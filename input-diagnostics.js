(function exposeJarvisInputDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisInputDiagnostics = api;
}(globalThis, function createJarvisInputDiagnostics() {
  'use strict';

  const STAGING_ORIGIN = 'https://jarvis-hud-staging.hlao-xiong.workers.dev';
  const MAX_EVENTS = 12;

  function isStagingDiagnostics(config = {}, location = globalThis.location) {
    return config?.hudOrigin === STAGING_ORIGIN && location?.origin === STAGING_ORIGIN;
  }

  function navigationCategory(event) {
    const key = String(event?.key || event?.code || '');
    if (key === 'ArrowUp') return 'UP';
    if (key === 'ArrowDown') return 'DOWN';
    if (key === 'ArrowLeft') return 'LEFT';
    if (key === 'ArrowRight') return 'RIGHT';
    if (key === 'Enter' || key === ' ' || key === 'Space') return 'SELECT';
    if (key === 'Escape' || key === 'Backspace') return 'BACK';
    const legacy = Number(event?.keyCode || event?.which);
    return ({ 8: 'BACK', 13: 'SELECT', 27: 'BACK', 32: 'SELECT', 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN' })[legacy] || 'OTHER';
  }

  function focusCategory(target) {
    const tag = String(target?.tagName || '').toUpperCase();
    if (tag === 'BUTTON') return 'BUTTON';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return 'TEXT INPUT';
    if (tag === 'A') return 'LINK';
    return tag ? 'OTHER' : 'NONE';
  }

  function pointerCategory(event) {
    return ['mouse', 'touch', 'pen'].includes(event?.pointerType) ? event.pointerType.toUpperCase() : 'OTHER';
  }

  // This controller deliberately stores only event categories. It never reads
  // typed values, key labels outside the fixed navigation set, target IDs,
  // coordinates, account data, or any persistent storage.
  function createInputDiagnostics({ target = globalThis, documentObject = globalThis.document, onChange = () => {}, maxEvents = MAX_EVENTS } = {}) {
    let active = false;
    let events = [];
    let counts = { keydown: 0, keyup: 0, focus: 0, pointer: 0, touch: 0, click: 0, window: 0 };
    const boundedMax = Number.isInteger(maxEvents) && maxEvents > 0 ? maxEvents : MAX_EVENTS;
    const snapshot = () => ({ active, counts: { ...counts }, events: events.map((event) => ({ ...event })), focus: focusCategory(documentObject?.activeElement) });
    const publish = () => onChange(snapshot());
    const record = (kind, detail) => {
      events = [{ kind, detail }].concat(events).slice(0, boundedMax);
      publish();
    };
    const listeners = {
      keydown: (event) => { counts.keydown += 1; record('KEY DOWN', navigationCategory(event)); },
      keyup: (event) => { counts.keyup += 1; record('KEY UP', navigationCategory(event)); },
      focusin: (event) => { counts.focus += 1; record('FOCUS', focusCategory(event.target)); },
      pointerdown: (event) => { counts.pointer += 1; record('POINTER', pointerCategory(event)); },
      touchstart: () => { counts.touch += 1; record('TOUCH', 'START'); },
      click: (event) => { counts.click += 1; record('CLICK', pointerCategory(event)); },
      focus: () => { counts.window += 1; record('WINDOW', 'FOCUS'); },
      blur: () => { counts.window += 1; record('WINDOW', 'BLUR'); },
      visibilitychange: () => { counts.window += 1; record('WINDOW', documentObject?.visibilityState === 'visible' ? 'VISIBLE' : 'HIDDEN'); },
    };
    const add = (host, type, listener) => host?.addEventListener?.(type, listener, true);
    const remove = (host, type, listener) => host?.removeEventListener?.(type, listener, true);
    const start = () => {
      if (active) return snapshot();
      active = true;
      add(target, 'keydown', listeners.keydown); add(target, 'keyup', listeners.keyup);
      add(documentObject, 'focusin', listeners.focusin); add(target, 'pointerdown', listeners.pointerdown);
      add(target, 'touchstart', listeners.touchstart); add(target, 'click', listeners.click);
      add(target, 'focus', listeners.focus); add(target, 'blur', listeners.blur);
      add(documentObject, 'visibilitychange', listeners.visibilitychange);
      publish();
      return snapshot();
    };
    const stop = () => {
      if (!active) return snapshot();
      active = false;
      remove(target, 'keydown', listeners.keydown); remove(target, 'keyup', listeners.keyup);
      remove(documentObject, 'focusin', listeners.focusin); remove(target, 'pointerdown', listeners.pointerdown);
      remove(target, 'touchstart', listeners.touchstart); remove(target, 'click', listeners.click);
      remove(target, 'focus', listeners.focus); remove(target, 'blur', listeners.blur);
      remove(documentObject, 'visibilitychange', listeners.visibilitychange);
      publish();
      return snapshot();
    };
    const clear = () => { events = []; counts = { keydown: 0, keyup: 0, focus: 0, pointer: 0, touch: 0, click: 0, window: 0 }; publish(); return snapshot(); };
    return Object.freeze({ start, stop, clear, snapshot });
  }

  function renderReadout(node, snapshot) {
    if (!node) return;
    const { counts, events, focus } = snapshot;
    node.textContent = [
      `FOCUS: ${focus}`,
      `KEY DOWN/UP: ${counts.keydown}/${counts.keyup}`,
      `POINTER/TOUCH/CLICK: ${counts.pointer}/${counts.touch}/${counts.click}`,
      `WINDOW: ${counts.window}`,
      events.length ? `LAST: ${events[0].kind} · ${events[0].detail}` : 'LAST: WAITING FOR INPUT',
      events.length ? `RECENT: ${events.map((event) => `${event.kind} ${event.detail}`).join(' · ')}` : '',
    ].filter(Boolean).join('\n');
  }

  function installInputDiagnostics(documentObject = globalThis.document, target = globalThis) {
    if (!isStagingDiagnostics(target.JARVIS_AUTH_CONFIG || {}, target.location) || !documentObject) return null;
    const panel = documentObject.querySelector?.('#hud-input-diagnostics');
    const open = documentObject.querySelector?.('#hud-open-input-diagnostics');
    const close = documentObject.querySelector?.('#hud-close-input-diagnostics');
    const clear = documentObject.querySelector?.('#hud-clear-input-diagnostics');
    const readout = documentObject.querySelector?.('#hud-input-diagnostics-readout');
    if (!panel || !open || !close || !clear || !readout) return null;
    const diagnostics = createInputDiagnostics({ target, documentObject, onChange: (snapshot) => renderReadout(readout, snapshot) });
    open.hidden = false;
    const hide = () => { diagnostics.stop(); panel.hidden = true; open.focus?.(); };
    open.addEventListener('click', () => { panel.hidden = false; diagnostics.clear(); diagnostics.start(); close.focus?.(); });
    close.addEventListener('click', hide);
    clear.addEventListener('click', () => diagnostics.clear());
    renderReadout(readout, diagnostics.snapshot());
    return diagnostics;
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => { installInputDiagnostics(document, globalThis); }, { once: true });
  return { STAGING_ORIGIN, isStagingDiagnostics, navigationCategory, focusCategory, pointerCategory, createInputDiagnostics, renderReadout, installInputDiagnostics };
}));
