// Staging-only replacement for the public connectors-config.js. It contains
// no credentials and deliberately has no Tailscale companion URL.
window.JARVIS_CONNECTORS_CONFIG = Object.freeze({
  enabled: true,
  workerOrigin: 'https://jarvis-connected-apps-staging.hlao-xiong.workers.dev',
  phoneCompanionUrl: 'https://jarvis-hud-staging.hlao-xiong.workers.dev/staging-apps-connect.html',
});
