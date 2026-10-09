# Pairing investigation — 2026-10-09

- The existing published site passed the live dashboard test in two isolated Edge browser contexts: approval, exact-byte file download, clipboard, prank consent and trusted reconnect.
- A diagnostic peer connected to the user's open computer tab on the published site. The user saw and accepted the approval. The data channel and pairing handshake both completed.
- The supplied phone code appeared truncated at the start. Two attempts with the app's generated `user-maks-` prefix restored returned `peer-unavailable` from signaling before ICE negotiation. This does not establish a TURN/NAT failure; the full current phone code and a foreground browser session are still needed.
- After the user brought the phone online, a third attempt reached it: signaling became stable, ICE went from checking to disconnected, and the data channel never opened. The attempt timed out before approval. A working TURN relay is the missing fallback for this observed direct-route failure.
- Those tests run on one physical Windows machine. They do not prove connectivity between separate devices, mobile data, or isolated Wi-Fi clients.
- A probe of the publicly documented Open Relay static-auth service yielded no relay candidates within 20 seconds. It was not added as a working fallback.
- The patch adds visible mobile QR confirmation, explicit Connect wording, persistent pairing phases, timeout/route explanations, retry cleanup, and copyable diagnostics without secrets.
- `tests/pairing-flow.cjs` passed against real public signaling with patched assets intercepted locally: 390px mobile QR confirmation, host approval while its QR modal is open, independent own-device consent, successful connection and no page errors or horizontal overflow.
- `node --test tests/transport.cjs` passed all 10 tests, including blocked-route timeout and retry cleanup.
- After applying the patch to `C:\lorlovsky.github.io`, `tests/dashboard-live.cjs` passed against port 8082 (full pairing/transfer/reconnect regression), and `tests/browser.cjs` passed (offline, mobile, direct file, music, settings and no browser exceptions).

The user subsequently confirmed that sharing with another laptop works and explicitly stopped phone troubleshooting. No TURN account setup is needed for their current working laptop connection. Phone/mobile-data support remains unverified with a relay; no working TURN credentials were added. The frontend improvements are saved locally and have not been published.

Run the new live check using `node tests/pairing-flow.cjs`. Set `NOTCHDROP_URL` to a reachable app URL; `PLAYWRIGHT_PATH` and `BROWSER_PATH` can select an existing Playwright install and browser. Optional `NOTCHDROP_OVERRIDE` intercepts index.html, app.js, peer.js and styles.css from a local folder before publishing (root-hosted URL).
