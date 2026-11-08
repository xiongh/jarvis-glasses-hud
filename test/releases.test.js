'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const hud = require('../app');
const { PUBLIC_FILES, prepareRelease } = require('../scripts/prepare-release.cjs');
const { verifyReleaseDirectory } = require('../scripts/verify-release.cjs');
const { auditPublication } = require('../scripts/audit-publication.cjs');
const unlock = require('../unlock');

const root = path.resolve(__dirname, '..');
const makeTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hud-release-'));

class Target {
  constructor() { this.listeners = new Map(); this.timeouts = []; this.location = { reloads: 0, reload() { this.reloads += 1; } }; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  setInterval() { return 0; }
  setTimeout(handler) { this.timeouts.push(handler); return this.timeouts.length; }
  clearTimeout() {}
}

function button(hidden = false, owner = null) {
  return { hidden, disabled: false, dataset: {}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, click() { this.listeners.click?.(); }, focus() { if (owner) owner.activeElement = this; } };
}

test('Pages release stamps the visible build ID and verifies static asset integrity', (t) => {
  const output = makeTemp(); t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const buildId = 'a'.repeat(40);
  const prepared = prepareRelease({ source: root, output, buildId });
  const verified = verifyReleaseDirectory({ root: output, expectedBuildId: buildId });
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`data-build-id="${buildId}"`));
  assert.match(html, new RegExp(`BUILD ${buildId}`));
  assert.equal(verified.buildId, prepared.manifest.buildId);
});

test('public publication audit rejects credential patterns and passes the intended public routes', (t) => {
  assert.equal(auditPublication(root).credentialsFound, false);
  const copy = makeTemp(); t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  for (const file of PUBLIC_FILES) {
    const destination = path.join(copy, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(path.join(root, file), destination);
  }
  const configPath = path.join(copy, 'connectors-config.js');
  fs.appendFileSync(configPath, "\nconst testKey = 'AIza" + 'x'.repeat(36) + "';\n");
  assert.throws(() => auditPublication(copy), /credential detected/);
});

test('release updater detects a newer Pages build and reloads only after explicit activation', async (t) => {
  const current = 'a'.repeat(40); const next = 'b'.repeat(40); let manifestId = current; let manifestRequest = '';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { manifestRequest = String(url); return { ok: true, json: async () => ({ buildId: manifestId, files: { 'app.js': 'synthetic-hash' } }) }; };
  t.after(() => { globalThis.fetch = previousFetch; });
  const status = { textContent: '' };
  const lockedStatus = { textContent: '' };
  const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const lockedVersion = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); document.visibilityState = 'visible'; document.activeElement = null;
  const check = button(false, document); const reload = button(true, document);
  const lockedCheck = button(false, document); const lockedReload = button(true, document);
  const elements = { 'hud-update-status': status, 'hud-build-version': version, 'hud-check-updates': check, 'hud-reload-update': reload };
  document.getElementById = (id) => elements[id];
  document.querySelectorAll = (selector) => ({ '[data-hud-update-status]': [status, lockedStatus], '[data-hud-build-version]': [version, lockedVersion], '[data-hud-check-updates]': [check, lockedCheck], '[data-hud-reload-update]': [reload, lockedReload] }[selector] || []);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const waiting = { messages: [], postMessage(message) { this.messages.push(message); serviceWorker.dispatch('controllerchange'); } };
  const registration = new Target(); registration.waiting = null; registration.installing = null;
  registration.update = async () => { if (manifestId === next) registration.waiting = waiting; };
  serviceWorker.register = async () => registration;
  const target = new Target();
  const updater = hud.registerHudUpdates({ serviceWorker, onLine: true }, target, document);
  await new Promise(setImmediate);
  assert.equal(version.textContent, `BUILD ${current.slice(0, 12)}`);
  assert.equal(lockedVersion.textContent, version.textContent);
  assert.match(manifestRequest, /release-manifest\.json\?check=/);
  manifestId = next;
  await updater.check();
  assert.equal(reload.hidden, false);
  assert.equal(lockedReload.hidden, false);
  assert.match(status.textContent, /update is ready/);
  assert.match(lockedStatus.textContent, /update is ready/);
  assert.equal(target.location.reloads, 0);
  reload.click();
  assert.deepEqual(waiting.messages, [{ type: 'ACTIVATE_UPDATE' }]);
  assert.equal(target.location.reloads, 1);
});

