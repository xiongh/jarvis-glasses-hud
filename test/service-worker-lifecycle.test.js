'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function workerHarness({ failInstall = false } = {}) {
  const handlers = new Map(); const deleted = []; let skipped = 0;
  const cachedAssets = [];
  const cache = { addAll: async (assets) => { cachedAssets.push(...assets.map((asset) => asset.url)); if (failInstall) throw new Error('offline'); }, match: async () => null };
  const caches = { open: async () => cache, keys: async () => ['jarvis-glasses-hud-v5-expired', 'jarvis-glasses-hud-v5-old', 'jarvis-glasses-hud-v5-local'], delete: async (key) => { deleted.push(key); return true; } };
  const self = { location: { href: 'https://hud.example/', origin: 'https://hud.example' }, addEventListener: (name, fn) => handlers.set(name, fn), skipWaiting: async () => { skipped += 1; }, clients: { claim: async () => {}, matchAll: async () => [] } };
  class Request { constructor(url, options) { this.url = typeof url === 'string' ? url : (url.url || String(url)); this.options = options; this.method = options?.method || url?.method || 'GET'; } }
  const fetched = [];
  const fetch = async (request) => { fetched.push({ url: request.url || String(request), options: request.options }); return { ok: true }; };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8'), { self, caches, Request, URL, Promise, fetch, Set });
  const dispatch = async (name, data, request = { method: 'GET', url: 'https://hud.example/app.js' }) => { let promise; handlers.get(name)({ data, waitUntil(value) { promise = value; }, respondWith(value) { promise = value; }, request }); await promise; };
  return { dispatch, deleted, cachedAssets, fetched, skipped: () => skipped };
}

test('a complete service-worker cache waits for explicit activation and retains one predecessor', async () => {
  const worker = workerHarness();
  await worker.dispatch('install');
  assert.ok(worker.cachedAssets.some((asset) => asset.endsWith('/input-diagnostics.js')));
  assert.equal(worker.cachedAssets.some((asset) => asset.includes('staging-apps-connect')), false, 'Connections controls must not be inherited from a predecessor cache');
  assert.equal(worker.skipped(), 0);
  await worker.dispatch('message', { type: 'ACTIVATE_UPDATE' });
  assert.equal(worker.skipped(), 1);
  await worker.dispatch('activate');
  assert.deepEqual(worker.deleted, ['jarvis-glasses-hud-v5-expired']);
});

test('a failed install never activates and removes only its incomplete cache', async () => {
  const worker = workerHarness({ failInstall: true });
  await assert.rejects(worker.dispatch('install'), /offline/);
  assert.equal(worker.skipped(), 0);
  assert.deepEqual(worker.deleted, ['jarvis-glasses-hud-v5-local']);
});

test('the Connections routes and controller always bypass a predecessor cache', async () => {
  const worker = workerHarness();
  for (const path of ['/staging-apps-connect', '/staging-apps-connect.html', '/staging-apps-connect.js?connections=old']) {
    await worker.dispatch('fetch', undefined, { method: 'GET', url: `https://hud.example${path}` });
  }
  assert.equal(worker.fetched.length, 3);
  assert.ok(worker.fetched.every(({ options }) => options?.cache === 'no-store'));
});
