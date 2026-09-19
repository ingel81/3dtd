'use strict';

/**
 * Where files the game saves end up: screenshots from photo mode, the state
 * dump, corridor snapshots. The page saves them through a download link; a
 * browser drops them into Downloads and shows its download bar. The desktop
 * build does the same without a dialog and says so in a notification.
 */

const path = require('node:path');

/** Characters Windows does not allow in a file name. */
const FORBIDDEN = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/** The name the page suggested, made safe for a single file in one folder. */
function safeFileName(suggested) {
  // The last segment after either separator, the same on every platform
  // (path.basename on Windows would also read "a:" as a drive).
  const last = String(suggested ?? '').split('/').pop().split('\\').pop();
  const cleaned = [...last]
    .map((ch) => (FORBIDDEN.has(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .replace(/^[. ]+|[. ]+$/g, '');
  return cleaned || 'download';
}

/**
 * A path in `dir` for `suggested` that does not overwrite anything:
 * "name.png", then "name (1).png", "name (2).png" as a browser numbers them.
 */
function uniqueDownloadPath(dir, suggested, exists) {
  const name = safeFileName(suggested);
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  let candidate = path.join(dir, name);
  for (let n = 1; exists(candidate); n++) {
    candidate = path.join(dir, `${stem} (${n})${extension}`);
  }
  return candidate;
}

module.exports = { safeFileName, uniqueDownloadPath };
