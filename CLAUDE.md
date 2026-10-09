# NotchDrop implementation handoff

## Location and goal

The requested repository directory is `C:\repos\blj2026-work--leo-o\challange`. The implementation was assembled in `C:\Users\MaksL\NotchDrop-build` and copied into the repository. The repository copy is the deliverable. No build step or package install is required to run the app.

## Architecture

- `index.html`: complete semantic dashboard, notch, pairing/friend/settings/note/prank/request dialogs. PeerJS 1.5.4 and QRCode.js 1.0.0 CDN scripts load before local scripts.
- `styles.css`: charcoal/lime responsive layout, Dynamic Island morphing (`data-state=idle|music|drag|targets|incoming`), mobile behavior, reduced motion.
- `app.js`: browser-local identity/settings/trust/history, safe DOM rendering, drag/drop target selection, approval queue, file download links, clipboard permissions fallback, daily prank cooldown.
- `peer.js`: `window.NotchPeer` EventTarget transport; PeerJS WebRTC, explicit pairing, shared secret HMAC reconnection, accepted chunk streaming with receiver ACK, progress, limits, QR helpers.
- `music.js`: `window.NotchMusic` module, three original synthesized offline tracks and optional `connectSpotify(getOAuthToken)` SDK hook; global togglePlay/nextTrack/prevTrack/seekTrack.
- `serve.cjs`: optional `node serve.cjs` server at localhost:8080.

The user requested four specialists; UI, media, network, and dashboard agents completed the modules, and the primary agent integrated and browser-tested them. Two specialists exhausted their usage allowance near the final review; primary continued. Consult VALIDATION.md for final results.

## Important implementation details

### Desktop extension requested after the initial web app

The user explicitly requires the notch always on the primary monitor, above other Windows apps even while the dashboard is minimized. The browser alone cannot do that. An optional Electron 44.7.0 shell was added; `npm start` or `Start NotchDrop.cmd` launches it. Keep the original zero-build web version working.

- `desktop/main.cjs` owns two independent BrowserWindows, not parent/child windows. One transparent, fixed, always-on-top island is placed using `screen.getPrimaryDisplay().bounds`. A regular Command Center window hosts the only app/network/music engine; close hides it while the tray keeps the app running.
- `desktop/dashboard.js` mirrors the existing safe-text notch DOM and forwards a small set of control events. The native overlay does NOT initialize a second PeerJS instance or second music engine. Range values travel separately to avoid replacing buttons under the pointer. State updates defer during pointer press.
- `desktop/overlay.js` presents snapshots and forwards bounded file/text drops without filesystem paths. File drops are reconstructed as browser File/DataTransfer objects in the dashboard and use the existing transfer pipeline.
- `desktop/preload.cjs` exposes named IPC methods only. Main process checks sender window/frame and packet bounds. Node integration is disabled; context isolation and renderer sandbox stay enabled. No arbitrary filesystem/shell IPC.
- A cursor-region check drives `setIgnoreMouseEvents` so transparent pixels around the notch do not block other apps. A 45 ms native cursor poll keeps hover detection reliable while click-through is active. Monitor changes trigger recentering.
- Desktop profile is `%APPDATA%\NotchDrop`. Tests use an isolated temporary profile with `--notchdrop-test`; they do not overwrite real pairings.
- `tests/desktop.cjs` uses Playwright's Electron launcher with the installed runtime. Test native geometry, topmost flag, hover/music event bridging, drops, show/hide settings, minimize/close behavior, and click-through with controlled cursor coordinates.

### Spotify desktop integration

The user listens through the actual Spotify desktop app. Added a native media-session connection rather than requiring Spotify Developer/OAuth setup:

- `desktop/spotify-session.ps1`: persistent, hidden Windows WinRT adapter for GlobalSystemMediaTransportControlsSessionManager. Only Spotify app IDs and status/toggle/next/previous/seek are supported. JSON lines; track metadata stays local.
- `desktop/spotify.cjs`: bounded request queue with timeouts and helper lifecycle; `main.cjs` validates dashboard-only IPC and resizes optional album thumbnails.
- `music.js`: `connectDesktopSpotify(adapter)` and `disconnectDesktopSpotify()`, source `spotify-desktop`, native controls, seek debouncing, live track/progress/cover UI, and fallback demos. Audio remains in Spotify; native source does not stream Spotify audio inside Electron.
- `desktop/spotify-ui.js`: settings source buttons, persisted `notchdrop.musicSource`. Tray/right-click menu has Connect Spotify desktop. Launch argument `--spotify` selects it on this launch and remembers the choice.
- `tests/spotify-desktop.cjs`: read-only live session discovery plus fake-adapter playback control tests; avoids modifying the user's current song during verification.

- LocalStorage key: `notchdrop.v1`. Contact secrets are stored locally and omitted from `NotchDrop.getState()`. `getIdentity()`, `getSettings()`, and `reconnect()` are available for local inspection.
- Both devices approve new pairing; claimed names/own-device roles are never trusted by themselves. Explicit own-device checkbox controls automatic acceptance.
- PeerJS 1.5.4 can deserialize binary data into Uint8Array. The receiver normalizes bounded ArrayBuffer views while respecting offsets. Do not regress this by accepting only ArrayBuffer.
- Completed receive progress must not overwrite the Save file link created by `onReceived`; received activity rows are marked and excluded from later progress updates.
- Notch Off is strict: recipient selection uses the generated `#target-dialog`, incoming approvals use `#request-dialog`, and drag events cannot force the notch visible. `data-state=prank` expands and glows only when enabled. Preserve these follow-up audit fixes.
- Simultaneous reconnects choose the connection initiated by the lexically smaller peer ID when two channels compete. This prevents both endpoints from closing each other's replacement channel.
- Packet types: FILE_TRANSFER, CLIPBOARD_SYNC, DAILY_PRANK, with PRANK_PAYLOAD alias accepted. Prank IDs: confetti, airhorn, bsod, cat, jumpscare (transport compatibility).
- Files: 100 MiB each, 200 MiB aggregate receive reservation, 64 KiB UTF-8 clipboard limit, bounded pending transfers and timeouts. Received files remain in memory until page closes and are saved by explicit links.
- TURN settings are configurable; no unverified public TURN credentials are embedded. Public STUN alone cannot guarantee routing on every Wi-Fi/LTE network.
- Local demo works offline/direct file. Clipboard features need permissions and secure context. Real networking needs internet and loaded PeerJS. Cross-device QR needs a publicly reachable HTTPS app URL.
- The Spotify hook does not implement a token backend/OAuth account login; supply a fresh token callback and Premium account to use SDK playback.

## Checks

`node --test tests/transport.cjs` runs protocol regression tests with Node 22+.

Browser test scripts use Playwright and a running `node serve.cjs`. Set `PLAYWRIGHT_PATH` if Playwright is not locally installed, and optionally `BROWSER_PATH` to a Chromium/Edge executable. Available on the original machine:

```powershell
$env:PLAYWRIGHT_PATH='C:\Users\MaksL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tests/browser.cjs
node tests/live-peer.cjs
node tests/dashboard-live.cjs
```

Real phone hardware, a Wi-Fi-to-LTE path, TURN credentials, and Spotify credentials are external validation dependencies. Do not present local-browser success as proof of those environments.
