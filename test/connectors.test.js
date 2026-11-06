'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { APPS, normalizeCompanionUrl, createGoogleConnectorClient } = require('../connectors');

const pairing = (now, expiresAt = now + 180_000) => ({
  pairingId: 'a'.repeat(48), pairingAlias: 'K7M2Q9', pollSecret: 'b'.repeat(64), userCode: '01234567', expiresAt,
});
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('companion URL accepts only HTTPS Tailscale Apps & Connections paths', () => {
  assert.equal(normalizeCompanionUrl('https://desktop.tailnet.ts.net/connect-apps.html'), 'https://desktop.tailnet.ts.net/connect-apps.html');
  for (const url of [
    'http://desktop.tailnet.ts.net/connect-apps.html',
    'https://evil.example/connect-apps.html',
    'https://desktop.tailnet.ts.net/',
    'https://user:password@desktop.tailnet.ts.net/connect-apps.html',
    'https://desktop.tailnet.ts.net/connect-apps.html?next=https://evil.example',
    'https://desktop.tailnet.ts.net/connect-apps.html#fragment',
  ]) assert.equal(normalizeCompanionUrl(url), '', url);
});

test('pairing validates the opaque ID, eight-digit code, poll secret, and three-minute lifetime', async () => {
  const now = 1_000_000;
  let sent;
  const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async (url, options) => { sent = { url, options }; return response(201, pairing(now)); } });
  const challenge = await client.startPairing();
  assert.deepEqual(challenge, { pairingAlias: 'K7M2Q9', userCode: '01234567', expiresAt: now + 180_000 });
  assert.equal(Object.hasOwn(challenge, 'pollSecret'), false);
  assert.deepEqual(JSON.parse(sent.options.body).apps, APPS);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.url, 'https://relay.example.workers.dev/v1/hud/pairings');
});

test('client rejects malformed or overlong pairing challenges', async () => {
  const now = 2_000_000;
  const malformed = [
    { ...pairing(now), pairingId: 'bad' },
    { ...pairing(now), pairingAlias: 'BAD!!!' },
    { ...pairing(now), userCode: '1234567' },
    { ...pairing(now), expiresAt: now + 210_001 },
  ];
  for (const challenge of malformed) {
    const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now, fetchImpl: async () => response(201, challenge) });
    await assert.rejects(client.startPairing(), /invalid or overlong pairing challenge/i);
    assert.equal(client.paired(), false);
  }
});

test('device capability stays in memory, commands use only relay routes, and revocation clears it on 401', async () => {
  const now = 3_000_000;
  const calls = [];
  const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/v1/hud/pairings')) return response(201, pairing(now));
      if (String(url).endsWith('/v1/hud/pairings/poll')) return response(200, { status: 'paired', accessToken: 'c'.repeat(64), deviceId: `hud_${'d'.repeat(32)}`, expiresAt: now + 900_000, apps: ['gmail'] });
      if (String(url).endsWith('/v1/hud/commands')) return response(401, { error: 'Authorization revoked.' });
      throw new Error('Unexpected relay route.');
    } });

  const challenge = await client.startPairing();
  assert.deepEqual(challenge, { pairingAlias: 'K7M2Q9', userCode: '01234567', expiresAt: now + 180_000 });
  assert.deepEqual(await client.pollPairing(), { paired: true, apps: ['gmail'], expiresAt: now + 900_000 });
  assert.deepEqual(JSON.parse(calls[1].options.body), { pairingId: 'a'.repeat(48), pollSecret: 'b'.repeat(64) }, 'HUD polling retains its internal pairing ID and private poll secret');
  assert.equal(client.paired(), true);
  await assert.rejects(client.runCommand('show latest emails'), /Authorization revoked/);
  assert.equal(client.paired(), false);
  await assert.rejects(client.runCommand('show latest emails'), /authorization expired/i);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://relay.example.workers.dev/v1/hud/commands');
  assert.equal(calls[2].options.credentials, 'omit');
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${'c'.repeat(64)}`);
  assert.equal(calls.some((call) => /googleapis\.com|oauth|callback/i.test(call.url)), false);
});

test('HUD shows a configured private companion link and keeps connector scripts in offline cache', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '..', 'connectors-config.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  assert.match(app, /normalizeCompanionUrl\?\.\(relayConfig\.phoneCompanionUrl\)/);
  assert.match(app, /OPEN APPS & CONNECTIONS ON IPHONE/);
  assert.match(app, /PAIRING ID · \$\{googleConnectorState\.pairing\.pairingAlias\}/);
  assert.match(app, /COPY PAIRING ID/);
  assert.doesNotMatch(app, /PAIRING ID · \$\{googleConnectorState\.pairing\.pairingId\}/);
  assert.match(app, /role', 'status'/);
  assert.doesNotMatch(app, /YOUR_PRIVATE_JARVIS_ORIGIN/);
  assert.match(config, /phoneCompanionUrl: 'https:\/\/[a-z0-9.-]+\.ts\.net\/connect-apps\.html'/);
  assert.match(worker, /'\.\/connectors-config\.js', '\.\/connectors\.js'/);
});
