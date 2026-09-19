'use strict';

/**
 * The page the window shows when the game failed to load or its renderer
 * died, instead of a blank or frozen window. A data: URL, so it needs no
 * file and no protocol handler that might be the thing that broke; its one
 * link goes back into the app, which will-navigate allows.
 */

/** net::ERR_ABORTED: a load replaced by another one, not a failure. */
const ERR_ABORTED = -3;

/** Whether a did-fail-load means the game did not come up. */
function isFatalLoadFailure(errorCode, isMainFrame) {
  return isMainFrame && errorCode !== ERR_ABORTED;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function errorPageHtml({ heading, detail, retryUrl, logDir }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>3DTD</title>
<style>
  html, body { height: 100%; margin: 0; }
  /* Colors from TD_THEME: bgDark, bgSurface, gold, textPrimary, textSecondary */
  body { display: grid; place-items: center; background: #111613; color: #eef1eb;
    font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 0.75rem; color: #c2a055; }
  p { margin: 0 0 1rem; }
  p.log { margin: 1rem 0 0; font-size: 0.85rem; color: #b6c0b3; }
  code { display: block; padding: 0.6rem 0.8rem; background: #1a201c; border-radius: 4px;
    font-size: 0.85rem; color: #b6c0b3; overflow-wrap: anywhere; }
  a { display: inline-block; margin-top: 0.5rem; padding: 0.5rem 1.2rem; border-radius: 4px;
    background: #c2a055; color: #111613; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(heading)}</h1>
  <p>Reloading usually helps. If it keeps happening, please open an issue on GitHub with what you did and this line:</p>
  <code>${escapeHtml(detail)}</code>
  <p class="log">The log file is in ${escapeHtml(logDir)}; Ctrl+Shift+L opens the folder.</p>
  <a href="${escapeHtml(retryUrl)}">Reload</a>
</main>
</body>
</html>`;
}

function errorPageUrl(content) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(errorPageHtml(content))}`;
}

module.exports = { errorPageHtml, errorPageUrl, isFatalLoadFailure };
