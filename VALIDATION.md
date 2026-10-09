# Verification

Verified on 2026-10-09 with Node 24 and headless Microsoft Edge 154.

## Passed

- JavaScript syntax checks for app, music, peer transport, and local server.
- `node --test tests/transport.cjs`: 9 passing tests including the parent suite. Explicit consent, independent trust roles, multi-chunk binary integrity, empty files, UTF-8 clipboard, acknowledged pranks, decline/size validation, disconnect cleanup, HMAC reconnect, typed-array offsets, malformed chunk rejection, and QR URL validation.
- `tests/browser.cjs`: all external network requests blocked; desktop, mobile, and direct `file://` launch; original demo playback, advancing audio clock, seek and track changes; settings persistence; safe plain-text notes; local prank preview; drag/drop states; offline pairing fallback; no horizontal overflow at 390, 768, and 1024 pixels; no uncaught page errors.
- Desktop (1440 px) and mobile (390 px) screenshots visually inspected: responsive layout, notch, cards, spacing, and controls.
- `tests/live-peer.cjs`: real public PeerJS signaling and actual WebRTC data channels between isolated browser contexts. Exact integrity of a 196,623-byte file, Unicode clipboard, and prank acknowledgment.
- `tests/dashboard-live.cjs`: real UI pairing while the host QR dialog stays open; friend approval; exact-byte download of a 160,123-byte file; clipboard decline and safe text acceptance; request dialog when notch is hidden; prank approval and 24-hour cooldown; own-device explicit trust and auto-accept; simultaneous trusted reconnection after both tabs reload.

The live tests exposed and drove fixes for PeerJS Uint8Array chunk decoding, completed progress overwriting file download links, and competing connections when both paired tabs reconnect simultaneously.

Follow-up checklist audit: corrected the Notch Off setting so drag/drop and recipient selection cannot reveal a disabled notch; recipient selection uses a standalone modal. Added the previously missing prank notch expansion/glow and restoration after dismissal. Browser regression checks cover the disabled-notch recipient dialog, Escape cancellation, and expanded prank geometry. The playback-clock check waits for observable clock advancement instead of assuming a fixed audio startup delay.

## Native Windows notch extension

Electron 44.7.0 was installed locally as an optional desktop runtime. `tests/desktop.cjs` passed against the actual runtime: primary-monitor top-center bounds, native always-on-top flag, nonresizable overlay, renderer sandbox isolation, hover expansion, shared play/pause/next controls, bounded text/file drops into the existing pipeline, settings hide/restore, and persistence after minimizing/closing the Command Center. The test uses a separate temporary profile.

The native click-through API was exercised with controlled inside/outside cursor coordinates, and a display-metrics event restored the overlay's correct position. Screenshot inspection confirmed the overlay's appearance; sampling a pixel outside the notch returned alpha 0 (fully transparent). Physical monitor unplug/reconfiguration and secure/exclusive fullscreen screens were not tested. The original browser regression suite passed after adding the optional host bridge.

Run `npm start` or double-click `Start NotchDrop.cmd` to use the desktop extension. The web version still has no package/build requirement.

## Spotify desktop connection

The native Windows media bridge was verified against an active Spotify desktop session: track/artist metadata, playback state, duration, position, and seek capability were available. `tests/spotify-desktop.cjs` verifies source selection/persistence, live metadata rendering, control routing (play/pause/next/previous/seek) with a fake adapter, and return to demos. The verification does not pause or skip the user's actual Spotify music. Cover artwork is displayed when Windows supplies a usable thumbnail; some sessions expose metadata without a cover.

This local desktop integration needs no OAuth token. The browser-only Web Playback SDK remains an optional separate integration requiring Spotify authentication.

## Requires external devices or credentials

- Actual phone camera QR scanning and camera upload (mobile layout was tested with viewport emulation).
- Separate physical Wi-Fi and LTE paths, including restrictive school/carrier NAT and a configured TURN service. Local-browser real WebRTC success is not a guarantee of every network topology.
- Real Spotify Premium/OAuth playback. The SDK hook is implemented; original offline demo playback was verified.
- Browser-specific clipboard permission prompts and background/sleep policies on mobile hardware.

## Reproduce

Run `node serve.cjs`, then run the scripts in `tests/`. Protocol tests need only Node 22+. Browser tests need an external Playwright install and Chromium/Edge, provided through `PLAYWRIGHT_PATH` and optionally `BROWSER_PATH`. The application itself has no build dependencies. See `CLAUDE.md` for the original machine's test-runtime paths.
