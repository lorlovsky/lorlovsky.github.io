# NotchDrop — current implementation handoff

Updated: 2026-10-09.

## Source of truth and current status

**The current project is `C:\lorlovsky.github.io`.** The finished account system has already been copied into this directory and tested there. Work in this repository going forward.

`C:\Users\MaksL\NotchDrop-build`, `NotchDrop-pairing-fix`, and `NotchDrop-accounts` are historical staging copies, not the main project. The original `C:\repos\blj2026-work--leo-o\challange` path is obsolete.

- The app now requires a real account with a unique username and password.
- A Node.js backend stores users, sessions, devices and friend requests in SQLite. No Supabase/Firebase account or runtime npm dependencies are required.
- The backend and dashboard were started and health-checked at **http://localhost:8083**. Check whether that process is still running before starting another instance.
- The account changes are local working-tree changes. They have **not been committed, pushed or published** by this agent.
- The existing public website is https://lorlovsky.github.io. Public account hosting has not been provisioned; uploading these frontend files alone will not make accounts work there.
- The user confirmed laptop-to-laptop sharing works and explicitly stopped phone/mobile-data troubleshooting. Do not resume TURN setup unless requested.

## Start and use the app

Requires **Node 24 or newer**. The frontend is vanilla HTML/CSS/JavaScript with no build step.

```powershell
cd C:\lorlovsky.github.io
node server.cjs
```

Equivalent: `npm run web`, `npm run server`, or double-click **Start Account Server.cmd**. Open **http://localhost:8083**, choose **Create account**, and choose a username/password. Keep the backend running.

For the always-on-top Windows notch, start the account server first, then run `npm start` or **Start NotchDrop.cmd** and sign in. Electron 44.7.0 is installed in the main project's `node_modules`. Browser and desktop profiles have separate login sessions.

`serve.cjs` is the legacy static-only server on port 8080. It cannot provide accounts. Opening `index.html` directly still requires a reachable account API. Fresh login/startup is not fully offline; demo music and existing P2P connections can operate after authenticated startup without the external CDNs/account server remaining reachable.

## Database and account behavior

- Database: **`C:\lorlovsky.github.io\data\notchdrop.sqlite`**, created automatically on server startup.
- DBeaver: create a SQLite connection and select that file. The user has DBeaver and asked for a SQL-backed account system.
- Schema: `database/schema.sql`; tables `users`, `sessions`, `devices`, `friendships`, `auth_limits`.
- Usernames are case-insensitive, normalized to lowercase, unique, and limited to 3–24 ASCII letters/numbers/underscores. Passwords require 10–128 characters. No email is required; there is no email password-recovery flow.
- Passwords use random salts and scrypt (`N=131072`, `r=8`, `p=1`). Only hashes are stored. The server bounds concurrent hashing and rate-limits authentication.
- Sessions use random bearer tokens, expire after seven days, and are stored as SHA-256 hashes in SQLite. Raw session tokens are stored in the client's localStorage under `notchdrop.session.v1:<API base URL>`; passwords are not stored in browser storage.
- Every protected API operation authenticates the session and enforces ownership. Only a friend-request recipient can accept it. Device discovery across accounts requires an accepted friendship.
- Settings supports username changes, password changes and sign-out. Password changes invalidate other server sessions; logout invalidates the current session and stops local sharing.
- Device registration allocates a stable `nd-<UUID>` PeerJS ID per account/installation. Heartbeats run every 20 seconds; recent activity is not proof that a WebRTC route is available.
- Clipboard history, settings, P2P secrets and prank cooldowns remain local, separated by `notchdrop.v2:<user UUID>`. Old guest data under `notchdrop.v1` is retained but not automatically imported. Files/clipboard content are not uploaded to the account database.
- `data/`, SQLite files and environment files are ignored by Git. The HTTP server serves an explicit frontend allowlist and never exposes the database, backend source or tests. Preserve these protections.

Use a SQLite-aware backup for a running server, or stop it before a simple file-copy backup or manual database edits. Do not publish the database or replace password hashes with plaintext.

