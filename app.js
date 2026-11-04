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

  function createYouTubeClient({ fetchImpl = globalThis.fetch, backendOrigin = DEFAULT_YOUTUBE_WORKER_ORIGIN, now = Date.now } = {}) {
    let base = normalizeBackendOrigin(backendOrigin) || DEFAULT_YOUTUBE_WORKER_ORIGIN;
    let deviceCredential = '';
    let expiresAt = 0;
    let pairing = null;
    const setBackendOrigin = (value) => { base = normalizeBackendOrigin(value); return base; };
    const request = async (path, { method = 'GET', body, anonymous = false } = {}) => {
      if (!base) throw new Error('Set the HTTPS JARVIS YouTube Worker origin first.');
      if (!anonymous && (!deviceCredential || expiresAt <= now())) { deviceCredential = ''; expiresAt = 0; throw new Error('Glasses session expired or was revoked. Pair again from the phone connection page.'); }
      const response = await fetchImpl(`${base}${path}`, { method, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(!anonymous ? { Authorization: `Bearer ${deviceCredential}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && !anonymous) { deviceCredential = ''; expiresAt = 0; }
        const error = new Error(data.error || `JARVIS YouTube request failed (${response.status}).`); error.status = response.status; throw error;
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
      clear: () => { deviceCredential = ''; expiresAt = 0; pairing = null; },
      probe,
      startPairing: async () => { const value = await request('/v1/pairings', { method: 'POST', body: {}, anonymous: true }); let connectUrl; try { connectUrl = new URL(value.connectUrl); } catch {} if (typeof value.pairingId !== 'string' || typeof value.pollSecret !== 'string' || !/^\d{8}$/.test(value.userCode || '') || !connectUrl || connectUrl.protocol !== 'https:' || connectUrl.origin !== base || connectUrl.pathname !== '/connect' || connectUrl.search || connectUrl.hash !== `#pair=${value.userCode}`) throw new Error('The YouTube service returned an invalid pairing request.'); pairing = value; return { userCode: value.userCode, expiresAt: value.expiresAt, connectUrl: connectUrl.href }; },
      checkPairing: async () => { if (!pairing) throw new Error('Start a new pairing request on the glasses first.'); const value = await request('/v1/pairings/poll', { method: 'POST', body: { pairingId: pairing.pairingId, pollSecret: pairing.pollSecret }, anonymous: true }); if (value.status === 'pending') return { paired: false }; if (value.status !== 'paired' || typeof value.accessToken !== 'string' || !Number.isFinite(Number(value.expiresAt)) || Number(value.expiresAt) <= now()) throw new Error('The YouTube service returned an invalid device session.'); deviceCredential = value.accessToken; expiresAt = Number(value.expiresAt); pairing = null; return { paired: true, expiresAt }; },
      home: () => request(`${YOUTUBE_API_PREFIX}/home`),
      search: (query, pageToken = '') => request(`${YOUTUBE_API_PREFIX}/search?q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`),
      account: () => request(`${YOUTUBE_API_PREFIX}/account`),
      subscriptions: (pageToken = '') => request(`${YOUTUBE_API_PREFIX}/subscriptions${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`),
      subscriptionVideos: (channelId) => request(`${YOUTUBE_API_PREFIX}/subscriptions/videos?channelId=${encodeURIComponent(channelId)}`),
      history: () => request(`${YOUTUBE_API_PREFIX}/history`),
      record: (item) => request(`${YOUTUBE_API_PREFIX}/history`, { method: 'POST', body: item }),
      recordSearch: async () => null,
      favorites: () => request(`${YOUTUBE_API_PREFIX}/favorites`),
      saveFavorite: (item) => request(`${YOUTUBE_API_PREFIX}/favorites`, { method: 'POST', body: item }),
      removeFavorite: (id) => request(`${YOUTUBE_API_PREFIX}/favorites?videoId=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    };
  }

  const MENU = [
    { id: 'ai', title: 'AI', detail: 'Pair a separately hosted, least-privilege AI gateway to chat. No desktop JARVIS endpoint is exposed.', available: true },
    { id: 'vision', title: 'VISION', detail: 'Camera and sensor capture are not part of this Web App. A separately approved Device Access Toolkit integration is required.', available: false },
    { id: 'media', title: 'MEDIA', detail: 'Connect YouTube on your phone and approve a one-time glasses pairing code. Google credentials remain in the cloud service.', available: true },
    { id: 'settings', title: 'SETTINGS', detail: 'Connection mode is standalone. This build contains no JARVIS server address, credentials, or development controls.', available: false },
  ];

  function registerHudUpdates(navigatorObject = globalThis.navigator, target = globalThis, documentObject = globalThis.document) {
    const serviceWorker = navigatorObject?.serviceWorker;
    if (!serviceWorker?.register) return null;
    const status = documentObject?.getElementById?.('hud-update-status');
    let registration = null;
    const show = (message) => { if (status) status.textContent = message; };
    const checkManifest = async () => {
      if (!globalThis.fetch || navigatorObject.onLine === false) return false;
      try {
        const response = await globalThis.fetch(RELEASE_MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const manifest = await response.json();
        if (!response.ok || !/^(?:local|[a-f0-9]{40})$/.test(manifest.buildId || '') || !manifest.files || typeof manifest.files !== 'object') throw new Error('invalid manifest');
        return manifest;
      } catch {
        show('Release check unavailable. The current HUD remains available.');
        return false;
      }
    };
    const check = async () => {
      if (!registration || navigatorObject.onLine === false) return Promise.resolve(false);
      const manifest = await checkManifest();
      return registration.update().then(() => {
        if (manifest && registration.waiting) show(`JARVIS release ${manifest.buildId.slice(0, 12)} is ready. Close and reopen the Web App to load it.`);
        return true;
      }).catch(() => {
        show('Update check unavailable. The current HUD remains available.');
        return false;
      });
    };
    serviceWorker.addEventListener?.('message', (event) => {
      if (event.data?.type === 'JARVIS_HUD_UPDATE_ACTIVATED') show('JARVIS update ready. This session stays active; close and reopen the Web App to load it.');
    });
    target.addEventListener?.('online', () => { show(''); check(); });
    documentObject?.addEventListener?.('visibilitychange', () => {
      if (documentObject.visibilityState === 'visible') check();
    });
    target.setInterval?.(check, 6 * 60 * 60 * 1000);
    serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then((value) => {
      registration = value;
      check();
      registration.addEventListener?.('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener?.('statechange', () => {
          if (installing.state === 'installed' && serviceWorker.controller) show('A verified JARVIS update is ready. Close and reopen the Web App to load it.');
        });
      });
    }).catch(() => show(navigatorObject.onLine === false
      ? 'Offline. The current HUD remains available; updates will be checked when online.'
      : 'Update check unavailable. The current HUD remains available.'));
    return { check };
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
      else if (state.screen === 'menu') state = { ...state, screen: state.selected === 0 ? 'chat' : state.selected === 2 ? 'youtube' : 'detail' };
      else state = { screen: 'menu', selected: state.selected };
      return commit();
    };
    const back = () => {
      if (state.screen === 'detail' || state.screen === 'chat' || state.screen === 'youtube') state = { ...state, screen: 'menu' };
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
    const youtubeState = { section: 'home', status: 'Not connected. Connect YouTube on your phone to enable account features.', query: '', pageToken: '', videos: [], channels: [], subscriptions: [], history: [], favorites: [], current: null, currentIndex: -1, resumeAt: 0, playerStatus: 'Player is not open.', pairing: null };
    let youtubePlayer = null;
    let youtubeProgressTimer = null;
    let youtubeRecordedStart = false;
    let youtubePairTimer = null;
    let youtubePairCheckBusy = false;
    const clearYoutubeProgress = () => { if (youtubeProgressTimer) clearInterval(youtubeProgressTimer); youtubeProgressTimer = null; };
    const youtubeVideoList = () => youtubeState.section === 'history' ? youtubeState.history : youtubeState.section === 'favorites' ? youtubeState.favorites : youtubeState.videos;
    const saveYoutubeProgress = async () => {
      if (!youtubePlayer?.active || !youtubeState.current || !youtubeRecordedStart) return;
      await youtube.record({ ...youtubeState.current, positionSeconds: youtubePlayer.position(), watchSeconds: youtubePlayer.position(), durationSeconds: youtubePlayer.duration(), incrementView: false, kind: youtubeState.current.kind === 'short' || youtubeState.section === 'shorts' ? 'short' : 'video' }).catch(() => {});
    };
    const leaveYoutubePlayer = () => { clearYoutubeProgress(); void saveYoutubeProgress(); youtubePlayer?.close(); youtubePlayer = null; youtubeState.current = null; youtubeState.currentIndex = -1; youtubeRecordedStart = false; };
    const openYoutubeVideo = (video, index = -1) => {
      if (!video?.videoId || !/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) return;
      clearYoutubeProgress(); void saveYoutubeProgress(); youtubePlayer?.close(); youtubePlayer = null;
      youtubeState.current = { ...video, kind: youtubeState.section === 'shorts' ? 'short' : video.kind };
      youtubeState.currentIndex = index; youtubeState.resumeAt = Math.max(0, Number(video.positionSeconds) || 0); youtubeState.playerStatus = 'Loading the official embedded player…'; youtubeRecordedStart = false;
      render(hud.snapshot());
      const shell = outlet.querySelector('#hud-youtube-player');
      const api = globalThis.jarvisYouTube;
      if (!shell || !api?.createPlayerController) { youtubeState.playerStatus = 'Embedded playback is unavailable here. Open the video on your paired phone or in YouTube.'; const status = outlet.querySelector('#hud-youtube-player-status'); if (status) status.textContent = youtubeState.playerStatus; return; }
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
      if (!youtube.paired()) { youtubeState.status = 'Pair first. Start pairing here, then sign in and approve the code on your iPhone.'; render(hud.snapshot()); return; }
      youtubeState.section = section; youtubeState.status = section === 'shorts' ? 'Searching embeddable videos matching #shorts. This is not an official Shorts feed.' : 'Loading YouTube…';
      if (!append) { youtubeState.videos = []; youtubeState.channels = []; youtubeState.subscriptions = []; youtubeState.history = []; youtubeState.pageToken = ''; }
      render(hud.snapshot());
      try {
        if (section === 'home' || section === 'search' || section === 'shorts') {
          const query = section === 'home' ? '' : (youtubeState.query.trim() || (section === 'shorts' ? 'popular' : ''));
          if (section !== 'home' && !query) throw new Error('Enter a search query.');
          if (section === 'search' || section === 'shorts') await youtube.recordSearch(query).catch(() => {});
          const searchQuery = section === 'shorts' ? `${query} #shorts` : query;
          const data = section === 'home' ? await youtube.home(youtubeState.pageToken) : await youtube.search(searchQuery, youtubeState.pageToken);
          const newVideos = Array.isArray(data.videos) ? data.videos : [];
          youtubeState.videos = append ? [...youtubeState.videos, ...newVideos.filter((video) => !youtubeState.videos.some((old) => old.videoId === video.videoId))] : newVideos;
          youtubeState.channels = append ? youtubeState.channels : (Array.isArray(data.channels) ? data.channels : []);
          youtubeState.pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
          youtubeState.status = section === 'home' ? (data.message || 'Recent authorized YouTube account activity; not official watch history or YouTube recommendations.') : section === 'shorts' ? 'Search results matching #shorts; YouTube does not provide a complete Shorts feed through this API.' : `Search results for “${query}”.`;
        } else if (section === 'subscriptions') {
          const data = await youtube.subscriptions(youtubeState.pageToken);
          const newChannels = Array.isArray(data.subscriptions) ? data.subscriptions : [];
          youtubeState.subscriptions = append ? [...youtubeState.subscriptions, ...newChannels.filter((channel) => !youtubeState.subscriptions.some((old) => old.channelId === channel.channelId))] : newChannels;
          youtubeState.pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
          youtubeState.status = 'Channels authorized by the connected YouTube account.';
        } else if (section === 'history') {
          const data = await youtube.history(); youtubeState.history = Array.isArray(data.items) ? data.items : [];
          youtubeState.status = data.disclaimer || 'JARVIS watch history only; this is not YouTube’s official watch history.';
        } else if (section === 'favorites') {
          const data = await youtube.favorites(); youtubeState.favorites = Array.isArray(data.items) ? data.items : [];
          youtubeState.status = 'Saved videos for this connected Google account.';
        } else if (section === 'account') {
          const data = await youtube.account(); youtubeState.status = data.connected ? `Connected as ${data.email || 'Google account'}. Manage access and devices on your iPhone.` : 'Connect a Google account on the iPhone connection page.';
          youtubeState.account = data.connected ? { email: data.email } : null;
        }
      } catch (error) { youtubeState.status = error.message || 'YouTube is temporarily unavailable. Try again.'; }
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
        youtubeState.status = 'YouTube connected. Loading your account…';
        await loadYoutubeSection('home');
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
      if (state.screen === 'youtube') {
        outlet.append(make('p', 'eyebrow', 'JARVIS MEDIA'), make('h1', 'detail-title', 'YOUTUBE'));
        const status = make('p', 'status hud-youtube-status', youtubeState.status); outlet.append(status);
        const accountStatus = make('p', 'copy hud-youtube-account-status', youtube.paired() ? 'Account Status: Connected' : 'Account Status: Not connected'); outlet.append(accountStatus);
        if (!youtube.paired()) {
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
          const nav = make('nav', 'hud-youtube-nav', ''); nav.setAttribute('aria-label', 'YouTube sections');
          for (const section of ['home', 'search', 'subscriptions', 'shorts', 'history', 'favorites', 'account']) {
            const button = make('button', 'action hud-youtube-tab', section.toUpperCase()); button.type = 'button'; button.dataset.youtubeFocus = 'true'; button.setAttribute('aria-pressed', String(youtubeState.section === section)); button.addEventListener('click', () => { if (youtubeState.current) leaveYoutubePlayer(); if (section === 'search' || section === 'shorts') { youtubeState.section = section; youtubeState.status = section === 'shorts' ? 'Enter a topic; results are ordinary #shorts searches, not an official Shorts feed.' : 'Enter a search for videos and channels.'; render(hud.snapshot()); } else void loadYoutubeSection(section); }); nav.append(button);
          }
          outlet.append(nav);
          if (youtubeState.section === 'search' || youtubeState.section === 'shorts') {
            const searchForm = document.createElement('form'); searchForm.className = 'hud-youtube-search';
            const query = document.createElement('input'); query.type = 'search'; query.maxLength = 100; query.value = youtubeState.query; query.placeholder = youtubeState.section === 'shorts' ? 'TOPIC FOR #SHORTS SEARCH' : 'SEARCH VIDEOS AND CHANNELS'; query.setAttribute('aria-label', 'Search YouTube'); query.dataset.youtubeFocus = 'true';
            const submit = make('button', 'action', 'SEARCH'); submit.type = 'submit'; submit.dataset.youtubeFocus = 'true'; searchForm.addEventListener('submit', (event) => { event.preventDefault(); youtubeState.query = query.value.trim(); if (!youtubeState.query || youtubeState.query.length > 100) { youtubeState.status = 'Enter a search of 1 to 100 characters.'; status.textContent = youtubeState.status; return; } void loadYoutubeSection(youtubeState.section); }); searchForm.append(query, submit); outlet.append(searchForm);
          }
          if (youtubeState.current) {
            const title = make('h2', 'hud-youtube-video-title', youtubeState.current.title || 'YouTube video'); outlet.append(title);
            const shell = make('div', `hud-youtube-player-shell${youtubeState.current.kind === 'short' ? ' is-short' : ''}`, ''); shell.id = 'hud-youtube-player'; shell.setAttribute('aria-label', 'YouTube embedded video player'); outlet.append(shell);
            const playerStatus = make('p', 'status hud-youtube-player-status', youtubeState.playerStatus); playerStatus.id = 'hud-youtube-player-status'; outlet.append(playerStatus);
            const controls = make('div', 'hud-youtube-controls', '');
            const play = make('button', 'action', 'PLAY / RESUME'); play.type = 'button'; play.dataset.youtubeFocus = 'true'; play.addEventListener('click', () => youtubePlayer?.play());
            const pause = make('button', 'action', 'PAUSE'); pause.type = 'button'; pause.dataset.youtubeFocus = 'true'; pause.addEventListener('click', () => { youtubePlayer?.pause(); void saveYoutubeProgress(); });
            const isFavorite = youtubeState.section === 'favorites' || youtubeState.favorites.some((item) => item.videoId === youtubeState.current.videoId);
            const favorite = make('button', 'action', isFavorite ? 'REMOVE FAVORITE' : 'SAVE TO FAVORITES'); favorite.type = 'button'; favorite.dataset.youtubeFocus = 'true'; favorite.addEventListener('click', async () => { try { if (isFavorite) { await youtube.removeFavorite(youtubeState.current.videoId); if (youtubeState.section === 'favorites') { await loadYoutubeSection('favorites'); return; } youtubeState.favorites = youtubeState.favorites.filter((item) => item.videoId !== youtubeState.current.videoId); youtubeState.status = 'Video removed from JARVIS favorites.'; } else { await youtube.saveFavorite({ videoId: youtubeState.current.videoId, kind: youtubeState.current.kind === 'short' ? 'short' : 'video' }); youtubeState.status = 'Video saved to this account’s JARVIS favorites.'; } status.textContent = youtubeState.status; } catch (error) { youtubeState.status = error.message || 'Could not update favorites.'; status.textContent = youtubeState.status; } });
            const videoList = youtubeVideoList();
            const previous = make('button', 'action', 'PREVIOUS'); previous.type = 'button'; previous.dataset.youtubeFocus = 'true'; previous.disabled = youtubeState.currentIndex <= 0; previous.addEventListener('click', () => { const item = videoList[youtubeState.currentIndex - 1]; if (item) openYoutubeVideo(item, youtubeState.currentIndex - 1); });
            const next = make('button', 'action', 'NEXT'); next.type = 'button'; next.dataset.youtubeFocus = 'true'; next.disabled = youtubeState.currentIndex < 0 || youtubeState.currentIndex >= videoList.length - 1; next.addEventListener('click', () => { const item = videoList[youtubeState.currentIndex + 1]; if (item) openYoutubeVideo(item, youtubeState.currentIndex + 1); });
            const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = '60'; volume.setAttribute('aria-label', 'YouTube player volume'); volume.dataset.youtubeFocus = 'true'; volume.addEventListener('input', () => youtubePlayer?.setVolume(volume.value));
            controls.append(play, pause, favorite, previous, next, volume); outlet.append(controls);
            const handoff = document.createElement('a'); handoff.className = 'action hud-youtube-handoff'; handoff.href = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeState.current.videoId)}`; handoff.target = '_blank'; handoff.rel = 'noopener noreferrer'; handoff.textContent = 'OPEN VIDEO ON PHONE / YOUTUBE'; handoff.dataset.youtubeFocus = 'true'; outlet.append(handoff);
            const back = make('button', 'action', 'BACK TO RESULTS'); back.type = 'button'; back.dataset.youtubeFocus = 'true'; back.addEventListener('click', () => { leaveYoutubePlayer(); render(hud.snapshot()); }); outlet.append(back);
          } else {
            const results = make('div', 'hud-youtube-results', ''); results.setAttribute('aria-live', 'polite');
            const videos = youtubeVideoList();
            videos.slice(0, 16).forEach((video, index) => {
              const button = make('button', 'hud-youtube-result', ''); button.type = 'button'; button.dataset.youtubeFocus = 'true';
              let imageUrl = ''; try { const candidate = new URL(video.thumbnail || ''); if (candidate.protocol === 'https:' && ['i.ytimg.com', 'img.youtube.com'].includes(candidate.hostname)) imageUrl = candidate.href; } catch {}
              if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = ''; img.loading = 'lazy'; button.append(img); }
              const text = make('span', '', `${video.title || 'YouTube video'} · ${video.channel || 'YouTube'}`); button.append(text);
              if (youtubeState.section === 'history' && Number(video.positionSeconds) > 0) { const resume = make('small', '', `Resume at ${Math.floor(video.positionSeconds)} seconds`); button.append(resume); }
              button.addEventListener('click', () => openYoutubeVideo(video, index)); results.append(button);
            });
            if (youtubeState.section === 'subscriptions') {
              youtubeState.subscriptions.forEach((channel) => { const button = make('button', 'hud-youtube-result', channel.title || 'Subscribed channel'); button.type = 'button'; button.dataset.youtubeFocus = 'true'; button.addEventListener('click', async () => { youtubeState.status = `Loading recent uploads from ${channel.title}…`; status.textContent = youtubeState.status; try { const data = await youtube.subscriptionVideos(channel.channelId); youtubeState.videos = (data.videos || []).map((item) => ({ ...item, kind: 'video' })); youtubeState.status = `Recent embeddable uploads from ${channel.title}.`; render(hud.snapshot()); } catch (error) { youtubeState.status = error.message; status.textContent = youtubeState.status; } }); results.append(button); });
            }
            youtubeState.channels.forEach((channel) => { const link = document.createElement('a'); link.className = 'action hud-youtube-handoff'; link.href = `https://www.youtube.com/channel/${encodeURIComponent(channel.channelId)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `OPEN CHANNEL: ${channel.title}`; link.dataset.youtubeFocus = 'true'; results.append(link); });
            if (!videos.length && !youtubeState.subscriptions.length && !youtubeState.channels.length) results.append(make('p', 'copy', 'No items loaded. Select a section or search to browse.'));
            outlet.append(results);
            if (youtubeState.pageToken && ['home', 'search', 'shorts', 'subscriptions'].includes(youtubeState.section)) { const more = make('button', 'action', 'LOAD MORE'); more.type = 'button'; more.dataset.youtubeFocus = 'true'; more.addEventListener('click', () => { if (youtubeState.section === 'subscriptions') void (async () => { try { const data = await youtube.subscriptions(youtubeState.pageToken); youtubeState.subscriptions.push(...(data.subscriptions || []).filter((channel) => !youtubeState.subscriptions.some((old) => old.channelId === channel.channelId))); youtubeState.pageToken = data.nextPageToken || ''; youtubeState.status = 'More subscribed channels loaded.'; render(hud.snapshot()); } catch (error) { youtubeState.status = error.message; status.textContent = youtubeState.status; } })(); else void loadYoutubeSection(youtubeState.section, true); }); outlet.append(more); }
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
    document.addEventListener('keydown', (event) => {
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
    registerHudUpdates(globalThis.navigator, globalThis, document);
    hud.render();
    return hud;
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => boot(document), { once: true });
  return { MENU, createHud, createYouTubeClient, normalizeBackendOrigin, registerHudUpdates, boot };
}));
