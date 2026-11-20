(function exposeStagingConnections(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisStagingConnections = api;
}(globalThis, function createStagingConnections() {
  'use strict';
  const HANDOFF = /^[A-Za-z0-9_-]{43}$/;
  const APPS = Object.freeze(['gmail', 'google-calendar', 'google-contacts', 'google-drive', 'google-docs', 'google-sheets', 'google-tasks']);
  const HUD_ORIGIN = 'https://jarvis-hud-staging.hlao-xiong.workers.dev';
  const AUTH_ORIGIN = 'https://jarvis-auth-staging.hlao-xiong.workers.dev';
  const APPS_ORIGIN = 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev';
  const bytes = (value) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid staging authentication response.'); const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0)); };
  const base64url = (value) => { let binary = ''; for (const item of new Uint8Array(value)) binary += String.fromCharCode(item); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const selected = (documentObject, name) => [...documentObject.querySelectorAll?.(`input[name="${name}"]:checked`) || []].map((item) => item.value).filter((item) => APPS.includes(item));
  const youtubeUrl = (value) => { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && !url.username && !url.password && /^jarvis-glasses-youtube-staging\.[a-z0-9-]+\.workers\.dev$/i.test(url.hostname) && url.pathname === '/connect' && !url.search && !url.hash ? url.href : ''; } catch { return ''; } };
  function trustedConfig(windowObject) {
    const auth = windowObject.JARVIS_AUTH_CONFIG || {}, connectors = windowObject.JARVIS_CONNECTORS_CONFIG || {};
    if (windowObject.location?.origin !== HUD_ORIGIN || auth.enabled !== true || auth.hudOrigin !== HUD_ORIGIN || auth.workerUrl !== AUTH_ORIGIN || connectors.enabled !== true || connectors.workerOrigin !== APPS_ORIGIN) return null;
    return Object.freeze({ authWorker: AUTH_ORIGIN, appsWorker: APPS_ORIGIN, youtubeUrl: youtubeUrl(connectors.youtubeConnectorUrl) });
  }
  function messageFor(error, phase) {
    const status = Number(error?.status);
    if (error?.name === 'NotAllowedError') return 'Passkey authentication was cancelled or unavailable.';
    if (phase === 'approve' && status === 410) return 'This pairing is expired, already used, invalid, or has reached its code-attempt limit. Start a new pairing on the HUD.';
    if (phase === 'approve' && status === 403) return 'Approval was denied because the requested app scope is not permitted for this pairing.';
    if (status === 401) return 'Your owner session expired or was revoked. Authenticate again.';
    if (status === 409) return 'The selected connection state has changed. Refresh and try again.';
    if (status === 503) return 'The isolated staging connector is not configured yet. Try again after its staging prerequisites are complete.';
    return phase === 'authenticate' ? 'Passkey authentication could not be completed.' : 'The connection request could not be completed. Try again.';
  }
  function mount(documentObject, windowObject = globalThis, navigatorObject = globalThis.navigator, fetchImpl = globalThis.fetch) {
    const byId = (id) => documentObject?.getElementById?.(id);
    const authenticate = byId('staging-approve-authenticate'), logout = byId('staging-approve-logout'), status = byId('staging-approve-status');
    const googleSection = byId('staging-google-section'), googleSummary = byId('staging-google-summary'), youtubeSection = byId('staging-youtube-section'), youtubeSummary = byId('staging-youtube-summary'), youtubeManage = byId('staging-youtube-manage'), serviceStatus = byId('staging-service-status');
    const connect = byId('staging-google-connect'), legacyReconnect = byId('staging-google-reconnect'), disconnect = byId('staging-google-disconnect');
    if (![authenticate, logout, status].every(Boolean)) return null;
    const config = trustedConfig(windowObject); let authenticated = false; let busy = false; let grant = null; let reconnectApps = [];
    const say = (value) => { status.textContent = value; };
    const setBusy = (value) => { busy = value; authenticate.disabled = value || authenticated; logout.disabled = value || !authenticated; [connect, legacyReconnect, disconnect, youtubeManage].filter(Boolean).forEach((button) => { button.disabled = value || !authenticated; }); for (const input of documentObject.querySelectorAll?.('input[name="staging-google-app"]') || []) input.disabled = value || !authenticated; };
    const showHub = (visible) => { [googleSection, youtubeSection, serviceStatus].filter(Boolean).forEach((section) => { section.hidden = !visible; }); logout.hidden = !visible; authenticate.hidden = visible; };
    const request = async (origin, path, body, options = {}) => {
      const response = await fetchImpl(`${origin}${path}`, { method: options.method || 'POST', mode: 'cors', credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.connectedApps ? { 'X-Jarvis-HUD': 'connected-apps' } : {}), ...(options.headers || {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(payload.error || 'Request rejected.'); error.status = response.status; throw error; } return payload;
    };
    const syncGoogleCheckboxes = () => { const active = new Set(grant?.apps || []), disabledApps = new Set(grant?.disabledApps || []), reconnect = new Set(reconnectApps); for (const input of documentObject.querySelectorAll?.('input[name="staging-google-app"]') || []) { input.checked = grant?.connected ? active.has(input.value) && !disabledApps.has(input.value) : reconnect.has(input.value); input.disabled = busy || !authenticated; } };
    const refreshGoogle = async () => { grant = await request(config.appsWorker, '/v1/owner/google/grant', undefined, { method: 'GET' }); if (grant.connected) reconnectApps = [...new Set(grant.apps || [])]; else if (grant.authorizationState === 'revoked' && Array.isArray(grant.previousApps)) reconnectApps = [...new Set(grant.previousApps.filter((app) => APPS.includes(app)))]; syncGoogleCheckboxes(); if (connect) connect.textContent = grant.authorizationState === 'revoked' ? 'RECONNECT GOOGLE' : 'CONNECT GOOGLE'; if (googleSummary) googleSummary.textContent = !grant.connected ? (grant.authorizationState === 'revoked' ? (reconnectApps.length ? 'Google was disconnected. Reconnect the previously selected apps, or change the selection before reconnecting.' : 'Google was disconnected. Select apps, then reconnect Google.') : 'Select the Google Apps to authorize, then connect Google.') : `${(grant.apps || []).length} Google App${grant.apps.length === 1 ? '' : 's'} authorized; ${(grant.disabledApps || []).length} disabled for JARVIS. Toggle an authorized app to enable or disable it.`; return grant; };
    const establishConnectedAppsSession = async () => { const handoff = await request(config.authWorker, '/v1/connected-apps/handoff', {}, { connectedApps: true }); if (!HANDOFF.test(handoff.handoff || '')) throw new Error('Invalid owner authorization handoff.'); await request(config.appsWorker, '/v1/owner/session/handoff', { handoff: handoff.handoff }, { connectedApps: true }); };
    const approveRegisteredGlasses = async () => {
      const pending = await request(config.authWorker, '/v1/glasses/unlock/pending', undefined, { method: 'GET', headers: { 'X-Jarvis-HUD': 'glasses-auto-unlock' } });
      const requests = Array.isArray(pending.pending) ? pending.pending : [];
      let approved = 0;
      for (const item of requests) {
        if (!/^[A-Za-z0-9_-]{24}$/.test(String(item?.transaction_id || ''))) continue;
        await request(config.authWorker, '/v1/glasses/unlock/auto-approve', { transactionId: item.transaction_id }, { headers: { 'X-Jarvis-HUD': 'glasses-auto-unlock' } });
        approved += 1;
      }
      return approved;
    };
    const authenticateOwner = async () => { const start = await request(config.authWorker, '/v1/auth/options', {}); const options = start.options; const credential = await navigatorObject.credentials.get({ publicKey: { ...options, challenge: bytes(options.challenge), allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: bytes(item.id) })) } }); if (!credential) throw new Error('Passkey authentication was cancelled.'); const response = credential.response; await request(config.authWorker, '/v1/auth/verify', { challengeId: start.challengeId, response: { id: credential.id, rawId: base64url(credential.rawId), type: credential.type, response: { clientDataJSON: base64url(response.clientDataJSON), authenticatorData: base64url(response.authenticatorData), signature: base64url(response.signature), userHandle: response.userHandle ? base64url(response.userHandle) : undefined }, clientExtensionResults: credential.getClientExtensionResults?.() || {} } }); const approvedGlasses = await approveRegisteredGlasses(); await establishConnectedAppsSession(); return approvedGlasses; };
    const connectionsReturnTo = () => { const path = windowObject.location?.pathname; return `${HUD_ORIGIN}${['/staging-apps-connect', '/staging-apps-connect.html'].includes(path) ? path : '/staging-apps-connect.html'}`; };
    const connectGoogle = async () => { const apps = selected(documentObject, 'staging-google-app'); if (!apps.length) { const message = 'Select one or more Google Apps first, then reconnect Google.'; say(message); if (googleSummary) googleSummary.textContent = message; return; } const alreadyGranted = new Set(grant?.apps || []); const needed = apps.filter((app) => !alreadyGranted.has(app)); if (grant?.connected && !needed.length) { say('The selected Google Apps are already authorized. Use their toggles to enable or disable them for JARVIS.'); return; } setBusy(true); try { const data = await request(config.appsWorker, '/v1/owner/google/oauth/start', { apps: needed.length ? needed : apps, returnTo: connectionsReturnTo() }, { connectedApps: true }); if (typeof data.authorizationUrl !== 'string' || !data.authorizationUrl.startsWith('https://accounts.google.com/')) throw new Error('Google authorization is unavailable.'); windowObject.location.assign(data.authorizationUrl); } catch (error) { say(messageFor(error, 'connect')); setBusy(false); } };
    const toggleGoogleApp = async (input) => { if (!grant?.connected) { reconnectApps = selected(documentObject, 'staging-google-app'); const message = reconnectApps.length ? 'Selection updated. Choose Reconnect Google to continue.' : 'Select one or more Google Apps before reconnecting.'; say(message); if (googleSummary) googleSummary.textContent = message; return; } if (!(grant.apps || []).includes(input.value)) { say('That app needs Google authorization. Select it and choose Connect Google.'); await refreshGoogle().catch(() => {}); return; } setBusy(true); try { const action = input.checked ? 'enable' : 'disable'; await request(config.appsWorker, '/v1/owner/google/apps/access', { apps: [input.value], action }, { connectedApps: true }); await refreshGoogle(); say(`${input.checked ? 'Enabled' : 'Disabled'} ${input.value.replace('google-', '')} for JARVIS.`); } catch (error) { say(messageFor(error, 'manage')); await refreshGoogle().catch(() => {}); } finally { setBusy(false); } };
    if (!config || !windowObject.isSecureContext || !windowObject.PublicKeyCredential || !navigatorObject?.credentials?.get) { say('Open the isolated staging HUD in a current secure browser with passkey support.'); authenticate.disabled = true; return { state: () => 'unavailable' }; }
    if (youtubeSection && youtubeSummary) youtubeSummary.textContent = config.youtubeUrl ? 'Use the isolated staging YouTube connection page. Its provider session remains separate from Google Apps.' : 'An isolated staging YouTube connector has not been configured. Production YouTube accounts are never used here.';
    // Connections is intentionally network-fresh, but register/update the HUD
    // worker here as well so a user who only visits this phone page still sees
    // a pending verified release. It is not activated automatically.
    try { navigatorObject?.serviceWorker?.register?.('./service-worker.js', { updateViaCache: 'none' }).then((registration) => registration.update?.()).catch(() => {}); } catch {}
    youtubeManage?.addEventListener('click', () => { if (config.youtubeUrl) windowObject.location.assign(config.youtubeUrl); else say('YouTube staging is not configured yet. No production account was opened.'); });
    authenticate.addEventListener('click', async () => { setBusy(true); say('Requesting a passkey authentication challenge…'); try { const approvedGlasses = await authenticateOwner(); authenticated = true; showHub(true); await refreshGoogle(); setBusy(false); say(approvedGlasses ? `Authenticated. Unlocked ${approvedGlasses} registered glasses request${approvedGlasses === 1 ? '' : 's'}.` : 'Authenticated. Manage phone-owned service connections below.'); } catch (error) { authenticated = false; showHub(false); setBusy(false); say(messageFor(error, 'authenticate')); } });
    connect?.addEventListener('click', () => { void connectGoogle(); });
    // Transitional compatibility for a predecessor document cached by an old
    // service worker. It uses the same checked inputs and authorization path;
    // it is not emitted by the current HTML.
    legacyReconnect?.addEventListener('click', () => { void connectGoogle(); });
    for (const input of documentObject.querySelectorAll?.('input[name="staging-google-app"]') || []) input.addEventListener?.('change', () => { void toggleGoogleApp(input); });
    disconnect?.addEventListener('click', async () => { if (!windowObject.confirm?.('Disconnect Google from JARVIS? This revokes JARVIS access and may require Google confirmation.')) return; reconnectApps = [...new Set(grant?.apps || selected(documentObject, 'staging-google-app'))]; setBusy(true); try { await request(config.appsWorker, '/v1/owner/google/grant', undefined, { method: 'DELETE', connectedApps: true }); await refreshGoogle(); say('Google was disconnected. Choose Reconnect Google to authorize the previous app selection again.'); } catch (error) { say(messageFor(error, 'disconnect')); } finally { setBusy(false); } });
    logout.addEventListener('click', async () => { setBusy(true); try { await request(config.authWorker, '/v1/logout', {}, { headers: { 'X-Jarvis-HUD': 'lock' } }); } catch {} finally { authenticated = false; grant = null; showHub(false); setBusy(false); say('Owner session logged out.'); } });
    showHub(false); setBusy(false);
    // The callback is allowed to return only to this exact HTTPS page. Its
    // Connected Apps session is HttpOnly, so a successful status read is the
    // authentication check; no OAuth material is placed in the URL or page.
    if (new URLSearchParams(String(windowObject.location?.search || '')).get('google') === 'complete') {
      setBusy(true); void refreshGoogle().then(() => { authenticated = true; showHub(true); say('Google authorization complete. Connection status refreshed.'); try { windowObject.history?.replaceState?.({}, '', connectionsReturnTo()); } catch {} }).catch((error) => { say(messageFor(error, 'authenticate')); }).finally(() => { setBusy(false); });
    }
    return { state: () => authenticated ? 'authenticated' : 'unauthenticated', refreshGoogle };
  }
  function autoMount(windowObject = globalThis) { const documentObject = windowObject.document; const start = () => { try { mount(documentObject, windowObject, windowObject.navigator || globalThis.navigator, windowObject.fetch || globalThis.fetch); } catch {} }; if (!documentObject) return false; if (documentObject.readyState === 'loading') { documentObject.addEventListener('DOMContentLoaded', start, { once: true }); return true; } start(); return true; }
  return { mount, autoMount, trustedConfig, messageFor, youtubeUrl, APPS };
}));
if (typeof document !== 'undefined') globalThis.jarvisStagingConnections?.autoMount(globalThis);
