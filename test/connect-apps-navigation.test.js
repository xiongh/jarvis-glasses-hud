'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHud, handleConnectAppsKey, createGoogleAppsActions, bindConnectAppsAction } = require('../app');
const { createGoogleConnectorClient } = require('../connectors');

const makeAppsHud = () => {
  const hud = createHud();
  hud.select(); // welcome -> menu
  hud.move(3); // CONNECT APPS
  hud.select();
  assert.equal(hud.snapshot().screen, 'connect-apps');
  return hud;
};

const makeEvent = (key, target = { tagName: 'BODY' }) => ({
  key, target, prevented: false,
  preventDefault() { this.prevented = true; },
});

test('Enter with lost focus is consumed instead of selecting back to the main menu', () => {
  const hud = makeAppsHud();
  const body = { matches: () => false };
  const event = makeEvent('Enter');
  assert.equal(handleConnectAppsKey(event, { hud, outlet: { querySelectorAll: () => [] }, document: { activeElement: body } }), true);
  assert.equal(event.prevented, true);
  assert.equal(hud.snapshot().screen, 'connect-apps');
});

test('Enter activates the focused connector button once and keeps the screen open', () => {
  const hud = makeAppsHud();
  let clicks = 0;
  const button = { matches: (selector) => selector === '[data-connectors-focus]:not(input)', click: () => { clicks += 1; } };
  const event = makeEvent('Enter', button);
  handleConnectAppsKey(event, { hud, outlet: { querySelectorAll: () => [button] }, document: { activeElement: button } });
  assert.equal(clicks, 1);
  assert.equal(hud.snapshot().screen, 'connect-apps');
});

test('mouse and touch click activation use the same connector action and never navigate back', async () => {
  const hud = makeAppsHud();
  let clicks = 0;
  const button = {
    disabled: false,
    listener: null,
    addEventListener(type, listener) { assert.equal(type, 'click'); this.listener = listener; },
  };
  bindConnectAppsAction(button, () => { clicks += 1; });
  for (const pointerType of ['mouse', 'touch']) button.listener({ type: 'click', pointerType });
  assert.equal(clicks, 2);
  assert.equal(hud.snapshot().screen, 'connect-apps');
});

test('arrow navigation wraps focus without changing HUD screen; Escape uses the back action', () => {
  const hud = makeAppsHud();
  const focused = [];
  const controls = [{ focus: () => focused.push(0) }, { focus: () => focused.push(1) }];
  const outlet = { querySelectorAll: () => controls };
  const document = { activeElement: controls[1] };
  const down = makeEvent('ArrowDown');
  handleConnectAppsKey(down, { hud, outlet, document });
  assert.deepEqual(focused, [0]);
  assert.equal(hud.snapshot().screen, 'connect-apps');
  const escape = makeEvent('Escape');
  handleConnectAppsKey(escape, { hud, outlet, document });
  assert.equal(hud.snapshot().screen, 'menu');
});

test('phone approval button starts a Worker pairing and rerenders only the Google Apps screen', async () => {
  let now = 1_000_000;
  const calls = [];
  const pairing = { pairingId: 'a'.repeat(48), pollSecret: 'b'.repeat(64), userCode: '01234567', expiresAt: now + 180_000 };
  const connector = createGoogleConnectorClient({
    workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/v1/hud/pairings')) return { ok: true, status: 201, json: async () => pairing };
      if (String(url).endsWith('/v1/hud/pairings/poll')) return { ok: true, status: 200, json: async () => ({ status: 'pending' }) };
      throw new Error('Unexpected relay endpoint');
    },
  });
  const hud = makeAppsHud();
  const state = { status: 'Not paired.', pairing: null, busy: false, result: '' };
  const rendered = [];
  const actions = createGoogleAppsActions({ state, connector, hud, render: (view) => rendered.push(view.screen) });
  await actions.startPairing();
  assert.equal(calls[0].url, 'https://relay.example.workers.dev/v1/hud/pairings');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(state.pairing.pairingId, pairing.pairingId);
  assert.equal(state.pairing.userCode, '01234567');
  assert.equal(Object.hasOwn(state.pairing, 'pollSecret'), false);
  assert.equal(state.pairing.expiresAt, now + 180_000);
  await actions.pollPairing();
  assert.match(state.status, /waiting for owner approval/i);
  assert.equal(hud.snapshot().screen, 'connect-apps');
  assert.ok(rendered.every((screen) => screen === 'connect-apps'));
});

test('pairing errors and expired requests update status without navigating away', async () => {
  let now = 2_000_000;
  const connector = createGoogleConnectorClient({
    workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async () => { throw new Error('Relay temporarily unavailable'); },
  });
  const hud = makeAppsHud();
  const state = { status: 'Not paired.', pairing: null, busy: false, result: '' };
  const actions = createGoogleAppsActions({ state, connector, hud });
  await actions.startPairing();
  assert.match(state.status, /relay temporarily unavailable/i);
  assert.equal(hud.snapshot().screen, 'connect-apps');

  const livePairing = { pairingId: 'c'.repeat(48), pollSecret: 'd'.repeat(64), userCode: '12345678', expiresAt: now + 180_000 };
  const expiring = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async () => ({ ok: true, status: 201, json: async () => livePairing }) });
  const expiryState = { status: '', pairing: null, busy: false, result: '' };
  const expiryActions = createGoogleAppsActions({ state: expiryState, connector: expiring, hud });
  await expiryActions.startPairing();
  now += 180_001;
  await expiryActions.pollPairing();
  assert.match(expiryState.status, /expired/i);
  assert.equal(hud.snapshot().screen, 'connect-apps');
});
