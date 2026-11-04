(function exposeJarvisGlassesHud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisGlassesHud = api;
}(globalThis, function createJarvisGlassesHud() {
  'use strict';

  const MENU = [
    { id: 'ai', title: 'AI', detail: 'Local HUD controls are ready. Remote AI and Meta AI actions are unavailable in standalone mode.', available: false },
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
      else if (state.screen === 'menu') state = { ...state, screen: 'detail' };
      else state = { screen: 'menu', selected: state.selected };
      return commit();
    };
    const back = () => {
      if (state.screen === 'detail') state = { ...state, screen: 'menu' };
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
    let hud;
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
      const item = state.item;
      outlet.append(make('p', 'eyebrow', 'JARVIS MENU'), make('h1', 'detail-title', item.title), make('span', 'unavailable-label', 'UNAVAILABLE'), make('p', 'copy', item.detail), make('p', 'status', 'NO REQUEST WAS SENT · NO PERMISSION WAS REQUESTED'));
      const backButton = make('button', 'action', 'BACK TO MENU'); backButton.type = 'button'; backButton.addEventListener('click', () => hud.back()); outlet.append(backButton); backButton.focus();
    };
    hud = createHud({ render });
    document.addEventListener('keydown', (event) => hud.handleKey(event));
    globalThis.addEventListener?.('popstate', () => hud.back());
    if (globalThis.navigator?.serviceWorker) globalThis.navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    hud.render();
    return hud;
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => boot(document), { once: true });
  return { MENU, createHud, boot };
}));
