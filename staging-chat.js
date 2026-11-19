/* Staging-only authenticated Cloudflare AI transport. No model or backend secret is shipped here. */
(function exposeStagingChat(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JARVIS_STAGING_CHAT = api;
})(globalThis, function stagingChatFactory(root) {
  'use strict';
  const RELAY = 'https://jarvis-staging-chat-relay.hlao-xiong.workers.dev';
  const capabilityPattern = /^[A-Za-z0-9_-]{43}$/;
  const requestPattern = /^[A-Za-z0-9_-]{24}$/;
  const assertionPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const safeText = (value, limit = 2000) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit);
  const validRelay = (value) => String(value || '') === RELAY;
  const transportCategory = (status) => status === 401 ? 'capability-rejected' : status === 403 ? 'origin-denied' : status === 409 ? 'capability-replayed' : status >= 500 ? 'relay-unavailable' : 'request-rejected';

  function createClient({ relayUrl, fetchImpl = root.fetch, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    if (!validRelay(relayUrl)) throw new Error('Authenticated staging chat is not configured.');
    let capability = '', expiresAt = 0, sending = false, authorizationGeneration = 0;
    const clear = () => { authorizationGeneration += 1; capability = ''; expiresAt = 0; };
    const request = async (path, { method = 'POST', body, authenticated = false } = {}) => {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (authenticated) headers.Authorization = `Bearer ${capability}`;
      let response;
      try { response = await fetchImpl(`${relayUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
      catch { const error = new Error('JARVIS could not reach authenticated staging chat.'); error.category = 'network'; throw error; }
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 || response.status === 409) clear();
        const error = new Error(safeText(data?.error, 240) || 'Authenticated staging chat is temporarily unavailable.');
        error.status = response.status;
        error.category = transportCategory(response.status);
        // Relay codes are allowlisted syntax only; they contain no model output
        // or request data and let the HUD render actionable fail-closed status.
        error.code = /^[A-Z_]{3,64}$/.test(data?.code || '') ? data.code : '';
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { const error = new Error('Authenticated staging chat returned an invalid response.'); error.category = 'invalid-response'; throw error; }
      return data;
    };
    return Object.freeze({
      get ready() { return Boolean(capability) && expiresAt > now(); },
      get expiresAt() { return expiresAt; },
      get sending() { return sending; },
      clear,
      async exchange(assertion, assertionExpiresAt) {
        if (!assertionPattern.test(assertion || '') || !Number.isSafeInteger(assertionExpiresAt) || assertionExpiresAt <= now()) throw new Error('The companion unlock assertion is invalid or expired.');
        const exchangeGeneration = authorizationGeneration;
        const data = await request('/v1/exchange', { body: { assertion } });
        if (!capabilityPattern.test(data.capability) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now() || data.expiresAt > assertionExpiresAt) throw new Error('Authenticated staging chat returned an invalid capability.');
        if (exchangeGeneration !== authorizationGeneration) throw new Error('The companion unlock authorization is no longer current.');
        capability = data.capability; expiresAt = data.expiresAt;
      },
      async send(message, history = [], { evaluation = false } = {}) {
        const text = safeText(message, 1200);
        if (!text) throw new Error('Enter a message for JARVIS.');
        if (typeof evaluation !== 'boolean' || !Array.isArray(history) || history.length > 6) throw new Error('Conversation context is invalid.');
        const context = history.map((item) => {
          if (!item || !['user', 'assistant'].includes(item.role)) throw new Error('Conversation context is invalid.');
          const content = safeText(item.text, 800);
          if (!content) throw new Error('Conversation context is invalid.');
          return { role: item.role, content };
        });
        if (context.reduce((total, item) => total + item.content.length, 0) > 3600) throw new Error('Conversation context is too large.');
        if (sending) throw new Error('JARVIS is already sending this message.');
        if (!capability || expiresAt <= now()) { clear(); throw new Error('Authenticated chat expired. Complete companion unlock again.'); }
        sending = true;
        try {
          const queued = await request('/v1/chat', { body: { message: text, history: context, ...(evaluation ? { evaluation: true } : {}) }, authenticated: true });
          if (!requestPattern.test(queued.id)) throw new Error('Authenticated staging chat returned an invalid request receipt.');
          const deadline = Math.min(expiresAt, now() + 30_000);
          while (now() < deadline) {
            const result = await request(`/v1/chat/${queued.id}`, { method: 'GET', authenticated: true });
            if (result.state === 'done' && typeof result.reply === 'string') return safeText(result.reply);
            if (result.state !== 'pending' && result.state !== 'leased') throw new Error('Authenticated staging chat returned an invalid response.');
            await wait(1000);
          }
          throw new Error('JARVIS timed out waiting for a response.');
        } finally { sending = false; }
      },
      async analyzeDocument(instruction, documentText) {
        const task = safeText(instruction, 1200), document = safeText(documentText, 6000);
        if (!task || !document) throw new Error('The selected document has no readable text.');
        if (sending) throw new Error('JARVIS is already sending this message.');
        if (!capability || expiresAt <= now()) { clear(); throw new Error('Authenticated chat expired. Complete companion unlock again.'); }
        sending = true;
        try { const result = await request('/v1/analyze-document', { body: { instruction: task, document }, authenticated: true }); if (typeof result.reply !== 'string') throw new Error('Authenticated staging chat returned an invalid response.'); return safeText(result.reply); }
        finally { sending = false; }
      },
    });
  }
  return { createClient, validRelay, safeText };
});
