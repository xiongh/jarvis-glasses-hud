// Staging-only replacement for the public auth-config.js. Package this file
// into an isolated staging HUD artifact; never publish it to GitHub Pages.
window.JARVIS_AUTH_CONFIG = Object.freeze({
  enabled: true,
  hudOrigin: 'https://jarvis-hud-staging.hlao-xiong.workers.dev',
  workerUrl: 'https://jarvis-auth-staging.hlao-xiong.workers.dev',
  chatRelayUrl: 'https://jarvis-staging-chat-relay.hlao-xiong.workers.dev',
  sessionRestore: true,
});
document.documentElement.dataset.jarvisAuthEnabled = 'true';
