'use strict';

/**
 * Copies the Angular production build (dist/3DTD/browser) into desktop/app/,
 * where electron-builder picks it up. Refuses when a locally configured tile
 * key made it into the bundle, see build-guard.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { filesContaining, secretValuesIn } = require('./build-guard');

const repoRoot = path.join(__dirname, '..', '..');
const source = path.join(repoRoot, 'dist', '3DTD', 'browser');
const target = path.join(__dirname, '..', 'app');
const environmentFiles = ['environment.ts', 'environment.prod.ts'].map((name) =>
  path.join(repoRoot, 'src', 'environments', name)
);

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error(`[copy-web] No build in ${source}. Run the Angular production build first.`);
  process.exit(1);
}

const secrets = environmentFiles
  .filter((file) => fs.existsSync(file))
  .flatMap((file) => secretValuesIn(fs.readFileSync(file, 'utf8')));
const leaks = filesContaining(source, secrets);
if (leaks.length > 0) {
  console.error('[copy-web] A tile key from src/environments is in the build. Refusing to package it.');
  for (const file of leaks) console.error(`  ${file}`);
  console.error('Leave cesiumIonToken and googleMapsApiKey empty in environment.prod.ts and rebuild.');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`[copy-web] ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, target)}`);
