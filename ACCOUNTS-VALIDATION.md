# Account system verification

Verified on Windows with Node 24, Edge and Electron 44.7.0. All accounts and passwords used in automated checks were created in isolated temporary databases; the user's normal database is not seeded with test accounts.

- `tests/accounts-api.cjs`: 10 passing tests against real SQLite. Case-insensitive username uniqueness, validation, scrypt password storage, hashed tokens, authenticated endpoints, private device ownership, stable peer IDs, recipient-only friendship approval, accepted-friend device discovery, server restart persistence, username changes, password replacement and session revocation, unfriend/logout, static-file restrictions, CORS rejection and login rate limits.
- `tests/accounts-browser.cjs`: passed real UI registration and login, session restoration, username friend request/acceptance, 140123-byte exact WebRTC transfer, same-account discovery across browser profiles, server-side logout revocation, and clipboard separation between accounts. Desktop/mobile screenshots were visually reviewed.
- `tests/browser.cjs`: passed after adapting to real accounts. CDN-offline dashboard and file-origin startup with a reachable local account API, demo music, settings, hidden-notch selection, notes, prank preview, drag/drop, responsive widths and no uncaught browser errors.
- `tests/dashboard-live.cjs`: passed full real PeerJS flow, consent, exact-byte download, clipboard accept/decline, disabled-notch fallback, daily cooldown, own-device auto-accept and trusted reconnect.
- `tests/pairing-flow.cjs`: passed mobile QR confirmation, host approval while its QR modal remains open, status progress, independent own-device consent and no overflow.
- `tests/desktop.cjs`: passed authenticated native primary-monitor placement, always-on-top/click-through behavior, shared music, text/file drops and settings visibility.
- `tests/spotify-desktop.cjs`: passed with the real Windows Spotify session available. Playback commands were tested through a fake adapter; the user's actual Spotify playback was not changed.

Public account hosting is not deployed. GitHub Pages still requires an HTTPS API with persistent storage, configured through `config.js`. The included Dockerfile is provided for deployment but has not been built here (Docker is not installed). Mobile-data TURN troubleshooting remains outside the user's current scope.
