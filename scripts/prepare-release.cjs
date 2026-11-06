'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_FILES = ['.nojekyll', 'app.js', 'connectors-config.js', 'connectors.js', 'index.html', 'manifest.webmanifest', 'service-worker.js', 'staging-passkey.html', 'staging-passkey.js', 'styles.css', 'youtube-player.js'];
const HASHED_FILES = ['app.js', 'connectors-config.js', 'connectors.js', 'index.html', 'manifest.webmanifest', 'service-worker.js', 'staging-passkey.html', 'staging-passkey.js', 'styles.css', 'youtube-player.js'];
const SHA = /^[a-f0-9]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function assertBuildId(buildId) {
  if (!/^(?:local|[a-f0-9]{40})$/.test(buildId)) throw new Error('Build ID must be "local" or a 40-character lowercase Git commit SHA.');
}
function copy(source, output, file) {
  const from = path.join(source, file); const to = path.join(output, file);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to);
}
function verifyManifest(manifest, root) {
  if (!manifest || manifest.schema !== 1 || !/^(?:local|[a-f0-9]{40})$/.test(manifest.buildId) || !manifest.files || typeof manifest.files !== 'object') throw new Error('Invalid release manifest structure.');
  for (const file of HASHED_FILES) {
    if (!SHA.test(manifest.files[file] || '')) throw new Error(`Invalid SHA-256 for ${file}.`);
    const actual = sha256(fs.readFileSync(path.join(root, file)));
    if (actual !== manifest.files[file]) throw new Error(`Release manifest digest mismatch for ${file}.`);
  }
  return true;
}
function prepareRelease({ source, output, buildId }) {
  assertBuildId(buildId);
  fs.rmSync(output, { recursive: true, force: true }); fs.mkdirSync(output, { recursive: true });
  for (const file of PUBLIC_FILES) copy(source, output, file);
  const workerPath = path.join(output, 'service-worker.js');
  const worker = fs.readFileSync(workerPath, 'utf8');
  const updated = worker.replace(/const BUILD_ID = 'local';/, `const BUILD_ID = '${buildId}';`);
  if (!updated.includes(`const BUILD_ID = '${buildId}';`)) throw new Error('Could not stamp the service worker build ID.');
  fs.writeFileSync(workerPath, updated);
  const files = Object.fromEntries(HASHED_FILES.map((file) => [file, sha256(fs.readFileSync(path.join(output, file)))]));
  const manifest = { schema: 1, app: 'JARVIS HUD', buildId, files };
  verifyManifest(manifest, output);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(output, 'release-manifest.json'), manifestText);
  fs.writeFileSync(path.join(output, 'health.json'), `${JSON.stringify({ schema: 1, status: 'ok', app: 'JARVIS HUD', buildId, manifestSha256: sha256(manifestText) })}\n`);
  return { manifest, manifestSha256: sha256(manifestText), files: [...PUBLIC_FILES, 'release-manifest.json', 'health.json'] };
}

if (require.main === module) {
  const args = process.argv.slice(2); const read = (name) => args[args.indexOf(name) + 1];
  try { const result = prepareRelease({ source: read('--source'), output: read('--output'), buildId: read('--build') }); process.stdout.write(`${JSON.stringify(result)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}
module.exports = { HASHED_FILES, PUBLIC_FILES, prepareRelease, verifyManifest, sha256 };
