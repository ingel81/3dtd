'use strict';

/**
 * Where files the game saves end up: screenshots from photo mode, the state
 * dump, corridor snapshots. The page saves them through a download link; a
 * browser drops them into Downloads and shows its download bar. The desktop
 * build saves a picture without a dialog (the photo bar says so) and asks
 * where anything else goes: a run log or a dump is looked for later, and a
 * notification in the background went unseen (User, 2026-09-26).
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

/** Pictures go straight to Downloads; everything else gets a save dialog. */
function savesSilently(suggested) {
  return /\.(png|jpe?g|webp)$/i.test(safeFileName(suggested));
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

/** Largest run log the page may write, bytes of UTF-16 text (a long run is a few MB) */
const MAX_RUN_LOG_CHARS = 64 * 2 ** 20;

/**
 * The file name of a run log in `userData/runs`, or null: one plain name of
 * letters, digits, dot, dash and underscore, not starting with a dot (".."
 * would be the folder above).
 */
function runLogFileName(raw) {
  const name = String(raw ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return name && !name.startsWith('.') ? name : null;
}

module.exports = { MAX_RUN_LOG_CHARS, runLogFileName, safeFileName, savesSilently, uniqueDownloadPath };
