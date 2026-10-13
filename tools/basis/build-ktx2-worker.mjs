/**
 * Writes public/basis/ktx2-worker.js: the worker three's KTX2Loader builds as
 * a blob, as a file of its own. The Basis transcoder's embind makes its
 * bindings with `new Function`, which the page's Content-Security-Policy
 * forbids and a blob worker inherits; a worker loaded from a URL takes the
 * policy of its own response instead, and only this file's allows it
 * (desktop/src/protocol.js, public/.htaccess). Same body as the loader's
 * (KTX2Loader.init), so it follows a three update. Run by postinstall.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const transcoder = readFileSync('node_modules/three/examples/jsm/libs/basis/basis_transcoder.js', 'utf8');
const fn = KTX2Loader.BasisWorker.toString();
const body = [
  '/* constants */',
  'let _EngineFormat = ' + JSON.stringify(KTX2Loader.EngineFormat),
  'let _EngineType = ' + JSON.stringify(KTX2Loader.EngineType),
  'let _TranscoderFormat = ' + JSON.stringify(KTX2Loader.TranscoderFormat),
  'let _BasisFormat = ' + JSON.stringify(KTX2Loader.BasisFormat),
  '/* basis_transcoder.js */',
  transcoder,
  '/* worker */',
  fn.substring(fn.indexOf('{') + 1, fn.lastIndexOf('}')),
].join('\n');

mkdirSync('public/basis', { recursive: true });
writeFileSync('public/basis/ktx2-worker.js', body);
console.log('KTX2 worker written');
