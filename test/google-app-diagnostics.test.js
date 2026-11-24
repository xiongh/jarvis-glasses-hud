'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const hud = require('../app');

test('glasses Google App labels distinguish empty calendars, provider reconnects, and device approval failures', () => {
  assert.equal(hud.googleAppOutcomeLabel('CALENDAR', { status: 'empty' }), 'CALENDAR · NO EVENTS FOR THIS DAY');
  assert.equal(hud.googleAppOutcomeLabel('CALENDAR', { status: 'reconnect_required' }), 'CALENDAR NEEDS GOOGLE RECONNECT · OPEN CONNECTIONS ON PHONE');
  assert.equal(hud.googleAppOutcomeLabel('CALENDAR', { status: 'temporary_error' }), 'CALENDAR TEMPORARILY UNAVAILABLE · RETRY');
  assert.equal(hud.googleAppFailureLabel('CALENDAR', { status: 401 }), 'CALENDAR PHONE APPROVAL EXPIRED OR REVOKED · APPROVE AGAIN ON PHONE');
  assert.equal(hud.googleAppFailureLabel('CALENDAR', { category: 'network-unreachable' }), 'CALENDAR NETWORK UNAVAILABLE · CHECK CONNECTION THEN RETRY');
});
