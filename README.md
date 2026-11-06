# JARVIS HUD for Meta Ray-Ban Display

This standalone Meta Web App keeps working without the Windows JARVIS PC. YouTube access uses a separate Cloudflare Worker and D1 database. The existing Desktop application and AI gateway remain separate and unchanged by this HUD.

## Canonical glasses Web App

The canonical JARVIS Web App URL is `https://xiongh.github.io/jarvis-glasses-hud/`. Use this Pages release both in a browser and when adding JARVIS in the Meta AI app. This repository contains its UI, connector client, optional phone-approved passkey lock, release manifest, service worker, and verified Pages workflow. The parallel local `glasses-webapp` candidate is not a production release and remains preserved until feature parity is fully reviewed. Compatible pairing and phone-unlock code is included here; no code or feature is removed from the candidate by this decision.

The phone-approved passkey lock is disabled by default in `auth-config.js`, preserving the currently published sign-in behavior. Enabling it requires a reviewed Auth Worker URL and matching production Worker/D1 setup; until then the unlock page clearly reports that approval is not configured. The existing staging passkey page remains separate and unchanged.

Every Pages artifact stamps the Git commit into the visible build label and service worker, and the release verifier checks the manifest and each static asset. Use **CHECK UPDATES** to bypass the current cache for the manifest and ask the service worker to fetch the new release. An update does not interrupt the current session. When a staged release is ready, choose **RELOAD LATEST**; the page activates the waiting worker and reloads after it takes control. If service workers are unavailable in a runtime, the controls report that limitation rather than claiming an update succeeded.

Meta supports Web Apps built with standard HTML, CSS, and JavaScript on Ray-Ban Display, including service workers and the Cache API. The current **VISION** entry remains explicitly unavailable: this HUD does not access the glasses camera. Keep existing Windows/browser Vision code intact; real glasses camera/audio integration needs a separate native Device Access Toolkit app. Physical rendering, Neural Band input, networking, and update behavior still require device verification.

## YouTube on the glasses

- The HUD is a standard HTML/CSS/JavaScript Meta Ray-Ban Display Web App candidate. Meta's current Web Apps path runs standalone web experiences on Display glasses and supports arrow/Enter navigation, captouch/Neural Band selection, and text entry. Add the deployed HUD URL in Meta AI app → Developer Mode → App Settings → App connections → Add a Web App. It has not yet been installed or tested on physical glasses.
- The YouTube screen uses a dark, compact YouTube header, account status, search field, and Home / Subscriptions / Shorts tabs. Feed requests cancel stale navigation/search results and suppress duplicate in-flight queries. Thumbnails load lazily and are accepted only from YouTube thumbnail hosts.
- The phone connection page performs Google sign-in and account management. The glasses never handle Google credentials, OAuth callbacks, API keys, access tokens, or refresh tokens.
- The HUD requests a short-lived pairing code from the YouTube Worker. The phone OAuth flow is completed on the Worker origin, then the Worker approves the initiating pairing and issues a device-scoped credential only after verification. The HUD keeps only that opaque device credential, device ID, and fixed expiry in its origin-scoped browser storage; Google access and refresh tokens stay encrypted on the Worker. The Worker validates and rotates the device credential when the HUD starts, with a non-sliding 30-day maximum lifetime. Users can revoke a device from the phone account page. If persistent browser storage is unavailable or the device session expires, pair again; a still-authorized phone session can approve the pairing without another Google sign-in.
- Search uses YouTube Data API results and can search videos and channels. Shorts are ordinary video search results matching `#shorts`; this is not a complete Shorts feed.
- Subscriptions use the authorized `youtube.readonly` scope. Recent uploads are requested only for a verified subscription.
- Home displays recent authorized YouTube account activity when available. It is not official watch history, a recommendation feed, or ranked suggestions. YouTube Data API does not expose complete official watch history, personalized recommendations, or a complete Shorts feed.
- JARVIS history and favorites are stored in account-isolated D1 rows. Titles and thumbnails are fetched from YouTube for display. Stored YouTube references are refreshed at least every 25 days while authorization remains available and removed if unavailable.
- Playback uses the official YouTube IFrame Player API. The embed is user-initiated, uses validated 11-character video IDs, and provides a phone/YouTube handoff on errors. YouTube requires an embedded player viewport of at least 200×200 pixels; the HUD enforces that minimum. Actual video/audio and controls still depend on the Meta Web App browser, which has not been verified on hardware.

The Worker implementation, OAuth connection site, D1 schema, local tests, and deployment preparation are in `../glasses-youtube-worker`. A separate Google OAuth Web client and Cloudflare D1 setup are required before it can be deployed. Do not put any Worker secrets in this static package.

## Text input and navigation

