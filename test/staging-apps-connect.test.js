'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mount, autoMount, trustedConfig } = require('../staging-apps-connect');

class Element {
  constructor() { this.textContent = ''; this.hidden = false; this.disabled = false; this.value = ''; this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async fire(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  focus() { this.focused = true; }
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(fetchImpl) {
  const authenticate = new Element(), form = new Element(), pairingId = new Element(), code = new Element(), submit = new Element(), logout = new Element(), status = new Element(), confirmation = new Element();
  const apps = ['gmail', 'google-calendar'].map((value) => ({ value, checked: true }));
  const elements = { 'staging-approve-authenticate': authenticate, 'staging-approve-form': form, 'staging-pairing-id': pairingId, 'staging-pairing-code': code, 'staging-approve-submit': submit, 'staging-approve-logout': logout, 'staging-approve-status': status, 'staging-approve-confirmation': confirmation };
  const documentObject = { getElementById: (id) => elements[id], querySelectorAll: () => apps.filter((item) => item.checked) };
  const windowObject = { isSecureContext: true, PublicKeyCredential: class {}, location: { origin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev' }, JARVIS_AUTH_CONFIG: { enabled: true, hudOrigin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev', workerUrl: 'https://jarvis-auth-staging.hlao-xiong.workers.dev' }, JARVIS_CONNECTORS_CONFIG: { enabled: true, workerOrigin: 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev' } };
  const credential = { id: 'credential', rawId: new Uint8Array([1]).buffer, type: 'public-key', response: { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null }, getClientExtensionResults: () => ({}) };
  const navigatorObject = { credentials: { get: async () => credential } };
  return { authenticate, form, pairingId, code, submit, logout, status, confirmation, apps, controller: mount(documentObject, windowObject, navigatorObject, fetchImpl) };
}

test('staging pairing approval authenticates by passkey, sends the in-memory bearer once, and clears it after approval', async () => {
  const calls = []; const f = fixture(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/auth/options')) return response({ challengeId: 'challenge', options: { challenge: 'AQ', allowCredentials: [] } });
    if (url.endsWith('/v1/auth/verify')) return response({ accessToken: 'a'.repeat(43) });
    if (url.endsWith('/pairings/approve')) return response({ status: 'approved' });
    throw new Error(`Unexpected request ${url}`);
  });
  await f.authenticate.fire('click');
  assert.equal(f.controller.state(), 'authenticated'); assert.equal(f.form.hidden, false);
  f.pairingId.value = 'ABCDEF'; f.code.value = '12345678';
  await f.form.fire('submit');
  const approval = calls.find((call) => call.url.endsWith('/pairings/approve'));
  assert.equal(approval.init.headers.Authorization, `Bearer ${'a'.repeat(43)}`);
  assert.deepEqual(JSON.parse(approval.init.body), { pairingAlias: 'ABCDEF', code: '12345678', apps: ['gmail', 'google-calendar'] });
  assert.equal(f.controller.state(), 'unauthenticated'); assert.match(f.status.textContent, /Google Apps device pairing approved/); assert.equal(f.confirmation.hidden, false); assert.equal(f.authenticate.hidden, true);
});

test('staging pairing approval gives expiry and session-revocation states without exposing server details', async () => {
  const calls = []; const f = fixture(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/auth/options')) return response({ challengeId: 'challenge', options: { challenge: 'AQ', allowCredentials: [] } });
    if (url.endsWith('/v1/auth/verify')) return response({ accessToken: 'b'.repeat(43) });
    return response({ error: 'sensitive internal detail' }, 410);
  });
  await f.authenticate.fire('click'); f.pairingId.value = 'ABCDEF'; f.code.value = '12345678'; await f.form.fire('submit');
  assert.match(f.status.textContent, /expired.*attempt/i); assert.doesNotMatch(f.status.textContent, /sensitive internal/i);
  assert.equal(f.controller.state(), 'authenticated');
  const logoutFetch = async (url) => response({}, url.endsWith('/v1/logout') ? 200 : 500);
  const g = fixture(logoutFetch); await g.authenticate.fire('click'); await g.logout.fire('click'); await settle();
  assert.equal(g.controller.state(), 'unauthenticated'); assert.match(g.status.textContent, /logged out/i);
});

test('staging approval controller fails closed outside the isolated staging origins', () => {
  assert.equal(trustedConfig({ location: { origin: 'https://evil.example' } }), null);
  assert.equal(trustedConfig({ location: { origin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev' }, JARVIS_AUTH_CONFIG: { enabled: true, hudOrigin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev', workerUrl: 'https://jarvis-auth-staging.hlao-xiong.workers.dev' }, JARVIS_CONNECTORS_CONFIG: { enabled: true, workerOrigin: 'https://jarvis-glasses-connected-apps.hlao-xiong.workers.dev' } }), null);
});

test('browser bootstrap mounts the page controller so the passkey button begins the authentication request', async () => {
  const authenticate = new Element(), form = new Element(), pairingId = new Element(), code = new Element(), submit = new Element(), logout = new Element(), status = new Element(), confirmation = new Element();
  const documentObject = { readyState: 'complete', getElementById: (id) => ({ 'staging-approve-authenticate': authenticate, 'staging-approve-form': form, 'staging-pairing-id': pairingId, 'staging-pairing-code': code, 'staging-approve-submit': submit, 'staging-approve-logout': logout, 'staging-approve-status': status, 'staging-approve-confirmation': confirmation }[id]), querySelectorAll: () => [] };
  let requested = false;
  const windowObject = { document: documentObject, isSecureContext: true, PublicKeyCredential: class {}, location: { origin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev' }, JARVIS_AUTH_CONFIG: { enabled: true, hudOrigin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev', workerUrl: 'https://jarvis-auth-staging.hlao-xiong.workers.dev' }, JARVIS_CONNECTORS_CONFIG: { enabled: true, workerOrigin: 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev' }, navigator: { credentials: { get: async () => { throw new DOMException('cancelled', 'NotAllowedError'); } } }, fetch: async (url) => { requested = url.endsWith('/v1/auth/options'); return response({ challengeId: 'challenge', options: { challenge: 'AQ', allowCredentials: [] } }); } };
  assert.equal(autoMount(windowObject), true);
  await authenticate.fire('click');
  assert.equal(requested, true); assert.match(status.textContent, /cancelled or unavailable/i);
});
