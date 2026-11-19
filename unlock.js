(function exposeGlassesUnlock(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisPhoneUnlock = api;
}(globalThis, function createGlassesUnlock() {
  'use strict';
  const b64urlToBytes = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid WebAuthn challenge.');
    const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  };
  const bytesToB64url = (value) => {
    let binary = ''; for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  function trustedWorker(config, location) {
    const hudOrigin = typeof config?.hudOrigin === 'string' ? config.hudOrigin : 'https://xiongh.github.io';
    if (config?.enabled !== true || typeof config.workerUrl !== 'string' || location?.origin !== hudOrigin) return '';
    try { const url = new URL(config.workerUrl); return url.protocol === 'https:' && url.origin === config.workerUrl.replace(/\/$/, '') && url.hostname.endsWith('.workers.dev') ? url.origin : ''; } catch { return ''; }
  }
  async function request(fetchImpl, worker, path, body, options = {}) {
    const response = await fetchImpl(`${worker}${path}`, { method: options.method || 'POST', mode: 'cors', credentials: options.credentials || 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body || {}) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'JARVIS approval request failed.'); error.status = response.status; const retryAfter = Number(response.headers?.get?.('Retry-After')); if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000; throw error; }
    return data;
  }
  function toPublicKey(options) {
    return { ...options, challenge: b64urlToBytes(options.challenge), allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: b64urlToBytes(item.id) })) };
  }
  function serializeAssertion(credential) {
    return { id: credential.id, rawId: bytesToB64url(credential.rawId), type: credential.type,
      response: { clientDataJSON: bytesToB64url(credential.response.clientDataJSON), authenticatorData: bytesToB64url(credential.response.authenticatorData), signature: bytesToB64url(credential.response.signature), userHandle: credential.response.userHandle ? bytesToB64url(credential.response.userHandle) : undefined },
      clientExtensionResults: credential.getClientExtensionResults?.() || {} };
  }
  function mountPhone(documentObject, { windowObject = globalThis.window, fetchImpl = globalThis.fetch, navigatorObject = globalThis.navigator } = {}) {
    const form = documentObject?.querySelector?.('#phone-unlock-form'); if (!form) return null;
    const input = documentObject.querySelector('#unlock-code'); const status = documentObject.querySelector('#phone-unlock-status'); const button = documentObject.querySelector('#approve-unlock'); const verifyButton = documentObject.querySelector('#phone-unlock-verify');
    const worker = trustedWorker(windowObject.JARVIS_AUTH_CONFIG, windowObject.location);
    let pending = null;
    const say = (message) => { status.textContent = message; };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = String(input.value || '').trim();
      if (!worker) { say('Phone approval is not configured for this trusted JARVIS release.'); return; }
      if (!/^\d{8}$/.test(code)) { say('Enter the 8-digit code shown in the glasses.'); return; }
      if (!navigatorObject.credentials?.get || !windowObject.PublicKeyCredential) { say('This iPhone browser does not support passkeys. Use current Safari on your iPhone.'); return; }
      button.disabled = true;
      try {
        say('Checking the glasses request…');
        const start = await request(fetchImpl, worker, '/v1/glasses/unlock/options', { code });
        if (start.options?.userVerification !== 'required') throw new Error('JARVIS did not require verified iPhone approval.');
        pending = { ...start, code };
        form.hidden = true; verifyButton.hidden = false;
        say('Tap Continue to approve with Face ID, Touch ID, or your device passcode.');
      } catch (error) { say(error?.message || 'Could not verify the glasses request.'); }
      finally { button.disabled = false; }
    });
    verifyButton.addEventListener('click', () => {
      if (!worker || !pending || !navigatorObject.credentials?.get) { say('Enter a current glasses code before approving.'); return; }
      // Invoke WebAuthn synchronously in this trusted tap handler. Do not put a
      // network await between iOS user activation and credentials.get().
      let ceremony;
      try { ceremony = navigatorObject.credentials.get({ publicKey: toPublicKey(pending.options) }); }
      catch (error) { say(error?.message || 'iPhone passkey approval could not start.'); return; }
      verifyButton.disabled = true; say('Complete the iPhone passkey prompt…');
      void (async () => {
        try {
          const credential = await ceremony;
          if (!credential) throw new Error('Passkey approval was canceled. Tap Continue to try again.');
          say('Verifying the signed approval…');
          await request(fetchImpl, worker, '/v1/glasses/unlock/approve', { transactionId: pending.transactionId, code: pending.code, challengeId: pending.challengeId, response: serializeAssertion(credential) });
          form.hidden = true; verifyButton.hidden = true; pending = null;
          say('Approved. JARVIS will unlock on the glasses automatically.');
        } catch (error) { say(error?.name === 'NotAllowedError' ? 'Passkey approval was canceled or unavailable. Tap Continue to try again before the glasses code expires.' : error?.message || 'Approval could not be verified.'); }
        finally { verifyButton.disabled = false; }
      })();
    });
    return { worker, status };
  }
  function mountGlasses(documentObject, { windowObject = globalThis.window, navigatorObject = globalThis.navigator, fetchImpl = globalThis.fetch, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const lock = documentObject?.getElementById?.('jarvis-session-lock'); const app = documentObject?.getElementById?.('jarvis-glasses-hud');
    if (!lock || !app) return null;
    const title = documentObject.getElementById('lock-title'); const status = documentObject.getElementById('lock-status'); const code = documentObject.getElementById('lock-code'); const retry = documentObject.getElementById('lock-retry'); const faceId = documentObject.getElementById('lock-face-id'); const phoneUnlock = documentObject.getElementById('lock-phone-unlock'); const manualLock = documentObject.getElementById('hud-lock'); const diagnostics = documentObject.getElementById('hud-auth-diagnostics');
    const worker = trustedWorker(windowObject.JARVIS_AUTH_CONFIG, windowObject.location);
    const POLL_INTERVAL_MS = 6_000; const POLL_BACKOFF_MIN_MS = 10_000; const POLL_BACKOFF_MAX_MS = 30_000;
    let timer = null; let expiryTimer = null; let expiry = 0; let generation = 0; let busy = false; let unlocked = false; let pollInFlight = false; let pollDelay = POLL_INTERVAL_MS; let restoreInFlight = null;
    // A refresh may briefly dispatch visibilitychange while the browser is
    // restoring its page.  That must not classify a still-valid cookie as
    // locked before the server-side restore request has answered.
    let startupSessionPending = windowObject.JARVIS_AUTH_CONFIG?.sessionRestore === true;
    const say = (message) => { status.textContent = message; };
    // Staging-only, intentionally non-secret observability.  It records
    // outcomes, never headers, cookies, assertions, tokens, or credentials.
    const diagnosticState = { build: diagnostics?.dataset?.buildId || 'unknown', unlock: 'none', cookie: 'not-attempted', restore: 'not-attempted', lock: 'idle', logout: 'not-attempted' };
    const report = () => {
      // This element is shipped hidden in the canonical HUD.  Only the
      // isolated staging configuration opts into showing operational labels.
      if (!diagnostics || windowObject.JARVIS_AUTH_CONFIG?.sessionRestore !== true) return;
      diagnostics.hidden = false;
      diagnostics.textContent = `STAGING AUTH DIAGNOSTICS · BUILD ${diagnosticState.build} · UNLOCK ${diagnosticState.unlock} · COOKIE ${diagnosticState.cookie} · RESTORE ${diagnosticState.restore} · LOCK ${diagnosticState.lock} · LOGOUT ${diagnosticState.logout}`;
    };
    const diagnose = (changes) => { Object.assign(diagnosticState, changes); report(); };
    const setChecking = (message = 'Checking your secure JARVIS session…') => { unlocked = false; lock.hidden = false; app.inert = true; documentObject.body.dataset.jarvisSession = 'checking_session'; code.hidden = true; if (title) title.textContent = 'CHECKING SESSION'; say(message); };
    const setLocked = (message) => { const wasUnlocked = unlocked; unlocked = false; expiry = 0; if (expiryTimer !== null) clearTimer(expiryTimer); expiryTimer = null; lock.hidden = false; app.inert = true; documentObject.body.dataset.jarvisSession = 'locked'; code.hidden = true; if (title) title.textContent = 'LOCKED'; if (message) say(message); retry?.focus?.(); if (wasUnlocked) documentObject.dispatchEvent(new windowObject.Event('jarvis-session-locked')); };
    const unlock = (expiresAt) => { if (expiryTimer !== null) clearTimer(expiryTimer); unlocked = true; expiry = expiresAt * 1000; lock.hidden = true; app.inert = false; documentObject.body.dataset.jarvisSession = 'authenticated'; documentObject.dispatchEvent(new windowObject.Event('jarvis-session-unlocked')); expiryTimer = setTimer(() => { if (unlocked) setLocked('Your JARVIS session expired. Approve again on your iPhone.'); }, Math.max(0, expiry - now())); };
    const stop = () => { generation++; if (timer !== null) clearTimer(timer); timer = null; busy = false; pollDelay = POLL_INTERVAL_MS; };
    const schedulePoll = (id, secret, run, delay = POLL_INTERVAL_MS) => {
      if (run !== generation || unlocked) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { timer = null; void poll(id, secret, run); }, delay);
    };
    const poll = async (id, secret, run) => {
      if (run !== generation || !worker || unlocked) return;
      if (pollInFlight) { schedulePoll(id, secret, run, POLL_INTERVAL_MS); return; }
      pollInFlight = true;
      try {
        diagnose({ unlock: 'companion-poll', cookie: 'issuance-requested' });
        const result = await request(fetchImpl, worker, '/v1/glasses/unlock/poll', { transactionId: id, pollSecret: secret }, { credentials: 'include' });
        if (run !== generation) return;
        if (result.unlocked === true && Number.isSafeInteger(result.expiresAt)) {
          diagnose({ cookie: result.session === 'issued' ? 'issued' : 'response-missing-marker', restore: 'not-needed' });
          stop();
          unlock(result.expiresAt);
          if (typeof result.assertion === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.assertion) && Number.isSafeInteger(result.assertionExpiresAt)) {
            windowObject.dispatchEvent?.(new CustomEvent('jarvis-glasses-assertion', { detail: { assertion: result.assertion, expiresAt: result.assertionExpiresAt * 1000 } }));
          }
          return;
        }
        if (result.pending !== true) throw new Error('Unlock request expired. Start a new request.');
        pollDelay = POLL_INTERVAL_MS;
        schedulePoll(id, secret, run, pollDelay);
      } catch (error) {
        if (run !== generation) return;
        if (error?.status === 429) {
          pollDelay = Math.min(POLL_BACKOFF_MAX_MS, Math.max(POLL_BACKOFF_MIN_MS, Number(error.retryAfterMs) || pollDelay * 2));
          say(`Approval check rate-limited. Retrying in ${Math.ceil(pollDelay / 1000)} seconds…`);
          schedulePoll(id, secret, run, pollDelay);
        } else { busy = false; say(error?.message || 'Could not check phone approval. Retry.'); retry.disabled = false; }
      } finally { pollInFlight = false; }
    };
    const start = async () => {
      stop(); setLocked('');
      if (!worker) { say('Phone unlock is not configured. This page stays locked until the approved JARVIS Auth Worker URL is set in this release.'); return false; }
      // The display Web App can report navigator.onLine as false while its
      // network stack is available.  Treat it only as a hint: the protected
      // request below is the authority and gives the user the real outcome.
      busy = true; retry.disabled = true; say('Creating a short-lived glasses unlock request…');
      const run = generation;
      try {
        const value = await request(fetchImpl, worker, '/v1/glasses/unlock/start', {});
        if (run !== generation) return false;
        if (!/^[A-Za-z0-9_-]{24}$/.test(value.transactionId || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.pollSecret || '') || !/^\d{8}$/.test(value.code || '') || !Number.isSafeInteger(value.expiresAt)) throw new Error('Unlock request was invalid.');
        code.textContent = `IPHONE CODE · ${value.code}`; code.hidden = false;
        say('Open the JARVIS Unlock page on your iPhone and enter this code.');
        busy = false; retry.disabled = false; pollDelay = POLL_INTERVAL_MS; void poll(value.transactionId, value.pollSecret, run); return true;
      } catch (error) { if (run === generation) { busy = false; retry.disabled = false; say(error?.message || 'Could not start a phone approval request.'); } return false; }
    };
    const restore = async () => {
      if (restoreInFlight) return restoreInFlight;
      setChecking();
      restoreInFlight = (async () => {
      if (!worker) { diagnose({ restore: 'not-configured' }); setLocked('Session check could not run. Unlock again with your iPhone.'); return false; }
      try {
        diagnose({ restore: 'requested' });
        const result = await request(fetchImpl, worker, '/v1/hud/session/restore', {}, { credentials: 'include', headers: { 'X-Jarvis-HUD': 'restore' } });
        if (result.authorized !== true || !Number.isSafeInteger(result.expiresAt) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.assertion || '') || !Number.isSafeInteger(result.assertionExpiresAt)) throw new Error('Session restoration was invalid.');
        diagnose({ restore: result.session === 'restored' ? 'restored' : 'response-missing-marker' });
        unlock(result.expiresAt);
        windowObject.dispatchEvent?.(new CustomEvent('jarvis-glasses-assertion', { detail: { assertion: result.assertion, expiresAt: result.assertionExpiresAt * 1000 } }));
        return true;
      } catch (error) { diagnose({ restore: error?.status === 401 ? 'rejected' : 'unavailable' }); setLocked(error?.status === 401 ? 'Your JARVIS session is locked. Unlock again with your iPhone.' : 'Session check could not reach JARVIS. Unlock again with your iPhone.'); return false; }
      })().finally(() => { startupSessionPending = false; restoreInFlight = null; });
      return restoreInFlight;
    };
    const lockNow = async () => {
      if (manualLock?.disabled) return false;
      if (!worker) { diagnose({ lock: 'executed', logout: 'not-configured' }); stop(); setLocked('JARVIS locked locally. Server logout is not configured; do not continue authorized work.'); return false; }
      manualLock && (manualLock.disabled = true); diagnose({ lock: 'executed', logout: 'requested' });
      try {
        const result = await request(fetchImpl, worker, '/v1/logout', {}, { credentials: 'include', headers: { 'X-Jarvis-HUD': 'lock' } });
        if (result.loggedOut !== true) throw new Error('JARVIS could not confirm server logout.');
        diagnose({ logout: 'confirmed' }); stop(); setLocked('JARVIS was locked. Unlock again with your iPhone.'); return true;
      } catch (error) {
        diagnose({ logout: 'failed' }); stop(); setLocked('JARVIS locked locally, but server logout was not confirmed. Do not continue authorized work; reconnect and unlock again.'); return false;
      } finally { if (manualLock) manualLock.disabled = false; }
    };
    retry.addEventListener('click', () => { void start(); });
    manualLock?.addEventListener('click', () => { void lockNow(); });
    if (faceId) faceId.addEventListener('click', async () => {
      if (faceId.disabled) return;
      if (!worker) { say('Direct iPhone unlock is not configured for this trusted JARVIS release.'); return; }
      if (!navigatorObject.credentials?.get || !windowObject.PublicKeyCredential) { say('This browser does not support passkeys. Use current Safari on your iPhone.'); return; }
      // See start(): navigator.onLine is not reliable in every glasses Web
      // App runtime, so let the authenticated Worker request decide.
      faceId.disabled = true;
      try {
        // This endpoint creates a fresh, single-use transaction. It never
        // accepts an owner bearer session as a substitute for this assertion.
        say('Preparing a fresh Face ID challenge…');
        const pending = await request(fetchImpl, worker, '/v1/hud/unlock/options', {});
        if (!/^[A-Za-z0-9_-]{24}$/.test(pending.transactionId || '') || !/^[a-f0-9]{64}$/.test(pending.challengeId || '') || pending.options?.userVerification !== 'required') throw new Error('JARVIS returned an invalid Face ID challenge.');
        say('Complete the Face ID or passkey prompt…');
        const credential = await navigatorObject.credentials.get({ publicKey: toPublicKey(pending.options) });
        if (!credential) throw new Error('Face ID or passkey authentication was canceled.');
        say('Verifying the signed assertion…');
        diagnose({ unlock: 'direct-face-id', cookie: 'issuance-requested' });
        const result = await request(fetchImpl, worker, '/v1/hud/unlock/verify', { transactionId: pending.transactionId, challengeId: pending.challengeId, response: serializeAssertion(credential) }, { credentials: 'include' });
        if (result.authorized !== true || result.transactionId !== pending.transactionId) throw new Error('JARVIS did not authorize this HUD unlock transaction.');
        diagnose({ cookie: result.session === 'issued' ? 'issued' : 'response-missing-marker', restore: 'not-needed' });
        stop();
        unlock(Number.isSafeInteger(result.expiresAt) ? result.expiresAt : Math.floor(now() / 1000) + 1800);
        if (typeof result.assertion === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.assertion) && Number.isSafeInteger(result.assertionExpiresAt)) {
          windowObject.dispatchEvent?.(new windowObject.CustomEvent('jarvis-glasses-assertion', { detail: { assertion: result.assertion, expiresAt: result.assertionExpiresAt * 1000 } }));
        }
        say('Unlocked with Face ID.');
      } catch (error) {
        const canceled = error?.name === 'NotAllowedError';
        setLocked(canceled ? 'Face ID or passkey authentication was canceled. Try again when ready.' : error?.message || 'Could not unlock with Face ID. Try again.');
      } finally { faceId.disabled = false; }
    });
    // The lock screen mounts before app.js and therefore needs its own D-pad
    // focus routing. Previously this capture listener suppressed all keys,
    // including the Arrow/Enter events the Neural Band sends, without moving
    // focus to the companion-unlock controls.
    const navigationKey = (event) => {
      const key = String(event?.key || event?.code || '');
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Space', 'Escape', 'Backspace'].includes(key)) return key === 'Space' ? ' ' : key;
      return ({ 8: 'Backspace', 13: 'Enter', 27: 'Escape', 32: ' ', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' })[Number(event?.keyCode || event?.which)] || '';
    };
    const lockControls = () => [faceId, phoneUnlock, retry].filter((control) => control && !control.hidden && !control.disabled);
    documentObject.addEventListener('keydown', (event) => {
      if (unlocked || event.target?.closest?.('[data-update-controls]')) return;
      const key = navigationKey(event); const controls = lockControls();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) && controls.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        const current = controls.indexOf(documentObject.activeElement);
        const delta = ['ArrowUp', 'ArrowLeft'].includes(key) ? -1 : 1;
        controls[(current + delta + controls.length) % controls.length].focus?.();
        return;
      }
      if ((key === 'Enter' || key === ' ') && controls.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        (controls.includes(documentObject.activeElement) ? documentObject.activeElement : controls[0]).click?.();
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    documentObject.addEventListener('visibilitychange', () => {
      // Do not render LOCKED during the only period where the session is
      // unknown. The restore result is the authority for that transition.
      if (startupSessionPending) return;
      if (documentObject.hidden) { stop(); if (!unlocked) setLocked('JARVIS is locked.'); }
      else if (expiry && expiry <= now()) { stop(); setLocked('Your JARVIS session expired. Approve again on your iPhone.'); void start(); }
      else if (!unlocked && !busy) void start();
    });
    report(); setChecking();
    if (windowObject.JARVIS_AUTH_CONFIG?.sessionRestore === true) void restore();
    else void start();
    return { start, restore, lock: lockNow, isUnlocked: () => unlocked };
  }
  return { mountPhone, mountGlasses, serializeAssertion, toPublicKey, trustedWorker };
}));

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('phone-unlock-form')) window.jarvisPhoneUnlock.mountPhone(document);
    else if (document.getElementById('jarvis-session-lock') && window.JARVIS_AUTH_CONFIG?.enabled === true) window.jarvisPhoneUnlock.mountGlasses(document);
  }, { once: true });
}
