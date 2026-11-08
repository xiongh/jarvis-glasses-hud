'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { APPS, commandHelp, normalizeCompanionUrl, createGoogleConnectorClient } = require('../connectors');

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
    ['https', '://user', ':password@desktop.tailnet.ts.net/connect-apps.html'].join(''),
    'https://desktop.tailnet.ts.net/connect-apps.html?next=https://evil.example',
    'https://desktop.tailnet.ts.net/connect-apps.html#fragment',
  ]) assert.equal(normalizeCompanionUrl(url), '', url);
});

test('greetings and unsupported conversation never reach the Google relay, while oldest-email requests do', async () => {
  let calls = 0;
  const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, fetchImpl: async () => { calls += 1; throw new Error('must not call relay'); } });
  for (const command of ['Hi', 'Hello JARVIS', 'Tell me a joke']) {
    const reply = await client.runCommand(command);
    assert.match(reply, /Hello|I can help/i, command);
  }
  assert.equal(calls, 0);
  const now = 3_000_000;
  const oldest = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now, fetchImpl: async (url) => { const path=String(url); if(path.endsWith('/renew'))return response(200,{ deviceId: `hud_${'a'.repeat(32)}`, accessToken: 'b'.repeat(64), renewalToken: 'c'.repeat(64), expiresAt: now + 900_000, deviceExpiresAt: now + 30 * 86400000, apps: ['gmail'] }); if(path.endsWith('/commands'))return response(200,{jobId:'d'.repeat(40)}); return response(200,{status:'complete',result:{content:'Oldest email'}}); }, storage: { read: async () => ({ workerOrigin: 'https://relay.example.workers.dev', deviceId: `hud_${'a'.repeat(32)}`, renewalToken: 'a'.repeat(64), deviceExpiresAt: now + 30 * 86400000 }), write: async () => {}, remove: async () => {} } });
  await oldest.restore();
  assert.equal(await oldest.runCommand('What is my first email?'), 'Oldest email');
  assert.match(commandHelp('Show my latest five emails'), /^$/);
  assert.match(commandHelp('Who emailed me yesterday?'), /^$/);
});

test('latest-email intent reaches the relay with an explicit count while Google failures stay surfaced safely', async () => {
  const now = 3_000_000; const calls = [];
  const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/v1/hud/renew')) return response(200, { deviceId: `hud_${'a'.repeat(32)}`, accessToken: 'b'.repeat(64), renewalToken: 'c'.repeat(64), expiresAt: now + 900_000, deviceExpiresAt: now + 30 * 86400000, apps: ['gmail'] });
      if (String(url).endsWith('/v1/hud/commands')) return response(503, { error: 'upstream failed' });
      throw new Error('Unexpected relay route.');
    }, storage: { read: async () => ({ workerOrigin: 'https://relay.example.workers.dev', deviceId: `hud_${'a'.repeat(32)}`, renewalToken: 'a'.repeat(64), deviceExpiresAt: now + 30 * 86400000 }), write: async () => {}, remove: async () => {} } });
  await client.restore();
  await assert.rejects(client.runCommand('Show my latest five emails'), /HTTP 503.*Relay unavailable/i);
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/hud/commands')).length, 1);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { message: 'Show my latest five emails' });
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

test('Google OAuth credentials never enter the persistent device session', async () => {
  const record = new Map();
  const storage = { read: async key => record.get(key), write: async value => record.set(value.workerOrigin, value), remove: async key => record.delete(key) };
  const now=4_000_000,deviceId=`hud_${'1'.repeat(32)}`,renewalToken='a'.repeat(64),accessToken='b'.repeat(64);
  const client=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async url=>url.endsWith('/v1/hud/pairings')?response(201,pairing(now)):response(200,{status:'paired',deviceId,accessToken,renewalToken,expiresAt:now+900000,deviceExpiresAt:now+30*86400000,apps:['gmail']})});
  await client.startPairing(['gmail']);await client.pollPairing();
  const saved=record.get('https://relay.example.workers.dev');
  assert.deepEqual(Object.keys(saved).sort(),['deviceExpiresAt','deviceId','renewalToken','workerOrigin']);
  assert.equal(JSON.stringify(saved).includes(accessToken),false);
  assert.doesNotMatch(JSON.stringify(saved),/refresh.?token|oauth|google/i);
});

