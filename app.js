(function exposeJarvisGlassesHud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisGlassesHud = api;
}(globalThis, function createJarvisGlassesHud() {
  'use strict';

  const YOUTUBE_API_PREFIX = '/v1/youtube';
  const DEFAULT_YOUTUBE_WORKER_ORIGIN = 'https://jarvis-glasses-youtube.hlao-xiong.workers.dev';
  const RELEASE_MANIFEST_URL = './release-manifest.json';
  const GOOGLE_APP_TERMS = /\b(?:e-?mails?|gmail|inbox|mail|messages?|calendar|meetings?|appointments?|events?|contacts?|phone number|email address|drive|gle|files?|folders?|doc(?:ument)?s?|sheets?|spreadsheets?|tasks?|to-do|todo|reminders?)\b/i;
  const GOOGLE_READ_TERMS = /\b(?:what(?:'s|s| is)?|show|find|search|look up|list|read|open|summari[sz]e|summeri[sz]e|upcoming|latest|newest|unfinished|completed|first|last|next)\b/i;
  const DRIVE_SELECTION_TERMS = /\b(?:doc(?:ument)?|file|item|pdf|sheet|spreadsheet)\s*(?:number\s*)?\d{1,2}\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:doc(?:ument)?|file|item|pdf|sheet|spreadsheet)\b/i;

  // Meta's Web App runtime maps Neural Band gestures to the normal D-pad
  // key set. Capture is intentional: the device browser can target a focused
  // control with a non-bubbling event, which a document bubble listener misses.
  // `code` and legacy numeric values keep this compatible with sparse events
  // from embedded WebViews without widening the accepted input.
  function navigationKey(event) {
    const key = String(event?.key || '');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', ' ', 'BrowserBack', 'GoBack', 'Back'].includes(key)) return ['BrowserBack', 'GoBack', 'Back'].includes(key) ? 'Escape' : key;
    const code = String(event?.code || '');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'Space'].includes(code)) return code === 'Space' ? ' ' : code;
    return ({ 4: 'Escape', 8: 'Backspace', 13: 'Enter', 27: 'Escape', 32: ' ', 166: 'Escape', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' })[Number(event?.keyCode || event?.which)] || '';
  }

  function bindHudKeyboard(target, listener) {
    if (!target?.addEventListener || typeof listener !== 'function') return () => {};
    target.addEventListener('keydown', listener, true);
    return () => target.removeEventListener?.('keydown', listener, true);
  }

  // This is a routing hint only. The Connected Apps Worker performs the
  // authoritative, owner-bound app allowlist and exposes read-only adapters.
  function isGoogleReadRequest(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim();
    return text.length > 0 && text.length <= 1200 && GOOGLE_APP_TERMS.test(text) && (GOOGLE_READ_TERMS.test(text) || DRIVE_SELECTION_TERMS.test(text));
  }
  function googleAppHint(value) {
    const text = String(value || '').toLowerCase();
    if (/\b(?:e-?mails?|gmail|inbox|mail|messages?)\b/.test(text)) return 'gmail';
    if (/\b(?:calendar|meeting|appointment|event)\b/.test(text)) return 'calendar';
    if (/\bcontacts?|phone number|email address\b/.test(text)) return 'contacts';
    if (/\b(?:drive|gle|files?|folders?)\b/.test(text)) return 'drive';
    if (/\b(?:docs?|documents?)\b/.test(text)) return 'documents';
    if (/\b(?:sheets?|spreadsheets?)\b/.test(text)) return 'sheets';
    if (/\b(?:tasks?|to-do|todo|reminder)\b/.test(text)) return 'tasks';
    return '';
  }
  function isGoogleFollowUp(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim();
    return text.length > 0 && text.length <= 300 && /\b(?:it|them|that|those|one|ones|number|email|emails|message|messages|first|second|third|latest|next|last)\b/i.test(text) && /\b(?:what|how|show|find|read|open|about|summari[sz]e|summeri[sz]e|first|second|third|latest|next|last)\b/i.test(text);
  }
  const subjectWords = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word.length >= 3);
  const nearWord = (left, right) => { if (left === right) return true; if (Math.abs(left.length - right.length) > 1) return false; let a = 0; let b = 0; let edits = 0; while (a < left.length && b < right.length) { if (left[a] === right[b]) { a += 1; b += 1; continue; } if (++edits > 1) return false; if (left.length > right.length) a += 1; else if (right.length > left.length) b += 1; else { a += 1; b += 1; } } return true; };
  function matchesRecentGmailSubject(value, subjects) {
    const phrase = String(value || '').trim().toLowerCase(); const words = subjectWords(phrase);
    if (!phrase || phrase.length > 240 || !words.length || !Array.isArray(subjects)) return false;
    return subjects.some((subject) => { const normalizedSubject = String(subject || '').toLowerCase(); const candidates = subjectWords(subject); const matches = words.filter((word) => normalizedSubject.includes(word) || word.length >= 5 && candidates.some((candidate) => nearWord(word, candidate))).length; return normalizedSubject.includes(phrase) || matches >= (words.length > 2 ? 2 : 1); });
  }
  // Status questions must not be answered by the model.  The authenticated
  // Connected Apps status endpoint is the only source of truth for whether an
  // owner-bound Google grant exists and which app adapters remain enabled.
  function isGoogleStatusRequest(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim();
    return text.length > 0 && text.length <= 500
      && /\b(?:connected|connection|access|available|authorized|authorization|applications?|apps?)\b|\bcan\s+you\s+(?:see|access)\s+(?:my\s+)?/i.test(text)
      && /\b(?:google|gmail|drive|calendar|contacts?|docs?|documents?|sheets?|tasks?)\b/i.test(text);
  }
  function isGoogleRetryRequest(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim();
    return /^(?:please\s+)?(?:try\s+again|retry(?:\s+(?:that|it))?)\.?$/i.test(text);
  }
  function usableGoogleRetry(operation, stamp = Date.now()) {
    return Boolean(operation && typeof operation.message === 'string' && operation.message.length > 0 && operation.message.length <= 1200
      && ['gmail', 'calendar', 'contacts', 'drive', 'documents', 'sheets', 'tasks'].includes(operation.app)
      && Number.isFinite(operation.createdAt) && stamp - operation.createdAt >= 0 && stamp - operation.createdAt <= 5 * 60 * 1000);
  }
  function isGoogleStatusFollowUp(value) {
    const text = String(value || '').normalize('NFKC').replace(/[\u2018\u2019]/g, "'").trim();
    return text.length > 0 && text.length <= 160 && /\b(?:how|what|and)\s+(?:about\s+)?now\b|\bnow\?$/i.test(text);
  }
  function googleStatusReply(grant, requestedApp = '') {
    const appLabels = { gmail: 'Gmail', calendar: 'Google Calendar', contacts: 'Google Contacts', drive: 'Google Drive', documents: 'Google Docs', sheets: 'Google Sheets', tasks: 'Google Tasks' };
    const grantApps = { gmail: 'gmail', calendar: 'google-calendar', contacts: 'google-contacts', drive: 'google-drive', documents: 'google-docs', sheets: 'google-sheets', tasks: 'google-tasks' };
    const app = requestedApp && appLabels[requestedApp] ? requestedApp : '';
    const label = appLabels[app] || 'Google Apps';
    const enabled = new Set(Array.isArray(grant?.apps) ? grant.apps : []);
    const disabled = new Set(Array.isArray(grant?.disabledApps) ? grant.disabledApps : []);
    const state = String(grant?.authorizationState || (grant?.reconnectRequired ? 'revoked' : grant?.connected ? 'connected' : 'disconnected'));
    if (state === 'revoked') return 'Google Apps authorization was revoked and must be reconnected by the owner. No Google read was sent.';
    if (state === 'disconnected' || !grant?.connected) return 'Google Apps is not connected for this owner session. No Google read was sent.';
    if (app && !enabled.has(grantApps[app])) return `${label} is not authorized for this owner session. No Google read was sent.`;
    if (app && disabled.has(grantApps[app])) return `${label} is authorized but currently disabled. Enable it in CONNECT APPS before making a read-only request.`;
    if (state === 'expired') return app ? `${label} authorization is present, but its temporary provider access has expired. JARVIS will securely renew it only when you make an allowed read-only request.` : 'Google Apps authorization is present, but its temporary provider access has expired. JARVIS will securely renew it only when you make an allowed read-only request.';
    if (app) return `${label} is authorized and enabled for read-only JARVIS requests. This confirms authorization, not current Gmail/Google API availability. No Google read was sent.`;
    return `Google Apps authorization is active for ${enabled.size} approved read-only app${enabled.size === 1 ? '' : 's'}. No Google read was sent.`;
  }
  function isConversationRecapRequest(value) {
    const text = String(value || '').normalize('NFKC').toLowerCase();
    return /\b(?:summari[sz](?:e|es)|summeri[sz](?:e|es)|recap)\b/.test(text) && /\b(?:we|conversation|chat|talked|discussed|just)\b/.test(text);
  }
  function isConversationTimelineFollowUp(value) {
    const text = String(value || '').normalize('NFKC').toLowerCase();
    return /\b(?:before|after)\b/.test(text) && /\b(?:about|aobut|that|it)\b/.test(text);
  }
  function createConversationMemory() {
    let entries = [];
    const short = (value, limit) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
    const add = (entry) => { entries.push(entry); if (entries.length > 12) entries = entries.slice(-12); };
    const appName = (app) => ({ gmail: 'Gmail', calendar: 'Calendar', contacts: 'Contacts', drive: 'Google Drive', documents: 'Google Docs', sheets: 'Google Sheets', tasks: 'Google Tasks' }[app] || 'Google Apps');
    return Object.freeze({
      clear: () => { entries = []; },
      get size() { return entries.length; },
      recordChat: (user, assistant, model) => add({ kind: 'chat', user: short(user, 260), assistant: short(assistant, 320), model: model === 'granite' ? 'Granite' : 'GLM' }),
      recordGoogle: (app, status) => add({ kind: 'google', app: appName(app), status: ['completed', 'empty', 'selected', 'analyzing'].includes(status) ? status : 'requested' }),
      safeModelContext: () => entries.filter((entry) => entry.kind === 'google').slice(-2).map((entry) => ({ role: 'assistant', content: `[Session note: a read-only ${entry.app} request ${entry.status}. Private Google results are not included in AI context.]` })),
      recap: () => entries.length ? `Session recap for this unlocked session:\n${entries.map((entry, index) => entry.kind === 'chat' ? `${index + 1}. You asked: “${entry.user}” JARVIS (${entry.model}) replied: “${entry.assistant}”` : `${index + 1}. You made a read-only ${entry.app} request (${entry.status}). Its private result details are not included in AI memory.`).join('\n')}` : 'There are no earlier messages in this unlocked session to recap.',
    });
  }
  // The transport accepts `{ role, text }`; memory's provider-safe notes use
  // `content` so they cannot be accidentally rendered as ordinary chat.  Make
  // that boundary explicit here and retain only the newest valid context that
  // fits the relay's fixed limits.
  function boundedModelHistory(items) {
    const source = Array.isArray(items) ? items.slice(-12) : [];
    const accepted = []; let size = 0;
    for (let index = source.length - 1; index >= 0 && accepted.length < 6; index -= 1) {
      const item = source[index] || {};
      if (!['user', 'assistant'].includes(item.role)) continue;
      const text = String(item.text ?? item.content ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
      if (!text || size + text.length > 3600) continue;
      accepted.push({ role: item.role, text }); size += text.length;
    }
    return accepted.reverse();
  }
  function createVisibleTranscript(limit = 120) {
    const boundedLimit = Number.isInteger(limit) && limit >= 12 && limit <= 240 ? limit : 120;
    const streams = { glm: [], granite: [] };
    return Object.freeze({
      append(model, ...entries) {
        const stream = streams[model] || streams.glm;
        for (const entry of entries) if (entry && ['user', 'assistant'].includes(entry.role) && typeof entry.text === 'string') stream.push({ role: entry.role, text: entry.text, kind: entry.kind || '' });
        if (stream.length > boundedLimit) stream.splice(0, stream.length - boundedLimit);
      },
      entries: (model) => [...(streams[model] || streams.glm)],
      clear: () => { streams.glm = []; streams.granite = []; },
    });
  }

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
    { id: 'media', title: 'MEDIA', detail: 'Open JARVIS apps. Account connections and permissions are managed only from the JARVIS phone app.', available: true },
    { id: 'settings', title: 'SETTINGS', detail: 'Connection mode is standalone. This build contains no JARVIS server address, credentials, or development controls.', available: false },
  ];

  // This is a launcher, not a connector manager.  Each entry either opens an
  // existing device-authorized experience or accurately explains why it cannot
  // yet run on glasses. Provider sign-in always remains in the phone hub.
  const MEDIA_APPS = [
    { id: 'youtube', title: 'YOUTUBE', status: 'DEVICE APPROVAL REQUIRED', experience: 'youtube' },
    { id: 'gmail', title: 'GMAIL', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'calendar', title: 'CALENDAR', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'contacts', title: 'CONTACTS', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'drive', title: 'DRIVE', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'documents', title: 'DOCS', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'sheets', title: 'SHEETS', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'tasks', title: 'TASKS', status: 'PHONE-MANAGED CONNECTION', experience: 'google-app' },
    { id: 'outlook-mail', title: 'OUTLOOK MAIL', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'outlook-calendar', title: 'OUTLOOK CALENDAR', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'facebook', title: 'FACEBOOK', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'instagram', title: 'INSTAGRAM', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'tiktok', title: 'TIKTOK', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'x', title: 'X', status: 'GLASSES ADAPTER NOT AVAILABLE', experience: 'status' },
    { id: 'maps', title: 'MAPS', status: 'HUD EXPERIENCE PLANNED · NO ACCOUNT REQUIRED', experience: 'status' },
    { id: 'weather', title: 'WEATHER', status: 'HUD EXPERIENCE PLANNED · NO ACCOUNT REQUIRED', experience: 'status' },
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
    const updateDialog = documentObject?.getElementById?.('jarvis-update-confirm');
    const updateReload = documentObject?.getElementById?.('jarvis-update-confirm-reload');
    const updateCancel = documentObject?.getElementById?.('jarvis-update-cancel');
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
    let updatePromptOpen = false;
    const show = (message) => { statuses.forEach((status) => { status.textContent = message; }); };
    const showReload = (visible) => { reloadButtons.forEach((button) => { button.hidden = !visible; }); };
    const currentBuild = () => versions[0]?.dataset?.buildId || '';
    const setCurrentBuild = (buildId) => {
      if (!/^(?:local|[a-f0-9]{40})$/.test(buildId || '')) return;
      versions.forEach((version) => { version.dataset.buildId = buildId; version.textContent = `BUILD ${buildId === 'local' ? 'LOCAL' : buildId.slice(0, 12)}`; });
    };
    const checkManifest = async () => {
      if (!globalThis.fetch) return false;
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
    const checkWithoutWorker = async () => {
      const manifest = await checkManifest();
      if (!manifest) return false;
      latestBuildId = manifest.buildId;
      if (manifest.buildId === currentBuild()) show(`JARVIS ${currentBuild().slice(0, 12)} is current.`);
      else show(`JARVIS ${manifest.buildId.slice(0, 12)} is available. This Web App runtime cannot activate updates automatically; close and reopen JARVIS to load it.`);
      return true;
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
      if (!registration) return checkWithoutWorker();
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
    const requestActivateLatest = () => {
      if (!registration?.waiting) return activateLatest();
      if (updatePromptOpen) return;
      updatePromptOpen = true;
      if (typeof updateDialog?.showModal === 'function') updateDialog.showModal();
      else if (target.confirm?.("Reloading JARVIS will apply the latest version.\n\nYour active session will be restored automatically if it is still valid. Otherwise, you'll need to unlock again with your iPhone.")) activateLatest();
      else activateLatest(); // non-DOM test/runtime fallback; reviewed HUD releases always include the dialog
    };
    reloadButtons.forEach((button) => button.addEventListener?.('click', requestActivateLatest));
    updateReload?.addEventListener?.('click', () => { updatePromptOpen = false; activateLatest(); });
    updateCancel?.addEventListener?.('click', () => { updatePromptOpen = false; show('Update cancelled. The current JARVIS session remains unchanged.'); });
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
          show('A verified JARVIS update is ready. Choose RELOAD LATEST when convenient.');
          // An activation notice can arrive from another tab. Keep this page
          // usable and let its explicit RELOAD LATEST action decide when to
          // switch controllers.
        }
        else if (reloadRequested) reloadAfterActivation();
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
    }).catch(() => { void checkWithoutWorker(); });
    return { check, activateLatest };
  }

  function handleUpdateControlsKey(event, documentObject = globalThis.document) {
    const key = navigationKey(event);
    const group = event.target?.closest?.('[data-update-controls]');
    if (!group) return false;
    const controls = [...(group.querySelectorAll?.('[data-update-focus]:not(:disabled):not([hidden])') || [])];
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      if (!controls.length) return false;
      event.preventDefault();
      const index = controls.indexOf(documentObject.activeElement);
      controls[(index + (['ArrowUp', 'ArrowLeft'].includes(key) ? controls.length - 1 : 1)) % controls.length].focus();
      return true;
    }
    if ((key === 'Enter' || key === ' ') && controls.includes(documentObject.activeElement)) {
      event.preventDefault();
      documentObject.activeElement.click();
      return true;
    }
    return false;
  }

  function createHud({ render = () => {} } = {}) {
    let state = { screen: 'welcome', selected: 0, mediaSelected: 0, mediaAppId: '', mediaBackFocused: false, launch: '' };
    const snapshot = () => ({ ...state, item: MENU[state.selected] && { ...MENU[state.selected] }, mediaItem: MEDIA_APPS[state.mediaSelected] && { ...MEDIA_APPS[state.mediaSelected] } });
    const commit = () => { render(snapshot()); return snapshot(); };
    const move = (delta) => {
      if (state.screen === 'media-apps') {
        const direction = Math.sign(delta || 0);
        if (!direction) return commit();
        if (state.mediaBackFocused) state = { ...state, mediaBackFocused: false, mediaSelected: direction < 0 ? MEDIA_APPS.length - 1 : 0 };
        else if ((direction > 0 && state.mediaSelected === MEDIA_APPS.length - 1) || (direction < 0 && state.mediaSelected === 0)) state = { ...state, mediaBackFocused: true };
        else state = { ...state, mediaSelected: state.mediaSelected + direction };
      }
      else state = { ...state, screen: 'menu', selected: (state.selected + delta + MENU.length) % MENU.length };
      return commit();
    };
    const select = () => {
      if (state.screen === 'welcome') state = { ...state, screen: 'menu', selected: 0 };
      else if (state.screen === 'menu') {
        const item = MENU[state.selected];
        state = { ...state, screen: item?.id === 'ai' ? 'chat' : item?.id === 'media' ? 'media-apps' : 'detail', launch: '' };
      } else if (state.screen === 'media-apps') {
        const app = MEDIA_APPS[state.mediaSelected];
        state = state.mediaBackFocused ? { ...state, screen: 'menu', mediaBackFocused: false, launch: '' } : { ...state, screen: app?.experience === 'youtube' ? 'youtube' : app?.experience === 'google-app' ? 'google-app' : 'media-status', mediaAppId: app?.id || '', launch: 'media' };
      }
      else state = { screen: 'menu', selected: state.selected };
      return commit();
    };
    const back = () => {
      if (state.screen === 'media-status' || state.screen === 'google-app' || state.screen === 'youtube' || (state.screen === 'chat' && state.launch === 'media')) state = { ...state, screen: 'media-apps', mediaBackFocused: false, launch: '' };
      else if (state.screen === 'detail' || state.screen === 'chat' || state.screen === 'connect-apps') state = { ...state, screen: 'menu' };
      else if (state.screen === 'menu') state = { ...state, screen: 'welcome' };
      return commit();
    };
    const handleKey = (event) => {
      const key = navigationKey(event);
      if (key === 'ArrowUp' || key === 'ArrowLeft') { event?.preventDefault?.(); return move(-1); }
      if (key === 'ArrowDown' || key === 'ArrowRight') { event?.preventDefault?.(); return move(1); }
      if (key === 'Enter' || key === ' ') { event?.preventDefault?.(); return select(); }
      if (key === 'Escape' || key === 'Backspace') { event?.preventDefault?.(); return back(); }
      return snapshot();
    };
    const openMediaChat = () => { state = { ...state, screen: 'chat', launch: 'media' }; return commit(); };
    const chooseMedia = (index) => { if (Number.isInteger(index) && index >= 0 && index < MEDIA_APPS.length) state = { ...state, mediaSelected: index, mediaBackFocused: false }; return commit(); };
    return { snapshot, move, select, back, handleKey, openMediaChat, chooseMedia, render: commit };
  }

  function handleConnectAppsKey(event, { hud, outlet, document }) {
    const key = navigationKey(event);
    if (!['connect-apps', 'media-device-access'].includes(hud.snapshot().screen)) return false;
    if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName) && key !== 'Escape') return true;
    if (key === 'Escape' || key === 'Backspace') { event.preventDefault(); hud.back(); return true; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      event.preventDefault();
      const controls = [...outlet.querySelectorAll('[data-connectors-focus]:not(:disabled)')];
      if (controls.length) {
        const current = controls.indexOf(document.activeElement);
        const direction = ['ArrowUp', 'ArrowLeft'].includes(key) ? -1 : 1;
        controls[(current + direction + controls.length) % controls.length].focus();
      }
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      // Consume activation keys even when focus was lost during a rerender.
      // Falling through to hud.handleKey() selects the current screen and exits.
      event.preventDefault();
      if (document.activeElement?.matches?.('[data-connectors-focus]:not(input)')) document.activeElement.click();
      return true;
    }
    return false;
  }

  function handleAppScreenKey(event, { hud, outlet, document }) {
    const key = navigationKey(event);
    if (hud.snapshot().screen !== 'google-app') return false;
    if (key === 'Escape' || key === 'Backspace') { event.preventDefault(); hud.back(); return true; }
    if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return key !== 'Escape';
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      event.preventDefault();
      const controls = [...outlet.querySelectorAll('[data-app-focus]:not(:disabled)')];
      if (controls.length) { const current = controls.indexOf(document.activeElement); const direction = ['ArrowUp', 'ArrowLeft'].includes(key) ? -1 : 1; controls[(current + direction + controls.length) % controls.length].focus(); }
      return true;
    }
    if (key === 'Enter' || key === ' ') { event.preventDefault(); if (document.activeElement?.matches?.('[data-app-focus]:not(input)')) document.activeElement.click(); return true; }
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
      async testAllApps() {
        state.busy = true; state.status = 'Testing seven read-only Google Apps connections…'; state.result = ''; redraw();
        try { state.result = await connector.runCommand(globalThis.jarvisGoogleConnectors?.CONNECTIVITY_TEST_COMMAND || '__JARVIS_GOOGLE_CONNECTIVITY_TEST_V1__'); state.status = 'Google Apps connectivity test complete.'; }
        catch (error) { state.status = error.message || 'Google Apps connectivity test failed.'; }
        finally { state.busy = false; redraw(); }
      },
      clear() {
        connector.clear(); state.pairing = null; state.result = ''; state.status = 'Authorization cleared from this glasses session.'; redraw();
      },
    };
    return api;
  }

  // This client deliberately keeps only the one-use handoff in memory.  The
  // Connected Apps Worker converts it to an HttpOnly, owner-bound cookie; no
  // No authentication credential or Google credential is ever exposed to HUD JavaScript.
  function createOwnerAppsClient({ authWorker, appsWorker, fetchImpl = globalThis.fetch, onDiagnostic = () => {} } = {}) {
    const request = async (origin, path, options = {}) => {
      const stage = options.stage || 'unknown'; onDiagnostic({ stage, state: 'attempted' });
      let response;
      try { response = await fetchImpl(`${origin}${path}`, { method: options.method || 'GET', credentials: 'include', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...((options.handoff || options.csrf) ? { 'X-Jarvis-HUD': 'connected-apps' } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) }); }
      catch { const error = new Error('Owner authorization request could not be completed.'); error.category = 'network-or-cors'; onDiagnostic({ stage, state: 'failed', category: error.category }); throw error; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(body.error || 'Owner authorization failed.'); error.status = response.status; error.category = response.status === 401 ? 'session-unavailable' : response.status === 409 ? 'handoff-replayed-or-expired' : response.status === 403 ? 'origin-or-csrf-denied' : response.status >= 500 ? 'service-unavailable' : 'request-rejected'; onDiagnostic({ stage, state: 'failed', status: response.status, category: error.category }); throw error; }
      onDiagnostic({ stage, state: 'success', status: response.status }); return body;
    };
    return Object.freeze({
      async authorize() { const handoff = await request(authWorker, '/v1/connected-apps/handoff', { method: 'POST', body: {}, handoff: true, stage: 'handoff-issuance' }); if (!/^[A-Za-z0-9_-]{43}$/.test(handoff.handoff || '')) { const error = new Error('Owner authorization failed.'); error.category = 'invalid-handoff-response'; onDiagnostic({ stage: 'handoff-issuance', state: 'failed', category: error.category }); throw error; } return request(appsWorker, '/v1/owner/session/handoff', { method: 'POST', body: { handoff: handoff.handoff }, handoff: true, stage: 'handoff-redemption' }); },
      status: () => request(appsWorker, '/v1/owner/google/grant', { stage: 'google-grant-status' }),
      readCommand: async (message) => {
        let timeZone = 'UTC'; try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone; } catch {}
        const value = await request(appsWorker, '/v1/owner/google/commands', { method: 'POST', body: { message: String(message || '').trim(), timeZone }, csrf: true, stage: 'google-read-command' });
        if (typeof value?.content !== 'string' || value.content.length > 5000) throw new Error('Google read response was invalid.');
        if (value.analysis !== undefined && (!value.analysis || typeof value.analysis.instruction !== 'string' || typeof value.analysis.text !== 'string' || value.analysis.instruction.length > 1200 || value.analysis.text.length > 6000)) throw new Error('Google read response was invalid.');
        const diagnostic = value?.diagnostic;
        if (diagnostic && typeof diagnostic === 'object' && ['provider-read', 'provider-response', 'grant-read', 'grant-refresh'].includes(diagnostic.stage) && /^[a-z0-9_-]{1,48}$/.test(diagnostic.category || '') && (diagnostic.providerStatus === undefined || Number.isInteger(diagnostic.providerStatus) && diagnostic.providerStatus >= 400 && diagnostic.providerStatus <= 599)) onDiagnostic({ stage: 'google-read-command', state: 'provider-failure', status: diagnostic.providerStatus, category: diagnostic.category });
        return value;
      },
      connect: (apps) => request(appsWorker, '/v1/owner/google/oauth/start', { method: 'POST', body: { apps }, csrf: true, stage: 'google-oauth-start' }),
      access: (action, apps) => request(appsWorker, '/v1/owner/google/apps/access', { method: 'POST', body: { action, apps }, csrf: true, stage: `google-app-${action}` }),
    });
  }

  function bindConnectAppsAction(element, action) {
    element.addEventListener('click', (event) => {
      if (!element.disabled) action(event);
    });
    return element;
  }

  // This runs while app.js is evaluated, before unlock.js can begin its
  // DOMContentLoaded flow. The assertion is passed directly to the existing
  // one-time exchange and is never saved in browser storage.
  function createStagingChatAuthorization({ root = globalThis, authConfig = root.JARVIS_AUTH_CONFIG || {}, stagingChatApi = root.JARVIS_STAGING_CHAT } = {}) {
    const STAGING_AUTH_WORKER = 'https://jarvis-auth-staging.hlao-xiong.workers.dev';
    let client = null; let exchangeInFlight = false; let renewalInFlight = null; let generation = 0;
    let status = 'DISCONNECTED · COMPLETE COMPANION UNLOCK TO CONNECT';
    try { client = stagingChatApi?.createClient({ relayUrl: authConfig.chatRelayUrl }); }
    catch { status = 'DISCONNECTED · AUTHENTICATED STAGING CHAT IS NOT CONFIGURED'; }
    const publish = (next) => {
      status = next;
      if (root.CustomEvent) root.dispatchEvent?.(new root.CustomEvent('jarvis-staging-chat-status', { detail: { status } }));
    };
    const clear = () => {
      generation += 1; exchangeInFlight = false; client?.clear();
      publish(client ? 'DISCONNECTED · COMPLETE COMPANION UNLOCK TO CONNECT' : 'DISCONNECTED · AUTHENTICATED STAGING CHAT IS NOT CONFIGURED');
    };
    root.addEventListener?.('jarvis-glasses-assertion', (event) => {
      const detail = event?.detail || {};
      // Replayed events cannot create another exchange. The relay still
      // validates the signed assertion and enforces its one-time use.
      if (!client || exchangeInFlight || client.ready) return;
      const run = ++generation; exchangeInFlight = true;
      publish('CONNECTING · VERIFYING COMPANION UNLOCK');
      void client.exchange(detail.assertion, detail.expiresAt).then(() => {
        if (run === generation && client.ready) publish('CONNECTED · AUTHORIZED STAGING CHAT');
      }).catch((error) => {
        if (run === generation) publish(error?.status === 409 ? 'DISCONNECTED · UNLOCK ASSERTION WAS ALREADY USED' : 'DISCONNECTED · COMPANION CHAT AUTHORIZATION FAILED');
      }).finally(() => { if (run === generation) exchangeInFlight = false; });
    });
    root.document?.addEventListener?.('jarvis-session-locked', clear);
    const ensureReady = async () => {
      if (client?.ready) return true;
      if (renewalInFlight) return renewalInFlight;
      if (!client || authConfig.workerUrl !== STAGING_AUTH_WORKER || typeof root.fetch !== 'function') { publish('DISCONNECTED - AUTHENTICATED STAGING CHAT IS NOT CONFIGURED'); return false; }
      const run = generation;
      renewalInFlight = (async () => {
        publish('CONNECTING - RESTORING OWNER SESSION');
        let response;
        try { response = await root.fetch(`${STAGING_AUTH_WORKER}/v1/hud/session/restore`, { method: 'POST', headers: { 'X-Jarvis-HUD': 'restore' }, credentials: 'include', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
        catch { if (run === generation) publish('DISCONNECTED - OWNER SESSION RESTORE UNAVAILABLE'); return false; }
        const value = await response.json().catch(() => null);
        if (!response.ok || value?.authorized !== true || typeof value.assertion !== 'string' || !Number.isSafeInteger(value.assertionExpiresAt)) { if (run === generation) publish(response.status === 401 ? 'DISCONNECTED - OWNER SESSION EXPIRED' : 'DISCONNECTED - OWNER SESSION RESTORE UNAVAILABLE'); return false; }
        if (run !== generation || exchangeInFlight) return false;
        exchangeInFlight = true;
        try {
          await client.exchange(value.assertion, value.assertionExpiresAt * 1000);
          if (run !== generation || !client.ready) return false;
          publish('CONNECTED - AUTHORIZED STAGING CHAT');
          return true;
        } catch { if (run === generation) publish('DISCONNECTED - COMPANION CHAT AUTHORIZATION FAILED'); return false; }
        finally { if (run === generation) exchangeInFlight = false; }
      })().finally(() => { renewalInFlight = null; });
      return renewalInFlight;
    };
    return Object.freeze({ get client() { return client; }, get status() { return status; }, clear, ensureReady });
  }

  function boot(document) {
    const outlet = document.querySelector('#hud-screen');
    if (!outlet) return null;
    let hud; const conversations = { glm: [], granite: [] }; const visibleTranscript = createVisibleTranscript(); const chatScrollPositions = { glm: 0, granite: 0 }; const conversationMemory = createConversationMemory(); let visibleConversation = 'glm'; let chatStatus = 'DISCONNECTED · COMPLETE COMPANION UNLOCK TO CONNECT'; let chatBusy = false; let pendingChatMessage = ''; let retryChatMessage = ''; let lastGoogleApp = ''; let lastGmailSubjects = []; let lastGoogleOperation = null; let lastGoogleStatusCheck = false; let chatRequestGeneration = 0; let lastChatTransport = { category: 'none', status: null };
    const appendConversation = (model, ...entries) => { conversations[model].push(...entries); if (conversations[model].length > 12) conversations[model] = conversations[model].slice(-12); visibleTranscript.append(model, ...entries); };
    const authConfig = globalThis.JARVIS_AUTH_CONFIG || {};
    let stagingChat = null;
    try { stagingChat = globalThis.JARVIS_STAGING_CHAT?.createClient({ relayUrl: authConfig.chatRelayUrl }); }
    catch { chatStatus = 'DISCONNECTED · AUTHENTICATED STAGING CHAT IS NOT CONFIGURED'; }
    if (!globalThis.JARVIS_STAGING_CHAT_AUTHORIZATION) globalThis.addEventListener?.('jarvis-glasses-assertion', (event) => {
      const detail = event?.detail || {};
      if (!stagingChat) return;
      chatStatus = 'CONNECTING · VERIFYING COMPANION UNLOCK';
      void stagingChat.exchange(detail.assertion, detail.expiresAt).then(() => {
        chatStatus = 'CONNECTED · AUTHORIZED STAGING CHAT';
      }).catch((error) => {
        chatStatus = error?.status === 409 ? 'DISCONNECTED · UNLOCK ASSERTION WAS ALREADY USED' : 'DISCONNECTED · COMPANION CHAT AUTHORIZATION FAILED';
      }).finally(() => { if (hud) render(hud.snapshot()); });
    });
    const chatAuthorization = globalThis.JARVIS_STAGING_CHAT_AUTHORIZATION || null;
    if (chatAuthorization) {
      stagingChat = chatAuthorization.client;
      chatStatus = chatAuthorization.status;
      globalThis.addEventListener?.('jarvis-staging-chat-status', (event) => { chatStatus = event?.detail?.status || chatStatus; if (hud) render(hud.snapshot()); });
    }
    let youtubeBackend = '';
    try { youtubeBackend = normalizeBackendOrigin(globalThis.localStorage?.getItem('jarvis.youtube.backend-origin') || '') || DEFAULT_YOUTUBE_WORKER_ORIGIN; } catch { youtubeBackend = DEFAULT_YOUTUBE_WORKER_ORIGIN; }
    const youtube = createYouTubeClient({ backendOrigin: youtubeBackend });
    const relayConfig = globalThis.JARVIS_CONNECTORS_CONFIG || {};
    const googleConnectors = globalThis.jarvisGoogleConnectors?.createGoogleConnectorClient({ workerOrigin: relayConfig.workerOrigin, enabled: relayConfig.enabled === true });
    const phoneCompanionUrl = globalThis.jarvisGoogleConnectors?.normalizeCompanionUrl?.(relayConfig.phoneCompanionUrl) || '';
    // Strict allowlist: this record deliberately never holds request URLs,
    // cookies, credentials, provider data, or server error strings.
    const ownerAppsDiagnostics = { hud: document.body?.dataset?.jarvisSession === 'authenticated' ? 'active' : 'unavailable', handoffIssuance: 'not-attempted', handoffRedemption: 'not-attempted', session: 'unavailable', googleStatus: 'not-attempted', lastStatus: 'none', category: 'none' };
    const stagingDiagnostics = authConfig.hudOrigin === 'https://jarvis-hud-staging.hlao-xiong.workers.dev' && globalThis.location?.origin === authConfig.hudOrigin;
    const updateOwnerAppsDiagnostic = ({ stage, state, status, category }) => {
      // These fields describe the last *failure*. A successful recovery must
      // not leave a prior revoked-session 401 displayed as current state.
      if (state === 'attempted' && stage === 'handoff-issuance') { ownerAppsDiagnostics.lastStatus = 'none'; ownerAppsDiagnostics.category = 'none'; }
      if ((state === 'failed' || state === 'provider-failure') && Number.isInteger(status)) ownerAppsDiagnostics.lastStatus = String(status);
      if ((state === 'failed' || state === 'provider-failure') && typeof category === 'string') ownerAppsDiagnostics.category = category;
      if (state === 'success' && stage === 'google-grant-status') { ownerAppsDiagnostics.lastStatus = 'none'; ownerAppsDiagnostics.category = 'none'; }
      if (stage === 'handoff-issuance') ownerAppsDiagnostics.handoffIssuance = state;
      if (stage === 'handoff-redemption') { ownerAppsDiagnostics.handoffRedemption = state; ownerAppsDiagnostics.session = state === 'success' ? 'active' : 'unavailable'; }
      if (stage === 'google-grant-status') ownerAppsDiagnostics.googleStatus = state === 'success' ? 'loaded' : state === 'failed' ? 'unavailable' : 'not-attempted';
    };
    const ownerApps = authConfig.workerUrl && relayConfig.workerOrigin ? createOwnerAppsClient({ authWorker: authConfig.workerUrl, appsWorker: relayConfig.workerOrigin, onDiagnostic: updateOwnerAppsDiagnostic }) : null;
    const ownerAppsState = { status: ownerApps ? 'Verifying your unlocked owner session…' : 'Google Apps owner authorization is not configured.', busy: false, ready: false, grantState: 'checking', selected: new Set(), connected: new Set(), disabled: new Set() };
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
    const GOOGLE_APP_SCREENS = Object.freeze({
      gmail: { grant: 'gmail', title: 'GMAIL', placeholder: 'Search or ask about email', initial: 'SHOW MY LATEST EMAILS', suggestions: ['SHOW MY LATEST EMAILS', 'FIND UNREAD EMAIL'] },
      calendar: { grant: 'google-calendar', title: 'CALENDAR', placeholder: 'Ask about your calendar', initial: "WHAT'S ON MY CALENDAR TODAY?", suggestions: ["WHAT'S ON MY CALENDAR TODAY?", "WHAT'S ON MY CALENDAR TOMORROW?", "WHAT'S ON MY CALENDAR NEXT WEEK?"] },
      contacts: { grant: 'google-contacts', title: 'CONTACTS', placeholder: 'Find a contact', initial: 'SHOW RECENT CONTACTS', suggestions: ['FIND A CONTACT', 'SHOW RECENT CONTACTS'] },
      drive: { grant: 'google-drive', title: 'DRIVE', placeholder: 'Find a file or folder', initial: 'FIND MY RECENT DRIVE FILES', suggestions: ['FIND MY RECENT DRIVE FILES', 'SHOW MY DRIVE FOLDERS'] },
      documents: { grant: 'google-docs', title: 'DOCS', placeholder: 'Find or read a document', initial: 'SHOW MY GOOGLE DOCS', suggestions: ['FIND MY RECENT GOOGLE DOCS', 'SHOW MY GOOGLE DOCUMENTS'] },
      sheets: { grant: 'google-sheets', title: 'SHEETS', placeholder: 'Find a spreadsheet', initial: 'SHOW MY GOOGLE SHEETS', suggestions: ['FIND MY RECENT SHEETS', 'SHOW MY GOOGLE SPREADSHEETS'] },
      tasks: { grant: 'google-tasks', title: 'TASKS', placeholder: 'Ask about tasks', initial: 'SHOW MY UNFINISHED TASKS', suggestions: ['SHOW MY UNFINISHED TASKS', 'SHOW MY COMPLETED TASKS'] },
    });
    const googleAppViews = Object.fromEntries(Object.keys(GOOGLE_APP_SCREENS).map((id) => [id, { busy: false, status: 'RESTORING PHONE-MANAGED CONNECTION…', result: '', initialized: false }]));
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
    const runGoogleAppCommand = async (appId, command) => {
      const screen = GOOGLE_APP_SCREENS[appId], view = googleAppViews[appId];
      if (!screen || !view || view.busy) return;
      const message = String(command || '').trim();
      if (!message || message.length > 1200) { view.status = 'ENTER A REQUEST OF 1 TO 1,200 CHARACTERS'; render(hud.snapshot()); return; }
      view.busy = true; view.result = ''; view.status = `READING AUTHORIZED ${screen.title}…`; render(hud.snapshot());
      try {
        if (!googleConnectors?.paired()) {
          view.status = `${screen.title} NEEDS PHONE APPROVAL · OPEN CONNECT APPS`;
          return;
        }
        if (!googleConnectors.apps.includes(screen.grant)) {
          view.status = `${screen.title} WAS NOT APPROVED FOR THIS DEVICE`;
          return;
        }
        view.result = String(await googleConnectors.runCommand(message) || 'No matching information was found.');
        view.status = `${screen.title} · READ-ONLY · COMPLETE`;
      } catch (error) {
        view.status = `${screen.title} COULD NOT BE READ · TRY AGAIN`;
      } finally { view.busy = false; render(hud.snapshot()); }
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
      if (state.screen === 'media-apps') {
        outlet.append(make('p', 'eyebrow', 'JARVIS APPS'), make('h1', 'detail-title', 'MEDIA'));
        outlet.append(make('p', 'copy media-launcher-help', 'Use the Band or thumb controls to select an app. Connections, permissions, and account changes happen only in the JARVIS phone app.'));
        const grid = make('div', 'media-app-grid', ''); grid.setAttribute('aria-label', 'JARVIS app launcher');
        MEDIA_APPS.forEach((app, index) => {
          const tile = make('button', `media-app-tile${app.experience === 'status' ? ' unavailable' : ''}`, '');
          tile.type = 'button'; tile.setAttribute('aria-current', String(!state.mediaBackFocused && index === state.mediaSelected));
          tile.dataset.mediaApp = app.id;
          tile.append(make('strong', '', app.title), make('small', '', app.status));
          tile.addEventListener('click', () => { hud.chooseMedia(index); hud.select(); });
          grid.append(tile);
          if (!state.mediaBackFocused && index === state.mediaSelected) queueMicrotask(() => tile.focus());
        });
        const status = make('p', 'status media-phone-status', 'OWNER CONNECTIONS RESTORE AFTER JARVIS UNLOCK'); status.setAttribute('role', 'status');
        const backButton = make('button', 'action', 'BACK TO JARVIS MENU'); backButton.type = 'button'; backButton.setAttribute('aria-current', String(state.mediaBackFocused)); backButton.addEventListener('click', () => hud.back()); if (state.mediaBackFocused) queueMicrotask(() => backButton.focus());
        outlet.append(grid, status, backButton); return;
      }
      if (state.screen === 'media-status') {
        const app = MEDIA_APPS.find((candidate) => candidate.id === state.mediaAppId) || { title: 'JARVIS APP', status: 'UNAVAILABLE' };
        outlet.append(make('p', 'eyebrow', 'JARVIS APPS'), make('h1', 'detail-title', app.title), make('span', 'unavailable-label', app.status), make('p', 'copy', 'This app does not have an owner-scoped glasses experience yet. Do not enter provider credentials on glasses. If this service needs an account, connect or review it in the JARVIS phone app.'));
        const backButton = make('button', 'action', 'BACK TO MEDIA'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      if (state.screen === 'google-app') {
        const app = GOOGLE_APP_SCREENS[state.mediaAppId], view = googleAppViews[state.mediaAppId];
        if (!app || !view) { hud.back(); return; }
        if (!view.initialized) { view.initialized = true; queueMicrotask(() => { void runGoogleAppCommand(state.mediaAppId, app.initial); }); }
        outlet.append(make('p', 'eyebrow', 'JARVIS APPS'), make('h1', 'detail-title', app.title));
        const status = make('p', 'status', view.status); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); outlet.append(status);
        const form = document.createElement('form'); form.className = 'hud-youtube-search';
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 1200; input.placeholder = app.placeholder; input.setAttribute('aria-label', `${app.title} request`); input.dataset.appFocus = 'true'; input.disabled = view.busy;
        const submit = make('button', 'action hud-youtube-search-button', 'READ'); submit.type = 'submit'; submit.dataset.appFocus = 'true'; submit.disabled = view.busy;
        form.addEventListener('submit', (event) => { event.preventDefault(); void runGoogleAppCommand(state.mediaAppId, input.value); }); form.append(input, submit); outlet.append(form);
        const suggestions = make('div', 'hud-youtube-nav', ''); suggestions.setAttribute('aria-label', `${app.title} suggestions`);
        app.suggestions.forEach((suggestion) => { const button = make('button', 'action hud-youtube-tab', suggestion); button.type = 'button'; button.dataset.appFocus = 'true'; button.disabled = view.busy; button.addEventListener('click', () => { void runGoogleAppCommand(state.mediaAppId, suggestion); }); suggestions.append(button); }); outlet.append(suggestions);
        if (view.result) {
          const result = make('pre', 'copy', view.result); result.setAttribute('aria-label', `${app.title} read-only result`); outlet.append(result);
          const numbered = [...view.result.matchAll(/^\s*(\d{1,2})\.\s+.+$/gm)].map((match) => Number(match[1])).filter((number, index, values) => number >= 1 && number <= 10 && values.indexOf(number) === index);
          const selectCommand = { gmail: (n) => `READ EMAIL ${n}`, calendar: (n) => `SHOW CALENDAR EVENT ${n}`, contacts: (n) => `SHOW CONTACT ${n}`, drive: (n) => `OPEN FILE ${n}`, documents: (n) => `READ DOCUMENT ${n}`, sheets: (n) => `READ SHEET ${n}`, tasks: (n) => `SHOW TASK ${n}` }[state.mediaAppId];
          if (selectCommand && numbered.length) { const choices = make('div', 'hud-youtube-nav', ''); choices.setAttribute('aria-label', `${app.title} result selection`); numbered.forEach((number) => { const button = make('button', 'action hud-youtube-tab', `OPEN ${number}`); button.type = 'button'; button.dataset.appFocus = 'true'; button.disabled = view.busy; button.addEventListener('click', () => { void runGoogleAppCommand(state.mediaAppId, selectCommand(number)); }); choices.append(button); }); outlet.append(choices); }
        }
        outlet.append(make('p', 'copy hud-youtube-help', 'READ-ONLY · CONNECTIONS AND ACCOUNT MANAGEMENT STAY IN THE JARVIS PHONE APP'));
        const backButton = make('button', 'action', 'BACK TO MEDIA'); backButton.type = 'button'; backButton.dataset.appFocus = 'true'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      if (state.screen === 'chat') {
        outlet.append(make('p', 'eyebrow', 'JARVIS AI'), make('h1', 'detail-title', 'AI CHAT'));
        const status = make('p', 'status', chatStatus);
        const log = make('div', 'chat-log', ''); log.tabIndex = 0; log.setAttribute('aria-label', 'Current unlocked chat transcript'); visibleTranscript.entries(visibleConversation).forEach(({ role, text, kind }) => log.append(make('p', `chat-message ${role}`, `${role === 'user' ? 'YOU' : kind === 'google' ? 'GOOGLE APPS' : 'JARVIS'}: ${text}`))); if (pendingChatMessage) log.append(make('p', 'chat-message user pending', `YOU: ${pendingChatMessage}`)); log.addEventListener('scroll', () => { chatScrollPositions[visibleConversation] = log.scrollTop; }); outlet.append(status, log); queueMicrotask(() => { log.scrollTop = chatScrollPositions[visibleConversation] || 0; });
        const prompt = document.createElement('input'); prompt.type = 'text'; prompt.placeholder = 'ASK JARVIS'; prompt.maxLength = 1000; prompt.value = retryChatMessage; prompt.setAttribute('aria-label', 'Message for JARVIS');
        const send = make('button', 'action', 'SEND'); send.type = 'button'; send.disabled = chatBusy || (!stagingChat?.ready && !chatAuthorization);
        send.addEventListener('click', async () => {
          const evaluation = send.dataset.evaluation === 'granite'; delete send.dataset.evaluation;
          const pendingMessage = prompt.value.trim(); if (!pendingMessage || chatBusy) return;
          const requestGeneration = ++chatRequestGeneration;
          const currentRequest = () => requestGeneration === chatRequestGeneration;
          const clearChatTransport = () => { lastChatTransport = { category: 'none', status: null }; };
          const rememberChatTransport = (error) => { const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null; const category = ['network', 'capability-rejected', 'origin-denied', 'capability-replayed', 'relay-unavailable', 'request-rejected', 'invalid-response'].includes(error?.category) ? error.category : 'unknown'; lastChatTransport = { category, status }; };
          const statusCheck = !evaluation && (isGoogleStatusRequest(pendingMessage) || (lastGoogleStatusCheck && isGoogleStatusFollowUp(pendingMessage)));
          if (!statusCheck && !stagingChat?.ready && chatAuthorization) {
            chatBusy = true; chatStatus = 'CONNECTING - RESTORING OWNER SESSION'; render(hud.snapshot());
            const restored = await chatAuthorization.ensureReady(); stagingChat = chatAuthorization.client; chatBusy = false;
            if (!restored || !stagingChat?.ready) { render(hud.snapshot()); return; }
          }
          if (!statusCheck && !stagingChat?.ready) { chatStatus = 'DISCONNECTED · COMPLETE COMPANION UNLOCK TO CONNECT'; render(hud.snapshot()); return; }
          const message = pendingMessage; const conversation = evaluation ? 'granite' : 'glm';
          // Never send a Connected Apps result to the AI provider as history.
          const history = boundedModelHistory([...conversations[conversation].filter((item) => item.kind !== 'google'), ...conversationMemory.safeModelContext()]); visibleConversation = conversation; chatBusy = true; pendingChatMessage = message; retryChatMessage = ''; prompt.value = ''; const startedAt = Date.now();
          const directGoogleApp = googleAppHint(message);
          const retryGoogleOperation = !evaluation && isGoogleRetryRequest(message) && usableGoogleRetry(lastGoogleOperation) ? lastGoogleOperation : null;
          const gmailContextFollowUp = lastGoogleApp === 'gmail' && (isGoogleFollowUp(message) || matchesRecentGmailSubject(message, lastGmailSubjects));
          const useGoogleApps = !evaluation && !statusCheck && (isGoogleReadRequest(message) || Boolean(retryGoogleOperation) || Boolean(lastGoogleApp && isGoogleFollowUp(message)) || gmailContextFollowUp);
          const googleMessage = retryGoogleOperation ? retryGoogleOperation.message : directGoogleApp ? message : lastGoogleApp ? `${message} ${lastGoogleApp}` : message;
          let activeGoogleOperation = retryGoogleOperation || (useGoogleApps && directGoogleApp ? { message, app: directGoogleApp, createdAt: Date.now() } : null);
          if (statusCheck) chatStatus = 'CHECKING AUTHORIZED GOOGLE APPS…';
          else if (useGoogleApps) chatStatus = googleConnectors?.paired() ? 'READING AUTHORIZED GOOGLE APPS…' : 'GOOGLE APPS APPROVAL REQUIRED · OPEN CONNECT APPS';
          else chatStatus = evaluation ? 'TESTING GRANITE · JARVIS IS THINKING…' : 'SENDING GLM · JARVIS IS THINKING…'; render(hud.snapshot());
          try {
            if (!evaluation && (isConversationRecapRequest(message) || (conversationMemory.size && isConversationTimelineFollowUp(message)))) {
              const reply = conversationMemory.recap(); appendConversation('glm', { role: 'user', text: message, kind: 'recap' }, { role: 'assistant', text: reply, kind: 'recap' });
              clearChatTransport(); chatStatus = `SESSION RECAP · ${Date.now() - startedAt} MS`;
            } else if (statusCheck) {
              const reply = googleConnectors?.paired() ? String(await googleConnectors.runCommand('__JARVIS_GOOGLE_CONNECTIVITY_TEST_V1__')) : 'Google Apps needs phone approval for this glasses session. Open Connect Apps, then approve the short-lived read-only device request on your phone.';
              appendConversation('glm', { role: 'user', text: message, kind: 'google' }, { role: 'assistant', text: reply, kind: 'google' });
              conversationMemory.recordGoogle(directGoogleApp || 'apps', googleConnectors?.paired() ? 'completed' : 'requested');
              lastGoogleStatusCheck = true;
              clearChatTransport(); chatStatus = `GOOGLE APPS STATUS · ${Date.now() - startedAt} MS`;
            } else if (useGoogleApps) {
              // Provider login and grant management remain phone-only. The
              // glasses use an already approved, short-lived device capability.
              const googleResult = googleConnectors?.paired() ? await googleConnectors.runCommand(googleMessage) : 'Connect Google Apps from the JARVIS menu, then approve this glasses session on your phone before asking that read-only request.';
              const reply = googleResult?.analysis && stagingChat?.analyzeDocument ? await stagingChat.analyzeDocument(googleResult.analysis.instruction, googleResult.analysis.text) : (typeof googleResult === 'string' ? googleResult : googleResult.content);
              appendConversation('glm', { role: 'user', text: message, kind: 'google' }, { role: 'assistant', text: reply, kind: 'google' });
              if (directGoogleApp) lastGoogleApp = directGoogleApp;
              const routing = googleResult?.routing;
              if (routing?.app === 'gmail' && Array.isArray(routing.subjects) && routing.subjects.length <= 10 && routing.subjects.every((subject) => typeof subject === 'string' && subject.length <= 180)) lastGmailSubjects = routing.subjects;
              const resultStatus = typeof googleResult === 'string' ? 'completed' : String(googleResult?.status || 'completed');
              lastGoogleOperation = resultStatus === 'temporary_error' && activeGoogleOperation ? activeGoogleOperation : null;
              conversationMemory.recordGoogle(directGoogleApp || lastGoogleApp, googleResult?.analysis ? 'completed' : typeof googleResult === 'string' ? 'completed' : googleResult?.status);
              clearChatTransport(); chatStatus = googleConnectors?.paired() ? `GOOGLE APPS · READ-ONLY · ${Date.now() - startedAt} MS` : 'GOOGLE APPS NOT CONNECTED · NO GOOGLE REQUEST WAS SENT';
            } else {
              const reply = await stagingChat.send(message, history, { evaluation }); appendConversation(conversation, { role: 'user', text: message }, { role: 'assistant', text: reply }); conversationMemory.recordChat(message, reply, conversation); clearChatTransport(); chatStatus = evaluation ? `GRANITE 4.0 H MICRO · ${Date.now() - startedAt} MS · RETURN TO GLM` : `GLM-4.7-FLASH · ${Date.now() - startedAt} MS`;
            }
          }
          catch (error) {
            if (!currentRequest()) return;
            rememberChatTransport(error);
            if (activeGoogleOperation && error?.status !== 401 && error?.status !== 409) lastGoogleOperation = activeGoogleOperation;
            if (error?.status === 401 || error?.status === 409) { conversations.glm = []; conversations.granite = []; visibleTranscript.clear(); chatScrollPositions.glm = 0; chatScrollPositions.granite = 0; conversationMemory.clear(); lastGoogleApp = ''; lastGmailSubjects = []; lastGoogleOperation = null; lastGoogleStatusCheck = false; }
            if (error?.code === 'AI_EVALUATION_LIMIT') chatStatus = 'GRANITE LIMIT REACHED · NO ADDITIONAL GRANITE RESPONSE WAS RUN';
            else if (error?.code === 'AI_USER_HOURLY_LIMIT') chatStatus = "JARVIS HOURLY AI LIMIT REACHED · TRY AGAIN AFTER THE NEXT UTC HOUR";
            else if (error?.code === 'AI_USER_DAILY_LIMIT' || error?.code === 'AI_USER_BUDGET_EXHAUSTED') chatStatus = "JARVIS DAILY AI LIMIT REACHED · TRY AGAIN AFTER THE UTC DAILY RESET";
            else if (error?.code === 'AI_ACCOUNT_BUDGET_EXHAUSTED') chatStatus = "JARVIS SHARED FREE AI BUDGET IS RESERVED · TRY AGAIN AFTER THE UTC DAILY RESET";
            else if (error?.code === 'AI_QUOTA_EXHAUSTED') chatStatus = "CLOUDFLARE AI FREE ALLOWANCE IS EXHAUSTED · TRY AGAIN AFTER THE UTC DAILY RESET";
            else if (error?.code === 'AI_CAPACITY') chatStatus = 'CLOUDFLARE AI IS TEMPORARILY BUSY · RETRY ONCE IN A MOMENT';
            else if (error?.code === 'AI_TIMEOUT') chatStatus = 'ERROR · AI RESPONSE TIMED OUT · RETRY ONCE';
            else if (error?.code === 'AI_REQUEST_REJECTED' || error?.code === 'AI_EXECUTION_FAILED' || error?.code === 'AI_RESPONSE_INVALID' || error?.code === 'REPLY_PERSIST_FAILED') chatStatus = 'AI RESPONSE COULD NOT BE COMPLETED · RETRY ONCE';
            else if (error?.code === 'AI_LOCAL_QUOTA_EXHAUSTED') chatStatus = "JARVIS AI LIMIT REACHED · TRY AGAIN LATER";
            else if (error?.status === 503 && /not enabled/i.test(error.message || '')) chatStatus = 'AI DISABLED · OWNER AUTHORIZATION REQUIRED';
            else if (error?.status === 401 || error?.status === 409) chatStatus = 'DISCONNECTED · COMPLETE COMPANION UNLOCK AGAIN';
            else if (error?.status === 403 || error?.category === 'origin-denied') chatStatus = 'CHAT REQUEST DENIED BY STAGING POLICY · RELOAD, THEN RETRY';
            else chatStatus = statusCheck ? 'GOOGLE APPS STATUS COULD NOT BE VERIFIED · UNLOCK OR RECONNECT, THEN RETRY' : useGoogleApps ? 'GOOGLE APPS READ COULD NOT BE COMPLETED · RETRY WHEN READY' : /conversation context is (?:invalid|too large)/i.test(error?.message || '') ? 'CHAT CONTEXT WAS RESET SAFELY · RETRY YOUR MESSAGE' : /chat expired|could not reach authenticated staging chat/i.test(error?.message || '') ? 'CHAT CONNECTION EXPIRED OR UNAVAILABLE · UNLOCK OR RETRY' : error?.message?.includes('timed out') ? 'ERROR · AI RESPONSE TIMED OUT · RETRY ONCE' : error?.category === 'invalid-response' ? 'CHAT RESPONSE WAS INVALID · RETRY ONCE' : 'ERROR · AUTHENTICATED CHAT IS TEMPORARILY UNAVAILABLE';
            retryChatMessage = message;
          } finally { if (currentRequest()) { pendingChatMessage = ''; chatBusy = false; render(hud.snapshot()); } }
        });
        const granite = make('button', 'action', 'TEST GRANITE · 2 REQUEST MAX'); granite.type = 'button'; granite.disabled = !stagingChat?.ready || chatBusy; granite.hidden = !stagingChat?.ready; granite.addEventListener('click', () => { send.dataset.evaluation = 'granite'; send.click(); });
        const returnToGlm = make('button', 'action', 'RETURN TO GLM'); returnToGlm.type = 'button'; returnToGlm.disabled = chatBusy; returnToGlm.addEventListener('click', () => { visibleConversation = 'glm'; chatStatus = stagingChat?.ready ? 'GLM-4.7-FLASH · CONNECTED · AUTHORIZED STAGING CHAT' : chatStatus; render(hud.snapshot()); });
        outlet.append(prompt, send, granite, returnToGlm, make('p', 'copy', 'GLM and Granite keep separate in-memory conversation histories. TEST GRANITE is owner-only, uses a fixed server model, and never accepts model selection.'));
        const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      if (state.screen === 'connect-apps') {
        // The phone hub owns provider login, scopes, reconnection, and
        // disconnect.  Keep this HUD on the device-capability path below.
        if (false && ownerApps) {
          const names = { gmail: 'Gmail', 'google-calendar': 'Google Calendar', 'google-contacts': 'Google Contacts', 'google-drive': 'Google Drive', 'google-docs': 'Google Docs', 'google-sheets': 'Google Sheets', 'google-tasks': 'Google Tasks' };
          const status = make('p', 'status', ownerAppsState.status); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
          outlet.append(make('h1', '', 'CONNECT APPS'), status, make('p', 'copy', 'Select the Google Apps JARVIS may access. Existing connections remain active unless you explicitly revoke them elsewhere.'));
          if (stagingDiagnostics) {
            const build = document.querySelector?.('[data-hud-build-version]')?.dataset?.buildId || 'unknown';
            const safeLines = () => [
              `HUD authentication: ${ownerAppsDiagnostics.hud}`,
              `Handoff issuance: ${ownerAppsDiagnostics.handoffIssuance}`,
              `Handoff redemption: ${ownerAppsDiagnostics.handoffRedemption}`,
              `Connected Apps session: ${ownerAppsDiagnostics.session}`,
              `Google authorization status: ${ownerAppsDiagnostics.googleStatus}`,
              `AI Chat transport: ${lastChatTransport.category}${lastChatTransport.status ? ` · HTTP ${lastChatTransport.status}` : ''}`,
              `Last failing HTTP status: ${ownerAppsDiagnostics.lastStatus}`,
              `Sanitized error category: ${ownerAppsDiagnostics.category}`,
              `HUD build: ${build}`,
            ];
            const diagnostics = make('p', 'copy', safeLines().join('\n')); diagnostics.setAttribute('aria-label', 'Safe staging authorization diagnostics'); outlet.append(diagnostics);
            const copy = make('button', 'action', 'COPY SAFE DIAGNOSTICS'); copy.type = 'button'; copy.dataset.connectorsFocus = 'true'; bindConnectAppsAction(copy, async () => { const report = `JARVIS CONNECT APPS STAGING DIAGNOSTICS\n${safeLines().join('\n')}`; try { await globalThis.navigator?.clipboard?.writeText(report); ownerAppsState.status = 'Safe diagnostics copied.'; } catch { ownerAppsState.status = 'Safe diagnostics could not be copied in this browser.'; } render(hud.snapshot()); }); outlet.append(copy);
          }
          const list = document.createElement('div'); list.className = 'hud-app-selection';
          const appStateLabel = (id) => ownerAppsState.disabled.has(id) ? 'DISABLED IN JARVIS' : ownerAppsState.connected.has(id) ? 'CONNECTED' : ownerAppsState.grantState === 'checking' ? 'CHECKING CONNECTION' : ownerAppsState.grantState === 'unavailable' ? 'UNABLE TO VERIFY' : ownerAppsState.grantState === 'reconnect-required' ? 'RECONNECT REQUIRED' : 'AUTHORIZATION NEEDED';
          Object.entries(names).forEach(([id, name]) => { const label = document.createElement('label'); label.className = 'copy hud-app-choice'; const box = document.createElement('input'); box.type = 'checkbox'; box.checked = ownerAppsState.selected.has(id); box.disabled = ownerAppsState.busy; box.dataset.connectorsFocus = 'true'; box.setAttribute('aria-label', `${name} selection`); box.addEventListener('change', () => { if (box.checked) ownerAppsState.selected.add(id); else ownerAppsState.selected.delete(id); render(hud.snapshot()); }); label.append(box, document.createTextNode(` ${name} · ${appStateLabel(id)}`)); list.append(label); }); outlet.append(list);
          const selectAll = make('button', 'action', 'SELECT ALL'); selectAll.type = 'button'; selectAll.disabled = ownerAppsState.busy; selectAll.dataset.connectorsFocus = 'true'; bindConnectAppsAction(selectAll, () => { ownerAppsState.selected = new Set(Object.keys(names)); render(hud.snapshot()); });
          const clear = make('button', 'action', 'CLEAR SELECTION'); clear.type = 'button'; clear.disabled = ownerAppsState.busy; clear.dataset.connectorsFocus = 'true'; bindConnectAppsAction(clear, () => { ownerAppsState.selected.clear(); render(hud.snapshot()); });
          const connect = make('button', 'action', ownerAppsState.busy ? 'PLEASE WAIT' : 'CONNECT SELECTED APPS'); connect.type = 'button'; connect.disabled = ownerAppsState.busy || !ownerAppsState.selected.size; connect.dataset.connectorsFocus = 'true'; bindConnectAppsAction(connect, () => { if (!ownerAppsState.ready) { void authorizeOwnerApps(); return; } void (async () => { const selected = [...ownerAppsState.selected], disabled = selected.filter((app) => ownerAppsState.disabled.has(app)); const needed = selected.filter((app) => !ownerAppsState.connected.has(app)); ownerAppsState.busy = true; try { if (disabled.length) { const result = await ownerApps.access('enable', disabled); ownerAppsState.disabled = new Set(result.disabledApps || []); } if (!needed.length) { ownerAppsState.status = disabled.length ? 'Selected Google Apps were re-enabled in JARVIS.' : 'Selected Google Apps are already connected.'; ownerAppsState.selected.clear(); return; } ownerAppsState.status = 'Requesting Google permission for selected apps…'; render(hud.snapshot()); const result = await ownerApps.connect(needed); if (typeof result.authorizationUrl === 'string') globalThis.location.assign(result.authorizationUrl); else throw new Error('Google authorization could not start.'); } catch (error) { ownerAppsState.status = error?.status === 401 ? 'Your owner session expired. Unlock JARVIS again.' : 'Could not update selected Google Apps.'; } finally { ownerAppsState.busy = false; render(hud.snapshot()); } })(); });
          const disconnect = make('button', 'action', 'DISCONNECT SELECTED APPS'); disconnect.type = 'button'; disconnect.disabled = ownerAppsState.busy || !ownerAppsState.selected.size; disconnect.dataset.connectorsFocus = 'true'; bindConnectAppsAction(disconnect, () => { if (!ownerAppsState.ready) { void authorizeOwnerApps(); return; } const apps = [...ownerAppsState.selected].filter((app) => ownerAppsState.connected.has(app) && !ownerAppsState.disabled.has(app)); if (!apps.length) { ownerAppsState.status = 'No selected connected Google Apps can be disconnected.'; render(hud.snapshot()); return; } const labels = apps.map((app) => names[app]).join(', '); if (!globalThis.confirm?.(`Disconnect ${labels} from JARVIS? Google account permission is not revoked; only JARVIS access to these apps will be disabled.`)) return; void (async () => { ownerAppsState.busy = true; ownerAppsState.status = 'Disabling selected Google Apps in JARVIS…'; render(hud.snapshot()); try { const result = await ownerApps.access('disable', apps); ownerAppsState.disabled = new Set(result.disabledApps || []); ownerAppsState.selected.clear(); ownerAppsState.status = 'Selected Google Apps are disabled in JARVIS. Google account permission remains unchanged.'; } catch (error) { ownerAppsState.status = error?.status === 401 ? 'Your owner session expired. Unlock JARVIS again.' : 'Could not disconnect selected Google Apps.'; } finally { ownerAppsState.busy = false; render(hud.snapshot()); } })(); });
          outlet.append(selectAll, clear, connect, disconnect);
          if (!ownerAppsState.ready) { const retry = make('button', 'action', ownerAppsState.busy ? 'AUTHORIZING…' : 'RETRY AUTHORIZATION'); retry.type = 'button'; retry.disabled = ownerAppsState.busy; retry.dataset.connectorsFocus = 'true'; bindConnectAppsAction(retry, () => { void authorizeOwnerApps(); }); outlet.append(retry); }
          const back = make('button', 'action', 'BACK TO JARVIS'); back.type = 'button'; back.dataset.connectorsFocus = 'true'; back.addEventListener('click', () => hud.back()); outlet.append(back); return;
        }
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
          const testAll = make('button', 'action', googleConnectorState.busy ? 'TESTING GOOGLE APPS…' : 'TEST ALL GOOGLE APPS'); testAll.type = 'button'; testAll.disabled = googleConnectorState.busy; testAll.dataset.connectorsFocus = 'true'; bindConnectAppsAction(testAll, () => { void googleAppsActions.testAllApps(); }); outlet.append(testAll, make('p', 'copy', 'Runs minimal read-only checks. Only PASS, FAIL, or NO DATA is shown; no Google content is displayed.'));
          const form=document.createElement('form');form.className='hud-youtube-search';const input=document.createElement('input');input.type='text';input.maxLength=1200;input.placeholder='Ask about Gmail, Calendar, Contacts, Drive, Docs, Sheets, or Tasks';input.setAttribute('aria-label','Google Apps command');input.dataset.connectorsFocus='true';input.dataset.googleCommand='true';const run=make('button','action','ASK JARVIS');run.type='submit';run.dataset.connectorsFocus='true';run.disabled=googleConnectorState.busy;form.addEventListener('submit',event=>{event.preventDefault();const command=input.value.trim();if(!command||googleConnectorState.busy)return;googleConnectorState.restoreCommandFocus=true;void googleAppsActions.runCommand(command);});form.append(input,run);outlet.append(form);if(googleConnectorState.restoreCommandFocus){googleConnectorState.restoreCommandFocus=false;queueMicrotask(()=>input.focus?.());}if(googleConnectorState.result){const result=make('pre','copy',googleConnectorState.result);result.setAttribute('aria-label','Google Apps response');outlet.append(result);}const reconnect=make('button','action','CLEAR SESSION');reconnect.type='button';reconnect.dataset.connectorsFocus='true';bindConnectAppsAction(reconnect,()=>googleAppsActions.clear());outlet.append(reconnect);
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
        const accountControl = make('button', 'hud-youtube-account-control', !youtubeState.sessionReady ? 'CHECKING' : requiresReauth ? 'PHONE REQUIRED' : connected ? 'CONNECTED' : 'PHONE REQUIRED');
        accountControl.type = 'button'; accountControl.dataset.youtubeFocus = 'true'; accountControl.disabled = !connected;
        accountControl.setAttribute('aria-label', requiresReauth ? 'YouTube needs phone reauthorization' : connected ? 'Connected YouTube account' : 'YouTube account not connected');
        accountControl.addEventListener('click', () => { if (connected) void loadYoutubeSection(youtubeState.section === 'account' ? 'subscriptions' : 'account'); });
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
          outlet.append(make('p', 'copy hud-youtube-help', 'YouTube needs reconnection. Open the JARVIS phone app to reconnect or disconnect the account. Provider sign-in is not available on glasses.'));
        } else if (!youtube.paired()) {
          outlet.append(make('p', 'copy hud-youtube-help', 'YouTube is not available for this owner session. Check its connection in the JARVIS phone app.'));
        } else {
          if (youtubeState.section === 'account') {
            const accountCard = make('section', 'hud-youtube-account-card', '');
            accountCard.append(make('strong', '', `Connected account: ${youtubeState.account?.email || 'Google account'}`), make('p', 'copy', 'Google tokens remain on the JARVIS YouTube Worker. Revoke access or disconnect from the phone account page.'));
            const history = make('button', 'action hud-youtube-account-action', 'JARVIS HISTORY'); history.type = 'button'; history.dataset.youtubeFocus = 'true'; history.addEventListener('click', () => void loadYoutubeSection('history'));
            const favorites = make('button', 'action hud-youtube-account-action', 'FAVORITES'); favorites.type = 'button'; favorites.dataset.youtubeFocus = 'true'; favorites.addEventListener('click', () => void loadYoutubeSection('favorites'));
            accountCard.append(history, favorites); outlet.append(accountCard);
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
    document.addEventListener?.('jarvis-session-locked', () => {
      chatRequestGeneration += 1; chatBusy = false; lastChatTransport = { category: 'none', status: null }; conversations.glm = []; conversations.granite = []; visibleTranscript.clear(); chatScrollPositions.glm = 0; chatScrollPositions.granite = 0; conversationMemory.clear(); pendingChatMessage = ''; retryChatMessage = ''; lastGoogleApp = ''; lastGmailSubjects = []; lastGoogleOperation = null; lastGoogleStatusCheck = false; visibleConversation = 'glm';
    });
    const googleAppsActions = createGoogleAppsActions({ state: googleConnectorState, connector: googleConnectors, hud, render });
    const authorizeOwnerApps = async () => {
      if (!ownerApps || ownerAppsState.busy) return;
      ownerAppsState.busy = true; ownerAppsState.ready = false; ownerAppsState.grantState = 'checking'; ownerAppsState.status = 'Verifying your unlocked owner session…'; render(hud.snapshot());
      try { await ownerApps.authorize(); const grant = await ownerApps.status(); ownerAppsDiagnostics.hud = 'active'; ownerAppsState.connected = new Set(grant.apps || []); ownerAppsState.disabled = new Set(grant.disabledApps || []); ownerAppsState.grantState = grant.reconnectRequired === true ? 'reconnect-required' : grant.connected ? 'verified' : 'missing'; ownerAppsState.status = grant.reconnectRequired === true ? 'Google Apps needs reconnection in the phone app.' : grant.connected ? 'Phone-managed Google Apps connection restored.' : 'Google Apps is not connected for this owner.'; ownerAppsState.ready = true; }
      catch (error) { ownerAppsState.grantState = 'unavailable'; ownerAppsDiagnostics.hud = error?.status === 401 ? 'unavailable' : ownerAppsDiagnostics.hud; ownerAppsState.status = error?.status === 401 ? 'Unlock JARVIS with your iPhone to restore phone-managed apps.' : 'Phone-managed app access is temporarily unavailable.'; }
      finally { ownerAppsState.busy = false; if (hud) render(hud.snapshot()); }
    };
    // A fresh unlock is the sole glasses authorization event. The exchange
    // creates only an HttpOnly owner session for allowed read-only commands.
    if (false && ownerApps) void authorizeOwnerApps();
    // A LOCK invalidates the Auth session that backs the Connected Apps
    // cookie. Once Face ID creates a new Auth session, exchange a fresh
    // one-time handoff and reload the existing encrypted Google grant. This
    // never renews or reconnects OAuth by itself.
    document.addEventListener?.('jarvis-session-locked', () => {
      ownerAppsState.ready = false; ownerAppsState.grantState = 'checking'; ownerAppsState.connected = new Set(); ownerAppsState.disabled = new Set(); ownerAppsState.status = 'Owner session locked. Unlock again to restore Connected Apps.';
      ownerAppsDiagnostics.session = 'unavailable'; ownerAppsDiagnostics.googleStatus = 'not-attempted'; ownerAppsDiagnostics.lastStatus = 'none'; ownerAppsDiagnostics.category = 'none';
    });
    document.addEventListener?.('jarvis-session-unlocked', () => { if (false && ownerApps) void authorizeOwnerApps(); });
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
    const handleHudKeydown = (event) => {
      const key = navigationKey(event);
      if (handleUpdateControlsKey(event, document)) return;
      if (handleConnectAppsKey(event, { hud, outlet, document })) return;
      if (handleAppScreenKey(event, { hud, outlet, document })) return;
      if (hud.snapshot().screen === 'youtube') {
        if (key === 'Escape' || key === 'Backspace') { event.preventDefault(); if (youtubeState.current) { leaveYoutubePlayer(); render(hud.snapshot()); } else hud.back(); return; }
        if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
          event.preventDefault();
          const controls = [...outlet.querySelectorAll('[data-youtube-focus]:not(:disabled)')];
          if (!controls.length) return;
          const current = controls.indexOf(document.activeElement);
          const direction = ['ArrowUp', 'ArrowLeft'].includes(key) ? -1 : 1;
          controls[(current + direction + controls.length) % controls.length].focus(); return;
        }
        if ((key === 'Enter' || key === ' ') && document.activeElement?.matches?.('[data-youtube-focus]:not(input)')) { event.preventDefault(); document.activeElement.click(); return; }
      }
      if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName) && key !== 'Escape') return;
      hud.handleKey(event);
    };
    bindHudKeyboard(globalThis.addEventListener ? globalThis : document, handleHudKeydown);
    globalThis.addEventListener?.('popstate', () => { if (youtubeState.current) leaveYoutubePlayer(); hud.back(); });
    hud.render();
    void restoreYoutubeSession().catch(() => { youtubeState.sessionReady = true; youtubeState.sessionVerified = false; youtubeState.status = 'Could not verify the saved YouTube session. Check the connection and retry.'; render(hud.snapshot()); });
    return hud;
  }

  function shouldWaitForSession(authConfig, sessionState) { return authConfig?.enabled === true && sessionState !== 'unlocked'; }
  // Kept only in memory for the life of this document. This listener exists
  // before the separate unlock event can cause HUD boot.
  globalThis.JARVIS_STAGING_CHAT_AUTHORIZATION = createStagingChatAuthorization();
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    registerHudUpdates(globalThis.navigator, globalThis, document);
    if (shouldWaitForSession(globalThis.JARVIS_AUTH_CONFIG, document.body?.dataset?.jarvisSession)) {
      document.addEventListener('jarvis-session-unlocked', () => boot(document), { once: true });
      return;
    }
    boot(document);
  }, { once: true });
  return { MENU, MEDIA_APPS, createHud, createRequestGate, createYouTubeClient, normalizeBackendOrigin, navigationKey, bindHudKeyboard, isGoogleReadRequest, isGoogleStatusRequest, isGoogleStatusFollowUp, isGoogleRetryRequest, usableGoogleRetry, googleStatusReply, googleAppHint, isGoogleFollowUp, matchesRecentGmailSubject, isConversationRecapRequest, isConversationTimelineFollowUp, createConversationMemory, boundedModelHistory, createVisibleTranscript, registerHudUpdates, handleUpdateControlsKey, shouldWaitForSession, handleConnectAppsKey, handleAppScreenKey, createGoogleAppsActions, createOwnerAppsClient, bindConnectAppsAction, createStagingChatAuthorization, boot };
}));
