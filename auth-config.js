// Fail closed until a reviewed release pins the deployed Auth Worker URL.
// Never populate this from a URL parameter, localStorage, or phone input.
window.JARVIS_AUTH_CONFIG = Object.freeze({ enabled: false, workerUrl: '' });
document.documentElement.dataset.jarvisAuthEnabled = window.JARVIS_AUTH_CONFIG.enabled === true ? 'true' : 'false';
