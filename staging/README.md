# Staging HUD overlay

This directory is an overlay, not a deployable production asset. Copy the
verified HUD baseline to an isolated staging artifact, then replace only
`auth-config.js` and `connectors-config.js` with these files before deploying
the artifact to `jarvis-hud-staging.hlao-xiong.workers.dev`.

The staging HUD authenticates only against `jarvis-auth-staging` and submits
Google commands only to `jarvis-connected-apps-staging`. It has no production
origin, Tailscale companion, bridge token, OAuth grant, or pairing record.

The existing `staging-passkey.html` page remains the owner enrollment and
authentication test interface. A staging owner must authenticate with that
synthetic passkey before calling owner OAuth or cloud-pairing approval routes.

## Verified deployment

The staging HUD is deployed at `https://jarvis-hud-staging.hlao-xiong.workers.dev`.
Build `4eee12b8737a26d835b30c59c904435d55115354` (Worker version
`f45af997-7876-411c-8cfc-3245d7da9a82`) was verified against all 13 release
asset hashes on 2026-11-09. It routes Auth to `jarvis-auth-staging`, Google
Apps to `jarvis-connected-apps-staging`, and retains the existing staging chat
relay. It has no production Connected Apps URL or Tailscale companion URL.

The Connected Apps Worker is not yet deployed, so Google commands remain
unavailable from this HUD until its staging-only OAuth client and secrets are
configured. Do not roll back to the previous staging HUD version: that version
pointed Google Apps to the production Worker. Retain the verified release
artifact and deploy a new reviewed artifact with these staging overlays for any
HUD rollback.
