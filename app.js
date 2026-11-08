(function exposeJarvisGlassesHud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisGlassesHud = api;
}(globalThis, function createJarvisGlassesHud() {
  'use strict';

  const YOUTUBE_API_PREFIX = '/v1/youtube';
  const DEFAULT_YOUTUBE_WORKER_ORIGIN = 'https://jarvis-glasses-youtube.hlao-xiong.workers.dev';
  const RELEASE_MANIFEST_URL = './release-manifest.json';

  function normalizeBackendOrigin(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
      const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
      const privateSuffix = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa') || host.endsWith('.ts.net');
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || privateSuffix || ipLiteral) return '';
      return parsed.origin;
    } catch { return ''; }
  }

  function createRequestGate({ AbortControllerImpl = globalThis.AbortController } = {}) {
    let generation = 0;
    let activeKey = '';
    let controller = null;
    return {
      begin(key) {
        const requestKey = String(key || '');
        if (controller && !controller.signal.aborted && requestKey === activeKey) return null;
        controller?.abort();
        const id = ++generation;
        controller = new AbortControllerImpl();
        activeKey = requestKey;
        return { id, signal: controller.signal, isCurrent: () => id === generation, finish: () => { if (id === generation) { controller = null; activeKey = ''; } } };
      },
      cancel() { controller?.abort(); controller = null; activeKey = ''; generation += 1; },
    };
  }

  function createYouTubeClient({ fetchImpl = globalThis.fetch, backendOrigin = DEFAULT_YOUTUBE_WORKER_ORIGIN, now = Date.now, storage: storageOverride } = {}) {
    let base = normalizeBackendOrigin(backendOrigin) || DEFAULT_YOUTUBE_WORKER_ORIGIN;
    let deviceCredential = '';
    let expiresAt = 0;
    let deviceId = '';
    let pairing = null;
    let persistentSession = false;
    let storage = storageOverride || null;
    if (!storage) { try { storage = globalThis.localStorage || null; } catch {} }
    const sessionKey = () => `jarvis.youtube.device-session:${base}`;
    const readSavedSession = () => {
      if (!storage || !base) return null;
      try {
        const saved = JSON.parse(storage.getItem(sessionKey()) || 'null');
        if (!saved || typeof saved.credential !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(saved.credential)
          || typeof saved.device !== 'string' || !/^dev_[A-Za-z0-9_-]{24,64}$/.test(saved.device)
          || !Number.isFinite(Number(saved.expiresAt))) return null;
        return { token: saved.credential, id: saved.device, expiresAt: Number(saved.expiresAt) };
      } catch { return null; }
    };
    const persistSession = () => {
      if (!storage || !deviceCredential || !deviceId || !expiresAt) { persistentSession = false; return false; }
      // This is only the 30-day, account-bound HUD device bearer; Google OAuth
      // access and refresh tokens remain encrypted in Worker D1 storage.
      try { storage.setItem(sessionKey(), JSON.stringify({ credential: deviceCredential, device: deviceId, expiresAt })); persistentSession = true; return true; }
      catch { persistentSession = false; return false; }
    };
    const savedSession = readSavedSession();
    if (savedSession && savedSession.expiresAt > now()) { deviceCredential = savedSession.token; deviceId = savedSession.id; expiresAt = savedSession.expiresAt; persistentSession = true; }
    const clear = () => {
      deviceCredential = ''; expiresAt = 0; deviceId = ''; pairing = null; persistentSession = false;
      try { storage?.removeItem(sessionKey()); } catch {}
    };
    const setBackendOrigin = (value) => {
      const normalized = normalizeBackendOrigin(value);
      if (normalized !== base) clear();
      base = normalized;
      return base;
    };
    const request = async (path, { method = 'GET', body, anonymous = false, signal } = {}) => {
      if (!base) throw new Error('Set the HTTPS JARVIS YouTube Worker origin first.');
      if (!anonymous && (!deviceCredential || expiresAt <= now())) { clear(); const error = new Error('Glasses session expired or was revoked. Pair again from the phone connection page.'); error.status = 401; error.code = 'DEVICE_SESSION_EXPIRED'; throw error; }
      const response = await fetchImpl(`${base}${path}`, { method, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(!anonymous ? { Authorization: `Bearer ${deviceCredential}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        let code = typeof data.code === 'string' ? data.code : '';
        if (['DEVICE_SESSION_REQUIRED', 'DEVICE_SESSION_INVALID', 'DEVICE_SESSION_EXPIRED'].includes(code)) {
          const saved = readSavedSession();
          if (saved && saved.token !== deviceCredential && saved.expiresAt > now()) {
            deviceCredential = saved.token; deviceId = saved.id; expiresAt = saved.expiresAt; persistentSession = true; code = 'DEVICE_SESSION_ROTATED';
          } else clear();
        }
        const error = new Error(data.error || `JARVIS YouTube request failed (${response.status}).`); error.status = response.status; error.code = code; throw error;
      }
      return data;
    };
    const probe = async () => {
      if (!base) throw new Error('Set the HTTPS JARVIS YouTube Worker origin first.');
      let response; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
      try { response = await fetchImpl(`${base}/health`, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: controller.signal }); }
      catch { throw new Error('Could not reach the secure YouTube service. Check its HTTPS URL, certificate, DNS, and browser network access.'); }
      finally { clearTimeout(timer); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `YouTube Worker check failed (${response.status}).`);
      if (data.ready !== true) throw new Error('The YouTube service is reachable but is not fully configured yet.');
      return { reachable: true };
    };
    return {
      setBackendOrigin,
      get backendOrigin() { return base; },
      paired: () => Boolean(deviceCredential && expiresAt > now()),
      hasSession: () => Boolean(deviceCredential && expiresAt > now()),
      get persistentSession() { return persistentSession; },
      clear,
      restore: async () => {
        if (!deviceCredential || expiresAt <= now()) { clear(); return { paired: false, verified: true, needsReauth: false }; }
        const previousDeviceId = deviceId;
        try {
          let value;
          for (let attempt = 0; attempt < 2; attempt++) {
            try { value = await request('/v1/device/session', { method: 'POST', body: {} }); break; }
            catch (error) { if (error.code === 'DEVICE_SESSION_ROTATED' && attempt === 0) continue; throw error; }
          }
          if (value.deviceId !== previousDeviceId || typeof value.accessToken !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(value.accessToken)
            || !Number.isFinite(Number(value.expiresAt)) || Number(value.expiresAt) <= now() || Number(value.expiresAt) > expiresAt) {
            clear(); return { paired: false, verified: true, needsReauth: false };
          }
          deviceCredential = value.accessToken; expiresAt = Number(value.expiresAt); persistSession();
          return { paired: true, verified: true, needsReauth: value.needsReauth === true, persistent: persistentSession };
        } catch (error) {
          if (!deviceCredential) return { paired: false, verified: true, needsReauth: false, error };
          return { paired: true, verified: false, needsReauth: false, error };
        }
      },
      probe,
      startPairing: async () => { const value = await request('/v1/pairings', { method: 'POST', body: {}, anonymous: true }); let connectUrl; try { connectUrl = new URL(value.connectUrl); } catch {} if (typeof value.pairingId !== 'string' || typeof value.pollSecret !== 'string' || !/^\d{8}$/.test(value.userCode || '') || !connectUrl || connectUrl.protocol !== 'https:' || connectUrl.origin !== base || connectUrl.pathname !== '/connect' || connectUrl.search || connectUrl.hash !== `#pair=${value.userCode}`) throw new Error('The YouTube service returned an invalid pairing request.'); pairing = value; return { userCode: value.userCode, expiresAt: value.expiresAt, connectUrl: connectUrl.href }; },
      checkPairing: async () => { if (!pairing) throw new Error('Start a new pairing request on the glasses first.'); const value = await request('/v1/pairings/poll', { method: 'POST', body: { pairingId: pairing.pairingId, pollSecret: pairing.pollSecret }, anonymous: true }); if (value.status === 'pending') return { paired: false }; if (value.status !== 'paired' || typeof value.accessToken !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(value.accessToken) || typeof value.deviceId !== 'string' || !/^dev_[A-Za-z0-9_-]{24,64}$/.test(value.deviceId) || !Number.isFinite(Number(value.expiresAt)) || Number(value.expiresAt) <= now()) throw new Error('The YouTube service returned an invalid device session.'); deviceCredential = value.accessToken; deviceId = value.deviceId; expiresAt = Number(value.expiresAt); pairing = null; persistSession(); return { paired: true, expiresAt, persistent: persistentSession }; },
      home: (pageToken = '', signal) => request(`${YOUTUBE_API_PREFIX}/home${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`, { signal }),
      search: (query, pageToken = '', signal) => request(`${YOUTUBE_API_PREFIX}/search?q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { signal }),
      account: (signal) => request(`${YOUTUBE_API_PREFIX}/account`, { signal }),
      subscriptions: (pageToken = '', signal) => request(`${YOUTUBE_API_PREFIX}/subscriptions${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`, { signal }),
      subscriptionVideos: (channelId, signal) => request(`${YOUTUBE_API_PREFIX}/subscriptions/videos?channelId=${encodeURIComponent(channelId)}`, { signal }),
      history: (signal) => request(`${YOUTUBE_API_PREFIX}/history`, { signal }),
      record: (item) => request(`${YOUTUBE_API_PREFIX}/history`, { method: 'POST', body: item }),
      recordSearch: async () => null,
      favorites: (signal) => request(`${YOUTUBE_API_PREFIX}/favorites`, { signal }),
      saveFavorite: (item) => request(`${YOUTUBE_API_PREFIX}/favorites`, { method: 'POST', body: item }),
      removeFavorite: (id) => request(`${YOUTUBE_API_PREFIX}/favorites?videoId=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    };
  }

  const MENU = [
    { id: 'ai', title: 'AI', detail: 'Pair a separately hosted, least-privilege AI gateway to chat. No desktop JARVIS endpoint is exposed.', available: true },
    { id: 'vision', title: 'VISION', detail: 'Camera and sensor capture are not part of this Web App. A separately approved Device Access Toolkit integration is required.', available: false },
    { id: 'media', title: 'MEDIA', detail: 'Connect YouTube on your phone and approve a one-time glasses pairing code. Google credentials remain in the cloud service.', available: true },
    { id: 'connect-apps', title: 'CONNECT APPS', detail: 'YouTube pairs through its dedicated cloud service. Google, Microsoft, and Weather require the separately authenticated private Connect Apps bridge.', available: true },
    { id: 'settings', title: 'SETTINGS', detail: 'Connection mode is standalone. This build contains no JARVIS server address, credentials, or development controls.', available: false },
  ];

  function registerHudUpdates(navigatorObject = globalThis.navigator, target = globalThis, documentObject = globalThis.document) {
    const serviceWorker = navigatorObject?.serviceWorker;
    const collect = (selector, id) => {
      const found = [...(documentObject?.querySelectorAll?.(selector) || [])];
      const fallback = documentObject?.getElementById?.(id);
      return found.length ? found : fallback ? [fallback] : [];
    };
    const statuses = collect('[data-hud-update-status]', 'hud-update-status');
    const versions = collect('[data-hud-build-version]', 'hud-build-version');
    const checkButtons = collect('[data-hud-check-updates]', 'hud-check-updates');
    const reloadButtons = collect('[data-hud-reload-update]', 'hud-reload-update');
    if (!serviceWorker?.register) {
      checkButtons.forEach((button) => { button.disabled = true; });
      reloadButtons.forEach((button) => { button.hidden = true; });
      statuses.forEach((status) => { status.textContent = 'Update controls are unavailable in this Web App runtime.'; });
      return null;
    }
    let registration = null;
    let reloadRequested = false;
    let reloadStarted = false;
    let latestBuildId = '';
    let activatedUpdateId = '';
    let installingTimer = null;
    const show = (message) => { statuses.forEach((status) => { status.textContent = message; }); };
    const showReload = (visible) => { reloadButtons.forEach((button) => { button.hidden = !visible; }); };
    const currentBuild = () => versions[0]?.dataset?.buildId || '';
    const setCurrentBuild = (buildId) => {
      if (!/^(?:local|[a-f0-9]{40})$/.test(buildId || '')) return;
      versions.forEach((version) => { version.dataset.buildId = buildId; version.textContent = `BUILD ${buildId === 'local' ? 'LOCAL' : buildId.slice(0, 12)}`; });
    };
    const checkManifest = async () => {
      if (!globalThis.fetch || navigatorObject.onLine === false) return false;
      try {
        // A unique query key bypasses this release's cache-first service worker.
        const response = await globalThis.fetch(`${RELEASE_MANIFEST_URL}?check=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const manifest = await response.json();
        if (!response.ok || !/^(?:local|[a-f0-9]{40})$/.test(manifest.buildId || '') || !manifest.files || typeof manifest.files !== 'object') throw new Error('invalid manifest');
        return manifest;
      } catch {
        show('Release check unavailable. The current HUD remains available.');
        return false;
      }
    };
    const releaseReady = () => {
      if (installingTimer) { target.clearTimeout?.(installingTimer); installingTimer = null; }
      showReload(true);
      show('A Pages-verified JARVIS update is ready. Choose RELOAD LATEST when convenient.');
    };
    const watchInstalling = () => {
      const installing = registration?.installing;
      if (!installing) return;
      const settled = () => {
        if (registration?.waiting) { releaseReady(); return; }
        if (installing.state === 'redundant') show('The verified update did not install. Check again when online.');
      };
      installing.addEventListener?.('statechange', settled);
      settled();
      if (installingTimer) target.clearTimeout?.(installingTimer);
      installingTimer = target.setTimeout?.(() => {
        installingTimer = null;
        if (registration?.waiting) releaseReady();
        else if (registration?.installing) show('The verified update is still downloading. The current HUD remains usable; CHECK UPDATES will retry safely.');
      }, 20_000) || null;
    };
    const check = async () => {
      if (!registration || navigatorObject.onLine === false) return Promise.resolve(false);
      checkButtons.forEach((button) => { button.disabled = true; });
      show('Checking for a verified JARVIS release…');
      const manifest = await checkManifest();
      if (manifest) latestBuildId = manifest.buildId;
      return registration.update().then(() => {
        if (manifest && manifest.buildId !== currentBuild()) {
          if (registration.waiting) releaseReady();
          else { show(`JARVIS ${manifest.buildId.slice(0, 12)} found. The verified update is installing…`); watchInstalling(); }
        } else if (registration.waiting) releaseReady();
        else if (manifest) show(`JARVIS ${currentBuild().slice(0, 12) || manifest.buildId.slice(0, 12)} is current.`);
        return true;
      }).catch(() => {
        show('Update check unavailable. The current HUD remains available.');
        return false;
      }).finally(() => { checkButtons.forEach((button) => { button.disabled = false; }); });
    };
    const activateLatest = () => {
      if (!registration?.waiting) {
        if (activatedUpdateId && activatedUpdateId !== currentBuild()) {
          reloadRequested = true;
          show('Loading the latest JARVIS release…');
          reloadAfterActivation();
          return;
        }
        show('No verified update is ready yet. Check again shortly.'); return;
      }
      reloadRequested = true;
      show('Loading the verified JARVIS release…');
      registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
      if (!serviceWorker.controller && target.location?.reload) reloadAfterActivation();
    };
    const reloadAfterActivation = () => {
      if (!reloadRequested || reloadStarted) return;
      reloadStarted = true;
      reloadRequested = false;
      target.location?.reload?.();
    };
    checkButtons.forEach((button) => button.addEventListener?.('click', () => { void check(); }));
    reloadButtons.forEach((button) => button.addEventListener?.('click', activateLatest));
    documentObject?.addEventListener?.('keydown', (event) => { if (handleUpdateControlsKey(event, documentObject)) event.stopImmediatePropagation?.(); }, true);
    serviceWorker.addEventListener?.('controllerchange', () => {
      reloadAfterActivation();
    });
    serviceWorker.addEventListener?.('message', (event) => {
      if (event.data?.type === 'JARVIS_HUD_UPDATE_ACTIVATED') {
        const activatedBuildId = event.data.buildId;
        if (activatedBuildId && activatedBuildId !== currentBuild()) {
          activatedUpdateId = activatedBuildId;
          showReload(true);
        }
        if (reloadRequested) reloadAfterActivation();
        else if (activatedUpdateId) show('A Pages-verified JARVIS update is ready. Choose RELOAD LATEST when convenient.');
      }
    });
    target.addEventListener?.('online', () => { show(''); check(); });
    documentObject?.addEventListener?.('visibilitychange', () => {
      if (documentObject.visibilityState === 'visible') check();
    });
    target.setInterval?.(check, 6 * 60 * 60 * 1000);
    serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then((value) => {
      registration = value;
      registration.addEventListener?.('updatefound', () => {
        watchInstalling();
      });
      // A browser can restore a page while a previous update is already
      // installing, before this page's updatefound listener exists.
      watchInstalling();
      setCurrentBuild(currentBuild());
      void check();
    }).catch(() => show(navigatorObject.onLine === false
      ? 'Offline. The current HUD remains available; updates will be checked when online.'
      : 'Update check unavailable. The current HUD remains available.'));
    return { check, activateLatest };
  }

  function handleUpdateControlsKey(event, documentObject = globalThis.document) {
    const group = event.target?.closest?.('[data-update-controls]') || documentObject?.activeElement?.closest?.('[data-update-controls]');
    if (!group) return false;
    const controls = [...(group.querySelectorAll?.('[data-update-focus]:not(:disabled):not([hidden])') || [])];
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      if (!controls.length) return false;
      event.preventDefault();
      const index = controls.indexOf(documentObject.activeElement);
      controls[(index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? controls.length - 1 : 1)) % controls.length].focus();
      return true;
    }
    if ((event.key === 'Enter' || event.key === ' ') && controls.includes(documentObject.activeElement)) {
      event.preventDefault();
      documentObject.activeElement.click();
      return true;
    }
    return false;
  }

  function createHud({ render = () => {} } = {}) {
    let state = { screen: 'welcome', selected: 0 };
    const snapshot = () => ({ ...state, item: MENU[state.selected] && { ...MENU[state.selected] } });
    const commit = () => { render(snapshot()); return snapshot(); };
    const move = (delta) => {
      state = { screen: 'menu', selected: (state.selected + delta + MENU.length) % MENU.length };
      return commit();
    };
    const select = () => {
      if (state.screen === 'welcome') state = { screen: 'menu', selected: 0 };
      else if (state.screen === 'menu') state = { ...state, screen: state.selected === 0 ? 'chat' : state.selected === 2 ? 'youtube' : state.selected === 3 ? 'connect-apps' : 'detail' };
      else state = { screen: 'menu', selected: state.selected };
      return commit();
    };
    const back = () => {
      if (state.screen === 'detail' || state.screen === 'chat' || state.screen === 'youtube' || state.screen === 'connect-apps') state = { ...state, screen: 'menu' };
      else if (state.screen === 'menu') state = { ...state, screen: 'welcome' };
      return commit();
    };
    const handleKey = (event) => {
      const key = event?.key;
      if (key === 'ArrowUp' || key === 'ArrowLeft') { event?.preventDefault?.(); return move(-1); }
      if (key === 'ArrowDown' || key === 'ArrowRight') { event?.preventDefault?.(); return move(1); }
      if (key === 'Enter' || key === ' ') { event?.preventDefault?.(); return select(); }
      if (key === 'Escape' || key === 'Backspace') { event?.preventDefault?.(); return back(); }
      return snapshot();
    };
    return { snapshot, move, select, back, handleKey, render: commit };
  }

  function handleConnectAppsKey(event, { hud, outlet, document }) {
    if (hud.snapshot().screen !== 'connect-apps') return false;
    if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName) && event.key !== 'Escape') return true;
    if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); hud.back(); return true; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const controls = [...outlet.querySelectorAll('[data-connectors-focus]:not(:disabled)')];
      if (controls.length) {
        const current = controls.indexOf(document.activeElement);
        const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
        controls[(current + direction + controls.length) % controls.length].focus();
      }
      return true;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      // Consume activation keys even when focus was lost during a rerender.
      // Falling through to hud.handleKey() selects the current screen and exits.
      event.preventDefault();
      if (document.activeElement?.matches?.('[data-connectors-focus]:not(input)')) document.activeElement.click();
      return true;
    }
    return false;
  }

  function createGoogleAppsActions({ state, connector, hud, render = () => {} }) {
    const redraw = () => render(hud.snapshot());
    let restoreInFlight = null;
    let retryCount = 0;
    const retry = () => {
      if (retryCount >= 3 || globalThis.navigator?.onLine === false) return;
      const delay = 1000 * (2 ** retryCount++);
      setTimeout(() => { void api.restore(); }, delay);
    };
    const api = {
      async restore() {
        if (restoreInFlight) return restoreInFlight;
        if (!connector?.restore) return;
        state.busy = true; state.restoring = true; state.status = 'Restoring saved Google Apps approval…'; redraw();
        restoreInFlight = Promise.resolve(connector.restore()).then((value) => {
          if (value.paired) { retryCount = 0; state.restoring = false; state.status = `Connected: ${value.apps.join(', ')}. Approval expires after 30 days.`; }
          else if (value.transient) { state.status = 'Saved approval is waiting for a connection. Retrying automatically…'; retry(); }
          else { state.restoring = false; state.status = value.storageAvailable ? 'No saved Google Apps approval. Start phone approval.' : 'Persistent browser storage is unavailable. Pairing works until this session expires.'; }
        }).catch(() => { state.status = 'Saved approval is waiting for a connection. Retrying automatically…'; retry(); }).finally(() => { state.busy = false; restoreInFlight = null; redraw(); });
        return restoreInFlight;
        if(!connector?.restore)return;
        state.busy=true;state.status='Restoring saved Google Apps approval…';redraw();
        try { const value=await connector.restore();state.status=value.paired?`Connected: ${value.apps.join(', ')}. Approval expires after 30 days.`:value.transient?'Saved approval could not be checked. Check network and retry.':value.storageAvailable?'No saved Google Apps approval. Start phone approval.':'Persistent browser storage is unavailable. Pairing works until this session expires.'; }
        finally { state.busy=false;redraw(); }
      },
      async startPairing() {
        state.busy = true; state.status = 'Creating a short-lived pairing request…'; redraw();
        try { state.pairing = await connector.startPairing(); state.status = 'Approve this pairing in Apps & Connections on your iPhone.'; }
        catch (error) { state.status = error.message || 'Could not start pairing.'; }
        finally { state.busy = false; redraw(); }
      },
      async pollPairing() {
        state.busy = true; state.status = 'Checking phone approval…'; redraw();
        try {
          const value = await connector.pollPairing();
          state.status = value.paired ? value.persistent ? `Connected: ${value.apps.join(', ')}. Approval expires after 30 days.` : `Connected for this session: ${value.apps.join(', ')}. Browser storage is unavailable; approval lasts at most 15 minutes.` : 'Waiting for owner approval on the phone.';
          if (value.paired) state.pairing = null;
        } catch (error) { state.status = error.message || 'Pairing check failed.'; }
        finally { state.busy = false; redraw(); }
      },
      async runCommand(command) {
        const help = connector?.commandHelp?.(command);
        if (help) { state.result = help; state.status = 'No Google request was sent.'; redraw(); return; }
        state.busy = true; state.status = 'Reading your authorized Google app…'; state.result = ''; redraw();
        try { state.result = await connector.runCommand(command); state.status = 'Read-only lookup complete.'; }
        catch (error) { state.status = error.message || 'Google lookup failed.'; }
        finally { state.busy = false; redraw(); }
      },
      clear() {
        connector.clear(); state.pairing = null; state.result = ''; state.status = 'Authorization cleared from this glasses session.'; redraw();
      },
    };
    return api;
  }

  function bindConnectAppsAction(element, action) {
    element.addEventListener('click', (event) => {
      if (!element.disabled) action(event);
    });
    return element;
  }

  function boot(document) {
    const outlet = document.querySelector('#hud-screen');
    if (!outlet) return null;
    let hud; let token = ''; let expiresAt = 0; let messages = [];
    let gateway = '';
    try { const candidate = new URL(new URLSearchParams(globalThis.location?.search || '').get('gateway') || ''); if (candidate.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(candidate.hostname)) gateway = candidate.origin; } catch {}
    const request = async (path, body, authorization = '') => {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { response = await globalThis.fetch(`${gateway}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) }); }
        catch (error) { if (attempt === 2) throw error; await new Promise((resolve) => setTimeout(resolve, 350 * (2 ** attempt))); continue; }
        if (![502, 503, 504].includes(response.status) || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 350 * (2 ** attempt)));
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(data.error || 'Connection failed.'); error.status = response.status; throw error; }
      return data;
    };
    let youtubeBackend = '';
    try { youtubeBackend = normalizeBackendOrigin(globalThis.localStorage?.getItem('jarvis.youtube.backend-origin') || '') || DEFAULT_YOUTUBE_WORKER_ORIGIN; } catch { youtubeBackend = DEFAULT_YOUTUBE_WORKER_ORIGIN; }
    const youtube = createYouTubeClient({ backendOrigin: youtubeBackend });
    const relayConfig = globalThis.JARVIS_CONNECTORS_CONFIG || {};
    const googleConnectors = globalThis.jarvisGoogleConnectors?.createGoogleConnectorClient({ workerOrigin: relayConfig.workerOrigin, enabled: relayConfig.enabled === true });
    const phoneCompanionUrl = globalThis.jarvisGoogleConnectors?.normalizeCompanionUrl?.(relayConfig.phoneCompanionUrl) || '';
    const googleConnectorState = { status: googleConnectors?.available() ? 'Not paired. Start a short-lived phone approval.' : 'Google Apps relay is not configured in this HUD release.', pairing: null, busy: false, result: '' };
    if (googleConnectors?.available()) {
      googleConnectorState.status = 'Restoring saved Google Apps approval…';
      googleConnectorState.busy = true;
      googleConnectorState.restoring = true;
    }
    const youtubeState = { section: 'subscriptions', status: 'Checking saved YouTube connection…', query: '', pageToken: '', videos: [], channels: [], subscriptions: [], history: [], favorites: [], current: null, resumeAt: 0, playerStatus: 'Player is not open.', pairing: null, sessionReady: false, sessionVerified: false, needsReauth: false, loadSucceeded: false, initialLoadPending: false, errorCode: '' };
    const youtubeRequestGate = createRequestGate();
    let youtubePlayer = null;
    let youtubeProgressTimer = null;
    let youtubeRecordedStart = false;
    let youtubePairTimer = null;
    let youtubePairCheckBusy = false;
    const clearYoutubeProgress = () => { if (youtubeProgressTimer) clearInterval(youtubeProgressTimer); youtubeProgressTimer = null; };
    const saveYoutubeProgress = async () => {
      if (!youtubePlayer?.active || !youtubeState.current || !youtubeRecordedStart) return;
      await youtube.record({ ...youtubeState.current, positionSeconds: youtubePlayer.position(), watchSeconds: youtubePlayer.position(), durationSeconds: youtubePlayer.duration(), incrementView: false, kind: youtubeState.current.kind === 'short' || youtubeState.section === 'shorts' ? 'short' : 'video' }).catch(() => {});
    };
    const leaveYoutubePlayer = () => { clearYoutubeProgress(); void saveYoutubeProgress(); youtubePlayer?.close(); youtubePlayer = null; youtubeState.current = null; youtubeRecordedStart = false; };
    const openYoutubeVideo = (video) => {
      if (!video?.videoId || !/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) return;
      clearYoutubeProgress(); void saveYoutubeProgress(); youtubePlayer?.close(); youtubePlayer = null;
      youtubeState.current = { ...video, kind: youtubeState.section === 'shorts' ? 'short' : video.kind };
      youtubeState.resumeAt = Math.max(0, Number(video.positionSeconds) || 0); youtubeState.playerStatus = 'Loading the official embedded player…'; youtubeRecordedStart = false;
      render(hud.snapshot());
      const shell = outlet.querySelector('#hud-youtube-player');
      const api = globalThis.jarvisYouTube;
      if (!shell || !api?.createPlayerController) { youtubeState.playerStatus = 'Embedded playback is unavailable in this browser.'; const status = outlet.querySelector('#hud-youtube-player-status'); if (status) status.textContent = youtubeState.playerStatus; return; }
      youtubePlayer = api.createPlayerController({ document, window: globalThis, container: shell, onStateChange: (event) => {
        youtubeState.playerStatus = event.detail || event.state;
        const status = outlet.querySelector('#hud-youtube-player-status'); if (status) status.textContent = youtubeState.playerStatus;
        if (event.state === 'ready') { if (youtubeState.resumeAt > 0) youtubePlayer?.seek(youtubeState.resumeAt); }
        if (event.state === 'playing') {
          if (!youtubeRecordedStart) { youtubeRecordedStart = true; void youtube.record({ ...youtubeState.current, positionSeconds: youtubePlayer?.position() || 0, watchSeconds: youtubePlayer?.position() || 0, durationSeconds: youtubePlayer?.duration() || 0, incrementView: true, kind: youtubeState.current?.kind === 'short' || youtubeState.section === 'shorts' ? 'short' : 'video' }).catch(() => {}); }
          if (!youtubeProgressTimer) youtubeProgressTimer = setInterval(() => { void saveYoutubeProgress(); }, 15_000);
        } else if (event.state === 'paused' || event.state === 'ended' || event.state === 'error') { clearYoutubeProgress(); void saveYoutubeProgress(); }
      } });
      void youtubePlayer.load(video.videoId);
    };
    const loadYoutubeSection = async (section = youtubeState.section, append = false) => {
      if (!youtube.paired() || !youtubeState.sessionVerified) { youtubeRequestGate.cancel(); youtubeState.status = youtubeState.sessionReady ? 'Verify this JARVIS device session before loading YouTube.' : 'Checking the saved JARVIS device session…'; render(hud.snapshot()); return; }
      if (youtubeState.current) leaveYoutubePlayer();
      const queryKey = section === 'home' ? '' : youtubeState.query.trim();
      const requestKey = `${section}|${queryKey}|${append ? youtubeState.pageToken : ''}`;
      const loadRequest = youtubeRequestGate.begin(requestKey);
      if (!loadRequest) return;
      youtubeState.section = section; youtubeState.status = section === 'shorts' ? 'Searching embeddable videos matching #shorts. This is not an official Shorts feed.' : 'Loading YouTube…';
      if (!append) { youtubeState.videos = []; youtubeState.channels = []; youtubeState.subscriptions = []; youtubeState.history = []; youtubeState.pageToken = ''; youtubeState.loadSucceeded = false; youtubeState.errorCode = ''; }
      render(hud.snapshot());
      try {
        if (section === 'home' || section === 'search' || section === 'shorts') {
          const query = section === 'home' ? '' : (youtubeState.query.trim() || (section === 'shorts' ? 'popular' : ''));
          if (section !== 'home' && !query) throw new Error('Enter a search query.');
          if (section === 'search' || section === 'shorts') await youtube.recordSearch(query).catch(() => {});
          const searchQuery = section === 'shorts' ? `${query} #shorts` : query;
          const data = section === 'home' ? await youtube.home(youtubeState.pageToken, loadRequest.signal) : await youtube.search(searchQuery, youtubeState.pageToken, loadRequest.signal);
          if (!loadRequest.isCurrent()) return;
          const newVideos = Array.isArray(data.videos) ? data.videos : [];
          youtubeState.videos = append ? [...youtubeState.videos, ...newVideos.filter((video) => !youtubeState.videos.some((old) => old.videoId === video.videoId))] : newVideos;
          youtubeState.channels = append ? youtubeState.channels : (Array.isArray(data.channels) ? data.channels : []);
          youtubeState.pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
          youtubeState.loadSucceeded = true;
          youtubeState.status = section === 'home' ? (data.message || 'Recent authorized YouTube account activity; not official watch history or YouTube recommendations.') : section === 'shorts' ? 'Showing one embeddable result matching #shorts. This is not a complete official Shorts feed.' : `Search results for “${query}”.`;
          if (section === 'shorts' && !append && newVideos.length) {
            youtubeState.status = 'Opening one embeddable #shorts search result. This is not a complete official Shorts feed.';
            loadRequest.finish();
            openYoutubeVideo(newVideos[0]);
            return;
          }
        } else if (section === 'subscriptions') {
          const data = await youtube.subscriptions(youtubeState.pageToken, loadRequest.signal);
          if (!loadRequest.isCurrent()) return;
          const newChannels = Array.isArray(data.subscriptions) ? data.subscriptions : [];
          youtubeState.subscriptions = append ? [...youtubeState.subscriptions, ...newChannels.filter((channel) => !youtubeState.subscriptions.some((old) => old.channelId === channel.channelId))] : newChannels;
          youtubeState.pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
          youtubeState.loadSucceeded = true;
          youtubeState.status = youtubeState.subscriptions.length ? 'Channels authorized by the connected YouTube account.' : 'Subscription list loaded.';
        } else if (section === 'history') {
          const data = await youtube.history(loadRequest.signal); if (!loadRequest.isCurrent()) return; youtubeState.history = Array.isArray(data.items) ? data.items : [];
          youtubeState.status = data.disclaimer || 'JARVIS watch history only; this is not YouTube’s official watch history.';
        } else if (section === 'favorites') {
          const data = await youtube.favorites(loadRequest.signal); if (!loadRequest.isCurrent()) return; youtubeState.favorites = Array.isArray(data.items) ? data.items : [];
          youtubeState.status = 'Saved videos for this connected Google account.';
        } else if (section === 'account') {
          const data = await youtube.account(loadRequest.signal); if (!loadRequest.isCurrent()) return; youtubeState.status = data.connected ? `Connected as ${data.email || 'Google account'}. Manage access and devices on your iPhone.` : 'Connect a Google account on the iPhone connection page.';
          youtubeState.account = data.connected ? { email: data.email } : null;
        }
      } catch (error) { if (!loadRequest.isCurrent() || error?.name === 'AbortError') return; youtubeState.status = error.message || 'YouTube is temporarily unavailable. Try again.'; youtubeState.errorCode = error.code || ''; youtubeState.needsReauth = ['GOOGLE_REAUTH_REQUIRED', 'YOUTUBE_SCOPE_REQUIRED'].includes(youtubeState.errorCode); youtubeState.sessionVerified = youtube.paired(); }
      finally { loadRequest.finish(); }
      if (!loadRequest.isCurrent()) return;
      render(hud.snapshot());
    };
    const checkYoutubePairing = async () => {
      if (youtubePairCheckBusy || !youtubeState.pairing) return;
      youtubePairCheckBusy = true;
      try {
        const result = await youtube.checkPairing();
        if (!result.paired) return;
        if (youtubePairTimer) clearInterval(youtubePairTimer); youtubePairTimer = null;
        youtubeState.pairing = null;
        youtubeState.sessionReady = true; youtubeState.sessionVerified = true; youtubeState.needsReauth = false;
        youtubeState.status = 'YouTube connected. Loading your account…';
        await loadYoutubeSection('subscriptions');
      } catch (error) {
        if (youtubePairTimer) clearInterval(youtubePairTimer); youtubePairTimer = null;
        youtubeState.pairing = null;
        youtubeState.status = error.message || 'Pairing expired or failed. Start a new request.';
        render(hud.snapshot());
      } finally { youtubePairCheckBusy = false; }
    };
    const render = (state) => {
      outlet.classList?.toggle('youtube-mode', state.screen === 'youtube');
      outlet.replaceChildren();
      const make = (tag, className, text) => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
      if (state.screen === 'welcome') {
        outlet.append(make('p', 'eyebrow', 'META RAY-BAN DISPLAY WEB APP'), make('h1', 'hero', 'JARVIS ONLINE'), make('p', 'copy', 'Standalone HUD ready. No private server connection is required for this hardware test.'), make('p', 'status', 'SYSTEM CONNECTION: STANDALONE · PRIVATE BACKEND DISABLED'));
        const begin = make('button', 'action', 'OPEN JARVIS MENU'); begin.type = 'button'; begin.addEventListener('click', () => hud.select()); outlet.append(begin); begin.focus();
        return;
      }
      if (state.screen === 'menu') {
        outlet.append(make('p', 'eyebrow', 'JARVIS MENU'));
        const menu = make('div', 'menu', '');
        MENU.forEach((item, index) => {
          const button = make('button', `menu-button${item.available ? '' : ' unavailable'}`, ''); button.type = 'button'; button.setAttribute('aria-current', String(index === state.selected));
          const title = make('strong', '', item.title); const stateText = make('small', '', item.available ? 'AVAILABLE' : 'UNAVAILABLE IN STANDALONE MODE'); button.append(title, stateText); button.addEventListener('click', () => { hud.move(index - hud.snapshot().selected); hud.select(); }); menu.append(button);
          if (index === state.selected) queueMicrotask(() => button.focus());
        });
        outlet.append(menu); return;
      }
      if (state.screen === 'chat') {
        outlet.append(make('p', 'eyebrow', 'JARVIS AI'), make('h1', 'detail-title', 'AI CHAT'));
        const status = make('p', 'status', token && expiresAt > Date.now() ? 'AI GATEWAY: PAIRED · SESSION MEMORY ONLY' : 'AI GATEWAY: NOT PAIRED · OFFLINE');
        const log = make('div', 'chat-log', ''); messages.slice(-4).forEach(({ role, text }) => log.append(make('p', `chat-message ${role}`, `${role === 'user' ? 'YOU' : 'JARVIS'}: ${text}`))); outlet.append(status, log);
        const gatewayInput = document.createElement('input'); gatewayInput.type = 'url'; gatewayInput.placeholder = 'HTTPS GATEWAY URL'; gatewayInput.value = gateway; gatewayInput.setAttribute('aria-label', 'Secure AI gateway URL');
        const codeInput = document.createElement('input'); codeInput.type = 'password'; codeInput.placeholder = 'ONE-TIME PAIRING CODE'; codeInput.setAttribute('aria-label', 'One-time pairing code');
        const pair = make('button', 'action', 'PAIR SECURE AI'); pair.type = 'button'; pair.addEventListener('click', async () => { try { const candidate = new URL(gatewayInput.value); gateway = candidate.protocol === 'https:' ? candidate.origin : ''; } catch { gateway = ''; } if (!gateway) { status.textContent = 'PAIRING: USE A PUBLIC HTTPS GATEWAY URL.'; return; } try { pair.disabled = true; const data = await request('/v1/pair', { code: codeInput.value }); token = data.accessToken; expiresAt = Number(data.expiresAt) || 0; codeInput.value = ''; status.textContent = 'AI GATEWAY: PAIRED · ENTER A MESSAGE.'; } catch { token = ''; status.textContent = 'PAIRING FAILED. CHECK THE CODE OR GATEWAY.'; } finally { pair.disabled = false; } });
        const prompt = document.createElement('input'); prompt.type = 'text'; prompt.placeholder = 'ASK JARVIS'; prompt.maxLength = 1000; prompt.setAttribute('aria-label', 'Message for JARVIS');
        const send = make('button', 'action', 'SEND'); send.type = 'button'; send.addEventListener('click', async () => { if (!token || expiresAt <= Date.now()) { token = ''; status.textContent = 'SESSION EXPIRED. PAIR SECURE AI AGAIN.'; return; } const message = prompt.value.trim(); if (!message) return; messages.push({ role: 'user', text: message }); prompt.value = ''; status.textContent = 'JARVIS IS THINKING…'; send.disabled = true; try { const data = await request('/v1/chat', { message }, token); messages.push({ role: 'assistant', text: String(data.reply || '').slice(0, 2000) }); status.textContent = 'AI GATEWAY: PAIRED'; } catch (error) { if (error.status === 401) { token = ''; expiresAt = 0; status.textContent = 'SESSION EXPIRED. PAIR SECURE AI AGAIN.'; } else { status.textContent = 'AI TEMPORARILY UNAVAILABLE. SESSION KEPT; TRY AGAIN.'; } } finally { send.disabled = false; render(hud.snapshot()); } });
        outlet.append(gatewayInput, codeInput, pair, prompt, send, make('p', 'copy', 'Focus a field to use Neural Band handwriting, dictation, or the on-screen keyboard. Pairing code and session token remain in memory only.'));
        const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      if (state.screen === 'connect-apps') {
        const connectorStatus = make('p', 'status', googleConnectorState.status); connectorStatus.setAttribute('role', 'status'); connectorStatus.setAttribute('aria-live', 'polite');
        outlet.append(make('h1', '', 'GOOGLE APPS'), connectorStatus, make('p', 'copy', 'Google grants remain on the private JARVIS backend. Glasses approval renews short-lived read-only access and expires after 30 days.'));
        if(googleConnectors?.available()&&!googleConnectors.paired()&&!googleConnectorState.busy&&!googleConnectorState.restoring){const restore=make('button','action','RESTORE SAVED APPROVAL');restore.type='button';restore.dataset.connectorsFocus='true';bindConnectAppsAction(restore,()=>{void googleAppsActions.restore();});outlet.append(restore);}
        if (phoneCompanionUrl) {
          const phone = make('a', 'action', 'OPEN APPS & CONNECTIONS ON IPHONE'); phone.href = phoneCompanionUrl; phone.target = '_blank'; phone.rel = 'noopener noreferrer'; phone.dataset.connectorsFocus = 'true';
          outlet.append(phone, make('p', 'copy', 'This private link requires your JARVIS Tailscale connection and an unlocked owner session.'));
        } else outlet.append(make('p', 'copy', 'Phone companion URL is not configured for this HUD release.'));
        if (googleConnectors?.available() && !googleConnectors.paired() && !googleConnectorState.restoring) {
          const start = make('button', 'action', googleConnectorState.busy ? 'PLEASE WAIT' : 'START PHONE APPROVAL'); start.type = 'button'; start.disabled = googleConnectorState.busy; start.dataset.connectorsFocus = 'true';
          bindConnectAppsAction(start, () => { void googleAppsActions.startPairing(); });
          outlet.append(start);
          if (googleConnectorState.pairing) {
            const pairingId = make('p', 'copy', `PAIRING ID · ${googleConnectorState.pairing.pairingAlias}`);
            const pairingCode = make('h2', 'hud-youtube-pair-code', googleConnectorState.pairing.userCode); pairingCode.setAttribute('aria-label', 'One-time eight-digit Google Apps pairing code'); pairingCode.setAttribute('role', 'status'); pairingCode.setAttribute('aria-live', 'polite');
            outlet.append(pairingId, pairingCode, make('p', 'copy', 'Enter the six-character pairing ID and code on your iPhone. The code expires after three minutes. The long pairing ID and polling secret remain in memory for secure polling.'));
            if (globalThis.navigator?.clipboard?.writeText) { const copy = make('button', 'action', 'COPY PAIRING ID'); copy.type = 'button'; copy.dataset.connectorsFocus = 'true'; copy.addEventListener('click', async () => { try { await globalThis.navigator.clipboard.writeText(googleConnectorState.pairing.pairingAlias); googleConnectorState.status = 'Pairing ID copied. Enter it with the code on your iPhone.'; } catch { googleConnectorState.status = 'Could not copy the pairing ID. Enter it manually.'; } render(hud.snapshot()); }); outlet.append(copy); }
            const poll = make('button', 'action', 'CHECK PHONE APPROVAL'); poll.type = 'button'; poll.disabled = googleConnectorState.busy; poll.dataset.connectorsFocus = 'true';
            bindConnectAppsAction(poll, () => { void googleAppsActions.pollPairing(); });
            outlet.append(poll);
          }
        } else if(googleConnectors?.paired()) {
          outlet.append(make('p','copy',`Connected: ${googleConnectors.apps.join(', ')}. Approval expires after 30 days.`));
          const form=document.createElement('form');form.className='hud-youtube-search';const input=document.createElement('input');input.type='text';input.maxLength=1200;input.placeholder='Ask about Gmail, Calendar, Contacts, Drive, Docs, Sheets, or Tasks';input.setAttribute('aria-label','Google Apps command');input.dataset.connectorsFocus='true';const run=make('button','action','ASK JARVIS');run.type='submit';run.dataset.connectorsFocus='true';run.disabled=googleConnectorState.busy;form.addEventListener('submit',event=>{event.preventDefault();const command=input.value.trim();if(!command||googleConnectorState.busy)return;void googleAppsActions.runCommand(command);});form.append(input,run);outlet.append(form);if(googleConnectorState.result){const result=make('pre','copy',googleConnectorState.result);result.setAttribute('aria-label','Google Apps response');outlet.append(result);}const reconnect=make('button','action','CLEAR SESSION');reconnect.type='button';reconnect.dataset.connectorsFocus='true';bindConnectAppsAction(reconnect,()=>googleAppsActions.clear());outlet.append(reconnect);
        }
        const backButton = make('button', 'action', 'BACK TO JARVIS MENU'); backButton.type = 'button'; backButton.dataset.connectorsFocus = 'true'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      if (state.screen === 'youtube') {
        const requiresReauth = youtubeState.needsReauth || ['GOOGLE_REAUTH_REQUIRED', 'YOUTUBE_SCOPE_REQUIRED'].includes(youtubeState.errorCode);
        const connected = youtubeState.sessionReady && youtubeState.sessionVerified && youtube.paired() && !requiresReauth;
        const youtubeHeader = make('header', 'hud-youtube-header', '');
        const youtubeBrand = make('div', 'hud-youtube-brand', '');
        const youtubeMark = make('span', 'hud-youtube-mark', '▶'); youtubeMark.setAttribute('aria-hidden', 'true');
        youtubeBrand.append(youtubeMark, make('h1', 'hud-youtube-title', 'YouTube'));
        const accountControl = make('button', 'hud-youtube-account-control', !youtubeState.sessionReady ? 'CHECKING' : requiresReauth ? 'REAUTHORIZE' : connected ? 'CONNECTED' : 'NOT CONNECTED');
        accountControl.type = 'button'; accountControl.dataset.youtubeFocus = 'true'; accountControl.disabled = !connected && !requiresReauth;
        accountControl.setAttribute('aria-label', requiresReauth ? 'Reauthorize YouTube on your phone' : connected ? 'Connected YouTube account settings' : 'YouTube account not connected');
        accountControl.addEventListener('click', () => { if (requiresReauth) globalThis.open?.(`${youtube.backendOrigin}/connect?reauthorize=1`, '_blank', 'noopener,noreferrer'); else void loadYoutubeSection(youtubeState.section === 'account' ? 'subscriptions' : 'account'); });
        youtubeHeader.append(youtubeBrand, accountControl);
        const status = make('p', 'status hud-youtube-status', youtubeState.status);
        const searchForm = document.createElement('form'); searchForm.className = 'hud-youtube-search';
        const query = document.createElement('input'); query.type = 'search'; query.maxLength = 100; query.value = youtubeState.query;
        query.placeholder = connected ? 'Search videos, channels, or topics' : 'Connect to search YouTube'; query.setAttribute('aria-label', 'Search YouTube'); query.dataset.youtubeFocus = 'true'; query.disabled = !connected;
        const submit = make('button', 'action hud-youtube-search-button', 'SEARCH'); submit.type = 'submit'; submit.dataset.youtubeFocus = 'true'; submit.disabled = !connected;
        searchForm.addEventListener('submit', (event) => {
          event.preventDefault(); youtubeState.query = query.value.trim();
          if (!youtubeState.query || youtubeState.query.length > 100) { youtubeState.status = 'Enter a search of 1 to 100 characters.'; status.textContent = youtubeState.status; return; }
          void loadYoutubeSection('search');
        });
        searchForm.append(query, submit);
        const nav = make('nav', 'hud-youtube-nav', ''); nav.setAttribute('aria-label', 'YouTube sections');
        for (const section of ['subscriptions', 'shorts']) {
          const button = make('button', 'action hud-youtube-tab', section === 'subscriptions' ? 'SUBSCRIPTIONS' : 'SHORTS');
          button.type = 'button'; button.dataset.youtubeFocus = 'true'; button.disabled = !connected;
          const activeSection = ['search', 'account', 'history', 'favorites'].includes(youtubeState.section) ? 'subscriptions' : youtubeState.section;
          button.setAttribute('aria-pressed', String(activeSection === section));
          button.addEventListener('click', () => { youtubeState.query = ''; youtubeState.selectedChannel = null; void loadYoutubeSection(section); });
          nav.append(button);
        }
        outlet.append(youtubeHeader, status, searchForm, nav);
        if (youtubeState.initialLoadPending && connected) { youtubeState.initialLoadPending = false; queueMicrotask(() => { void loadYoutubeSection('subscriptions'); }); }
        if (!youtubeState.sessionReady) {
          outlet.append(make('p', 'copy hud-youtube-help', 'Verifying the saved, time-limited JARVIS device session with the YouTube Worker…'));
        } else if (youtube.hasSession() && !youtubeState.sessionVerified) {
          const retry = make('button', 'action', 'RETRY CONNECTION CHECK'); retry.type = 'button'; retry.dataset.youtubeFocus = 'true'; retry.addEventListener('click', () => { youtubeState.sessionReady = false; youtubeState.status = 'Checking saved YouTube connection…'; render(hud.snapshot()); void restoreYoutubeSession(); }); outlet.append(retry);
        } else if (requiresReauth) {
          const reconnect = document.createElement('a'); reconnect.className = 'action hud-youtube-handoff'; reconnect.href = `${youtube.backendOrigin}/connect?reauthorize=1`; reconnect.target = '_blank'; reconnect.rel = 'noopener noreferrer'; reconnect.textContent = 'RECONNECT YOUTUBE'; reconnect.dataset.youtubeFocus = 'true'; outlet.append(reconnect, make('p', 'copy hud-youtube-help', 'Review and approve YouTube read-only access on your phone. JARVIS keeps Google tokens on the Worker.'));
        } else if (!youtube.paired()) {
          const pair = make('button', 'action', 'CONNECT YOUTUBE'); pair.type = 'button'; pair.dataset.youtubeFocus = 'true'; pair.addEventListener('click', async () => {
            // Open a phone/browser tab during the user gesture so iOS Safari does
            // not block the later pairing handoff as an unsolicited popup.
            let phoneWindow = null; try { phoneWindow = globalThis.open?.('about:blank', '_blank'); if (phoneWindow) phoneWindow.opener = null; } catch {}
            pair.disabled = true; youtubeState.status = 'Creating a short-lived pairing code…'; status.textContent = youtubeState.status;
            try {
              const pairing = await youtube.startPairing(); youtubeState.pairing = pairing;
              if (phoneWindow) { try { phoneWindow.location.replace(pairing.connectUrl); } catch { phoneWindow.close?.(); phoneWindow = null; } }
              youtubeState.status = 'Continue on your phone to authorize YouTube. This one-time link expires in five minutes.'; render(hud.snapshot());
              if (youtubePairTimer) clearInterval(youtubePairTimer);
              youtubePairTimer = setInterval(() => { void checkYoutubePairing(); }, 2_500);
            } catch (error) { youtubeState.status = error.message || 'Could not create a pairing request. Check the HTTPS Worker origin.'; status.textContent = youtubeState.status; }
            finally { pair.disabled = false; }
          });
          outlet.append(pair, make('p', 'copy hud-youtube-help', 'Authorize on your phone. The short-lived link is bound to this one-time glasses pairing.'));
          if (youtubeState.pairing) {
            const codeDisplay = make('h2', 'hud-youtube-pair-code', youtubeState.pairing.userCode); codeDisplay.setAttribute('aria-label', 'One-time phone approval code');
            const help = make('p', 'copy hud-youtube-help', 'If automatic opening was blocked, use the secure phone link below. Google sign-in and approval continue automatically.');
            const servicePage = make('a', 'action hud-youtube-handoff', 'OPEN PHONE SIGN-IN'); servicePage.href = youtubeState.pairing.connectUrl; servicePage.target = '_blank'; servicePage.rel = 'noopener noreferrer'; servicePage.dataset.youtubeFocus = 'true';
            const sharePhoneLink = make('button', 'action', 'SHARE PHONE SIGN-IN LINK'); sharePhoneLink.type = 'button'; sharePhoneLink.dataset.youtubeFocus = 'true'; sharePhoneLink.addEventListener('click', async () => {
              try {
                if (globalThis.navigator?.share) await globalThis.navigator.share({ title: 'JARVIS YouTube pairing', text: 'Open this short-lived link on your phone to connect YouTube.', url: youtubeState.pairing.connectUrl });
                else if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(youtubeState.pairing.connectUrl); youtubeState.status = 'One-time phone link copied. Open it on your phone before it expires.'; status.textContent = youtubeState.status; }
                else { youtubeState.status = 'Use OPEN PHONE SIGN-IN or enter the one-time code on the phone connection page.'; status.textContent = youtubeState.status; }
              } catch (error) { youtubeState.status = error?.name === 'AbortError' ? 'Phone link sharing was cancelled. The one-time link remains available below.' : 'Could not share the phone link. Open it directly below.'; status.textContent = youtubeState.status; }
            });
            const check = make('button', 'action', 'CHECK PHONE APPROVAL'); check.type = 'button'; check.dataset.youtubeFocus = 'true'; check.addEventListener('click', () => { void checkYoutubePairing(); });
            outlet.append(codeDisplay, help, servicePage, sharePhoneLink, check);
          }
        } else {
          if (youtubeState.section === 'account') {
            const accountCard = make('section', 'hud-youtube-account-card', '');
            accountCard.append(make('strong', '', `Connected account: ${youtubeState.account?.email || 'Google account'}`), make('p', 'copy', 'Google tokens remain on the JARVIS YouTube Worker. Revoke access or disconnect from the phone account page.'));
            const history = make('button', 'action hud-youtube-account-action', 'JARVIS HISTORY'); history.type = 'button'; history.dataset.youtubeFocus = 'true'; history.addEventListener('click', () => void loadYoutubeSection('history'));
            const favorites = make('button', 'action hud-youtube-account-action', 'FAVORITES'); favorites.type = 'button'; favorites.dataset.youtubeFocus = 'true'; favorites.addEventListener('click', () => void loadYoutubeSection('favorites'));
            const manage = document.createElement('a'); manage.className = 'action hud-youtube-account-action'; manage.href = `${youtube.backendOrigin}/connect`; manage.target = '_blank'; manage.rel = 'noopener noreferrer'; manage.textContent = 'MANAGE ACCOUNT ON PHONE'; manage.dataset.youtubeFocus = 'true';
            accountCard.append(history, favorites, manage); outlet.append(accountCard);
          } else if (youtubeState.current) {
            const title = make('h2', 'hud-youtube-video-title', youtubeState.current.title || 'YouTube video'); outlet.append(title);
            const shell = make('div', `hud-youtube-player-shell${youtubeState.current.kind === 'short' ? ' is-short' : ''}`, ''); shell.id = 'hud-youtube-player'; shell.setAttribute('aria-label', 'YouTube embedded video player'); outlet.append(shell);
            const playerStatus = make('p', 'status hud-youtube-player-status', youtubeState.playerStatus); playerStatus.id = 'hud-youtube-player-status'; outlet.append(playerStatus);
            // Playback controls remain inside YouTube's official embedded player.
          } else {
            const results = make('div', 'hud-youtube-results', ''); results.setAttribute('aria-live', 'polite');
            const videos = youtubeState.section === 'shorts' ? [] : youtubeState.section === 'history' ? youtubeState.history : youtubeState.section === 'favorites' ? youtubeState.favorites : youtubeState.videos;
            videos.forEach((video) => {
              const button = make('button', 'hud-youtube-result', ''); button.type = 'button'; button.dataset.youtubeFocus = 'true';
              let imageUrl = ''; try { const candidate = new URL(video.thumbnail || ''); if (candidate.protocol === 'https:' && ['i.ytimg.com', 'img.youtube.com'].includes(candidate.hostname)) imageUrl = candidate.href; } catch {}
              if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = ''; img.loading = 'lazy'; button.append(img); }
              const text = make('span', 'hud-youtube-result-copy', '');
              text.append(make('strong', 'hud-youtube-result-title', video.title || 'YouTube video'), make('small', 'hud-youtube-result-channel', video.channel || 'YouTube'));
              button.append(text);
              if (youtubeState.section === 'history' && Number(video.positionSeconds) > 0) { const resume = make('small', '', `Resume at ${Math.floor(video.positionSeconds)} seconds`); button.append(resume); }
              button.addEventListener('click', () => openYoutubeVideo(video)); results.append(button);
            });
            if (youtubeState.section === 'subscriptions') {
              youtubeState.subscriptions.forEach((channel) => { const button = make('button', 'hud-youtube-result hud-youtube-channel', ''); button.type = 'button'; button.dataset.youtubeFocus = 'true'; const image = channel.thumbnail; let avatarUrl = ''; try { const candidate = new URL(image || ''); if (candidate.protocol === 'https:' && ['yt3.ggpht.com', 'yt3.googleusercontent.com'].includes(candidate.hostname)) avatarUrl = candidate.href; } catch {} if (avatarUrl) { const avatar = document.createElement('img'); avatar.src = avatarUrl; avatar.alt = ''; avatar.loading = 'lazy'; button.append(avatar); } const copy = make('span', 'hud-youtube-result-copy', ''); copy.append(make('strong', 'hud-youtube-result-title', channel.title || 'Subscribed channel'), make('small', 'hud-youtube-result-channel', 'CHANNEL · SELECT FOR RECENT VIDEOS')); button.append(copy); button.addEventListener('click', async () => { youtubeState.status = `Loading recent uploads from ${channel.title}…`; status.textContent = youtubeState.status; try { const data = await youtube.subscriptionVideos(channel.channelId); youtubeState.videos = (data.videos || []).map((item) => ({ ...item, kind: 'video' })); youtubeState.selectedChannel = channel; youtubeState.status = youtubeState.videos.length ? `Recent embeddable uploads from ${channel.title}.` : `No recent embeddable uploads from ${channel.title}.`; render(hud.snapshot()); } catch (error) { youtubeState.status = error.message || 'Could not load this channel’s videos.'; status.textContent = youtubeState.status; } }); results.append(button); });
            }
            youtubeState.channels.forEach((channel) => { const link = document.createElement('a'); link.className = 'action hud-youtube-handoff'; link.href = `https://www.youtube.com/channel/${encodeURIComponent(channel.channelId)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `OPEN CHANNEL: ${channel.title}`; link.dataset.youtubeFocus = 'true'; results.append(link); });
            if (!videos.length && !youtubeState.subscriptions.length && !youtubeState.channels.length && youtubeState.loadSucceeded) results.append(make('p', 'copy', youtubeState.section === 'shorts' ? 'No embeddable #shorts search result was found. Try another search.' : youtubeState.section === 'subscriptions' ? (youtubeState.pageToken ? 'No subscriptions on this page. Load more channels to continue.' : 'This Google account has no subscribed channels.') : 'No videos found. Try another search.'));
            outlet.append(results);
            if (youtubeState.pageToken && ['search', 'subscriptions'].includes(youtubeState.section)) { const more = make('button', 'action', youtubeState.section === 'subscriptions' ? 'LOAD MORE CHANNELS' : 'LOAD MORE VIDEOS'); more.type = 'button'; more.dataset.youtubeFocus = 'true'; more.addEventListener('click', () => void loadYoutubeSection(youtubeState.section, true)); outlet.append(more); }
          }
        }
        const backButton = make('button', 'action', 'BACK TO JARVIS MENU'); backButton.type = 'button'; backButton.dataset.youtubeFocus = 'true'; backButton.addEventListener('click', () => { if (youtubeState.current) leaveYoutubePlayer(); hud.back(); }); outlet.append(backButton);
        return;
      }
      const item = state.item;
      outlet.append(make('p', 'eyebrow', 'JARVIS MENU'), make('h1', 'detail-title', item.title), make('span', 'unavailable-label', 'UNAVAILABLE'), make('p', 'copy', item.detail), make('p', 'status', 'NO REQUEST WAS SENT · NO PERMISSION WAS REQUESTED'));
      const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); backButton.focus();
    };
    hud = createHud({ render });
    const googleAppsActions = createGoogleAppsActions({ state: googleConnectorState, connector: googleConnectors, hud, render });
    const restoreYoutubeSession = async () => {
      const result = await youtube.restore();
      youtubeState.sessionReady = true;
      youtubeState.sessionVerified = result.verified === true && result.paired === true;
      youtubeState.needsReauth = result.needsReauth === true;
      youtubeState.errorCode = result.error?.code || '';
      if (result.error) youtubeState.status = result.verified ? (result.error.message || 'Saved YouTube session expired. Pair this device again.') : 'Could not verify the saved YouTube session. Check the connection and retry.';
      else if (!result.paired) youtubeState.status = 'Not connected. Connect YouTube on your phone to enable account features.';
      else if (result.needsReauth) { youtubeState.errorCode = 'GOOGLE_REAUTH_REQUIRED'; youtubeState.status = 'Google authorization needs renewal on your phone.'; }
      else { youtubeState.status = result.persistent ? 'Connected. Loading subscriptions when YouTube opens…' : 'Connected for this session. Persistent storage is unavailable in this Web App.'; youtubeState.initialLoadPending = true; }
      render(hud.snapshot());
    };
    document.addEventListener('keydown', (event) => {
      if (handleUpdateControlsKey(event, document)) return;
      if (handleConnectAppsKey(event, { hud, outlet, document })) return;
      if (hud.snapshot().screen === 'youtube') {
        if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); if (youtubeState.current) { leaveYoutubePlayer(); render(hud.snapshot()); } else hud.back(); return; }
        if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const controls = [...outlet.querySelectorAll('[data-youtube-focus]:not(:disabled)')];
          if (!controls.length) return;
          const current = controls.indexOf(document.activeElement);
          const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
          controls[(current + direction + controls.length) % controls.length].focus(); return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches?.('[data-youtube-focus]:not(input)')) { event.preventDefault(); document.activeElement.click(); return; }
      }
      if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName) && event.key !== 'Escape') return;
      hud.handleKey(event);
    });
    globalThis.addEventListener?.('popstate', () => { if (youtubeState.current) leaveYoutubePlayer(); hud.back(); });
    hud.render();
    void googleAppsActions.restore();
    globalThis.addEventListener?.('online', () => { if (!googleConnectors?.paired()) void googleAppsActions.restore(); });
    void restoreYoutubeSession().catch(() => { youtubeState.sessionReady = true; youtubeState.sessionVerified = false; youtubeState.status = 'Could not verify the saved YouTube session. Check the connection and retry.'; render(hud.snapshot()); });
    return hud;
  }

  function shouldWaitForSession(authConfig, sessionState) { return authConfig?.enabled === true && sessionState !== 'unlocked'; }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    registerHudUpdates(globalThis.navigator, globalThis, document);
    if (shouldWaitForSession(globalThis.JARVIS_AUTH_CONFIG, document.body?.dataset?.jarvisSession)) {
      document.addEventListener('jarvis-session-unlocked', () => boot(document), { once: true });
      return;
    }
    boot(document);
  }, { once: true });
  return { MENU, createHud, createRequestGate, createYouTubeClient, normalizeBackendOrigin, registerHudUpdates, handleUpdateControlsKey, shouldWaitForSession, handleConnectAppsKey, createGoogleAppsActions, bindConnectAppsAction, boot };
}));
