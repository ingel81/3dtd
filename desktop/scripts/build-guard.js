'use strict';

/**
 * Keeps local tile keys out of the installer.
 *
 * environment.ts and environment.prod.ts are gitignored and may hold the
 * developer's own Cesium token or Google key. A production build is supposed
 * to ship without them (the player brings their own), but one wrong line in
 * environment.prod.ts would put a paid key into every copy of the installer.
 * The guard reads the values that are set locally and looks for them in the
 * build, which is the one check that cannot miss the actual key.
 */

const fs = require('node:fs');
const path = require('node:path');

const SECRET_FIELDS = ['cesiumIonToken', 'googleMapsApiKey'];
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.html', '.css', '.txt', '.map']);

/** Non-empty values of the secret fields in an environment file's source. */
function secretValuesIn(source) {
  const values = [];
  const pattern = new RegExp(`(?:${SECRET_FIELDS.join('|')})\\s*:\\s*(['"\`])(.*?)\\1`, 'g');
  for (const match of source.matchAll(pattern)) {
    if (match[2].trim()) values.push(match[2].trim());
  }
  return values;
}

/** Files below `dir` (text only) that contain one of `secrets`, relative to `dir`. */
function filesContaining(dir, secrets) {
  if (secrets.length === 0) return [];
  const hits = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    const text = fs.readFileSync(filePath, 'utf8');
    if (secrets.some((secret) => text.includes(secret))) hits.push(path.relative(dir, filePath));
  }
  return hits;
}

module.exports = { SECRET_FIELDS, filesContaining, secretValuesIn };
