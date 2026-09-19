'use strict';

/**
 * The app:// protocol: serves the Angular build out of the asar.
 *
 * A registered standard + secure scheme gives the app a real origin
 * (app://app), so routing, module workers, WASM and fetch resolve the same way
 * they do on the web, without the quirks of file://. Everything in here is a
 * plain function over a request and a file reader, so the tests run it under
 * Node without Electron.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const APP_SCHEME = 'app';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Explicit types for everything the build contains. Chromium refuses to
 * stream-compile WASM without application/wasm, and a module worker without
 * a JavaScript type does not start at all.
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Hosts the game talks to. Anything else shows up as a CSP violation. */
const CONNECT_HOSTS = [
  'https://api.cesium.com',
  'https://assets.ion.cesium.com',
  'https://tile.googleapis.com',
  'https://nominatim.openstreetmap.org',
  'https://overpass.kumi.systems',
  'https://overpass-api.de',
  'https://overpass.private.coffee',
  'https://query.wikidata.org',
];

/**
 * Inline event handlers the Angular build writes into index.html. Beasties
 * (critical CSS) loads the full stylesheet as media="print" and flips it with
 * this handler; blocked, the page would keep only the critical CSS.
 */
const ALLOWED_INLINE_HANDLERS = ["this.media='all'"];

const sha256 = (source) => `'sha256-${crypto.createHash('sha256').update(source).digest('base64')}'`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' 'unsafe-hashes' ${ALLOWED_INLINE_HANDLERS.map(sha256).join(' ')}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  // blob: for GLTFLoader, which fetches the textures embedded in a .glb;
  // data: for AudioBufferCache, which fetches sounds shipped as data URLs.
  `connect-src 'self' blob: data: ${CONNECT_HOSTS.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Map an app:// URL to a file below `root`, or null when it must not be
 * served. Paths without a file extension are Angular routes and get
 * index.html; a missing file with an extension stays a 404 later, so a JSON
 * or GLB loader never parses HTML.
 */
function resolveFilePath(root, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (!path.posix.extname(lastSegment)) return path.join(root, 'index.html');

  // Decoding can bring back what URL parsing already resolved: %2e%2e, %5c.
  const relative = path.posix.normalize(pathname).replace(/^\/+/, '');
  if (
    relative.startsWith('..') ||
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.includes('\0')
  ) {
    return null;
  }

  const filePath = path.join(root, relative);
  const fromRoot = path.relative(root, filePath);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) return null;
  return filePath;
}

/**
 * Parse a single-range `Range` header. Returns null to ignore the header
 * (answer with the whole file), 'unsatisfiable' for a 416, or the byte span.
 * The music player seeks with currentTime and loops, and a media element needs
 * ranges for both.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (match[2] !== '' && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

const NOT_FOUND_ERRORS = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

/**
 * The handler for protocol.handle(). `readFile` is injected: fs.promises
 * reads inside the asar in Electron and a fake does in the tests.
 */
function createAppProtocolHandler({ root, readFile }) {
  const headers = (extra) => ({ 'Content-Security-Policy': CONTENT_SECURITY_POLICY, ...extra });

  return async function handleAppRequest(request) {
    const filePath = resolveFilePath(root, request.url);
    if (!filePath) return new Response(null, { status: 404, headers: headers() });

    let data;
    try {
      data = await readFile(filePath);
    } catch (error) {
      const status = NOT_FOUND_ERRORS.has(error?.code) ? 404 : 500;
      return new Response(null, { status, headers: headers() });
    }

    const type = { 'Content-Type': mimeTypeFor(filePath), 'Accept-Ranges': 'bytes' };
    const rangeHeader = request.headers?.get('range');
    const range = rangeHeader ? parseRange(rangeHeader, data.length) : null;

    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: headers({ ...type, 'Content-Range': `bytes */${data.length}` }),
      });
    }
    if (range) {
      const body = data.subarray(range.start, range.end + 1);
      return new Response(body, {
        status: 206,
        headers: headers({
          ...type,
          'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`,
          'Content-Length': String(body.length),
        }),
      });
    }
    return new Response(data, {
      status: 200,
      headers: headers({ ...type, 'Content-Length': String(data.length) }),
    });
  };
}

module.exports = {
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  ALLOWED_INLINE_HANDLERS,
  CONNECT_HOSTS,
  CONTENT_SECURITY_POLICY,
  createAppProtocolHandler,
  mimeTypeFor,
  parseRange,
  resolveFilePath,
};
