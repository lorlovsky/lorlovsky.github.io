# NotchDrop

A no-build, vanilla HTML/CSS/JavaScript dashboard with a Dynamic Island, device-to-device file sharing, clipboard bridge, original demo music, and daily pranks.

## Open it

### Desktop notch on your primary monitor (Windows)

Double-click **`Start NotchDrop.cmd`** in this folder. The optional Electron desktop runtime has been installed on this machine. On a fresh checkout, the launcher installs the pinned runtime once using npm, so Node.js and internet are needed for that initial installation.

You can also run `npm start` from this folder.

- The notch is a separate transparent, always-on-top window, fixed at the physical top center of the **primary monitor**, independent of the dashboard's position.
- Hover to expand music controls; click to keep them expanded. Drop Explorer files or text onto the notch to choose a recipient there.
- The transparent area surrounding the notch passes mouse input through to the windows underneath.
- Minimizing or closing the Command Center keeps the notch and active session running. Right-click the notch or use the NotchDrop tray icon to reopen the Command Center.
- Choose **Quit NotchDrop** from the tray/right-click menu to exit. Settings → Dynamic Notch can still hide it explicitly.
- Monitor configuration changes recenter it on the current primary screen. It does not install a Windows login/startup entry.

The desktop app has its own browser profile (`%APPDATA%\NotchDrop`), so pair devices once in this desktop session. The dashboard and overlay share a single networking/music engine. Normal Windows apps cannot cover the topmost notch; Windows secure screens (lock/UAC) and some exclusive fullscreen applications are controlled by the OS.

