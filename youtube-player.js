(function attachJarvisYouTube(global) {
  'use strict';

  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
  const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

  function parseVideoInput(value) {
    const input = String(value || '').trim();
    if (!input || input.length > 2_048) return null;
    if (VIDEO_ID.test(input)) return { videoId: input, url: canonicalWatchUrl(input) };
    let url;
    try { url = new URL(input); } catch { return null; }
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (SHORT_HOSTS.has(host)) {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (YOUTUBE_HOSTS.has(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      else if (['embed', 'shorts', 'live'].includes(parts[0])) videoId = parts[1] || '';
    }
    return VIDEO_ID.test(videoId) ? { videoId, url: canonicalWatchUrl(videoId) } : null;
  }

  function canonicalWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  function parseCommand(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    const normalized = text.toLowerCase().replace(/^hey\s+jarvis\s*,?\s*/i, '');
    if (/^open youtube(?:\s+(.+))?$/i.test(normalized)) {
      const match = /^open youtube(?:\s+(.+))?$/i.exec(text.replace(/^hey\s+jarvis\s*,?\s*/i, ''));
      return { action: 'open', videoInput: match?.[1]?.trim() || '' };
    }
    if (/^close youtube$/i.test(normalized)) return { action: 'close' };
    if (/^(play youtube|play)$/i.test(normalized)) return { action: 'play' };
    if (/^(pause youtube|pause)$/i.test(normalized)) return { action: 'pause' };
    if (/^(resume youtube|resume)$/i.test(normalized)) return { action: 'resume' };
    if (/^go back$/i.test(normalized)) return { action: 'back' };
    return null;
  }

  function createPlayerController({ document, window, container, onStateChange = () => {}, apiLoader } = {}) {
    let player = null;
    let videoId = '';
    let closed = true;
    let loadGeneration = 0;
    const loadApi = apiLoader || (() => loadIframeApi({ document, window }));
    const notify = (state, detail = '') => onStateChange({ state, detail, videoId, url: videoId ? canonicalWatchUrl(videoId) : '' });

    async function load(input) {
      const parsed = typeof input === 'string' ? parseVideoInput(input) : input;
      if (!parsed) { notify('error', 'Enter an HTTPS YouTube link or an 11-character video ID.'); return false; }
      const generation = ++loadGeneration;
      player?.destroy?.();
      player = null;
      videoId = parsed.videoId;
      closed = false;
      notify('loading', 'Loading the YouTube player…');
      try {
        const YT = await loadApi();
        if (!YT?.Player || closed || generation !== loadGeneration) return false;
        if (container) container.replaceChildren?.();
        player = new YT.Player(container, {
          videoId,
          playerVars: { autoplay: 0, playsinline: 1, rel: 0 },
          events: {
            onReady: (event) => { if (!closed && event?.target === player) notify('ready', 'Video ready. Press Play to start.'); },
            onError: () => { if (!closed) notify('error', 'YouTube could not embed this video. Use Open on YouTube instead.'); },
            onStateChange: (event) => {
              if (closed || event?.target !== player) return;
              const states = YT.PlayerState || {};
              if (event.data === states.PLAYING) notify('playing', 'Playing.');
              else if (event.data === states.PAUSED) notify('paused', 'Paused.');
              else if (event.data === states.ENDED) notify('ended', 'Playback ended.');
            },
          },
        });
        return true;
      } catch {
        if (!closed) notify('error', 'The YouTube player could not load. Check your connection or open the video on YouTube.');
        return false;
      }
    }

    function play() { if (!player || closed) return false; player.playVideo?.(); return true; }
    function pause() { if (!player || closed) return false; player.pauseVideo?.(); return true; }
    function position() { const value = Number(player?.getCurrentTime?.()); return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }
    function duration() { const value = Number(player?.getDuration?.()); return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0; }
    function seek(seconds) { const value = Number(seconds); if (!player || closed || !Number.isFinite(value) || value < 0) return false; player.seekTo?.(value, true); return true; }
    function setVolume(value) { const volume = Number(value); if (!player || closed || !Number.isFinite(volume)) return false; player.setVolume?.(Math.max(0, Math.min(100, Math.round(volume)))); return true; }
    function volume() { const value = Number(player?.getVolume?.()); return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100; }
    function close() { loadGeneration += 1; closed = true; player?.destroy?.(); player = null; videoId = ''; if (container) container.replaceChildren?.(); notify('closed', 'YouTube closed.'); }
    return { load, play, pause, position, duration, seek, setVolume, volume, close, get videoId() { return videoId; }, get active() { return !closed; } };
  }

  let apiPromise;
  function loadIframeApi({ document, window } = {}) {
    if (window?.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      if (!document?.createElement || !document?.head?.append) { reject(new Error('Document unavailable.')); return; }
      const priorReady = window.onYouTubeIframeAPIReady;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady = priorReady;
        apiPromise = null;
        reject(new Error('YouTube API unavailable.'));
      };
      window.onYouTubeIframeAPIReady = () => {
        try { priorReady?.(); } finally { resolve(window.YT); }
      };
      document.head.append(script);
    });
    return apiPromise;
  }

  const api = { parseVideoInput, canonicalWatchUrl, parseCommand, createPlayerController, loadIframeApi };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.jarvisYouTube = api;
}(globalThis));
