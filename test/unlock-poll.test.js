'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const unlock = require('../unlock');

const transactionId = 'a'.repeat(24), pollSecret = 'b'.repeat(43);
const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name] || null }, json: async () => body });

function harness(responses, config = {}) {
  const timers = []; const events = []; const listeners = {};
  let documentObject;
  const element = () => ({ hidden: false, disabled: false, textContent: '', clicks: 0, focus() { documentObject.activeElement = this; }, click() { this.clicks += 1; this.listeners?.click?.(); }, addEventListener(type, listener) { this.listeners ||= {}; this.listeners[type] = listener; } });
  const lock = element(), app = element(), status = element(), code = element(), retry = element(), faceId = element(), phoneUnlock = element(), manualLock = element();
  documentObject = { body: { dataset: {} }, activeElement: null, getElementById: (id) => ({ 'jarvis-session-lock': lock, 'jarvis-glasses-hud': app, 'lock-status': status, 'lock-code': code, 'lock-retry': retry, 'lock-face-id': faceId, 'lock-phone-unlock': phoneUnlock, 'hud-lock': manualLock }[id]), addEventListener(type, listener) { listeners[type] = listener; }, dispatchEvent(event) { events.push(event.type); } };
  const windowObject = { JARVIS_AUTH_CONFIG: { enabled: true, hudOrigin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev', workerUrl: 'https://jarvis-auth-staging.hlao-xiong.workers.dev', ...config }, location: { origin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev' }, Event: class { constructor(type) { this.type = type; } }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, dispatchEvent(event) { events.push(event.type); } };
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); const next = responses.shift(); assert.ok(next, `unexpected request ${url}`); return next; };
  const controller = unlock.mountGlasses(documentObject, { windowObject, navigatorObject: { onLine: config.navigatorOnLine ?? true }, fetchImpl, now: () => 1_000, setTimer(handler, delay) { const timer = { delay, cleared: false, fired: false, handler: () => { timer.fired = true; handler(); } }; timers.push(timer); return timer; }, clearTimer(timer) { timer.cleared = true; } });
  return { controller, timers, events, listeners, documentObject, status, lock, app, retry, faceId, phoneUnlock, manualLock, calls };
}

test('companion polling stays below the Auth Worker window and stops after one successful unlock', async () => {
  const h = harness([
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }),
    json(200, { unlocked: false, pending: true, expiresAt: 1_100 }),
    json(200, { unlocked: true, expiresAt: 2_800, assertion: 'x.y.z', assertionExpiresAt: 1_120 }),
  ]);
  await new Promise(setImmediate);
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].delay, 6_000);
  h.timers[0].handler(); await new Promise(setImmediate);
  assert.equal(h.lock.hidden, true); assert.equal(h.app.inert, false); assert.equal(h.events.filter((type) => type === 'jarvis-glasses-assertion').length, 1);
  assert.equal(h.timers.filter((timer) => timer.delay === 6_000 && !timer.cleared && !timer.fired).length, 0);
});

test('a second start cancels the old loop and an in-flight poll cannot create a parallel loop', async () => {
  const h = harness([
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }), json(200, { unlocked: false, pending: true }),
    json(201, { transactionId: 'c'.repeat(24), pollSecret: 'd'.repeat(43), code: '87654321', expiresAt: 1_100 }), json(200, { unlocked: false, pending: true }),
  ]);
  await new Promise(setImmediate); const first = h.timers[0];
  await h.controller.start(); await new Promise(setImmediate);
  assert.equal(first.cleared, true);
  assert.equal(h.timers.filter((timer) => !timer.cleared).length, 1);
});

test('429 backs off without darkening the HUD and expired transactions stop polling with a retryable error', async () => {
  const h = harness([
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }),
    json(429, { error: 'Too many requests.' }, { 'Retry-After': '20' }),
    json(200, { unlocked: false, pending: false }),
  ]);
  await new Promise(setImmediate);
  assert.match(h.status.textContent, /rate-limited/i); assert.equal(h.timers[0].delay, 20_000);
  h.timers[0].handler(); await new Promise(setImmediate);
  assert.match(h.status.textContent, /expired/i); assert.equal(h.lock.hidden, false); assert.equal(h.app.inert, true);
});