The HUD uses standard Web App inputs for search. Meta documents dictation, handwriting, and on-screen keyboard text input plus Neural Band/captouch selection for Web Apps. This project maps arrow keys, Enter, and Escape for navigation; the physical input event mapping still needs device verification.

## Local checks and preview

From the project root:

```powershell
node --test test/glasses-webapp.test.js test/glasses-youtube-worker.test.js test/youtube-player.test.js
node scripts/audit-glasses-webapp-publication.js --root glasses-webapp
npm test
npm run preview:glasses
```

These checks use mocked Google/YouTube responses and a local SQLite-backed D1 test double. They do not prove a Google OAuth client, Cloudflare configuration, live API quota, network reachability from glasses, or physical video playback. The public Pages bundle contains no Worker secret or private PC endpoint.

## Static HUD publication

This repository preserves the existing GitHub Pages address and JARVIS HUD identity. Its Pages workflow publishes a staged artifact only: it stamps the exact commit SHA into the visible interface and service worker, produces a SHA-256 release manifest, then verifies `health.json`, the manifest, and each released asset over HTTPS after deployment. The HUD checks the network manifest on launch, reconnect, resume, and explicit request; it never force-reloads an active session. The service worker keeps the current and immediately prior release caches, so the prior offline bundle remains available through a newly activated release.

Do not run a deployment without approval. A successful workflow run is the deployment record and its commit SHA is the last-known-good release.

To roll production back to a known-good successful SHA produced by this upgraded workflow, authorize and run this GitHub Actions dispatch command from a clone of this repository:

```powershell
gh workflow run deploy-pages.yml --repo xiongh/jarvis-glasses-hud --ref main -f revision=<known-good-40-character-sha>
```

For the first upgrade only, the existing production release predates this release tooling and cannot be rebuilt by the dispatch workflow. If that first release must be rolled back, use the reviewed release commit as the boundary: `git revert --no-edit <first-upgrade-release-sha>` followed by `git push origin main`. That is a production action and must be explicitly authorized; it preserves history but reverses every change in that release commit, so keep the Pages upgrade as its own commit.

The Pages workflow does not deploy the YouTube Worker. Worker deployment is separate and documented in `../glasses-youtube-worker/README.md`.

## Install and verify on the glasses

1. Publish the audited static HUD to GitHub Pages after the owner approves release.
2. Enable Developer Mode in the Meta AI mobile app.
3. Open glasses settings, choose **App connections** → **Add a Web App**, and enter `https://xiongh.github.io/jarvis-glasses-hud/` if it is not already installed.
4. Set the YouTube Worker HTTPS origin in the HUD, then use **Test Cloud Service**.
5. Choose **Start One-Time Pairing** on the glasses. On the iPhone, open the displayed connection page, connect the Google account, enter the displayed code, and approve the device.
6. Return to the HUD and choose **Check Phone Approval**. Confirm account isolation, search, subscriptions, history, and favorites. Test embedded video/audio; use phone handoff if unsupported.
7. On the phone connection page, review authorized devices and revoke any device you no longer use. Disconnecting deletes that account's JARVIS data and revokes Google authorization; it does not delete YouTube data.

After an approved release, open the installed app online. The previous version will check for a new service worker; when it reports an update is ready, close and reopen once to receive the version with visible update controls. On later releases, choose **CHECK UPDATES**, then **RELOAD LATEST** when convenient. No manual cache clearing is required by this update path. Cloud configuration and physical-device playback remain unverified until performed in the owner's accounts and on actual display glasses.

## Google Apps HUD relay

The glasses HUD sends typed, read-only Google commands through the short-lived Connected Apps Worker capability. Pairing still requires approval in the authenticated private JARVIS phone companion. Google OAuth grants and API calls stay on the private backend; this static site contains only the public Worker origin and no relay secrets.

`phoneCompanionUrl` in `connectors-config.js` is public routing metadata, not a credential. It must be an HTTPS Tailscale `*.ts.net/connect-apps.html` URL; Tailscale access control and the authenticated JARVIS session still protect the private companion.

The Google relay displays a six-character uppercase pairing alias and eight-digit approval code. The original 192-bit pairing ID and polling secret remain private to the HUD client and are used only to poll. The alias is a lookup handle, not an authorization credential; the phone still requires the owner session, CSRF protection, exact connected-app scopes, and the three-minute code. The phone companion copies the alias and code only after the owner taps its copy control. D1 migration `0003_short_pairing_alias.sql` must be applied before the alias-aware Worker is deployed.

Calendar event wording is supplied by the private JARVIS connector backend and rendered verbatim by this HUD. The backend formats event instants in their event time zone and keeps all-day dates date-only; releasing a HUD does not deploy or restart that backend.
