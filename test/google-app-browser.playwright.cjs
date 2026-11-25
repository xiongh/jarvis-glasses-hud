'use strict';

// Browser-level regression: Google Apps must render their own read-only
// browsers, not the AI chat/request UI.  The connector below is deliberately
// capability-shaped and contains no owner session or provider credential.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join, normalize, extname } = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
const root = join(__dirname, '..');
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const fakeConnectors = `window.jarvisGoogleConnectors={normalizeCompanionUrl:()=>'',createGoogleConnectorClient:()=>{let lastResult=null,paired=!location.search.includes('unpaired'),polls=0;const apps=['gmail','google-calendar','google-contacts','google-drive','google-docs','google-sheets','google-tasks'];return{available:()=>true,paired:()=>paired,get apps(){return apps},get lastResult(){return lastResult},restore:async()=>({paired,storageAvailable:true,apps:paired?apps:[]}),startPairing:async()=>{window.__googlePairStarts=(window.__googlePairStarts||0)+1;return{pairingAlias:'K7M2Q9',userCode:'01234567'}},pollPairing:async()=>{window.__googlePairPolls=(window.__googlePairPolls||0)+1;if(++polls<2)return{paired:false};paired=true;return{paired:true,persistent:true,apps}},runCommand:async(command)=>{lastResult={status:'completed'};const value=String(command);if(/SHOW CALENDAR EVENT/.test(value))return 'Planning\\nToday at 10:00 AM\\nTeam review';if(/CALENDAR/.test(value))return '1. Planning — Today at 10:00 AM';if(/READ EMAIL/.test(value))return 'Quarterly update\\nFrom: Team\\nRead-only message preview';if(/EMAILS/.test(value))return '1. Quarterly update — Team';if(/SHOW CONTACT/.test(value))return 'Taylor Example\\ntaylor@example.test';if(/CONTACT/.test(value))return '1. Taylor Example — taylor@example.test';if(/OPEN FILE/.test(value))return 'Project plan\\nSupported file details';if(/DRIVE/.test(value))return '1. Project plan — Drive file';if(/READ DOCUMENT/.test(value))return 'Project brief\\nReadable document content';if(/DOC/.test(value))return '1. Project brief — Google Doc';if(/READ SHEET/.test(value))return 'Budget\\nReadable spreadsheet content';if(/SHEET/.test(value))return '1. Budget — Google Sheet';if(/SHOW TASK/.test(value))return 'Review proposal\\nDue today';return '1. Review proposal — Due today';}}}};`;

async function main() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const safe = normalize(relative).replace(/^([.][.][\\/])+/, '');
    try {
      response.setHeader('content-type', types[extname(safe)] || 'application/octet-stream');
      if (safe === 'connectors.js') return response.end(fakeConnectors);
      response.end(readFileSync(join(root, safe)));
    } catch { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'OPEN JARVIS MENU' }).click();
    await page.getByRole('button', { name: /^MEDIA/ }).click();
    const apps = [
      ['calendar', 'CALENDAR', 'EVENT', 'Planning'], ['gmail', 'GMAIL', 'EMAIL', 'Quarterly update'], ['contacts', 'CONTACTS', 'CONTACT', 'Taylor Example'],
      ['drive', 'DRIVE', 'FILE', 'Project plan'], ['documents', 'DOCS', 'DOCUMENT', 'Project brief'], ['sheets', 'SHEETS', 'SHEET', 'Budget'], ['tasks', 'TASKS', 'TASK', 'Review proposal'],
    ];
    for (const [appId, name, item, detail] of apps) {
      await page.locator(`button[data-media-app="${appId}"]`).click();
      await page.getByRole('button', { name: new RegExp(`^${item} 1$`) }).waitFor();
      assert.equal(await page.locator(`input[aria-label="${name} request"]`).count(), 0, `${name} must not render the old request field`);
      assert.equal(await page.getByText('ASK JARVIS').count(), 0, `${name} must not render AI chat`);
      if (name === 'CALENDAR') {
        await page.getByRole('button', { name: 'PREVIOUS DAY' }).focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'TODAY', 'Band/D-pad key moves browser focus');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'NEXT DAY');
      }
      await page.getByRole('button', { name: `${item} 1` }).focus();
      await page.keyboard.press('Enter');
      await page.getByText(detail).waitFor();
      await page.getByRole('button', { name: 'BACK TO MEDIA' }).click();
    }
    const pending = await browser.newPage({ viewport: { width: 600, height: 600 } });
    await pending.goto(`http://127.0.0.1:${server.address().port}/?unpaired=1`, { waitUntil: 'networkidle' });
    await pending.getByRole('button', { name: 'OPEN JARVIS MENU' }).click();
    await pending.getByRole('button', { name: /^MEDIA/ }).click();
    await pending.locator('button[data-media-app="calendar"]').click();
    await pending.getByText('PAIRING ID · K7M2Q9').waitFor();
    await pending.getByRole('button', { name: 'EVENT 1' }).waitFor({ timeout: 4000 });
    assert.equal(await pending.evaluate(() => window.__googlePairStarts), 1, 'opening Calendar starts one scoped device pairing');
    assert.ok(await pending.evaluate(() => window.__googlePairPolls) >= 2, 'the HUD consumes approval without a separate Check button');
    await pending.close();
    assert.deepEqual(errors, [], `uncaught browser errors: ${errors.join('; ')}`);
    process.stdout.write(JSON.stringify({ result: 'passed', apps: apps.length }) + '\n');
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
