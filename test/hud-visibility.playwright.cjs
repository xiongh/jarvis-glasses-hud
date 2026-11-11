'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdirSync, readFileSync } = require('node:fs');
const { join, normalize, extname } = require('node:path');
// The HUD is a linked standalone checkout; resolve the root project's declared
// Playwright dependency when this focused release check is run from the root.
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));

const root = join(__dirname, '..');
const screenshots = join(root, 'test-results');
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const transaction = (character) => character.repeat(24);
const pollSecret = (character) => character.repeat(43);

function reply(body) {
  return JSON.stringify(body);
}

async function main() {
  let starts = 0;
  let polls = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safe = normalize(relative).replace(/^([.][.][\\/])+/, '');
    try {
      const source = safe === 'auth-config.js' ? join(root, 'staging', 'auth-config.js') : join(root, safe);
      response.setHeader('content-type', types[extname(source)] || 'application/octet-stream');
      const content = readFileSync(source);
      response.end(safe === 'auth-config.js'
        ? content.toString().replace('https://jarvis-hud-staging.hlao-xiong.workers.dev', `http://127.0.0.1:${server.address().port}`)
        : content);
    } catch {
      response.statusCode = 404; response.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://jarvis-auth-staging.hlao-xiong.workers.dev/**', async (route) => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname.endsWith('/session/restore')) return route.fulfill({ status: 401, contentType: 'application/json', body: reply({ authorized: false }) });
      if (url.pathname.endsWith('/start')) {
        starts += 1;
        const character = starts === 1 ? 'a' : 'c';
        body = { transactionId: transaction(character), pollSecret: pollSecret(starts === 1 ? 'b' : 'd'), code: starts === 1 ? '11112222' : '33334444', expiresAt: Math.floor(Date.now() / 1000) + 60 };
      } else if (url.pathname.endsWith('/poll')) {
        polls += 1;
        body = polls === 1 ? { unlocked: false, pending: true, expiresAt: Math.floor(Date.now() / 1000) + 60 } : { unlocked: true, expiresAt: Math.floor(Date.now() / 1000) + 1 };
      } else return route.abort();
      await route.fulfill({ contentType: 'application/json', body: reply(body) });
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'locked');
    assert.equal(await page.locator('#jarvis-session-lock').isVisible(), true, 'locked overlay must be visible');
    assert.equal(await page.locator('#jarvis-glasses-hud').evaluate((node) => getComputedStyle(node).visibility), 'hidden', 'locked HUD must be hidden');
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, 'hud-visibility-locked.png'), fullPage: true });

    await page.locator('#lock-retry').click();
    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'authenticated');
    assert.equal(await page.locator('#jarvis-session-lock').isVisible(), false, 'unlock must dismiss the overlay');
    assert.equal(await page.locator('#jarvis-glasses-hud').evaluate((node) => getComputedStyle(node).visibility), 'visible', 'unlocked HUD must be visible');
    await page.screenshot({ path: join(screenshots, 'hud-visibility-unlocked.png'), fullPage: true });

    await page.waitForFunction(() => document.body.dataset.jarvisSession === 'locked', { timeout: 3_000 });
    assert.equal(await page.locator('#jarvis-session-lock').isVisible(), true, 'expiry must restore the lock overlay');
    assert.equal(await page.locator('#jarvis-glasses-hud').evaluate((node) => getComputedStyle(node).visibility), 'hidden', 're-locked HUD must be hidden');
    assert.deepEqual(errors, [], `uncaught browser errors: ${errors.join('; ')}`);
    process.stdout.write(JSON.stringify({ result: 'passed', starts, polls, screenshots: [join(screenshots, 'hud-visibility-locked.png'), join(screenshots, 'hud-visibility-unlocked.png')] }) + '\n');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