The desktop host uses [Electron's always-on-top window API](https://www.electronjs.org/docs/latest/api/browser-window) and [primary-display coordinates](https://www.electronjs.org/docs/latest/api/screen).

### Browser-only dashboard

Open `index.html` for the local dashboard and offline music demo. No package installation is needed. For networking and browser clipboard permissions, use a local server:

```sh
node serve.cjs
```

Visit **http://localhost:8080**. For devices on different networks, serve these static files on a public **HTTPS** host. A phone cannot open a laptop's `localhost` or local `file:` URL. Both devices must keep NotchDrop open; there is no background delivery.

## Connect your Spotify desktop app

1. Open Spotify on this Windows computer, sign in there, and play a song.
2. Right-click the native notch and choose **Connect Spotify desktop**. Alternatively open NotchDrop Settings and select **Connect Spotify desktop**.
3. Hover over the notch for the current song, artist, progress, and play/pause/previous/next controls. Seeking is enabled when Spotify exposes it to Windows.

Your source selection is remembered. This controls the already-running Spotify desktop app through Windows media sessions; no Spotify developer account, API token, or separate NotchDrop sign-in is needed. Spotify still plays the audio itself. If no session appears, start playback on **this computer** in Spotify and wait a moment. Use **Settings → Use demo music** to return to the original demos.

The Windows bridge only selects app IDs containing Spotify. It runs a hidden local helper, does not access your Spotify credentials, and does not send track metadata to a server. This native connection is distinct from the optional browser Web Playback SDK hook below. Reference: [Windows media-session controls](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession).

The online version fetches PeerJS 1.5.4 and QRCode.js 1.0.0 from the CDNs declared in `index.html`. If unavailable, the local dashboard, settings, notes, original synthesized demo music, and prank previews remain usable. The first online connection requires internet. Offline peer discovery, offline CDN loading, and cross-network transfer without connectivity are not claimed.

## Pair and share

1. Open the app on both devices.
2. On the first device select **Pair a device**. If needed, enter the public HTTPS app URL before generating the QR code.
3. Scan it on the other device and tap **Connect** in the confirmation dialog on that device. Alternatively, enter the first device's code manually and press **Connect**.
4. Verify the displayed identity/device code and approve the pairing on the receiving device. Only explicitly approved own devices qualify for automatic acceptance.
5. Pick or drop files, choose an online recipient, and accept the incoming offer. Clipboard and pranks use the same connection.

Friends are paired using a friend invitation or their device code. Identities, paired-device trust, preferences, history, and daily-prank cooldowns are browser-local; this application has no account backend or automatic account-wide device discovery. Names are user-supplied labels, not verified identities. Use a single active tab per browser profile/device identity.

## Cross-network connections

**Online means the signaling server is reachable; it does not prove that two devices can reach each other.** The pairing status panel distinguishes opening a connection from waiting for approval. Keep both browser tabs visible during pairing, particularly on phones.

If no approval appears:

1. For a QR invitation, first tap **Connect on the scanning phone**. The other device cannot receive a request before this step.
2. Check the pairing status. **Waiting for approval** means the other device was reached. **Connecting** or **Device connection is taking longer** means the approval has not reached it yet.
3. A route failure remains visible with **Retry pairing**, **Relay settings**, and **Copy connection details**. The copied details contain phases and device IDs, never pairing secrets or TURN credentials.
4. If another network also fails, configure a working TURN service on both devices. HTTPS hosting alone cannot relay WebRTC traffic. [Open Relay's setup guide](https://www.metered.ca/tools/openrelay/) describes obtaining relay credentials; enter TURN credentials in Settings, not a provider's account API secret. Use the provider's TCP/TLS endpoint when UDP is blocked.
5. If a code is unavailable, keep exactly one tab open per device and copy its current code. Website and desktop-app identities are separate.

Pairing failures now clear pending connections, so Retry starts a fresh attempt. Direct connection attempts time out after 45 seconds; once the data channel opens, users get two minutes to approve.

PeerJS Cloud handles signaling; WebRTC encrypts the data channel. Public STUN assists direct connections. Some school, enterprise, carrier, and symmetric-NAT networks require a TURN relay. In **Settings → Advanced · cross-network relay**, enter a TURN service URL, username, and credential. Test **Force relay** on both devices when validating the relay. No unauthenticated public TURN server is assumed, and no shared third-party credentials are embedded.

TURN relays carry encrypted WebRTC traffic; signaling/relay operators can still observe connection metadata. This app does not upload files to an application storage server. Browser-local trust is not a substitute for a production identity/account service. TURN credentials are stored in this browser; use limited-lived credentials for a production deployment.

Reference: [PeerJS connection and data APIs](https://peerjs.com/client/getting-started), [WebRTC ICE server configuration](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/RTCPeerConnection), [QRCode.js](https://github.com/davidshimjs/qrcodejs).

## Browser behavior

- Clipboard reading needs browser permission and a secure context (HTTPS or localhost). If denied, paste into **Write a quick note**. Receiving a clipboard does not overwrite the system clipboard automatically.
- Audio starts after a user gesture. The offline demo contains original programmatically synthesized tracks. Prank sound may require a tap if browser autoplay policy blocks it.
- Downloads are offered as explicit save links after successful reception. Large files are assembled in browser memory; the transport caps individual transfers at 100 MiB.
- Daily prank limits are tracked locally per recipient for 24 hours. Clearing browser data resets local limits; this is a casual feature, not an abuse-resistant server-side quota.
- Settings and pairing persist per browser origin. Moving between `file:`, localhost, and a hosted URL creates separate storage contexts.

## Files

- `index.html`: semantic dashboard, notch, dialogs, and CDN loading.
- `styles.css`: responsive dark UI, notch physics, accessibility, reduced-motion support.
- `app.js`: identity, trust, dashboard, selection, clipboard, requests, pranks, and settings.
- `peer.js`: PeerJS signaling, trust handshake, accepted chunk transfer, acknowledgments, QR utilities.
- `music.js`: offline original audio and optional Spotify SDK integration hook.
- `serve.cjs`: optional no-dependency static development server.
- `desktop/`: optional native window host, restricted preload bridge, overlay, and dashboard synchronizer.
- `Start NotchDrop.cmd`: double-click Windows desktop launcher.

The Spotify hook accepts the SDK token callback convention:

```js
NotchMusic.connectSpotify(callback => callback(freshAccessToken));
// Choose NotchDrop in Spotify Connect, then use the existing player controls.
// Return to the original offline demos:
NotchMusic.disconnectSpotify();
```

Supply tokens from your own OAuth flow; no token or client secret is bundled. See the [Spotify Web Playback SDK reference](https://developer.spotify.com/documentation/web-playback-sdk/reference).

See `VALIDATION.md` for verification results and remaining real-device checks.
