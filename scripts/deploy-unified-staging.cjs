'use strict';

// Staging-only HUD release gate. Pages is deliberately verification-only until
// a separate non-production Pages origin is provided and reviewed.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStagingRelease } = require('./prepare-staging-release.cjs');
const { verifyReleaseDirectory } = require('./verify-release.cjs');
const { verifyDeployment } = require('./verify-deployment.cjs');

const STAGING_URL = 'https://jarvis-hud-staging.hlao-xiong.workers.dev/';
const PRODUCTION_PAGES_ORIGIN = 'https://xiongh.github.io';

function value(args, name) { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] || ''; }
function run(file, args, cwd) { execFileSync(file, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' }); }

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(value(args, '--source') || process.cwd());
  const deploy = args.includes('--deploy');
  const pagesUrl = value(args, '--pages-staging-url');
  if (pagesUrl) {
    const parsed = new URL(pagesUrl);
    if (parsed.origin === PRODUCTION_PAGES_ORIGIN) throw new Error('Refusing the production GitHub Pages origin. A separate Pages staging origin requires explicit setup and review.');
    throw new Error('A Pages staging deployment is not configured in this repository. The supplied staging URL may be verified only after its existing owner-managed deployment publishes the same artifact.');
  }
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-hud-unified-staging-'));
  const config = path.join(root, 'wrangler.phase1-staging.jsonc');
  if (!fs.existsSync(config)) throw new Error(`Missing staging Worker config: ${config}`);
  try {
    const release = prepareStagingRelease({ source: root, output, buildId: 'auto' });
    const buildId = release.manifest.buildId;
    verifyReleaseDirectory({ root: output, expectedBuildId: buildId });
    if (deploy) {
      // Existing account authorization is consumed by Wrangler; this script
      // neither reads nor creates credentials or secrets.
      run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.159.0', 'deploy', '--config', config, '--assets', output], root);
      await verifyDeployment({
        baseUrl: STAGING_URL,
        expectedBuildId: buildId,
        onRetry: ({ attempt, attempts, delayMs, reason }) => process.stderr.write(`[staging verification] attempt ${attempt}/${attempts} did not observe the new release; retrying in ${delayMs}ms (${reason})\n`),
        onTransportFallback: () => process.stderr.write('[staging verification] native HTTPS fetch failed; using the HTTPS curl fallback.\n'),
      });
    }
    process.stdout.write(`${JSON.stringify({ buildId, artifact: output, cloudflareStaging: STAGING_URL, deployed: deploy, pages: 'BLOCKED_NO_STAGING_TARGET' })}\n`);
  } finally {
    if (!args.includes('--keep-artifact')) fs.rmSync(output, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
module.exports = { main, STAGING_URL, PRODUCTION_PAGES_ORIGIN };
