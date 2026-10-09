/* Public browser configuration. No passwords, session tokens or database paths here.
 * Empty = use the server that serves this page.
 * For GitHub Pages, set apiBaseUrl to your deployed account server's HTTPS URL.
 * For the desktop app, empty defaults to the local account server on port 8083.
 */
(() => {
  // HTTPS address of the account server for the public website (your ngrok domain). Set by setup-web.ps1.
  const webApi = 'https://paver-outweigh-polyester.ngrok-free.dev';
  const onPublicSite = location.hostname === 'lorlovsky.github.io';
  window.NOTCHDROP_CONFIG = Object.freeze({ apiBaseUrl: onPublicSite ? webApi : '' });
})();
