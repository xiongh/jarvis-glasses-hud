(function exposeGoogleAppsTest(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.jarvisGoogleAppsTest = api;
}(globalThis, function createGoogleAppsTest() {
  'use strict';
  const services = ['Gmail', 'Calendar', 'Contacts', 'Drive', 'Docs', 'Sheets', 'Tasks'];
  const safeLine = new RegExp(`^(${services.join('|')}): (PASS|NO DATA|FAIL \\((?:not authorized|reconnect required|invalid request|API disabled|scope denied|permission denied|resource unavailable|rate limited|network unavailable|provider unavailable)\\)|NOT TESTED)$`);
  function reportInto(result, value) {
    const found = new Map(String(value || '').split('\n').filter((line) => safeLine.test(line)).map((line) => [line.split(':')[0], line]));
    result.textContent = services.map((name) => found.get(name) || `${name}: NOT TESTED`).join('\n');
    result.hidden = false;
  }
  function mount(documentObject, windowObject = globalThis) {
    const config = windowObject.JARVIS_CONNECTORS_CONFIG || {};
    const button = documentObject?.getElementById?.('test-all-google-apps');
    const status = documentObject?.getElementById?.('google-apps-status');
    const result = documentObject?.getElementById?.('google-apps-result');
    if (!button || !status || !result) return null;
    const say = (value) => { status.textContent = value; };
    const setButton = (label, disabled = false) => { button.textContent = label; button.disabled = disabled; };
    const client = windowObject.jarvisGoogleConnectors?.createGoogleConnectorClient?.({ workerOrigin: config.workerOrigin, enabled: config.enabled === true });
    let phase = 'restoring';
    if (!client || !client.available()) { phase = 'unconfigured'; say('The staging Google Apps relay is not configured.'); setButton('GOOGLE APPS UNAVAILABLE', true); return { phase: () => phase }; }
    const restore = async () => {
      phase = 'restoring'; setButton('RESTORING AUTHORIZATION…', true); say('Restoring the existing paired-device authorization…');
      try {
        const restored = await client.restore();
        if (!restored.paired) {
          phase = restored.transient ? 'network' : restored.storageAvailable === false ? 'storage' : 'missing';
          say(restored.transient ? 'Saved device authorization could not be reached. Check your network, then tap RETRY AUTHORIZATION.' : restored.storageAvailable === false ? 'Safari storage is unavailable in this browser context, so the paired-device authorization cannot be restored. Use the same non-private Safari or installed web-app context used for pairing.' : 'No paired-device authorization is saved in this Safari or PWA context. Open this page in the same browser context used for pairing; no re-pairing is started here.');
          setButton(restored.transient ? 'RETRY AUTHORIZATION' : 'SHOW AUTHORIZATION STATUS');
          return false;
        }
        phase = 'ready'; say('Paired-device authorization restored.'); setButton('TEST ALL GOOGLE APPS'); return true;
      } catch {
        phase = 'network'; say('Saved device authorization could not be restored. Check your network, then tap RETRY AUTHORIZATION.'); setButton('RETRY AUTHORIZATION'); return false;
      }
    };
    button.addEventListener('click', () => {
      if (phase === 'restoring' || phase === 'network') { void restore(); return; }
      if (phase === 'missing' || phase === 'storage') { reportInto(result, ''); say(phase === 'storage' ? 'Safari storage is unavailable in this browser context. Use the same non-private Safari or installed web-app context used for pairing.' : 'No paired-device authorization is saved in this Safari or PWA context. Open this page in the same browser context used for pairing.'); return; }
      if (phase !== 'ready') return;
      phase = 'testing'; setButton('TESTING GOOGLE APPS…', true); result.hidden = true; say('Running seven minimal read-only Google API checks…');
      void client.runCommand(windowObject.jarvisGoogleConnectors.CONNECTIVITY_TEST_COMMAND).then((value) => {
        reportInto(result, value); say('Google Apps connectivity test complete.');
      }).catch(() => { reportInto(result, ''); say('The Google Apps connectivity test could not complete. Check your network and paired authorization. No Google data was changed.'); }).finally(() => { phase = 'ready'; setButton('TEST ALL GOOGLE APPS'); });
    });
    void restore();
    return { phase: () => phase, restore };
  }
  return { mount, reportInto, services };
}));

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.jarvisGoogleAppsTest?.mount(document, window);
  }, { once: true });
}