test('unlock polling keeps no sessionStorage state to resume after reload', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'unlock.js'), 'utf8');
  assert.doesNotMatch(source, /sessionStorage|resumePendingUnlock/);
});

test('a refresh restores only a server-authorized session and manual LOCK revokes it', async () => {
  const h = harness([
    json(200, { authorized: true, expiresAt: 2_800, assertion: 'x.y.z', assertionExpiresAt: 1_120 }),
    json(200, { loggedOut: true }),
  ], { sessionRestore: true });
  await new Promise(setImmediate);
  assert.equal(h.lock.hidden, true); assert.equal(h.app.inert, false);
  assert.match(h.calls[0].url, /\/v1\/hud\/session\/restore$/);
  assert.equal(h.calls[0].options.credentials, 'include'); assert.equal(h.calls[0].options.headers['X-Jarvis-HUD'], 'restore');
  h.manualLock.listeners.click(); await new Promise(setImmediate);
  assert.match(h.calls[1].url, /\/v1\/logout$/); assert.equal(h.calls[1].options.headers['X-Jarvis-HUD'], 'lock');
  assert.equal(h.lock.hidden, false); assert.equal(h.app.inert, true); assert.match(h.status.textContent, /locked/i);
});

test('a rejected restoration stays locked and cannot synthesize an authorization assertion', async () => {
  const h = harness([
    json(401, { authorized: false }),
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }),
    json(200, { unlocked: false, pending: true }),
  ], { sessionRestore: true });
  await new Promise(setImmediate);
  assert.equal(h.lock.hidden, false); assert.equal(h.app.inert, true);
  assert.equal(h.events.includes('jarvis-glasses-assertion'), false);
  assert.match(h.status.textContent, /iPhone/i);
});

test('display runtimes with a false online hint still restore and create companion approval requests', async () => {
  const restored = harness([
    json(200, { authorized: true, session: 'restored', expiresAt: 2_800, assertion: 'x.y.z', assertionExpiresAt: 1_120 }),
  ], { sessionRestore: true, navigatorOnLine: false });
  await new Promise(setImmediate);
  assert.equal(restored.lock.hidden, true);
  assert.match(restored.calls[0].url, /\/v1\/hud\/session\/restore$/);

  const companion = harness([
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }),
    json(200, { unlocked: false, pending: true, expiresAt: 1_100 }),
  ], { navigatorOnLine: false });
  await new Promise(setImmediate);
  assert.match(companion.calls[0].url, /\/v1\/glasses\/unlock\/start$/);
  assert.equal(companion.status.textContent, 'Open the JARVIS Unlock page on your iPhone and enter this code.');
});

test('locked glasses route Neural Band arrows and Select across the companion unlock controls', async () => {
  const h = harness([
    json(201, { transactionId, pollSecret, code: '12345678', expiresAt: 1_100 }),
    json(200, { unlocked: false, pending: true, expiresAt: 1_100 }),
  ]);
  await new Promise(setImmediate);
  assert.equal(h.documentObject.activeElement, h.retry, 'companion unlock is initially focused');
  const event = (key) => ({ key, target: { closest: () => null }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
  const up = event('ArrowUp'); h.listeners.keydown(up);
  assert.equal(h.documentObject.activeElement, h.phoneUnlock);
  assert.equal(up.prevented, true); assert.equal(up.stopped, true);
  const select = event('Enter'); h.listeners.keydown(select);
  assert.equal(h.phoneUnlock.clicks, 1);
  assert.equal(select.prevented, true); assert.equal(select.stopped, true);
  const down = event('ArrowDown'); h.listeners.keydown(down);
  assert.equal(h.documentObject.activeElement, h.retry);
});
