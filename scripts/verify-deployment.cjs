'use strict';

const { spawnSync } = require('node:child_process');
const { HASHED_FILES, sha256 } = require('./prepare-release.cjs');

class DeploymentVerificationError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'DeploymentVerificationError';
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryableStatus = (status) => status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
const retryDelay = (attempt, initialDelayMs, maxDelayMs) => Math.min(maxDelayMs, initialDelayMs * (2 ** (attempt - 1)));

function publicReason(error) {
  const message = String(error?.message || 'request failed').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
  return `${error?.name || 'Error'}: ${message}`;
}

function curlFetch(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('HTTPS is required for fallback deployment verification.');
  const timeoutSeconds = Math.max(1, Math.ceil((options.timeoutMs || 10000) / 1000));
  const args = ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '5', '--max-time', String(timeoutSeconds)];
  const accept = options.headers?.Accept || options.headers?.accept;
  if (accept) args.push('--header', `Accept: ${accept}`);
  args.push(url);
  const result = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { encoding: null, maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new TypeError('HTTPS fallback request failed.');
  return new Response(result.stdout, { status: 200 });
}

function createResilientFetch({ fetchImpl = fetch, curlImpl = curlFetch, onFallback = () => {} } = {}) {
  return async (url, options) => {
    try {
      return await fetchImpl(url, options);
    } catch (error) {
      onFallback({ reason: publicReason(error) });
      return curlImpl(url, { ...options, timeoutMs: options?.timeoutMs });
    }
  };
}

function validateReleaseManifest(manifest, expectedBuildId) {
  if (!manifest || manifest.schema !== 1 || manifest.app !== 'JARVIS HUD' || manifest.buildId !== expectedBuildId || !manifest.files || typeof manifest.files !== 'object') throw new Error('Deployment release manifest has an invalid identity or structure.');
  const actualFiles = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify([...HASHED_FILES].sort())) throw new Error('Deployment release manifest has an unexpected file inventory.');
  for (const file of HASHED_FILES) if (!/^[a-f0-9]{64}$/.test(manifest.files[file] || '')) throw new Error(`Deployment release manifest has an invalid SHA-256 for ${file}.`);
  return true;
}

async function checkedJson(fetchImpl, url, label, timeoutMs) {
  const signal = timeoutMs > 0 && typeof globalThis.AbortSignal?.timeout === 'function' ? globalThis.AbortSignal.timeout(timeoutMs) : undefined;
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal, timeoutMs });
  if (!response.ok) throw new DeploymentVerificationError(`${label} returned HTTP ${response.status}.`, { retryable: retryableStatus(response.status) });
  const text = await response.text();
  try { return { text, value: JSON.parse(text) }; } catch { throw new DeploymentVerificationError(`${label} did not return JSON.`, { retryable: true }); }
}

async function verifyDeploymentOnce({ baseUrl, expectedBuildId, fetchImpl, timeoutMs }) {
  const base = new URL(baseUrl); if (base.protocol !== 'https:') throw new Error('Deployment health checks require HTTPS.');
  const urlFor = (file) => new URL(file, base).href;
  const { value: health } = await checkedJson(fetchImpl, urlFor('health.json'), 'Deployment health document', timeoutMs);
  if (health.status !== 'ok' || health.app !== 'JARVIS HUD' || health.buildId !== expectedBuildId || !/^[a-f0-9]{64}$/.test(health.manifestSha256 || '')) throw new DeploymentVerificationError('Deployment health document has not reached the expected JARVIS release.', { retryable: true });
  const { text: manifestText, value: manifest } = await checkedJson(fetchImpl, urlFor('release-manifest.json'), 'Deployment release manifest', timeoutMs);
  if (sha256(manifestText) !== health.manifestSha256 || manifest.buildId !== expectedBuildId) throw new DeploymentVerificationError('Deployment release manifest did not match health metadata.');
  validateReleaseManifest(manifest, expectedBuildId);
  for (const file of HASHED_FILES) {
    const signal = timeoutMs > 0 && typeof globalThis.AbortSignal?.timeout === 'function' ? globalThis.AbortSignal.timeout(timeoutMs) : undefined;
    const response = await fetchImpl(urlFor(file), { cache: 'no-store', redirect: 'error', signal, timeoutMs });
    if (!response.ok) throw new DeploymentVerificationError(`Release file ${file} returned HTTP ${response.status}.`, { retryable: retryableStatus(response.status) });
    const actual = sha256(Buffer.from(await response.arrayBuffer()));
    if (actual !== manifest.files[file]) throw new DeploymentVerificationError(`Published SHA-256 mismatch for ${file}.`);
  }
  return { buildId: manifest.buildId, manifestSha256: health.manifestSha256 };
}

async function verifyDeployment({ baseUrl, expectedBuildId, fetchImpl, curlImpl, attempts = 6, initialDelayMs = 1000, maxDelayMs = 8000, timeoutMs = 10000, wait = sleep, onRetry = () => {}, onTransportFallback = () => {} }) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('Verification attempts must be a positive integer.');
  const transport = fetchImpl || createResilientFetch({ curlImpl, onFallback: onTransportFallback });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyDeploymentOnce({ baseUrl, expectedBuildId, fetchImpl: transport, timeoutMs });
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof DeploymentVerificationError) || error.retryable;
      if (!retryable || attempt === attempts) break;
      const delayMs = retryDelay(attempt, initialDelayMs, maxDelayMs);
      onRetry({ attempt, attempts, delayMs, reason: publicReason(error) });
      await wait(delayMs);
    }
  }
  throw new Error(`Deployment verification failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${publicReason(lastError)}`);
}
if (require.main === module) {
  const args = process.argv.slice(2); const read = (name) => args[args.indexOf(name) + 1];
  verifyDeployment({ baseUrl: read('--url'), expectedBuildId: read('--build') }).then((value) => process.stdout.write(`${JSON.stringify(value)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
module.exports = { DeploymentVerificationError, createResilientFetch, curlFetch, validateReleaseManifest, verifyDeployment, verifyDeploymentOnce };
