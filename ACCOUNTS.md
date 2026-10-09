# NotchDrop accounts

The current project lives in `C:\lorlovsky.github.io`. This is a real Node.js API and SQLite database, not a browser-only login simulation. Node 24 or newer is required. The account server has no npm runtime dependencies.

## Start locally

1. Double-click **Start Account Server.cmd**, or run `node server.cjs` in the project directory.
2. Open **http://localhost:8083**.
3. Select **Create account**, choose a username and password, and sign in. Usernames are case-insensitive, 3–24 letters/numbers/underscores. Passwords need 10–128 characters. There is no email requirement.
4. Leave the server running. Sign in to the same backend from your other browser/device to see your account's registered devices. Each device still approves the first P2P pairing.

The always-on-top desktop app uses this local API by default when `config.js` has an empty `apiBaseUrl`. Start the account server before launching **Start NotchDrop.cmd**. Browser and desktop profiles have separate login sessions. A configured public API URL works for both when that server allows the desktop's `null` file origin.

`serve.cjs` only serves static files and cannot run accounts. Opening `index.html` directly also needs the account server. New logins need a reachable backend; an already-loaded dashboard can continue its established P2P connections if the account server briefly goes offline.

## View the database in DBeaver

The server creates **`C:\lorlovsky.github.io\data\notchdrop.sqlite`** on its first start.

In DBeaver choose **New Database Connection → SQLite**, select that file, and finish. Let DBeaver install its SQLite driver if prompted. Inspect `users`, `sessions`, `devices`, and `friendships`. Passwords are salted scrypt hashes; session tokens are stored as SHA-256 hashes. Do not replace hashes with plaintext passwords.

Stop the server before manually changing the database or making a simple file copy backup. SQLite uses WAL files during writes. A SQLite-aware backup is preferable for a live server. Keep the database private: it is ignored by Git and Docker builds and cannot be downloaded from the app's HTTP server.

## What accounts save

- Unique usernames and hashed passwords, persistent seven-day sessions.
- Account-owned device names and stable PeerJS IDs; heartbeat timestamps indicate recent activity, not guaranteed network reachability.
- Username friend requests, recipient-only acceptance, and device discovery for accepted friends.
- Clipboard history, preferences and peer trust remain on each browser, under a separate storage key for each account. Files and clipboard content are not uploaded to the account database.

Settings lets you change your username, change your password, or sign out. Changing a password invalidates other login sessions. There is no email password recovery flow in this username-only version. Account registration does not automatically import old guest pairings or clipboard history; existing guest records are retained in their old storage key.

## Use accounts on the public website

GitHub Pages cannot execute `server.cjs` or host a writable database. Uploading the frontend alone is not sufficient. Deploy the account server to a Node 24 host with **persistent disk storage and HTTPS**. The same server can serve the complete frontend, which is the simplest deployment. Alternatively keep GitHub Pages as the frontend:

1. Deploy `server.cjs`, `database/schema.sql`, the frontend files and the two desktop bridge scripts listed in `Dockerfile`.
2. Keep the SQLite file on a persistent volume. Do not put it on an ephemeral/serverless filesystem, and run one server instance against that local database.
3. Set `NOTCHDROP_HOST=0.0.0.0`, the host's `PORT`, `NOTCHDROP_DATABASE` to the persistent file path, and `NOTCHDROP_PUBLIC_URL` to the backend's HTTPS URL.
4. Set `NOTCHDROP_ORIGINS=https://lorlovsky.github.io` (comma-separated exact origins if more are needed).
5. Set `apiBaseUrl` in `config.js` to the backend's HTTPS URL, without `/api`, and publish the frontend. This URL is public configuration; no database credentials or session tokens belong in that file.
6. For native Electron clients, also set `NOTCHDROP_ALLOW_FILE_ORIGIN=true` on the backend. File-origin requests still require the user's bearer session token. Local loopback servers allow file origins by default; publicly bound servers do not.

Use the same API URL on every client. Separate local servers create separate account databases even if users choose the same username. A laptop's localhost is not reachable from another laptop. Production passwords and tokens must travel over HTTPS; loopback HTTP is only for local use.

The included Dockerfile listens on 8083 and keeps data at `/data/notchdrop.sqlite`; mount a persistent volume at `/data`. TLS is supplied by your hosting platform or reverse proxy. Enable `NOTCHDROP_TRUST_PROXY=true` only if your trusted proxy overwrites `X-Forwarded-For`; otherwise login rate limits use the socket's source address.

## Verification

`npm test` runs the transport and real SQLite API tests. With Playwright and Edge installed, `node tests/accounts-browser.cjs` tests real registration/login, username friendships, an exact-byte WebRTC file transfer, same-account device discovery, logout and local account isolation. Tests use isolated temporary databases and never insert test users into your normal database.

Account authorization runs on the server for every API request. The database is not directly exposed to browsers. PeerJS still carries files between devices and requires explicit initial consent; an account does not replace TURN for blocked networks or make PeerJS's public signaling service an account-identity provider.
