'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PUBLIC_FILES } = require('./prepare-release.cjs');

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{30,}/,
  /ya29\.[0-9A-Za-z_-]{20,}/,
  /(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function auditPublication(root) {
  const base = path.resolve(root);
  const contents = new Map();
  for (const file of PUBLIC_FILES) {
    const text = fs.readFileSync(path.join(base, file), 'utf8');
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) throw new Error(`Possible credential detected in public asset ${file}.`);
    if (/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(text)) throw new Error(`Private local backend URL found in public asset ${file}.`);
    contents.set(file, text);
  }
  const config = contents.get('connectors-config.js') || '';
  const worker = config.match(/workerOrigin:\s*'([^']*)'/)?.[1] || '';
  if (worker) {
    let url;
    try { url = new URL(worker); } catch { throw new Error('Public Connected Apps Worker origin is invalid.'); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Public Connected Apps origin must be a credential-free HTTPS Worker origin.');
  }
  const companion = config.match(/phoneCompanionUrl:\s*'([^']*)'/)?.[1] || '';
  if (companion) {
    let url;
    try { url = new URL(companion); } catch { throw new Error('Phone companion URL is invalid.'); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.pathname !== '/connect-apps.html' || url.search || url.hash || url.username || url.password) throw new Error('Phone companion URL must be the expected HTTPS Tailscale route.');
  }
  const auth = contents.get('auth-config.js') || '';
  const enabled = auth.match(/enabled:\s*(true|false)/)?.[1];
  const workerUrl = auth.match(/workerUrl:\s*'([^']*)'/)?.[1] || '';
  if (!enabled) throw new Error('Public passkey configuration is missing an explicit enabled flag.');
  if (enabled === 'true') {
    let url;
    try { url = new URL(workerUrl); } catch { throw new Error('Enabled passkey authorization requires a valid Auth Worker URL.'); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Public Auth Worker configuration must be a credential-free HTTPS Worker origin.');
  } else if (workerUrl) throw new Error('Disabled passkey configuration must not retain an Auth Worker URL.');
  return { checkedAssets: PUBLIC_FILES.length, credentialsFound: false };
}

if (require.main === module) {
  const args = process.argv.slice(2); const root = args[args.indexOf('--root') + 1] || '.';
  try { process.stdout.write(`${JSON.stringify(auditPublication(root))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}

module.exports = { auditPublication };