test('reload button can refresh after a new worker activates in another app window', () => {
  const current = 'a'.repeat(40); const next = 'b'.repeat(40);
  const status = { textContent: '' }; const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version }[id]);
  const reload = button(true, document); document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version, 'hud-reload-update': reload }[id]);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const registration = new Target(); registration.waiting = null; registration.update = async () => {};
  serviceWorker.register = async () => registration;
  const target = new Target();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ buildId: current, files: {} }) });
  try {
  hud.registerHudUpdates({ serviceWorker, onLine: true }, target, document);
  serviceWorker.dispatch('message', { data: { type: 'JARVIS_HUD_UPDATE_ACTIVATED', buildId: next } });
  assert.equal(reload.hidden, false);
  reload.click();
  assert.equal(target.location.reloads, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('an update already installing when the HUD opens is observed and exposes its verified reload action', async () => {
  const current = 'a'.repeat(40); const next = 'b'.repeat(40);
  const status = { textContent: '' }; const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); const reload = button(true, document);
  document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version, 'hud-reload-update': reload }[id]);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const waiting = { postMessage() {} }; const installing = new Target(); installing.state = 'installing';
  const registration = new Target(); registration.waiting = waiting; registration.installing = installing; registration.update = async () => {};
  serviceWorker.register = async () => registration;
  const target = new Target(); const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ buildId: next, files: {} }) });
  try {
    hud.registerHudUpdates({ serviceWorker, onLine: true }, target, document);
    await new Promise(setImmediate);
    assert.equal(reload.hidden, false);
    assert.match(status.textContent, /update is ready/i);
  } finally { globalThis.fetch = previousFetch; }
});

test('a slow service-worker install leaves an accurate retryable status instead of an indefinite installing message', async () => {
  const current = 'a'.repeat(40); const next = 'b'.repeat(40);
  const status = { textContent: '' }; const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version }[id]);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const installing = new Target(); installing.state = 'installing'; const registration = new Target(); registration.waiting = null; registration.installing = installing; registration.update = async () => {};
  serviceWorker.register = async () => registration;
  const target = new Target(); const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ buildId: next, files: {} }) });
  try {
    hud.registerHudUpdates({ serviceWorker, onLine: true }, target, document);
    await new Promise(setImmediate);
    target.timeouts.at(-1)();
    assert.match(status.textContent, /still downloading.*CHECK UPDATES/i);
  } finally { globalThis.fetch = previousFetch; }
});

test('glasses arrow and Enter controls can operate the release actions', () => {
  const document = { activeElement: null };
  const first = button(false, document); const second = button(false, document); const group = { querySelectorAll: () => [first, second] };
  document.activeElement = first;
  const event = (key, target) => ({ key, target: { closest: () => group }, prevented: false, preventDefault() { this.prevented = true; } });
  const arrow = event('ArrowRight', first);
  assert.equal(hud.handleUpdateControlsKey(arrow, document), true);
  assert.equal(arrow.prevented, true);
  assert.equal(document.activeElement, second);
  let clicked = 0; second.click = () => { clicked += 1; };
  const enter = event('Enter', second);
  assert.equal(hud.handleUpdateControlsKey(enter, document), true);
  assert.equal(clicked, 1);
});

test('a stale Check Updates focus cannot trap glasses navigation after a Google response redraw', () => {
  const hudState = require('../app').createHud(); hudState.select(); hudState.move(3); hudState.select();
  const document = { activeElement: null };
  const staleUpdate = button(false, document); const updateGroup = { querySelectorAll: () => [staleUpdate] };
  document.activeElement = staleUpdate;
  const googleInput = button(false, document); const outlet = { querySelectorAll: () => [googleInput] };
  const event = { key: 'ArrowDown', target: { closest: () => null }, prevented: false, preventDefault() { this.prevented = true; } };
  assert.equal(hud.handleUpdateControlsKey(event, document), false);
  assert.equal(hud.handleConnectAppsKey(event, { hud: hudState, outlet, document }), true);
  assert.equal(event.prevented, true);
  assert.equal(document.activeElement, googleInput);
  assert.notEqual(event.target.closest('[data-update-controls]'), updateGroup);
});

