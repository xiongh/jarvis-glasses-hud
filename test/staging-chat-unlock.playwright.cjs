'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdirSync, readFileSync } = require('node:fs');
const { join, normalize, extname } = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));

const root = join(__dirname, '..');
const screenshots = join(root, 'test-results');
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  // Production-shaped compact JWT from the Auth Worker poll response. The
  // browser test checks transport/UI wiring; verifier compatibility is covered
  // by the Auth Worker-to-recovered-relay integration test.
  const assertion = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'jarvis-auth-staging', aud: 'jarvis-staging-glasses-chat', sub: '123e4567-e89b-42d3-a456-426614174000', txn: '1'.repeat(24), jti: '2'.repeat(24), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 90 })).toString('base64url')}.${'c'.repeat(43)}`;
const transaction = (character) => character.repeat(24);
const pollSecret = (character) => character.repeat(43);

async function main() {
  let starts = 0; let polls = 0; let exchanges = 0; const chatRequests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'); const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safe = normalize(relative).replace(/^([.][.][\\/])+/, '');
    try {
      const source = safe === 'auth-config.js' ? join(root, 'staging', 'auth-config.js') : join(root, safe);
      response.setHeader('content-type', types[extname(source)] || 'application/octet-stream');
      let content = readFileSync(source).toString();
      if (safe === 'auth-config.js') content = content.replaceAll('https://jarvis-hud-staging.hlao-xiong.workers.dev', `http://127.0.0.1:${server.address().port}`);
      response.end(content);
    } catch { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } }); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://jarvis-auth-staging.hlao-xiong.workers.dev/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session/restore')) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ authorized: false }) });
      if (path.endsWith('/start')) { starts += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ transactionId: transaction(String(starts)), pollSecret: pollSecret(String(starts + 3)), code: '12345678', expiresAt: Math.floor(Date.now() / 1000) + 60 }) }); }
      if (path.endsWith('/poll')) { polls += 1; const unlocked = polls > 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(unlocked ? { unlocked: true, expiresAt: Math.floor(Date.now() / 1000) + (polls === 2 ? 2 : 60), assertion, assertionExpiresAt: Math.floor(Date.now() / 1000) + 90 } : { unlocked: false, pending: true, expiresAt: Math.floor(Date.now() / 1000) + 60 }) }); }
      return route.abort();
    });
    await page.route('https://jarvis-staging-chat-relay.hlao-xiong.workers.dev/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/exchange') {
        exchanges += 1;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ capability: 'd'.repeat(43), expiresAt: Date.now() + 50_000 }) });
      }
      if (path === '/v1/chat' && route.request().method() === 'POST') {
        chatRequests.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: `${String(chatRequests.length).padStart(2, '0')}${'e'.repeat(22)}` }) });
      }
      if (/^\/v1\/chat\/[A-Za-z0-9_-]{24}$/.test(path)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'done', reply: `Synthetic reply ${chatRequests.length}.` }) });
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'locked');
    assert.equal(await page.locator('#jarvis-session-lock').isVisible(), true, 'HUD starts locked');
    await page.locator('#lock-retry').click();
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'authenticated');
    await page.getByRole('button', { name: 'OPEN JARVIS MENU' }).click();
    await page.getByRole('button', { name: /^AI/ }).click();
    await page.getByText('CONNECTED · AUTHORIZED STAGING CHAT').waitFor();
    assert.equal(exchanges, 1, 'the companion assertion exchanges once');
    const prompt = page.getByRole('textbox', { name: 'Message for JARVIS' });
    await prompt.fill('Hello JARVIS, what can you help me with?');
    await page.getByRole('button', { name: 'SEND' }).click();
    await page.getByText('JARVIS: Synthetic reply 1.').waitFor();
    await prompt.fill('Can you explain that in more detail?');
    await page.getByRole('button', { name: 'SEND' }).click();
    await page.getByText('JARVIS: Synthetic reply 2.').waitFor();
    assert.deepEqual(chatRequests[0].history, [], 'the first chat request starts without history');
    assert.deepEqual(chatRequests[1].history, [
      { role: 'user', content: 'Hello JARVIS, what can you help me with?' },
      { role: 'assistant', content: 'Synthetic reply 1.' },
    ], 'a follow-up sends only bounded transient context');
    // The visible transcript has a separate, session-only bound from the
    // compact relay context. It must retain enough entries to overflow and
    // remain scrollable during an ordinary conversation.
    for (let i = 3; i <= 7; i += 1) {
      await prompt.fill(`Follow-up ${i}`);
      await page.getByRole('button', { name: 'SEND' }).click();
      await page.getByText(`JARVIS: Synthetic reply ${i}.`).waitFor();
    }
    const transcript = page.locator('.chat-log');
    assert.equal(await transcript.evaluate((node) => getComputedStyle(node).overflowY), 'scroll');
    assert.equal(await transcript.evaluate((node) => node.scrollHeight > node.clientHeight), true, 'long conversation overflows the visible transcript');
    await transcript.evaluate((node) => { node.scrollTop = 0; });
    assert.equal(await transcript.evaluate((node) => node.scrollTop), 0, 'earlier session messages remain reachable by scrolling');
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, 'staging-chat-connected.png'), fullPage: true });

    // Manual lock is a local event and must revoke only in-memory chat access.
    await page.evaluate(() => document.dispatchEvent(new Event('jarvis-session-locked')));
    await page.getByText('DISCONNECTED · COMPLETE COMPANION UNLOCK TO CONNECT').waitFor();
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'locked', { timeout: 4_000 });
    await page.locator('#lock-retry').click();
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'authenticated');
    await page.getByText('CONNECTED · AUTHORIZED STAGING CHAT').waitFor();
    assert.equal(exchanges, 2, 're-lock requires and accepts a fresh assertion');
    assert.deepEqual(errors, [], `uncaught browser errors: ${errors.join('; ')}`);
    process.stdout.write(JSON.stringify({ result: 'passed', starts, polls, exchanges, chatRequests: chatRequests.length, screenshot: join(screenshots, 'staging-chat-connected.png') }) + '\n');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
