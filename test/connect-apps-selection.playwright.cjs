'use strict';

// Browser regression: checkboxes must start clear and directly drive both
// owner-management actions. All responses are synthetic; no Google account,
// cookie, or OAuth credential is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
const root = path.resolve(__dirname, '..');
const apps = ['gmail', 'google-calendar', 'google-contacts', 'google-drive', 'google-docs', 'google-sheets', 'google-tasks'];
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));

async function main() {
  let disabled = new Set();
  const server = http.createServer(async (request, response) => {
    if (request.url.startsWith('/auth-config.js')) { response.setHeader('Content-Type', 'text/javascript'); return response.end(`window.JARVIS_AUTH_CONFIG=Object.freeze({enabled:false,hudOrigin:'http://${request.headers.host}',workerUrl:'https://auth.example',chatRelayUrl:'https://chat.example',sessionRestore:false});document.documentElement.dataset.jarvisAuthEnabled='false';`); }
    if (request.url.startsWith('/connectors-config.js')) { response.setHeader('Content-Type', 'text/javascript'); return response.end(`window.JARVIS_CONNECTORS_CONFIG=Object.freeze({enabled:true,workerOrigin:'https://apps.example'});`); }
    const file = path.join(root, request.url.split('?')[0] === '/' ? 'index.html' : request.url.split('?')[0]);
    if (request.url.startsWith('/app.js')) {
      response.setHeader('Content-Type', 'text/javascript'); return response.end(fs.readFileSync(path.join(root, 'app.js')));
    }
    try { response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); const body = fs.readFileSync(file, 'utf8'); response.end(file.endsWith('index.html') ? body.replace('</head>', `<script>globalThis.fetch=async(u,o={})=>{const p=new URL(u).pathname;if(p==='/v1/hud/session/restore')return new Response(JSON.stringify({authorized:true,expiresAt:9999999999,session:'restored',assertion:'a.b.c',assertionExpiresAt:9999999999}),{status:200});if(p==='/v1/connected-apps/handoff')return new Response(JSON.stringify({handoff:'${'h'.repeat(43)}'}),{status:201});if(p==='/v1/owner/session/handoff')return new Response(JSON.stringify({authenticated:true}),{status:200});if(p==='/v1/owner/google/grant')return new Response(JSON.stringify({connected:true,apps:${JSON.stringify(apps)},disabledApps:[...globalThis.__disabled||[]]}),{status:200});if(p==='/v1/owner/google/apps/access'){const b=JSON.parse(o.body);globalThis.__disabled=new Set(b.action==='disable'?[...(globalThis.__disabled||[]),...b.apps]:[...(globalThis.__disabled||[])].filter(x=>!b.apps.includes(x)));return new Response(JSON.stringify({apps:${JSON.stringify(apps)},disabledApps:[...globalThis.__disabled]}),{status:200});}throw Error('unexpected '+p)};</script></head>`).replace('<body>', '<body data-jarvis-session="unlocked">') : body); } catch { response.statusCode = 404; response.end(); }
  });
  await listen(server); const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', (error) => process.stderr.write(`pageerror: ${error.message}\n`)); await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 5_000 }); await page.waitForTimeout(100); if (!(await page.locator('button', { hasText: 'OPEN JARVIS MENU' }).count())) throw new Error(`HUD did not boot: ${await page.locator('body').innerText()}`); await page.locator('button', { hasText: 'OPEN JARVIS MENU' }).click(); await page.getByText('CONNECT APPS', { exact: true }).click();
    await page.locator('input[aria-label="Gmail selection"]').waitFor();
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    assert.equal(await page.getByText('CONNECT SELECTED APPS', { exact: true }).isDisabled(), true);
    await page.locator('input[aria-label="Gmail selection"]').check();
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 1);
    assert.equal(await page.getByText('CONNECT SELECTED APPS', { exact: true }).isDisabled(), false);
    await page.locator('input[aria-label="Google Calendar selection"]').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('input[type=checkbox]:checked').count(), 2);
    await page.locator('input[aria-label="Gmail selection"]').uncheck();
    assert.equal(await page.locator('input[aria-label="Google Calendar selection"]').isChecked(), true);
    await page.getByText('SELECT ALL', { exact: true }).click(); assert.equal(await page.locator('input[type=checkbox]:checked').count(), 7);
    await page.getByText('CLEAR SELECTION', { exact: true }).click(); assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    await page.locator('input[aria-label="Gmail selection"]').check(); page.once('dialog', (dialog) => dialog.accept()); await page.getByText('DISCONNECT SELECTED APPS', { exact: true }).click();
    await page.getByText('Gmail · DISABLED IN JARVIS').waitFor(); assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
    process.stdout.write(JSON.stringify({ result: 'passed', directCheckboxes: true }) + '\n');
  } finally { await browser.close(); await close(server); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
