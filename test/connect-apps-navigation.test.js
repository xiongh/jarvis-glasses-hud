'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHud, navigationKey, bindHudKeyboard, handleConnectAppsKey, createGoogleAppsActions, createOwnerAppsClient, bindConnectAppsAction } = require('../app');
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

test('Neural Band-compatible sparse key events are normalized for navigation', () => {
  assert.equal(navigationKey({ key: 'Unidentified', code: 'ArrowRight' }), 'ArrowRight');
  assert.equal(navigationKey({ key: 'Unidentified', keyCode: 13 }), 'Enter');
  const hud = createHud(); hud.select();
  hud.handleKey({ key: 'Unidentified', which: 40, preventDefault() {} });
  assert.equal(hud.snapshot().selected, 1);
});

test('HUD keyboard binding captures non-bubbling Neural Band key events before focused controls consume them', () => {
  let listener = null; let capture = null;
  const target = { addEventListener(type, callback, option) { assert.equal(type, 'keydown'); listener = callback; capture = option; }, removeEventListener() {} };
  const received = []; const detach = bindHudKeyboard(target, (event) => received.push(navigationKey(event)));
  listener({ key: 'ArrowDown' });
  detach();
  assert.equal(capture, true);
  assert.deepEqual(received, ['ArrowDown']);
});

test('phone approval button starts a Worker pairing and rerenders only the Google Apps screen', async () => {
  let now = 1_000_000;
  const calls = [];
  const pairing = { pairingId: 'a'.repeat(48), pairingAlias: 'K7M2Q9', pollSecret: 'b'.repeat(64), userCode: '01234567', expiresAt: now + 180_000 };
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
  assert.equal(state.pairing.pairingAlias, pairing.pairingAlias);
  assert.equal(Object.hasOwn(state.pairing, 'pairingId'), false);
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
    fetchImpl: async () => { throw new Error('Relay temporarily unavailable: private-host.ts.net token=synthetic-private-detail'); },
  });
  const hud = makeAppsHud();
  const state = { status: 'Not paired.', pairing: null, busy: false, result: '' };
  const actions = createGoogleAppsActions({ state, connector, hud });
  await actions.startPairing();
  assert.match(state.status, /Google Apps POST \/v1\/hud\/pairings/);
  assert.match(state.status, /network, DNS, or browser CORS/);
  assert.match(state.status, /Retry the request/);
  assert.doesNotMatch(state.status, /Relay temporarily unavailable|private-host|synthetic-private-detail/);
  assert.equal(state.busy, false);
  assert.equal(hud.snapshot().screen, 'connect-apps');

  const livePairing = { pairingId: 'c'.repeat(48), pairingAlias: 'M7R4Q2', pollSecret: 'd'.repeat(64), userCode: '12345678', expiresAt: now + 180_000 };
  const expiring = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async () => ({ ok: true, status: 201, json: async () => livePairing }) });
  const expiryState = { status: '', pairing: null, busy: false, result: '' };
  const expiryActions = createGoogleAppsActions({ state: expiryState, connector: expiring, hud });
  await expiryActions.startPairing();
  now += 180_001;
  await expiryActions.pollPairing();
  assert.match(expiryState.status, /expired/i);
  assert.equal(expiryState.busy, false);
  assert.equal(hud.snapshot().screen, 'connect-apps');
});

test('startup stays restoring during a slow saved-approval check and redraws connected automatically', async () => {
  const hud = makeAppsHud();
  let complete;
  const delayed = new Promise((resolve) => { complete = resolve; });
  const state = { status: 'Restoring saved Google Apps approval…', pairing: null, busy: true, restoring: true, result: '' };
  const renders = [];
  const actions = createGoogleAppsActions({ state, connector: { restore: async () => delayed }, hud, render: () => renders.push({ status: state.status, restoring: state.restoring, busy: state.busy }) });
  const first = actions.restore();
  const duplicate = actions.restore();
  assert.equal(state.restoring, true);
  assert.match(state.status, /restoring/i);
  complete({ paired: true, storageAvailable: true, apps: ['gmail'] });
  await Promise.all([first, duplicate]);
  assert.equal(state.restoring, false);
  assert.equal(state.busy, false);
  assert.match(state.status, /connected: gmail/i);
  assert.ok(renders.some((view) => /connected/i.test(view.status)));
});

test('Face ID owner management uses only the handoff and owner grant routes, never a Pair ID route', async () => {
  const calls = [];
  const client = createOwnerAppsClient({ authWorker: 'https://auth.example', appsWorker: 'https://apps.example', fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/connected-apps/handoff')) return { ok: true, status: 201, json: async () => ({ handoff: 'h'.repeat(43) }) };
    if (String(url).endsWith('/v1/owner/session/handoff')) return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
    if (String(url).endsWith('/v1/owner/google/grant')) return { ok: true, status: 200, json: async () => ({ connected: true, apps: ['gmail'] }) };
    throw new Error('unexpected route');
  } });
  await client.authorize(); const grant = await client.status();
  assert.deepEqual(grant.apps, ['gmail']);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/v1/connected-apps/handoff', '/v1/owner/session/handoff', '/v1/owner/google/grant']);
  assert.equal(calls.some((call) => call.url.includes('/v1/hud/pairings')), false);
});

test('a fresh owner handoff recovers an existing Google grant after a revoked pre-LOCK session', async () => {
  const calls = []; let grantChecks = 0;
  const client = createOwnerAppsClient({ authWorker: 'https://auth.example', appsWorker: 'https://apps.example', fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init }); const route = new URL(url).pathname;
    if (route === '/v1/owner/google/grant' && grantChecks++ === 0) return { ok: false, status: 401, json: async () => ({ error: 'Owner session expired or was revoked.' }) };
    if (route === '/v1/connected-apps/handoff') return { ok: true, status: 201, json: async () => ({ handoff: 'h'.repeat(43) }) };
    if (route === '/v1/owner/session/handoff') return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
    if (route === '/v1/owner/google/grant') return { ok: true, status: 200, json: async () => ({ connected: true, apps: ['gmail', 'google-drive'] }) };
    throw new Error('unexpected route');
  }});
  await assert.rejects(client.status(), (error) => error.status === 401);
  await client.authorize(); const grant = await client.status();
  assert.deepEqual(grant.apps, ['gmail', 'google-drive']);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/v1/owner/google/grant', '/v1/connected-apps/handoff', '/v1/owner/session/handoff', '/v1/owner/google/grant']);
  assert.equal(calls[2].init.credentials, 'include'); assert.equal(calls[2].init.headers['X-Jarvis-HUD'], 'connected-apps');
});

test('an already-connected owner session can make a read-only AI Chat Google request without a device pairing', async () => {
  const calls = [];
  const client = createOwnerAppsClient({ authWorker: 'https://auth.example', appsWorker: 'https://apps.example', fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/owner/google/commands')) return { ok: true, status: 200, json: async () => ({ content: '1. Synthetic calendar event', status: 'completed' }) };
    throw new Error('unexpected route');
  } });
  assert.deepEqual(await client.readCommand("What's on my calendar tomorrow?"), { content: '1. Synthetic calendar event', status: 'completed' });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ['/v1/owner/google/commands']);
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['X-Jarvis-HUD'], 'connected-apps');
  const body = JSON.parse(calls[0].init.body); assert.equal(body.message, "What's on my calendar tomorrow?"); assert.equal(typeof body.timeZone, 'string'); assert.ok(body.timeZone.length > 0);
});
