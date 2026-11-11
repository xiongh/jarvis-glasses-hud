'use strict';

// Browser-level coverage for the protocol property that unit tests cannot
// establish: a credentialed cross-origin response really persists the
// HttpOnly HUD cookie and returns it on restore/logout.  The local Auth
// fixture exposes no token to page JavaScript.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));

const cookieName = '__Host-jarvis-staging-session';
const token = 's'.repeat(43);

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
  let hudOrigin = ''; let active = token; const seen = [];
  const auth = createServer(async (request, response) => {
    const body = await new Promise((resolve) => { let text = ''; request.on('data', (chunk) => { text += chunk; }); request.on('end', () => resolve(text)); });
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const hasCookie = request.headers.cookie?.includes(`${cookieName}=${active}`) === true;
    seen.push({ path, hasCookie, csrf: request.headers['x-jarvis-hud'] || '', body });
    response.setHeader('Access-Control-Allow-Origin', hudOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Jarvis-HUD');
    if (request.method === 'OPTIONS') { response.writeHead(204); return response.end(); }
    response.setHeader('Content-Type', 'application/json');
    if (path === '/v1/hud/unlock/verify' || path === '/v1/glasses/unlock/poll') {
      response.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`);
      return response.end(JSON.stringify(path.includes('/poll') ? { unlocked: true, session: 'issued' } : { authorized: true, session: 'issued' }));
    }
    if (path === '/v1/hud/session/restore') {
      if (!hasCookie) { response.statusCode = 401; return response.end(JSON.stringify({ authorized: false })); }
      return response.end(JSON.stringify({ authorized: true, session: 'restored', assertion: 'a.b.c' }));
    }
    if (path === '/v1/logout') {
      if (!hasCookie || request.headers['x-jarvis-hud'] !== 'lock') { response.statusCode = 401; return response.end(JSON.stringify({ loggedOut: false })); }
      active = ''; response.setHeader('Set-Cookie', `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`); return response.end(JSON.stringify({ loggedOut: true }));
    }
    response.statusCode = 404; response.end('{}');
  });
  const hud = createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>HUD cookie test</title>'); });
  await listen(auth); await listen(hud);
  const authOrigin = `http://127.0.0.1:${auth.address().port}`; hudOrigin = `http://127.0.0.1:${hud.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(hudOrigin);
    const call = (path, headers = {}) => page.evaluate(async ({ origin, path, headers }) => {
      const response = await fetch(`${origin}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
      return { status: response.status, body: await response.json() };
    }, { origin: authOrigin, path, headers });
    for (const path of ['/v1/hud/unlock/verify', '/v1/glasses/unlock/poll']) {
      active = token;
      assert.equal((await call(path)).body.session, 'issued');
      assert.deepEqual((await call('/v1/hud/session/restore', { 'X-Jarvis-HUD': 'restore' })).body, { authorized: true, session: 'restored', assertion: 'a.b.c' });
      assert.equal((await call('/v1/logout', { 'X-Jarvis-HUD': 'lock' })).body.loggedOut, true);
      const expired = await call('/v1/hud/session/restore', { 'X-Jarvis-HUD': 'restore' });
      assert.equal(expired.status, 401); assert.equal(expired.body.authorized, false);
    }
    assert.ok(seen.some((entry) => entry.path === '/v1/hud/session/restore' && entry.hasCookie && entry.csrf === 'restore'));
    assert.ok(seen.some((entry) => entry.path === '/v1/logout' && entry.hasCookie && entry.csrf === 'lock'));
    process.stdout.write(JSON.stringify({ result: 'passed', requests: seen.length }) + '\n');
  } finally { await browser.close(); await close(auth); await close(hud); }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