test('Google Calendar response text is displayed unchanged by the HUD client', async () => {
  const state = { busy: false, result: '', status: '' };
  const formatted = '1. Today, 2:00 PM — Synthetic event';
  const actions = hud.createGoogleAppsActions({ state, connector: { runCommand: async () => formatted }, hud: { snapshot: () => ({ screen: 'connect-apps' }) } });
  await actions.runCommand('What is on my calendar?');
  assert.equal(state.result, formatted);
});

test('Google Apps UI gives local help for greetings without invoking the relay command', async () => {
  const state = { busy: false, result: '', status: '' }; let requests = 0;
  const actions = hud.createGoogleAppsActions({ state, connector: { commandHelp: () => 'Hello. Try a Google Apps request.', runCommand: async () => { requests += 1; } }, hud: { snapshot: () => ({ screen: 'connect-apps' }) } });
  await actions.runCommand('Hi');
  assert.equal(requests, 0);
  assert.equal(state.result, 'Hello. Try a Google Apps request.');
  assert.equal(state.status, 'No Google request was sent.');
});

test('canonical HUD retains the existing menu, passkey staging page, YouTube, and Google pairing entry points', () => {
  const ids = hud.MENU.map((item) => item.id);
  assert.deepEqual(ids, ['ai', 'vision', 'media', 'connect-apps', 'settings']);
  assert.equal(hud.MENU.find((item) => item.id === 'vision').available, false, 'camera Vision remains explicitly unavailable pending native integration');
  for (const file of ['staging-passkey.html', 'staging-passkey.js', 'auth-config.js', 'unlock.html', 'unlock.js', 'youtube-player.js', 'connectors.js', 'connectors-config.js']) assert.equal(fs.existsSync(path.join(root, file)), true, `${file} remains part of the canonical app`);
  const authConfig = fs.readFileSync(path.join(root, 'auth-config.js'), 'utf8');
  assert.match(authConfig, /enabled: false/);
  assert.equal(hud.shouldWaitForSession({ enabled: true }, 'locked'), true);
  assert.equal(hud.shouldWaitForSession({ enabled: true }, 'unlocked'), false);
  assert.equal(hud.shouldWaitForSession({ enabled: false }, 'locked'), false);
  assert.equal(unlock.trustedWorker({ enabled: true, workerUrl: 'https://jarvis-auth.test.workers.dev' }, { origin: 'https://xiongh.github.io' }), 'https://jarvis-auth.test.workers.dev');
  assert.equal(unlock.trustedWorker({ enabled: true, workerUrl: 'https://attacker.example' }, { origin: 'https://xiongh.github.io' }), '');
  assert.equal(unlock.trustedWorker({ enabled: true, workerUrl: 'https://jarvis-auth.test.workers.dev' }, { origin: 'https://attacker.example' }), '');
  assert.match(fs.readFileSync(path.join(root, 'connectors.js'), 'utf8'), /pairingAlias/);
});

test('YouTube pairing keeps its opaque request ID private and returns only the short phone code/link', async () => {
  const now = 1_800_000_000_000;
  const payload = { pairingId: 'a'.repeat(48), pollSecret: 'b'.repeat(64), userCode: '01234567', expiresAt: now + 180_000, connectUrl: 'https://jarvis-glasses-youtube.hlao-xiong.workers.dev/connect#pair=01234567' };
  const client = hud.createYouTubeClient({ now: () => now, backendOrigin: 'https://jarvis-glasses-youtube.hlao-xiong.workers.dev', fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }), storage: { getItem() { return null; }, setItem() {}, removeItem() {} } });
  const result = await client.startPairing();
  assert.deepEqual(Object.keys(result).sort(), ['connectUrl', 'expiresAt', 'userCode']);
  assert.equal(result.userCode, '01234567');
  assert.equal(JSON.stringify(result).includes(payload.pairingId), false);
  assert.equal(JSON.stringify(result).includes(payload.pollSecret), false);
});
