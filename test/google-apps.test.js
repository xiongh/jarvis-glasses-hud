'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mount } = require('../google-apps');

class Element {
  constructor() { this.textContent = ''; this.hidden = false; this.disabled = false; this.listeners = new Map(); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { this.listeners.get('click')?.(); }
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ restore, runCommand, enabled = true } = {}) {
  const button = new Element(), status = new Element(), result = new Element();
  const documentObject = { getElementById: (id) => ({ 'test-all-google-apps': button, 'google-apps-status': status, 'google-apps-result': result }[id]) };
  const client = { available: () => enabled, restore, runCommand };
  const windowObject = { JARVIS_CONNECTORS_CONFIG: { enabled: true, workerOrigin: 'https://relay.example.workers.dev' }, jarvisGoogleConnectors: { CONNECTIVITY_TEST_COMMAND: '__JARVIS_GOOGLE_CONNECTIVITY_TEST_V1__', createGoogleConnectorClient: () => client } };
  return { button, status, result, api: mount(documentObject, windowObject) };
}

test('Google Apps button immediately shows a testing state and renders only sanitized successful results', async () => {
  let resolveCommand; const command = new Promise((resolve) => { resolveCommand = resolve; });
  const f = fixture({ restore: async () => ({ paired: true }), runCommand: async () => command }); await settle();
  assert.equal(f.button.textContent, 'TEST ALL GOOGLE APPS'); f.button.click();
  assert.equal(f.button.textContent, 'TESTING GOOGLE APPS…'); assert.match(f.status.textContent, /Running seven/);
  resolveCommand('Gmail: PASS\nCalendar: NO DATA\nContacts: FAIL (permission denied)\nprivate content'); await settle(); await settle();
  assert.match(f.result.textContent, /Gmail: PASS/); assert.match(f.result.textContent, /Calendar: NO DATA/); assert.match(f.result.textContent, /Contacts: FAIL \(permission denied\)/); assert.doesNotMatch(f.result.textContent, /private content/); assert.match(f.result.textContent, /Tasks: NOT TESTED/);
});

test('missing paired authorization remains visibly actionable and sends no command', async () => {
  let calls = 0; const f = fixture({ restore: async () => ({ paired: false, storageAvailable: true }), runCommand: async () => { calls += 1; } }); await settle();
  assert.equal(f.button.disabled, false); assert.equal(f.button.textContent, 'SHOW AUTHORIZATION STATUS'); f.button.click();
  assert.match(f.status.textContent, /No paired-device authorization/); assert.match(f.result.textContent, /Gmail: NOT TESTED/); assert.equal(calls, 0);
});

test('unavailable Safari storage is distinguished from a missing paired authorization', async () => {
  const f = fixture({ restore: async () => ({ paired: false, storageAvailable: false }), runCommand: async () => {} }); await settle();
  assert.match(f.status.textContent, /Safari storage is unavailable/); f.button.click();
  assert.match(f.status.textContent, /non-private Safari/); assert.match(f.result.textContent, /Gmail: NOT TESTED/);
});

test('network restore and command failures provide a retry or sanitized test failure state', async () => {
  let restores = 0; const f = fixture({ restore: async () => { restores += 1; return restores === 1 ? { paired: false, transient: true } : { paired: true }; }, runCommand: async () => { throw new Error('private token detail'); } }); await settle();
  assert.equal(f.button.textContent, 'RETRY AUTHORIZATION'); f.button.click(); await settle();
  assert.equal(f.button.textContent, 'TEST ALL GOOGLE APPS'); f.button.click(); await settle(); await settle();
  assert.match(f.status.textContent, /could not complete/i); assert.doesNotMatch(f.status.textContent, /private token/i); assert.match(f.result.textContent, /Gmail: NOT TESTED/);
});

test('Google Apps report preserves only the added fixed provider diagnostic labels', () => {
  const result = new Element();
  const { reportInto } = require('../google-apps');
  reportInto(result, 'Contacts: FAIL (API disabled)\nDocs: FAIL (resource unavailable)\nSheets: FAIL (scope denied)\nprivate provider detail');
  assert.match(result.textContent, /Contacts: FAIL \(API disabled\)/);
  assert.match(result.textContent, /Docs: FAIL \(resource unavailable\)/);
  assert.match(result.textContent, /Sheets: FAIL \(scope denied\)/);
  assert.doesNotMatch(result.textContent, /private provider detail/);
});
