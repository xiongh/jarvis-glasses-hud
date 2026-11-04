# JARVIS HUD for Meta Ray-Ban Display

This is a separate Web App. It does not replace the desktop JARVIS simulator and it never calls a JARVIS desktop endpoint. The initial hardware test works with no backend connection.

## Phase B AI chat

The AI panel is usable after pairing with a separately deployed HTTPS gateway. The public HUD contains no gateway URL, pairing code, API key, provider credential, or persistent session. Entering a gateway URL and one-time pairing code in the HUD creates a short-lived in-memory session only; reload clears it. The gateway must be a separate service, never the Windows JARVIS server, and must expose only `/v1/pair` and `/v1/chat` with an exact Pages-origin CORS allowlist, short-lived authorization, rate limiting, and a server-side AI-provider key. `glasses-ai-gateway.js` is the reference implementation.

Meta documents standard text fields for Neural Band handwriting, on-glasses dictation, and the on-screen keyboard. Focus the pairing or message field, enter text with one of those system methods, then use Select to activate the focused button. This is supported text entry, not raw Neural Band sensor access.

## Local preview

From the repository root, run `npm run preview:glasses`, then open `http://127.0.0.1:4175/`. Use Arrow keys to move selection, Enter/Space to select, and Escape/Backspace to return. The static preview is only local HTTP and is not installable on glasses.

## Security and future connection boundary

This build intentionally contains no server URL, bridge token, session cookie, OAuth material, development command, WebSocket connection, or camera request. A future backend-enabled edition must be separately reviewed and must use a private HTTPS/WSS origin, short-lived per-device authorization scoped to read-only HUD status, server-side enforcement, origin checks, CSRF where applicable, and a fixed allowlist of status endpoints. It must not grant Auto Development, shell, token, credential, or unrestricted server access.

## Private test deployment preparation

Publish this directory only after an explicit deployment decision. It is a static bundle and needs HTTPS for installation. Do not point it at the existing Windows JARVIS server, open a firewall port, use Tailscale Funnel, add secrets to static files, or enable a private API connection as part of this step.

Meta's Web Apps documentation describes standard web APIs, 600×600 additive-display design, keyboard navigation/selection, and ordinary fetch/WebSocket connectivity. This HUD uses only keyboard navigation; it does not assume raw Neural Band sensors, camera access, or Meta AI control.

## GitHub Pages publication package

This directory is the complete future repository root. Its included GitHub Actions workflow publishes only this directory's artifact after a push to `main`; it does not build, copy, or reference the parent JARVIS repository. Relative `./` asset URLs make the HUD work at the repository Pages URL, for example `https://<github-owner>.github.io/jarvis-glasses-hud/`.

Before any public push, review the exact directory inventory and enable **Settings → Pages → Build and deployment → Source: GitHub Actions** in the future repository. GitHub Pages is public for GitHub Free public repositories. Do not create or push that repository until publication is explicitly approved.

## Install on glasses after hosting approval

1. Host this exact static directory at the approved HTTPS URL.
2. Enable Developer Mode for the paired glasses in the Meta AI app.
3. In the Meta AI app, open the display glasses settings, then **App connections → Web apps → Add a web app**.
4. Enter the app name and approved HTTPS URL, then open it on the glasses.
5. First test the standalone welcome screen and Arrow/Enter navigation. Do not claim backend connectivity or camera capability until separately implemented and tested.

Meta's current FAQ documents adding a hosted Web App through the Meta AI app; its current starter-kit guidance also recommends testing with the Meta Ray-Ban Display simulator before device testing.
