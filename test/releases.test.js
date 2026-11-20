'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const hud = require('../app');
const { HASHED_FILES, PUBLIC_FILES, prepareRelease } = require('../scripts/prepare-release.cjs');
const { verifyReleaseDirectory } = require('../scripts/verify-release.cjs');
const { createResilientFetch, verifyDeployment } = require('../scripts/verify-deployment.cjs');
const { auditPublication } = require('../scripts/audit-publication.cjs');
const { main: deployStaging } = require('../scripts/deploy-unified-staging.cjs');
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

test('release verification rejects a service-worker cache generation that differs from the visible build', (t) => {
  const output = makeTemp(); t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const buildId = 'c'.repeat(40);
  prepareRelease({ source: root, output, buildId });
  const worker = path.join(output, 'service-worker.js');
  fs.writeFileSync(worker, fs.readFileSync(worker, 'utf8').replace(buildId, 'd'.repeat(40)));
  assert.throws(() => verifyReleaseDirectory({ root: output, expectedBuildId: buildId }), /Service-worker cache build ID/);
});

test('staging deployment is restricted to the approved GitHub Actions workflow', async () => {
  await assert.rejects(() => deployStaging(['--source', root, '--deploy'], { environment: {} }), /approved GitHub Actions workflow/);
});

test('deployment verification retries a transient post-deploy fetch failure and verifies every published asset', async () => {
  const buildId = 'e'.repeat(40);
  const assets = Object.fromEntries(HASHED_FILES.map((file) => [file, Buffer.from(`asset:${file}`)]));
  const manifest = { schema: 1, app: 'JARVIS HUD', buildId, files: Object.fromEntries(HASHED_FILES.map((file) => [file, require('node:crypto').createHash('sha256').update(assets[file]).digest('hex')])) };
  const manifestText = `${JSON.stringify(manifest)}\n`;
  const health = { schema: 1, status: 'ok', app: 'JARVIS HUD', buildId, manifestSha256: require('node:crypto').createHash('sha256').update(manifestText).digest('hex') };
  let healthRequests = 0; const waits = []; const retries = [];
  const fetchImpl = async (url) => {
    const file = new URL(url).pathname.slice(1);
    if (file === 'health.json') {
      healthRequests += 1;
      if (healthRequests === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(health));
    }
    if (file === 'release-manifest.json') return new Response(manifestText);
    return new Response(assets[file]);
  };
  const verified = await verifyDeployment({ baseUrl: 'https://staging.example/', expectedBuildId: buildId, fetchImpl, attempts: 2, initialDelayMs: 3, maxDelayMs: 3, wait: async (ms) => { waits.push(ms); }, onRetry: (info) => retries.push(info) });
  assert.equal(verified.buildId, buildId);
  assert.deepEqual(waits, [3]);
  assert.equal(retries.length, 1);
  assert.match(retries[0].reason, /fetch failed/);
});

test('deployment verification retries until a newly published manifest matches its health generation', async () => {
  const buildId = 'd'.repeat(40);
  const assets = Object.fromEntries(HASHED_FILES.map((file) => [file, Buffer.from(`asset:${file}`)]));
  const manifest = { schema: 1, app: 'JARVIS HUD', buildId, files: Object.fromEntries(HASHED_FILES.map((file) => [file, require('node:crypto').createHash('sha256').update(assets[file]).digest('hex')])) };
  const manifestText = `${JSON.stringify(manifest)}\n`;
  const health = { schema: 1, status: 'ok', app: 'JARVIS HUD', buildId, manifestSha256: require('node:crypto').createHash('sha256').update(manifestText).digest('hex') };
  let manifestRequests = 0; const waits = [];
  const fetchImpl = async (url) => {
    const file = new URL(url).pathname.slice(1);
    if (file === 'health.json') return new Response(JSON.stringify(health));
    if (file === 'release-manifest.json') return new Response(manifestRequests++ === 0 ? '{"schema":1,"buildId":"stale"}\n' : manifestText);
    return new Response(assets[file]);
  };
  const verified = await verifyDeployment({ baseUrl: 'https://staging.example/', expectedBuildId: buildId, fetchImpl, attempts: 2, initialDelayMs: 2, maxDelayMs: 2, wait: async (ms) => { waits.push(ms); } });
  assert.equal(verified.buildId, buildId);
  assert.deepEqual(waits, [2]);
});

