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
    if (config?.enabled !== true || typeof config.workerUrl !== 'string' || location?.origin !== 'https://xiongh.github.io') return '';
    try { const url = new URL(config.workerUrl); return url.protocol === 'https:' && url.origin === config.workerUrl.replace(/\/$/, '') && url.hostname.endsWith('.workers.dev') ? url.origin : ''; } catch { return ''; }
  }
  async function request(fetchImpl, worker, path, body) {
    const response = await fetchImpl(`${worker}${path}`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'JARVIS approval request failed.');
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
    const status = documentObject.getElementById('lock-status'); const code = documentObject.getElementById('lock-code'); const retry = documentObject.getElementById('lock-retry');
    const worker = trustedWorker(windowObject.JARVIS_AUTH_CONFIG, windowObject.location);
    let timer = null; let expiry = 0; let generation = 0; let busy = false; let unlocked = false;
    const say = (message) => { status.textContent = message; };
    const setLocked = (message) => { unlocked = false; lock.hidden = false; app.inert = true; documentObject.body.dataset.jarvisSession = 'locked'; code.hidden = true; if (message) say(message); };
    const unlock = (expiresAt) => { unlocked = true; expiry = expiresAt * 1000; lock.hidden = true; app.inert = false; documentObject.body.dataset.jarvisSession = 'unlocked'; documentObject.dispatchEvent(new windowObject.Event('jarvis-session-unlocked')); setTimer(() => { if (unlocked) setLocked('Your JARVIS session expired. Approve again on your iPhone.'); }, Math.max(0, expiry - now())); };
    const stop = () => { generation++; if (timer !== null) clearTimer(timer); timer = null; busy = false; };
    const poll = async (id, secret, run) => {
      if (run !== generation || !worker) return;
      try {
        const result = await request(fetchImpl, worker, '/v1/glasses/unlock/poll', { transactionId: id, pollSecret: secret });
        if (run !== generation) return;
        if (result.unlocked === true && Number.isSafeInteger(result.expiresAt)) { unlock(result.expiresAt); return; }
        if (result.pending !== true) throw new Error('Unlock request expired. Start a new request.');
        timer = setTimer(() => { void poll(id, secret, run); }, 1500);
      } catch (error) { if (run === generation) { busy = false; say(error?.message || 'Could not check phone approval. Retry.'); retry.disabled = false; } }
    };
    const start = async () => {
      stop(); setLocked('');
      if (!worker) { say('Phone unlock is not configured. This page stays locked until the approved JARVIS Auth Worker URL is set in this release.'); return false; }
      if (navigatorObject.onLine === false) { say('Connect to the internet to request a phone approval.'); return false; }
      busy = true; retry.disabled = true; say('Creating a short-lived glasses unlock request…');
      const run = generation;
      try {
        const value = await request(fetchImpl, worker, '/v1/glasses/unlock/start', {});
        if (run !== generation) return false;
        if (!/^[A-Za-z0-9_-]{24}$/.test(value.transactionId || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.pollSecret || '') || !/^\d{8}$/.test(value.code || '') || !Number.isSafeInteger(value.expiresAt)) throw new Error('Unlock request was invalid.');
        code.textContent = `IPHONE CODE · ${value.code}`; code.hidden = false;
        say('Open the JARVIS Unlock page on your iPhone and enter this code.');
        busy = false; retry.disabled = false; void poll(value.transactionId, value.pollSecret, run); return true;
      } catch (error) { if (run === generation) { busy = false; retry.disabled = false; say(error?.message || 'Could not start a phone approval request.'); } return false; }
    };
    retry.addEventListener('click', () => { void start(); });
    documentObject.addEventListener('keydown', (event) => { if (!unlocked && !event.target?.closest?.('[data-update-controls]')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    documentObject.addEventListener('visibilitychange', () => { if (documentObject.hidden) { stop(); if (!unlocked) setLocked('JARVIS is locked.'); } else if (expiry && expiry <= now()) { stop(); setLocked('Your JARVIS session expired. Approve again on your iPhone.'); void start(); } else if (!unlocked && !busy) void start(); });
    setLocked(''); void start();
    return { start, lock: setLocked, isUnlocked: () => unlocked };
  }
  return { mountPhone, mountGlasses, serializeAssertion, toPublicKey, trustedWorker };
}));

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('phone-unlock-form')) window.jarvisPhoneUnlock.mountPhone(document);
    else if (document.getElementById('jarvis-session-lock') && window.JARVIS_AUTH_CONFIG?.enabled === true) window.jarvisPhoneUnlock.mountGlasses(document);
  }, { once: true });
}
