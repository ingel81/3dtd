'use strict';

/**
 * Where the window may go and what the page may ask for. Plain functions so
 * the rules are testable without Electron; main.js wires them up.
 */

/**
 * What to do with a URL the page wants to open or navigate to:
 * 'allow' stays in the window (same origin as the app), 'external' goes to
 * the system browser, 'deny' is dropped. Only http and https ever leave the
 * app, so a link can never hand a file:// path or a custom scheme to the
 * shell.
 */
function classifyNavigation(targetUrl, appOrigin) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return 'deny';
  }
  // Node reports origin "null" for schemes it does not know, app:// included,
  // so compare scheme and host instead of url.origin.
  if (`${url.protocol}//${url.host}` === appOrigin) return 'allow';
  if (url.protocol === 'https:' || url.protocol === 'http:') return 'external';
  return 'deny';
}

/**
 * Permissions the game uses. Writing to the clipboard backs the share link
 * and the copy buttons in the debug window; the pointer lock lets a manned
 * tower aim with the mouse (docs/TOWER_CONTROL.md; without it the tower
 * stayed at "Click the map to aim"). Camera, microphone, location,
 * notifications and the rest are never needed.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'pointerLock']);

function isPermissionAllowed(permission) {
  return ALLOWED_PERMISSIONS.has(permission);
}

module.exports = { ALLOWED_PERMISSIONS, classifyNavigation, isPermissionAllowed };
