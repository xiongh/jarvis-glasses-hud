'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyManifest, sha256 } = require('./prepare-release.cjs');
const { validateReleaseManifest } = require('./verify-deployment.cjs');
const { auditPublication } = require('./audit-publication.cjs');

function readJson(file) {
  try { return { text: fs.readFileSync(file, 'utf8'), value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { throw new Error(`Invalid JSON release metadata: ${path.basename(file)}.`); }
}
function verifyReleaseDirectory({ root, expectedBuildId }) {
  const absolute = path.resolve(root);
  const { text: manifestText, value: manifest } = readJson(path.join(absolute, 'release-manifest.json'));
  const { value: health } = readJson(path.join(absolute, 'health.json'));
  validateReleaseManifest(manifest, expectedBuildId);
  auditPublication(absolute);
  const html = fs.readFileSync(path.join(absolute, 'index.html'), 'utf8');
  if (html.includes('__JARVIS_BUILD_ID__') || !html.includes(`data-build-id="${expectedBuildId}"`)) throw new Error('Visible HUD build ID did not match the release.');
  if (health.schema !== 1 || health.status !== 'ok' || health.app !== 'JARVIS HUD' || health.buildId !== expectedBuildId || health.manifestSha256 !== sha256(manifestText)) throw new Error('Release health metadata did not match the staged manifest.');
  verifyManifest(manifest, absolute);
  return { buildId: manifest.buildId, manifestSha256: health.manifestSha256 };
}
if (require.main === module) {
  const args = process.argv.slice(2); const read = (name) => args[args.indexOf(name) + 1];
  try { process.stdout.write(`${JSON.stringify(verifyReleaseDirectory({ root: read('--root'), expectedBuildId: read('--build') }))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}
module.exports = { verifyReleaseDirectory };