test('resilient deployment fetch falls back to HTTPS curl only after native fetch fails', async () => {
  let fallbacks = 0; let curlCalls = 0;
  const request = createResilientFetch({
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
    curlImpl: async (url, options) => { curlCalls += 1; assert.equal(url, 'https://staging.example/health.json'); assert.equal(options.headers.Accept, 'application/json'); return new Response('{"ok":true}'); },
    onFallback: () => { fallbacks += 1; },
  });
  assert.equal(await (await request('https://staging.example/health.json', { headers: { Accept: 'application/json' } })).text(), '{"ok":true}');
  assert.equal(fallbacks, 1);
  assert.equal(curlCalls, 1);
});

test('deployment verification fails closed on a published asset hash mismatch without retrying', async () => {
  const buildId = 'f'.repeat(40); let retries = 0;
  const manifest = { schema: 1, app: 'JARVIS HUD', buildId, files: Object.fromEntries(HASHED_FILES.map((file) => [file, 'a'.repeat(64)])) };
  const manifestText = `${JSON.stringify(manifest)}\n`;
  const health = { schema: 1, status: 'ok', app: 'JARVIS HUD', buildId, manifestSha256: require('node:crypto').createHash('sha256').update(manifestText).digest('hex') };
  const fetchImpl = async (url) => {
    const file = new URL(url).pathname.slice(1);
    if (file === 'health.json') return new Response(JSON.stringify(health));
    if (file === 'release-manifest.json') return new Response(manifestText);
    return new Response('wrong bytes');
  };
  await assert.rejects(() => verifyDeployment({ baseUrl: 'https://staging.example/', expectedBuildId: buildId, fetchImpl, attempts: 3, wait: async () => { throw new Error('should not wait'); }, onRetry: () => { retries += 1; } }), /SHA-256 mismatch/);
  assert.equal(retries, 0);
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

test('release updater attempts a verified check when the display online hint is false', async (t) => {
  const current = 'a'.repeat(40); let manifestRequest = '';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { manifestRequest = String(url); return { ok: true, json: async () => ({ buildId: current, files: {} }) }; };
  t.after(() => { globalThis.fetch = previousFetch; });
  const status = { textContent: '' }; const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version }[id]);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const registration = new Target(); registration.waiting = null; registration.installing = null; registration.update = async () => {};
  serviceWorker.register = async () => registration;
  const updater = hud.registerHudUpdates({ serviceWorker, onLine: false }, new Target(), document);
  await new Promise(setImmediate); await updater.check();
  assert.match(manifestRequest, /release-manifest\.json\?check=/);
  assert.match(status.textContent, /is current/i);
});

test('release updater uses the verified manifest when this Web App runtime rejects service workers', async (t) => {
  const current = 'a'.repeat(40); let manifestRequest = '';
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { manifestRequest = String(url); return { ok: true, json: async () => ({ buildId: current, files: {} }) }; };
  t.after(() => { globalThis.fetch = previousFetch; });
  const status = { textContent: '' }; const version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version }[id]);
  const serviceWorker = new Target(); serviceWorker.register = async () => { throw new Error('unsupported'); };
  hud.registerHudUpdates({ serviceWorker, onLine: false }, new Target(), document);
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.match(manifestRequest, /release-manifest\.json\?check=/);
  assert.match(status.textContent, /is current/i);
});

test('an update activated in another tab offers an explicit reload without interrupting this page', () => {
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
  assert.equal(target.location.reloads, 0);
  serviceWorker.dispatch('message', { data: { type: 'JARVIS_HUD_UPDATE_ACTIVATED', buildId: next } });
  assert.equal(target.location.reloads, 0, 'an update message does not interrupt an active interaction');
  reload.click();
  assert.equal(target.location.reloads, 1, 'the explicit reload action moves to the verified active release');
  } finally { globalThis.fetch = previousFetch; }
});

