'use strict';

/**
 * Who the game says it is to the free OpenStreetMap services.
 *
 * Their usage policies ask for a User-Agent or a Referer that identifies the
 * application. On the web the page's Referer does that. Under app:// there is
 * none, and overpass-api.de answers a browser User-Agent without a Referer
 * with 406 Not Acceptable (measured 2026-09-18: 406 with Chrome's or
 * Electron's default User-Agent, 200 with this one). The page cannot fix it
 * itself, Chromium ignores a User-Agent set in fetch(), so the main process
 * sets it on the way out, for these hosts only.
 */

const IDENTIFIED_HOSTS = [
  'https://overpass.kumi.systems',
  'https://overpass-api.de',
  'https://overpass.private.coffee',
  'https://nominatim.openstreetmap.org',
];

const PROJECT_URL = 'https://github.com/ingel81/3dtd';

function identifyingUserAgent(version) {
  return `3DTD/${version} (+${PROJECT_URL})`;
}

/** URL patterns for session.webRequest filters. */
function identifiedUrlPatterns() {
  return IDENTIFIED_HOSTS.map((host) => `${host}/*`);
}

module.exports = { IDENTIFIED_HOSTS, identifiedUrlPatterns, identifyingUserAgent };
