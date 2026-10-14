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
 * Windows the page may open on the app's own origin, by name: the map
 * editor's test window ("Test map" and the bot's check, MAP_TEST_WINDOW in
 * src/app/world/map-trial.ts). Every other window.open on the app's origin is
 * dropped, so the page cannot spawn windows at will.
 */
const APP_WINDOW_NAMES = new Set(['3dtd-map-test']);

/**
 * What to do with a window.open: 'window' opens an app window (same
 * origin, a known name), 'external' hands an http(s) link to the system
 * browser, 'deny' drops it.
 */
function classifyWindowOpen(targetUrl, frameName, appOrigin) {
  // The editor opens its test window blank within the click (a popup blocker lets only that through) and sends it
  // to the game once the map is saved; the window keeps the app's settings, its navigation the app's rules
  if (targetUrl === 'about:blank' || targetUrl === '') return APP_WINDOW_NAMES.has(frameName) ? 'window' : 'deny';
  const verdict = classifyNavigation(targetUrl, appOrigin);
  if (verdict === 'allow') return APP_WINDOW_NAMES.has(frameName) ? 'window' : 'deny';
  return verdict;
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

module.exports = { ALLOWED_PERMISSIONS, APP_WINDOW_NAMES, classifyNavigation, classifyWindowOpen, isPermissionAllowed };