test('RELOAD LATEST waits for confirmation, and CANCEL leaves the active session and release unchanged', async () => {
  const current = 'a'.repeat(40), next = 'b'.repeat(40);
  const status = { textContent: '' }, version = { dataset: { buildId: current }, textContent: `BUILD ${current}` };
  const document = new Target(); const reload = button(false, document), cancel = button(false, document), confirm = button(false, document);
  const dialog = { shown: 0, showModal() { this.shown += 1; }, addEventListener() {} };
  document.getElementById = (id) => ({ 'hud-update-status': status, 'hud-build-version': version, 'hud-reload-update': reload, 'jarvis-update-confirm': dialog, 'jarvis-update-cancel': cancel, 'jarvis-update-confirm-reload': confirm }[id]);
  const serviceWorker = new Target(); serviceWorker.controller = {};
  const waiting = { messages: [], postMessage(message) { this.messages.push(message); serviceWorker.dispatch('controllerchange'); } };
  const registration = new Target(); registration.waiting = waiting; registration.update = async () => {};
  serviceWorker.register = async () => registration;
  const target = new Target(); const oldFetch = globalThis.fetch; globalThis.fetch = async () => ({ ok: true, json: async () => ({ buildId: next, files: {} }) });
  try {
    hud.registerHudUpdates({ serviceWorker, onLine: true }, target, document);
    await new Promise(setImmediate);
    reload.click(); reload.click();
    assert.equal(dialog.shown, 1, 'repeated clicks cannot bypass or loop the confirmation');
    assert.deepEqual(waiting.messages, []); assert.equal(target.location.reloads, 0);
    cancel.click();
    assert.match(status.textContent, /cancelled/i); assert.deepEqual(waiting.messages, []); assert.equal(target.location.reloads, 0);
    reload.click(); confirm.click();
    assert.deepEqual(waiting.messages, [{ type: 'ACTIVATE_UPDATE' }]); assert.equal(target.location.reloads, 1);
  } finally { globalThis.fetch = oldFetch; }
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

test('Google Apps connectivity action only renders the sanitized relay report', async () => {
  const state = { busy: false, result: '', status: '' };
  const actions = hud.createGoogleAppsActions({ state, connector: { runCommand: async (command) => { assert.equal(command, '__JARVIS_GOOGLE_CONNECTIVITY_TEST_V1__'); return 'Gmail: PASS\nDocs: NO DATA'; } }, hud: { snapshot: () => ({ screen: 'connect-apps' }) } });
  await actions.testAllApps();
  assert.equal(state.result, 'Gmail: PASS\nDocs: NO DATA');
  assert.equal(state.status, 'Google Apps connectivity test complete.');
});

test('canonical HUD uses Media as the app home and retains the secured phone and device entry points', () => {
  const ids = hud.MENU.map((item) => item.id);
  assert.deepEqual(ids, ['ai', 'vision', 'media', 'settings']);
  assert.equal(hud.MEDIA_APPS.some((item) => item.id === 'youtube'), true);
  assert.equal(hud.MEDIA_APPS.filter((item) => item.experience === 'google-app').length, 7);
  assert.equal(hud.MENU.find((item) => item.id === 'vision').available, false, 'camera Vision remains explicitly unavailable pending native integration');
  for (const file of ['staging-passkey.html', 'staging-passkey.js', 'staging-apps-connect.html', 'staging-apps-connect.js', 'auth-config.js', 'unlock.html', 'unlock.js', 'youtube-player.js', 'connectors.js', 'connectors-config.js', 'google-apps.html', 'google-apps.js']) assert.equal(fs.existsSync(path.join(root, file)), true, `${file} remains part of the canonical app`);
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

test('staging Connections app uses only isolated Workers and keeps the owner bearer out of persistent storage', () => {
  const html = fs.readFileSync(path.join(root, 'staging-apps-connect.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'staging-apps-connect.js'), 'utf8');
  assert.match(html, /staging-connections\.webmanifest/); assert.match(html, /Outlook Mail/); assert.match(html, /Facebook/); assert.match(html, /NO CONNECTION REQUIRED/);
  assert.match(script, /jarvis-auth-staging\.hlao-xiong\.workers\.dev/);
  assert.match(script, /jarvis-connected-apps-staging\.hlao-xiong\.workers\.dev/);
  assert.doesNotMatch(`${html}\n${script}`, /staging-pairing-id|owner\/hud\/pairings\/approve/);
  assert.match(script, /\/v1\/logout/);
  assert.doesNotMatch(`${html}\n${script}`, /localStorage|sessionStorage|indexedDB|desktop-frvv2vt\.taile1cf65\.ts\.net|jarvis-glasses-connected-apps\.hlao-xiong\.workers\.dev/);
});

test('limited Google Apps staging entry point has no OAuth, pairing, passkey, or data-rendering surface', () => {
  const html = fs.readFileSync(path.join(root, 'google-apps.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'google-apps.js'), 'utf8');
  assert.match(html, /RESTORE PAIRED AUTHORIZATION/);
  assert.match(html, /google-apps\.js\?staging-google-test=1/);
  assert.doesNotMatch(`${html}\n${script}`, /oauth|startPairing|credentials\.get|unlock\.js/i);
  assert.match(script, /NOT TESTED/);
  assert.match(script, /safeLine/);
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