test('device capability stays in memory, commands use only relay routes, and revocation clears it on 401', async () => {
  const now = 3_000_000;
  const calls = [];
  const client = createGoogleConnectorClient({ workerOrigin: 'https://relay.example.workers.dev', enabled: true, now: () => now,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/v1/hud/pairings')) return response(201, pairing(now));
      if (String(url).endsWith('/v1/hud/pairings/poll')) return response(200, { status: 'paired', accessToken: 'c'.repeat(64), renewalToken:'e'.repeat(64),deviceId: `hud_${'d'.repeat(32)}`, expiresAt: now + 900_000,deviceExpiresAt:now+30*86400000, apps: ['gmail'] });
      if (String(url).endsWith('/v1/hud/commands')) return response(401, { error: 'Authorization revoked. private-host.ts.net token=synthetic-private-detail' });
      if (String(url).endsWith('/v1/hud/renew')) return response(401, { error: 'private-host.ts.net token=synthetic-private-detail' });
      throw new Error('Unexpected relay route.');
    } });

  const challenge = await client.startPairing();
  assert.deepEqual(challenge, { pairingAlias: 'K7M2Q9', userCode: '01234567', expiresAt: now + 180_000 });
  assert.deepEqual(await client.pollPairing(), { paired: true, apps: ['gmail'], expiresAt: now + 900_000, deviceExpiresAt: now + 30*86400000, persistent: false });
  assert.deepEqual(JSON.parse(calls[1].options.body), { pairingId: 'a'.repeat(48), pollSecret: 'b'.repeat(64) }, 'HUD polling retains its internal pairing ID and private poll secret');
  assert.equal(client.paired(), true);
  await assert.rejects(client.runCommand('show latest emails'), (error) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /POST \/v1\/hud\/commands: HTTP 401/);
    assert.match(error.message, /Authorization expired or revoked\. Restore the saved approval or pair again on your phone/);
    assert.doesNotMatch(error.message, /Authorization revoked|private-host|synthetic-private-detail/);
    return true;
  });
  assert.equal(client.paired(), false);
  assert.deepEqual(client.apps, []);
  assert.equal(client.expiresAt, 0);
  await assert.rejects(client.runCommand('show latest emails'), /authorization expired/i);
  assert.equal(calls.length, 4);
  assert.equal(calls[2].url, 'https://relay.example.workers.dev/v1/hud/commands');
  assert.equal(calls[2].options.credentials, 'omit');
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${'c'.repeat(64)}`);
  assert.equal(calls[3].url, 'https://relay.example.workers.dev/v1/hud/renew');
  assert.equal(calls.some((call) => /googleapis\.com|oauth|callback/i.test(call.url)), false);
});

test('Google device approval survives client recreation with a rotated renewable capability',async()=>{
  const now=1_000_000,record=new Map(),storage={read:async key=>record.get(key),write:async value=>record.set(value.workerOrigin,value),remove:async key=>record.delete(key)};
  let renewals=0;const deviceId=`hud_${'f'.repeat(32)}`,accessA='a'.repeat(64),accessB='b'.repeat(64),renewalA='c'.repeat(64),renewalB='d'.repeat(64),deviceExpiresAt=now+30*86400000;
  const client=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async(url,options)=>{
    if(url.endsWith('/v1/hud/pairings'))return response(201,pairing(now));
    if(url.endsWith('/v1/hud/pairings/poll'))return response(200,{status:'paired',deviceId,accessToken:accessA,renewalToken:renewalA,expiresAt:now+900000,deviceExpiresAt,apps:['gmail']});
    if(url.endsWith('/v1/hud/renew')){renewals++;assert.equal(JSON.parse(options.body).deviceId,deviceId);assert.equal(JSON.parse(options.body).renewalToken,renewalA);return response(200,{deviceId,accessToken:accessB,renewalToken:renewalB,expiresAt:now+900000,deviceExpiresAt,apps:['gmail']});}
    throw new Error('Unexpected route');
  }});
  await client.startPairing(['gmail']);await client.pollPairing();assert.equal(client.persistent,true);assert.equal(record.get('https://relay.example.workers.dev').renewalToken,renewalA);
  const reopened=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async(url,options)=>{renewals++;assert.ok(url.endsWith('/v1/hud/renew'));assert.equal(JSON.parse(options.body).renewalToken,renewalA);return response(200,{deviceId,accessToken:accessB,renewalToken:renewalB,expiresAt:now+900000,deviceExpiresAt,apps:['gmail']});}});
  assert.deepEqual(await reopened.restore(),{paired:true,storageAvailable:true,apps:['gmail']});assert.equal(reopened.paired(),true);assert.equal(record.get('https://relay.example.workers.dev').renewalToken,renewalB);
});

test('a stale HUD renewal failure cannot erase a newer rotated saved capability',async()=>{
  const now=1_000_000,deviceId=`hud_${'f'.repeat(32)}`,renewalA='a'.repeat(64),renewalB='b'.repeat(64),deviceExpiresAt=now+30*86400000;
  const record=new Map([['https://relay.example.workers.dev',{workerOrigin:'https://relay.example.workers.dev',deviceId,renewalToken:renewalA,deviceExpiresAt}]]);
  const storage={read:async key=>record.get(key),write:async value=>record.set(value.workerOrigin,value),remove:async key=>record.delete(key)};
  let rejectStale,staleStarted;const staleResponse=new Promise(resolve=>{rejectStale=()=>resolve(response(401,{}));});const staleStart=new Promise(resolve=>{staleStarted=resolve;});
  const stale=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async()=>{staleStarted();return staleResponse;}});
  const staleRestore=stale.restore();await staleStart;
  const fresh=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async()=>response(200,{deviceId,accessToken:'c'.repeat(64),renewalToken:renewalB,expiresAt:now+900000,deviceExpiresAt,apps:['gmail']})});
  assert.equal((await fresh.restore()).paired,true);
  rejectStale();assert.equal((await staleRestore).paired,false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(record.get('https://relay.example.workers.dev').renewalToken,renewalB);
});

test('concurrent startup restores share one slow IndexedDB and renewal request',async()=>{
  const now=1_000_000,deviceId=`hud_${'9'.repeat(32)}`,renewal='a'.repeat(64),record=new Map([['https://relay.example.workers.dev',{workerOrigin:'https://relay.example.workers.dev',deviceId,renewalToken:renewal,deviceExpiresAt:now+30*86400000}]]);
  let releaseRead,renewCalls=0;const slowRead=new Promise(resolve=>{releaseRead=resolve;});
  const storage={read:async key=>{await slowRead;return record.get(key);},write:async value=>record.set(value.workerOrigin,value),remove:async key=>record.delete(key)};
  const client=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async()=>{renewCalls++;return response(200,{deviceId,accessToken:'b'.repeat(64),renewalToken:'c'.repeat(64),expiresAt:now+900000,deviceExpiresAt:now+30*86400000,apps:['gmail']});}});
  const first=client.restore(),second=client.restore();releaseRead();
  assert.equal((await first).paired,true);assert.equal((await second).paired,true);assert.equal(renewCalls,1);
});

test('a reopening stale tab re-reads a capability rotated by another tab before showing signed out',async()=>{
  const now=1_000_000,deviceId=`hud_${'8'.repeat(32)}`,renewalA='a'.repeat(64),renewalB='b'.repeat(64),renewalC='c'.repeat(64),record=new Map([['https://relay.example.workers.dev',{workerOrigin:'https://relay.example.workers.dev',deviceId,renewalToken:renewalA,deviceExpiresAt:now+30*86400000}]]);
  const storage={read:async key=>record.get(key),write:async value=>record.set(value.workerOrigin,value),remove:async key=>record.delete(key)};
  let rejectStale;const staleWait=new Promise(resolve=>{rejectStale=()=>resolve(response(401,{}));});
  const stale=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async(url,options)=>JSON.parse(options.body).renewalToken===renewalA?staleWait:response(200,{deviceId,accessToken:'d'.repeat(64),renewalToken:renewalC,expiresAt:now+900000,deviceExpiresAt:now+30*86400000,apps:['gmail']})});
  const fresh=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage,fetchImpl:async()=>response(200,{deviceId,accessToken:'e'.repeat(64),renewalToken:renewalB,expiresAt:now+900000,deviceExpiresAt:now+30*86400000,apps:['gmail']})});
  const staleResult=stale.restore();assert.equal((await fresh.restore()).paired,true);rejectStale();assert.equal((await staleResult).transient,true);assert.equal((await stale.restore()).paired,true);assert.equal(record.get('https://relay.example.workers.dev').renewalToken,renewalC);
});

test('temporary offline restoration keeps the saved capability for an automatic retry',async()=>{
  const now=1_000_000,deviceId=`hud_${'7'.repeat(32)}`,renewal='a'.repeat(64),saved={workerOrigin:'https://relay.example.workers.dev',deviceId,renewalToken:renewal,deviceExpiresAt:now+30*86400000};let removed=false;
  const client=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage:{read:async()=>saved,write:async()=>{},remove:async()=>{removed=true;}},fetchImpl:async()=>{throw new Error('offline');}});
  assert.deepEqual(await client.restore(),{paired:false,storageAvailable:true,transient:true});assert.equal(removed,false);
});

test('expired authorization and unavailable storage fail closed while a fresh pairing remains usable in memory',async()=>{
  const now=2_000_000,deviceId=`hud_${'f'.repeat(32)}`,renewalToken='a'.repeat(64);let removed=false;
  const expiredStorage={read:async()=>({workerOrigin:'https://relay.example.workers.dev',deviceId,renewalToken,deviceExpiresAt:now-1}),write:async()=>{},remove:async()=>{removed=true;}};
  const expired=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage:expiredStorage,fetchImpl:async()=>{throw new Error('expired renewal must not be sent');}});
  assert.deepEqual(await expired.restore(),{paired:false,storageAvailable:true});assert.equal(removed,true);
  const unavailable={read:async()=>{throw new Error('quota details must not escape');},write:async()=>{throw new Error('private storage detail');},remove:async()=>{throw new Error('private storage detail');}};
  const fresh=createGoogleConnectorClient({workerOrigin:'https://relay.example.workers.dev',enabled:true,now:()=>now,storage:unavailable,fetchImpl:async url=>url.endsWith('/v1/hud/pairings')?response(201,pairing(now)):response(200,{status:'paired',deviceId,accessToken:'b'.repeat(64),renewalToken,expiresAt:now+900000,deviceExpiresAt:now+30*86400000,apps:['gmail']})});
  assert.deepEqual(await fresh.restore(),{paired:false,storageAvailable:false});await fresh.startPairing(['gmail']);assert.equal((await fresh.pollPairing()).paired,true);assert.equal(fresh.paired(),true);assert.equal(fresh.persistent,false);
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
  assert.match(worker, /'\.\/auth-config\.js', '\.\/unlock\.html', '\.\/unlock\.js'/);
  assert.match(worker, /caches\.open\(CACHE\).*cache\.match/);
  assert.doesNotMatch(worker, /caches\.match\(event\.request\)/);
});
