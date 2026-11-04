'use strict';

const { HASHED_FILES, sha256 } = require('./prepare-release.cjs');

function validateReleaseManifest(manifest, expectedBuildId) {
  if (!manifest || manifest.schema !== 1 || manifest.app !== 'JARVIS HUD' || manifest.buildId !== expectedBuildId || !manifest.files || typeof manifest.files !== 'object') throw new Error('Deployment release manifest has an invalid identity or structure.');
  const actualFiles = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify([...HASHED_FILES].sort())) throw new Error('Deployment release manifest has an unexpected file inventory.');
  for (const file of HASHED_FILES) if (!/^[a-f0-9]{64}$/.test(manifest.files[file] || '')) throw new Error(`Deployment release manifest has an invalid SHA-256 for ${file}.`);
  return true;
}

async function checkedJson(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Health check failed (${response.status}) for ${url}`);
  const text = await response.text();
  try { return { text, value: JSON.parse(text) }; } catch { throw new Error(`Expected JSON from ${url}`); }
}
async function verifyDeployment({ baseUrl, expectedBuildId, fetchImpl = fetch }) {
  const base = new URL(baseUrl); if (base.protocol !== 'https:') throw new Error('Deployment health checks require HTTPS.');
  const urlFor = (file) => new URL(file, base).href;
  const { value: health } = await checkedJson(fetchImpl, urlFor('health.json'));
  if (health.status !== 'ok' || health.app !== 'JARVIS HUD' || health.buildId !== expectedBuildId || !/^[a-f0-9]{64}$/.test(health.manifestSha256 || '')) throw new Error('Deployment health document did not identify the expected JARVIS release.');
  const { text: manifestText, value: manifest } = await checkedJson(fetchImpl, urlFor('release-manifest.json'));
  if (sha256(manifestText) !== health.manifestSha256 || manifest.buildId !== expectedBuildId) throw new Error('Deployment release manifest did not match health metadata.');
  validateReleaseManifest(manifest, expectedBuildId);
  for (const file of HASHED_FILES) {
    const response = await fetchImpl(urlFor(file), { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(`Release file check failed (${response.status}) for ${file}`);
    const actual = sha256(Buffer.from(await response.arrayBuffer()));
    if (actual !== manifest.files[file]) throw new Error(`Published SHA-256 mismatch for ${file}.`);
  }
  return { buildId: manifest.buildId, manifestSha256: health.manifestSha256 };
}
if (require.main === module) {
  const args = process.argv.slice(2); const read = (name) => args[args.indexOf(name) + 1];
  verifyDeployment({ baseUrl: read('--url'), expectedBuildId: read('--build') }).then((value) => process.stdout.write(`${JSON.stringify(value)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
module.exports = { validateReleaseManifest, verifyDeployment };
