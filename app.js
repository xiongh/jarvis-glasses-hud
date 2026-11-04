(function exposeJarvisGlassesHud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisGlassesHud = api;
}(globalThis, function createJarvisGlassesHud() {
  'use strict';

  const MENU = [
    { id: 'ai', title: 'AI', detail: 'Pair a separately hosted, least-privilege AI gateway to chat. No desktop JARVIS endpoint is exposed.', available: true },
    { id: 'vision', title: 'VISION', detail: 'Camera and sensor capture are not part of this Web App. A separately approved Device Access Toolkit integration is required.', available: false },
    { id: 'media', title: 'MEDIA', detail: 'Private media accounts and playback are intentionally not connected to this standalone HUD.', available: false },
    { id: 'settings', title: 'SETTINGS', detail: 'Connection mode is standalone. This build contains no JARVIS server address, credentials, or development controls.', available: false },
  ];

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
      else if (state.screen === 'menu') state = { ...state, screen: state.selected === 0 ? 'chat' : 'detail' };
      else state = { screen: 'menu', selected: state.selected };
      return commit();
    };
    const back = () => {
      if (state.screen === 'detail' || state.screen === 'chat') state = { ...state, screen: 'menu' };
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
      const response = await globalThis.fetch(`${gateway}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Connection failed.'); return data;
    };
    const render = (state) => {
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
        const send = make('button', 'action', 'SEND'); send.type = 'button'; send.addEventListener('click', async () => { if (!token || expiresAt <= Date.now()) { status.textContent = 'PAIR SECURE AI FIRST.'; return; } const message = prompt.value.trim(); if (!message) return; messages.push({ role: 'user', text: message }); prompt.value = ''; status.textContent = 'JARVIS IS THINKING…'; send.disabled = true; try { const data = await request('/v1/chat', { message }, token); messages.push({ role: 'assistant', text: String(data.reply || '').slice(0, 2000) }); status.textContent = 'AI GATEWAY: PAIRED'; } catch { token = ''; status.textContent = 'CHAT UNAVAILABLE. SESSION CLEARED.'; } finally { send.disabled = false; render(hud.snapshot()); } });
        outlet.append(gatewayInput, codeInput, pair, prompt, send, make('p', 'copy', 'Focus a field to use Neural Band handwriting, dictation, or the on-screen keyboard. Pairing code and session token remain in memory only.'));
        const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); return;
      }
      const item = state.item;
      outlet.append(make('p', 'eyebrow', 'JARVIS MENU'), make('h1', 'detail-title', item.title), make('span', 'unavailable-label', 'UNAVAILABLE'), make('p', 'copy', item.detail), make('p', 'status', 'NO REQUEST WAS SENT · NO PERMISSION WAS REQUESTED'));
      const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); backButton.focus();
    };
    hud = createHud({ render });
    document.addEventListener('keydown', (event) => { if (['INPUT', 'TEXTAREA'].includes(event.target?.tagName) && !['Escape'].includes(event.key)) return; hud.handleKey(event); });
    globalThis.addEventListener?.('popstate', () => hud.back());
    if (globalThis.navigator?.serviceWorker) globalThis.navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    hud.render();
    return hud;
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => boot(document), { once: true });
  return { MENU, createHud, boot };
}));
