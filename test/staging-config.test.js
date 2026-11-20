'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { auditPublication } = require('../scripts/audit-publication.cjs');
const { prepareStagingRelease, stagingBuildId } = require('../scripts/prepare-staging-release.cjs');

test('staging HUD routes Auth, Google Apps, and chat only to isolated staging Workers', () => {
  const root = path.join(__dirname, '..', 'staging');
  const context = { window: {}, document: { documentElement: { dataset: {} } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'auth-config.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'connectors-config.js'), 'utf8'), context);
  const auth = context.window.JARVIS_AUTH_CONFIG;
  const connectors = context.window.JARVIS_CONNECTORS_CONFIG;
  assert.equal(auth.enabled, true);
  assert.equal(auth.hudOrigin, 'https://jarvis-hud-staging.hlao-xiong.workers.dev');
  assert.equal(auth.workerUrl, 'https://jarvis-auth-staging.hlao-xiong.workers.dev');
  assert.equal(auth.chatRelayUrl, 'https://jarvis-staging-chat-relay.hlao-xiong.workers.dev');
  assert.equal(connectors.enabled, true);
  assert.equal(connectors.workerOrigin, 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev');
  assert.equal(connectors.phoneCompanionUrl, 'https://jarvis-hud-staging.hlao-xiong.workers.dev/staging-apps-connect.html');
  const serialized = JSON.stringify({ auth, connectors });
  for (const productionHost of ['jarvis-glasses-connected-apps.hlao-xiong.workers.dev', 'desktop-frvv2vt.taile1cf65.ts.net', 'xiongh.github.io']) {
    assert.equal(serialized.includes(productionHost), false, `staging configuration must not contain ${productionHost}`);
  }
});

test('staging release audit permits only the isolated staging approval page as its companion URL', () => {
  const source = path.join(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-staging-audit-'));
  const { PUBLIC_FILES } = require('../scripts/prepare-release.cjs');
  try {
    for (const file of PUBLIC_FILES) fs.copyFileSync(path.join(source, file), path.join(temporary, file));
    fs.copyFileSync(path.join(source, 'staging', 'auth-config.js'), path.join(temporary, 'auth-config.js'));
    fs.copyFileSync(path.join(source, 'staging', 'connectors-config.js'), path.join(temporary, 'connectors-config.js'));
    assert.equal(auditPublication(temporary).credentialsFound, false);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('staging packaging overlays the authenticated staging configuration instead of the legacy pairing configuration', (t) => {
  const source = path.join(__dirname, '..');
  const output = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-staging-release-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  prepareStagingRelease({ source, output, buildId: 'b'.repeat(40) });
  const auth = fs.readFileSync(path.join(output, 'auth-config.js'), 'utf8');
  const connectors = fs.readFileSync(path.join(output, 'connectors-config.js'), 'utf8');
  assert.match(auth, /enabled: true/);
  assert.match(auth, /jarvis-auth-staging\.hlao-xiong\.workers\.dev/);
  assert.match(connectors, /jarvis-connected-apps-staging\.hlao-xiong\.workers\.dev/);
  assert.doesNotMatch(connectors, /jarvis-glasses-connected-apps\.hlao-xiong\.workers\.dev/);
  assert.equal(auditPublication(output).credentialsFound, false);
});

test('staging packaging fingerprints the isolated artifact when no commit revision is supplied', (t) => {
  const source = path.join(__dirname, '..'); const output = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-staging-fingerprint-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const expected = stagingBuildId(source); const result = prepareStagingRelease({ source, output, buildId: 'auto' });
  assert.match(expected, /^[a-f0-9]{40}$/); assert.equal(result.manifest.buildId, expected);
});

test('staging packaging identity is stable across Windows and CI line endings', (t) => {
  const source = path.join(__dirname, '..'); const copy = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-staging-line-endings-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  const { PUBLIC_FILES } = require('../scripts/prepare-release.cjs');
  for (const file of PUBLIC_FILES) {
    const target = path.join(copy, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, file), target);
  }
  fs.mkdirSync(path.join(copy, 'staging')); for (const file of ['auth-config.js', 'connectors-config.js']) fs.copyFileSync(path.join(source, 'staging', file), path.join(copy, 'staging', file));
  const app = fs.readFileSync(path.join(copy, 'app.js'), 'utf8'); fs.writeFileSync(path.join(copy, 'app.js'), app.replace(/\r?\n/g, '\r\n'));
  assert.equal(stagingBuildId(copy), stagingBuildId(source));
});
