(function exposeStagingAppsApproval(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisStagingAppsApproval = api;
}(globalThis, function createStagingAppsApproval() {
  'use strict';
  const PAIRING_ID = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
  const PAIRING_CODE = /^[0-9]{8}$/;
  const TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const APPS = new Set(['gmail', 'google-calendar', 'google-contacts', 'google-drive', 'google-docs', 'google-sheets', 'google-tasks']);
  const bytes = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid staging authentication response.');
    const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
  };
  const base64url = (value) => { let binary = ''; for (const item of new Uint8Array(value)) binary += String.fromCharCode(item); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  function trustedConfig(windowObject) {
    const auth = windowObject.JARVIS_AUTH_CONFIG || {}, connectors = windowObject.JARVIS_CONNECTORS_CONFIG || {};
    const hudOrigin = 'https://jarvis-hud-staging.hlao-xiong.workers.dev';
    if (windowObject.location?.origin !== hudOrigin || auth.enabled !== true || auth.hudOrigin !== hudOrigin || auth.workerUrl !== 'https://jarvis-auth-staging.hlao-xiong.workers.dev' || connectors.enabled !== true || connectors.workerOrigin !== 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev') return null;
    return Object.freeze({ authWorker: auth.workerUrl, appsWorker: connectors.workerOrigin });
  }
  function messageFor(error, phase) {
    const status = Number(error?.status);
    if (error?.name === 'NotAllowedError') return 'Passkey authentication was cancelled or unavailable.';
    if (phase === 'approve' && status === 410) return 'This pairing is expired, already used, invalid, or has reached its code-attempt limit. Start a new pairing on the HUD.';
    if (phase === 'approve' && status === 403) return 'Approval was denied because the requested app scope is not permitted for this pairing.';
    if (status === 401) return phase === 'approve' ? 'Your owner session expired or was revoked. Authenticate again.' : 'Passkey authentication was not accepted.';
    if (status === 503) return 'Staging authorization is temporarily unavailable. Try again shortly.';
    return phase === 'approve' ? 'Pairing approval could not be completed. Check the pairing ID and code.' : 'Passkey authentication could not be completed.';
  }
  function mount(documentObject, windowObject = globalThis, navigatorObject = globalThis.navigator, fetchImpl = globalThis.fetch) {
    const authenticate = documentObject?.getElementById?.('staging-approve-authenticate'), form = documentObject?.getElementById?.('staging-approve-form'), pairingId = documentObject?.getElementById?.('staging-pairing-id'), code = documentObject?.getElementById?.('staging-pairing-code'), submit = documentObject?.getElementById?.('staging-approve-submit'), logout = documentObject?.getElementById?.('staging-approve-logout'), status = documentObject?.getElementById?.('staging-approve-status'), confirmation = documentObject?.getElementById?.('staging-approve-confirmation');
    if (!authenticate || !form || !pairingId || !code || !submit || !logout || !status || !confirmation) return null;
    const config = trustedConfig(windowObject); let bearer = ''; let busy = false;
    const say = (value) => { status.textContent = value; };
    const setBusy = (value) => { busy = value; authenticate.disabled = value || Boolean(bearer); submit.disabled = value || !bearer; logout.disabled = value || !bearer; };
    const request = async (origin, path, body, authorization = '') => {
      const response = await fetchImpl(`${origin}${path}`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(payload.error || 'Request rejected.'); error.status = response.status; throw error; }
      return payload;
    };
    const clearSession = () => { bearer = ''; form.hidden = true; logout.hidden = true; authenticate.hidden = false; setBusy(false); };
    if (!config || !windowObject.isSecureContext || !windowObject.PublicKeyCredential || !navigatorObject?.credentials?.get) { say('Open the isolated staging HUD in a current secure browser with passkey support.'); authenticate.disabled = true; return { state: () => 'unavailable' }; }
    say('Authenticate with your staging passkey to approve a HUD pairing.'); setBusy(false);
    authenticate.addEventListener('click', async () => {
      setBusy(true);
      try {
        say('Requesting a passkey authentication challenge…');
        const start = await request(config.authWorker, '/v1/auth/options', {});
        const options = start.options;
        say('Complete the platform-passkey prompt.');
        const credential = await navigatorObject.credentials.get({ publicKey: { ...options, challenge: bytes(options.challenge), allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: bytes(item.id) })) } });
        if (!credential) throw new Error('Passkey authentication was cancelled.');
        const response = credential.response;
        const verified = await request(config.authWorker, '/v1/auth/verify', { challengeId: start.challengeId, response: { id: credential.id, rawId: base64url(credential.rawId), type: credential.type, response: { clientDataJSON: base64url(response.clientDataJSON), authenticatorData: base64url(response.authenticatorData), signature: base64url(response.signature), userHandle: response.userHandle ? base64url(response.userHandle) : undefined }, clientExtensionResults: credential.getClientExtensionResults?.() || {} } });
        if (!TOKEN.test(verified.accessToken || '')) throw new Error('Invalid owner session.');
        bearer = verified.accessToken; confirmation.hidden = true; authenticate.hidden = true; form.hidden = false; logout.hidden = false; setBusy(false); say('Authenticated. Review the app scope and approve the Google Apps device pairing before it expires.'); pairingId.focus?.();
      } catch (error) { clearSession(); say(messageFor(error, 'authenticate')); }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const alias = String(pairingId.value || '').trim().toUpperCase(), userCode = String(code.value || '').replace(/\s/g, '');
      const apps = [...documentObject.querySelectorAll?.('input[name="staging-app"]:checked') || []].map((item) => item.value).filter((item) => APPS.has(item));
      if (!PAIRING_ID.test(alias)) { say('Enter the six-character pairing ID shown by the HUD.'); pairingId.focus?.(); return; }
      if (!PAIRING_CODE.test(userCode)) { say('Enter the eight-digit code shown by the HUD.'); code.focus?.(); return; }
      if (!apps.length) { say('Select at least one requested Google App to approve.'); return; }
      setBusy(true); say('Approving the one-time staging pairing…');
      try {
        await request(config.appsWorker, '/v1/owner/hud/pairings/approve', { pairingAlias: alias, code: userCode, apps }, `Bearer ${bearer}`);
        pairingId.value = ''; code.value = ''; bearer = ''; form.hidden = true; logout.hidden = true; authenticate.hidden = true; confirmation.hidden = false; setBusy(false); say('Google Apps device pairing approved. Return to the staging HUD and tap CHECK PHONE APPROVAL.');
      } catch (error) { if (error.status === 401) clearSession(); setBusy(false); say(messageFor(error, 'approve')); }
    });
    logout.addEventListener('click', async () => {
      const token = bearer; clearSession(); say('Ending the owner session…');
      try { await request(config.authWorker, '/v1/logout', {}, `Bearer ${token}`); say('Owner session logged out.'); }
      catch { say('Local owner session cleared. The server logout could not be confirmed.'); }
    });
    return { state: () => bearer ? 'authenticated' : 'unauthenticated' };
  }
  function autoMount(windowObject = globalThis) {
    const documentObject = windowObject.document;
    const showInitializationError = () => {
      const status = documentObject?.getElementById?.('staging-approve-status');
      if (status) status.textContent = 'The staging approval page could not initialize. Reload this page and try again.';
    };
    const start = () => {
      try { if (!mount(documentObject, windowObject, windowObject.navigator || globalThis.navigator, windowObject.fetch || globalThis.fetch)) showInitializationError(); }
      catch { showInitializationError(); }
    };
    if (!documentObject) return false;
    if (documentObject.readyState === 'loading') { documentObject.addEventListener('DOMContentLoaded', start, { once: true }); return true; }
    start(); return true;
  }
  return { mount, autoMount, trustedConfig, messageFor };
}));

if (typeof document !== 'undefined') {
  globalThis.jarvisStagingAppsApproval?.autoMount(globalThis);
}