## Main files and startup flow

- `server.cjs`: built-in Node HTTP, SQLite and crypto; account API, ownership checks, CORS, sessions, rate limiting and frontend serving. Default bind is `127.0.0.1:8083`.
- `database/schema.sql`: startup schema and indexes; parameterized application queries live in `server.cjs`.
- `config.js`: public `apiBaseUrl`. Empty uses the page's origin for HTTP(S), or `http://127.0.0.1:8083` for file-origin desktop pages.
- `auth.js` / `auth.css`: registration/sign-in gate and responsive account screens, session restoration, logout and password/username updates.
- `accounts.js`: database device/friend synchronization, username friend requests, acceptance/removal, account settings and heartbeat state.
- `app.js`: awaits `NotchAuth.ready`, registers this installation, initializes account-scoped dashboard state and starts PeerJS. Calls `NotchAuth.completeStartup()` and dispatches `notchdrop:ready` when usable. Startup failures remain on the account screen.
- `index.html` / `styles.css`: dashboard, Dynamic Island and dialogs. PeerJS 1.5.4 and QRCode.js 1.0.0 are loaded from pinned CDNs.
- `peer.js`: `window.NotchPeer` EventTarget transport, pairing consent, HMAC trust on reconnect, chunked files with receiver acknowledgments, clipboard/pranks and QR helpers.
- `music.js`: original synthesized demos, shared global playback controls, optional Spotify Web Playback SDK hook, and native Spotify adapter.
- `ACCOUNTS.md`: authoritative local setup, DBeaver and deployment instructions.
- `ACCOUNTS-VALIDATION.md`: current account and regression verification. `VALIDATION.md` and `PAIRING-VALIDATION.md` contain earlier feature/pairing history.

`NotchDrop.getIdentity()`, `getSettings()`, `getState()` and `reconnect()` support debugging after sign-in. `getState()` omits contact secrets. `NotchAuth.getUser()` exposes the current public profile, not the session token.

## P2P and pairing invariants

- Account sign-in/friend acceptance does not silently grant transfer trust. Initial device pairing still requires explicit approval. Own-device auto-accept is controlled by a local ownership choice, not a remote claim.
- QR flow: scan, tap **Connect on the scanning device**, then **Accept on the other device**. Mobile confirmation uses a visible dialog. Keep both tabs visible.
- Persistent pairing status distinguishes connecting, handshake, waiting for approval, success and failure. Retry clears a failed pending channel. Connection attempts time out after 45 seconds; an opened channel permits two minutes for approval.
- A signaling Online badge does not prove device-to-device connectivity. Public STUN is configured; TURN credentials can be entered in Settings. No unverified shared public TURN credentials are embedded.
- The user's computer accepted a diagnostic pairing. A later phone attempt reached signaling but the WebRTC data channel timed out. Phone work was subsequently dropped at the user's request.
- PeerJS can deserialize binary packets into `Uint8Array`. Preserve bounded ArrayBuffer-view handling, including byte offsets; do not accept only ArrayBuffer.
- Files are capped at 100 MiB each; receive reservations, pending transfers and timeouts are bounded. Clipboard text is capped at 64 KiB UTF-8. A successful send requires receiver ACK. Received downloads are explicit Save file links.
- Late progress events must not overwrite received Save file links. Simultaneous reconnects retain the channel initiated by the lexically smaller peer ID.
- Notch Off is strict: targets use `#target-dialog`, approvals use `#request-dialog`, and dragging must not force the notch visible. Preserve `data-state=prank` behavior and daily cooldowns.
- Display untrusted names, clipboard content and filenames with safe text rendering.

## Native notch and Spotify

The user requires a notch fixed to the **primary monitor**, above other Windows apps even when the Command Center is minimized. Keep the native shell; a normal browser cannot provide that behavior.

