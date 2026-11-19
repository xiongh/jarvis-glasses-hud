'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STAGING_ORIGIN, isStagingDiagnostics, navigationCategory, createInputDiagnostics } = require('../input-diagnostics');

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { const entries = this.listeners.get(type) || []; entries.push(listener); this.listeners.set(type, entries); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, ...event }); }
}

test('input diagnostics are strictly limited to the Cloudflare staging origin', () => {
  assert.equal(isStagingDiagnostics({ hudOrigin: STAGING_ORIGIN }, { origin: STAGING_ORIGIN }), true);
  assert.equal(isStagingDiagnostics({ hudOrigin: STAGING_ORIGIN }, { origin: 'https://jarvis-hud.example.com' }), false);
  assert.equal(isStagingDiagnostics({}, { origin: STAGING_ORIGIN }), false);
});

test('input diagnostics records only safe event categories and keeps no raw input', () => {
  const target = new Events(); const documentObject = new Events(); documentObject.activeElement = { tagName: 'BUTTON' }; documentObject.visibilityState = 'visible';
  const diagnostics = createInputDiagnostics({ target, documentObject, maxEvents: 4 });
  diagnostics.start();
  target.dispatch('keydown', { key: 'ArrowDown', target: { tagName: 'BUTTON' } });
  target.dispatch('keyup', { key: 'ArrowDown', target: { tagName: 'BUTTON' } });
  documentObject.dispatch('focusin', { target: { tagName: 'INPUT', value: 'private passkey text' } });
  target.dispatch('pointerdown', { pointerType: 'touch', clientX: 123, clientY: 456 });
  target.dispatch('click', { pointerType: 'touch', target: { textContent: 'private account email' } });
  const snapshot = diagnostics.snapshot();
  assert.deepEqual(snapshot.counts, { keydown: 1, keyup: 1, focus: 1, pointer: 1, touch: 0, click: 1, window: 0 });
  assert.equal(snapshot.events[0].kind, 'CLICK');
  assert.equal(snapshot.events[0].detail, 'TOUCH');
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(JSON.stringify(snapshot).includes('123'), false);
  diagnostics.stop();
  target.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(diagnostics.snapshot().counts.keydown, 1);
});

test('navigation categories cover the documented D-pad inputs without exposing unknown keys', () => {
  assert.equal(navigationCategory({ key: 'ArrowLeft' }), 'LEFT');
  assert.equal(navigationCategory({ key: 'Enter' }), 'SELECT');
  assert.equal(navigationCategory({ key: 'Confidential typed value' }), 'OTHER');
});
