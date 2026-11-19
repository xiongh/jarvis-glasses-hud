'use strict';

// Package the staging overlay before generating hashes.  Calling the generic
// release preparer directly is safe for production but intentionally uses the
// root fail-closed configuration; doing that for staging silently disables the
// owner-management client and falls back to the hardware-pairing UI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PUBLIC_FILES, prepareRelease } = require('./prepare-release.cjs');

function stagingBuildId(source) {
  // Preserve the dirty worktree while assigning each staging artifact a
  // deterministic content identity instead of the ambiguous "local" label.
  const hash = crypto.createHash('sha1'); const staging = path.join(source, 'staging');
  for (const file of PUBLIC_FILES) {
    const from = ['auth-config.js', 'connectors-config.js'].includes(file) ? path.join(staging, file) : path.join(source, file);
    hash.update(file).update('\0').update(fs.readFileSync(from)).update('\0');
  }
  return hash.digest('hex');
}
function prepareStagingRelease({ source, output, buildId }) {
  const staging = path.join(source, 'staging');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hud-staging-source-'));
  try {
    for (const file of PUBLIC_FILES) {
      const target = path.join(temporary, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(source, file), target);
    }
    for (const file of ['auth-config.js', 'connectors-config.js']) fs.copyFileSync(path.join(staging, file), path.join(temporary, file));
    return prepareRelease({ source: temporary, output, buildId: buildId === 'auto' || !buildId ? stagingBuildId(source) : buildId });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2); const read = (name) => args[args.indexOf(name) + 1];
  try { process.stdout.write(`${JSON.stringify(prepareStagingRelease({ source: read('--source'), output: read('--output'), buildId: read('--build') || 'auto' }))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}

module.exports = { prepareStagingRelease, stagingBuildId };