- `desktop/main.cjs` manages independent dashboard and transparent island windows, tray lifecycle and primary-display placement. Closing the dashboard hides it; tray Quit exits. A cursor-region poll preserves hover/click-through around transparent pixels.
- The dashboard is the only networking/music engine. `desktop/dashboard.js` mirrors its notch DOM; `overlay.js` forwards bounded controls/file drops. Do not create duplicate PeerJS sessions in the overlay.
- Sandbox and context isolation are enabled, Node integration is off, and preload IPC is narrowly scoped with sender checks. Keep these boundaries.
- Main-process loading hides stale notch snapshots. Signing out explicitly hides the native overlay. Spotify controls initialize after `notchdrop:ready`, including a queued tray connect request.
- Desktop profile: `%APPDATA%\NotchDrop`. Tests use temporary profiles with `--notchdrop-test` and do not alter the real profile.
- The user uses **Spotify desktop**. `spotify-session.ps1` and `spotify.cjs` use Windows media sessions through a hidden local helper. No Spotify developer account/OAuth token is needed for this native path. Spotify itself plays the audio.
- Tray/right-click **Connect Spotify desktop** or the Settings button enables track metadata and play/pause/previous/next/seek. Source selection is stored under `notchdrop.musicSource`.
- The separate web SDK hook still requires an external OAuth/token flow; the new NotchDrop account system does not implement Spotify OAuth.
- Spotify testing reads the live session but routes playback actions through a fake adapter so the user's actual song is not changed.

## Tests and verified results

Run from the main project:

```powershell
npm test
```

Last run: **20 passing tests** across `tests/transport.cjs` and `tests/accounts-api.cjs`. API tests use real isolated SQLite databases, including ownership boundaries, unique usernames, password/session behavior, restart persistence, friend consent, CORS/static restrictions and rate limits.

Browser and native tests use Playwright. The updated regression tests use `tests/account-fixture.cjs` to start isolated real account servers and sessions; a separate manually started static server is no longer required by default.

```powershell
$env:PLAYWRIGHT_PATH='C:\Users\MaksL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tests/accounts-browser.cjs
node tests/browser.cjs
node tests/dashboard-live.cjs
node tests/pairing-flow.cjs
node tests/desktop.cjs
node tests/spotify-desktop.cjs
```

All six scripts passed during account integration. Coverage includes UI registration/login, real 140123-byte exact WebRTC transfer, username friendship approval, same-account device discovery, logout revocation, local account isolation, responsive/direct-file startup with a reachable API, existing dashboard interactions, native notch geometry and Spotify routing. `tests/live-peer.cjs` remains an optional direct transport smoke test; it was adapted to the new server fixture but was not part of that final six-script run.

Screenshots were visually reviewed. The Dockerfile has not been built here because Docker is not installed. Do not present browser tests as proof of all physical networks or public deployment.

## Remaining deployment work

Local account implementation is complete. **Public-site accounts require an HTTPS backend with persistent storage.** GitHub Pages cannot execute Node or host a writable SQLite database.

1. Deploy the included server/Dockerfile on a suitable host with persistent disk and TLS. One SQLite-backed server instance is the supported arrangement.
2. Set `NOTCHDROP_HOST=0.0.0.0`, the hosting `PORT`, a persistent `NOTCHDROP_DATABASE` path, and `NOTCHDROP_PUBLIC_URL` to the backend HTTPS URL.
3. Set exact allowed frontend origins in `NOTCHDROP_ORIGINS`; `https://lorlovsky.github.io` is the default. Public native/file clients additionally require `NOTCHDROP_ALLOW_FILE_ORIGIN=true`. All private endpoints still require bearer tokens.
4. Set `config.js` `apiBaseUrl` to that shared backend URL, without `/api`, before publishing the frontend. Keep all clients on the same backend; separate local servers contain separate accounts.
5. Verify actual public registration, login and cross-device discovery. The account work is not yet deployed, and no hosting account has been configured.

For reverse proxies, enable `NOTCHDROP_TRUST_PROXY=true` only when the trusted proxy overwrites `X-Forwarded-For`. See ACCOUNTS.md for the full deployment procedure. Do not commit private databases, raw session tokens or user passwords.
