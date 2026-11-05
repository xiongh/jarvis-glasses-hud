(() => {
  'use strict';
  const ORIGIN = 'https://xiongh.github.io';
  const AUTH_WORKER = 'https://jarvis-auth-staging.hlao-xiong.workers.dev';
  const ticket = document.querySelector('#ticket');
  const enrollment = document.querySelector('#enroll-form');
  const enrollButton = document.querySelector('#enroll');
  const authButton = document.querySelector('#authenticate');
  const status = document.querySelector('#status');
  const base64urlToBytes = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid WebAuthn response.');
    const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (byte) => byte.charCodeAt(0));
  };
  const bytesToBase64url = (value) => {
    let binary = ''; for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const setStatus = (message) => { status.textContent = message; };
  const setBusy = (busy) => { enrollButton.disabled = busy; authButton.disabled = busy; };
  const request = async (path, body, authorization = '') => {
    const response = await fetch(`${AUTH_WORKER}${path}`, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The staging authentication request was rejected.');
    return payload;
  };
  const supported = location.origin === ORIGIN && window.isSecureContext && Boolean(window.PublicKeyCredential) && Boolean(navigator.credentials?.create) && Boolean(navigator.credentials?.get);
  if (!supported) { setStatus(`Open ${ORIGIN} in a current secure browser with passkey support.`); setBusy(true); return; }
  setStatus('Ready. Enter a staging-only one-time ticket to enroll, or authenticate with an existing passkey.');

  enrollment.addEventListener('submit', async (event) => {
    event.preventDefault();
    let value = ticket.value;
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) { setStatus('Enter a valid one-time enrollment ticket.'); return; }
    setBusy(true);
    try {
      setStatus('Requesting a registration challenge…');
      const start = await request('/v1/register/options', { ticket: value });
      value = ''; ticket.value = '';
      setStatus('Complete the platform-passkey prompt.');
      const options = start.options;
      const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: base64urlToBytes(options.challenge), user: { ...options.user, id: base64urlToBytes(options.user.id) }, excludeCredentials: (options.excludeCredentials || []).map((item) => ({ ...item, id: base64urlToBytes(item.id) })) } });
      if (!credential) throw new Error('Passkey enrollment was cancelled.');
      const response = credential.response;
      await request('/v1/register/verify', { challengeId: start.challengeId, response: { id: credential.id, rawId: bytesToBase64url(credential.rawId), type: credential.type, response: { clientDataJSON: bytesToBase64url(response.clientDataJSON), attestationObject: bytesToBase64url(response.attestationObject), transports: response.getTransports?.() || [] }, clientExtensionResults: credential.getClientExtensionResults?.() || {} } });
      setStatus('Passkey enrolled. You can now authenticate.');
    } catch (error) { ticket.value = ''; setStatus(error?.name === 'NotAllowedError' ? 'Passkey enrollment was cancelled or unavailable.' : 'Enrollment was not accepted. Do not reuse a consumed or expired ticket.'); }
    finally { value = ''; ticket.value = ''; setBusy(false); }
  });

  authButton.addEventListener('click', async () => {
    let sessionGrant = '';
    setBusy(true);
    try {
      setStatus('Requesting an authentication challenge…');
      const start = await request('/v1/auth/options', {});
      setStatus('Complete the platform-passkey prompt.');
      const options = start.options;
      const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: base64urlToBytes(options.challenge), allowCredentials: (options.allowCredentials || []).map((item) => ({ ...item, id: base64urlToBytes(item.id) })) } });
      if (!credential) throw new Error('Passkey authentication was cancelled.');
      const response = credential.response;
      const verified = await request('/v1/auth/verify', { challengeId: start.challengeId, response: { id: credential.id, rawId: bytesToBase64url(credential.rawId), type: credential.type, response: { clientDataJSON: bytesToBase64url(response.clientDataJSON), authenticatorData: bytesToBase64url(response.authenticatorData), signature: bytesToBase64url(response.signature), userHandle: response.userHandle ? bytesToBase64url(response.userHandle) : undefined }, clientExtensionResults: credential.getClientExtensionResults?.() || {} } });
      if (!/^[A-Za-z0-9_-]{43}$/.test(verified.accessToken || '')) throw new Error('Invalid authentication result.');
      sessionGrant = verified.accessToken;
      const authorization = `Bearer ${sessionGrant}`;
      await request('/v1/authorize', {}, authorization);
      await request('/v1/logout', {}, authorization);
      const replay = await fetch(`${AUTH_WORKER}/v1/authorize`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: '{}' });
      if (replay.status !== 401) throw new Error('Revoked session was accepted.');
      setStatus('Passkey authentication, server authorization, logout, and revoked-session rejection succeeded.');
    } catch (error) { setStatus(error?.name === 'NotAllowedError' ? 'Passkey authentication was cancelled or unavailable.' : 'Authentication was not accepted.'); }
    finally { sessionGrant = ''; setBusy(false); }
  });
})();
