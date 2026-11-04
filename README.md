# JARVIS HUD for Meta Ray-Ban Display

This standalone Meta Web App keeps working without the Windows JARVIS PC. YouTube access uses a separate Cloudflare Worker and D1 database. The existing Desktop application and AI gateway remain separate and unchanged by this HUD.

## YouTube on the glasses

- The phone connection page performs Google sign-in and account management. The glasses never handle Google credentials, OAuth callbacks, API keys, access tokens, or refresh tokens.
- The HUD requests a short-lived pairing code from the YouTube Worker. The user signs in on the iPhone, enters the code, and approves the glasses. The Worker issues a device credential only after approval; it is kept in HUD memory and expires after 24 hours.
- Search uses YouTube Data API results and can search videos and channels. Shorts are ordinary video search results matching `#shorts`; this is not a complete Shorts feed.
- Subscriptions use the authorized `youtube.readonly` scope. Recent uploads are requested only for a verified subscription.
- Home displays recent authorized YouTube account activity when available. It is not official watch history, a recommendation feed, or ranked suggestions. YouTube Data API does not expose complete official watch history, personalized recommendations, or a complete Shorts feed.
- JARVIS history and favorites are stored in account-isolated D1 rows. Titles and thumbnails are fetched from YouTube for display. Stored YouTube references are refreshed at least every 25 days while authorization remains available and removed if unavailable.
- Playback uses the official YouTube IFrame Player API. Actual video/audio, controls, and phone handoff depend on the glasses browser. The HUD keeps a YouTube phone handoff available when embedding fails.

The Worker implementation, OAuth connection site, D1 schema, local tests, and deployment preparation are in `../glasses-youtube-worker`. A separate Google OAuth Web client and Cloudflare D1 setup are required before it can be deployed. Do not put any Worker secrets in this static package.

## Text input and navigation

The HUD uses standard Web App inputs for search. On supported glasses, enter text with Meta's available dictation, handwriting, or on-screen keyboard. Neural Band up/down/select and keyboard arrows, Enter, and Escape navigate the interface. If the installed Meta runtime does not expose a text-entry method to this Web App, search entry requires the phone-assisted page or another Meta-supported input; physical text input must be verified on device.

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

This repository preserves the existing GitHub Pages address and JARVIS HUD identity. Its Pages workflow publishes a staged artifact only: it stamps the exact commit SHA into the service worker, produces a SHA-256 release manifest, then verifies `health.json`, the manifest, and each released asset over HTTPS after deployment. The HUD checks that manifest on launch, reconnect, and resume; it never force-reloads an active session. The service worker keeps the current and immediately prior release caches, so the prior offline bundle remains available through a newly activated release.

Do not run a deployment without approval. A successful workflow run is the deployment record and its commit SHA is the last-known-good release.

To roll production back to a known-good successful SHA produced by this upgraded workflow, authorize and run this GitHub Actions dispatch command from a clone of this repository:

```powershell
gh workflow run deploy-pages.yml --repo xiongh/jarvis-glasses-hud --ref main -f revision=<known-good-40-character-sha>
```

For the first upgrade only, the existing production release predates this release tooling and cannot be rebuilt by the dispatch workflow. If that first release must be rolled back, use the reviewed release commit as the boundary: `git revert --no-edit <first-upgrade-release-sha>` followed by `git push origin main`. That is a production action and must be explicitly authorized; it preserves history but reverses every change in that release commit, so keep the Pages upgrade as its own commit.

The Pages workflow does not deploy the YouTube Worker. Worker deployment is separate and documented in `../glasses-youtube-worker/README.md`.

## Install and verify on the glasses

1. Publish the audited static HUD to GitHub Pages.
2. Enable Developer Mode in the Meta AI mobile app.
3. Open glasses settings, choose **App connections** → **Add a Web App**, and enter the HUD HTTPS URL.
4. Set the YouTube Worker HTTPS origin in the HUD, then use **Test Cloud Service**.
5. Choose **Start One-Time Pairing** on the glasses. On the iPhone, open the displayed connection page, connect the Google account, enter the displayed code, and approve the device.
6. Return to the HUD and choose **Check Phone Approval**. Confirm account isolation, search, subscriptions, history, and favorites. Test embedded video/audio; use phone handoff if unsupported.
7. On the phone connection page, review authorized devices and revoke any device you no longer use. Disconnecting deletes that account's JARVIS data and revokes Google authorization; it does not delete YouTube data.

Cloud configuration and physical-device playback are unverified until performed in the user's accounts and on the actual display glasses.
