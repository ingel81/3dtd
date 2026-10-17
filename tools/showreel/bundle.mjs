// The app a recording plays: a development build of this checkout (the showreel hook needs ngDevMode), served
// by the runner itself on the recording port while it holds the display (run.mjs --record). Each agent records
// its own code from its own worktree; nothing is shared but the port, and the port only under the lock. No live
// reload, no rebuild under the recording, no server left running after it.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT } from './browser.mjs';

/** Where the build lies: dist/showreel-record/browser of this checkout */
export const BUNDLE = join(ROOT, 'dist/showreel-record');

/** The development build of this checkout (with the agent's script worker and the build info), its browser folder */
export function buildBundle(out = BUNDLE) {
  console.log(`building the app for the recording into ${out}`);
  const steps = [
    'node tools/agent/build-script-worker.mjs',
    'node tools/build-info.mjs',
    `npx ng build --configuration development --output-path "${out}"`,
  ];
  for (const step of steps) execSync(step, { cwd: ROOT, stdio: 'inherit' });
  return join(out, 'browser');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.txt': 'text/plain',
};

/**
 * The build served on `port` as the dev server serves it: the same isolation headers (angular.json), an
 * address without a file gets index.html (the app's routes). Resolves once it listens; `close()` ends it.
 */
export function serveBundle(dir, port) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`no build in ${root} (run.mjs --record builds one, or --bundle <dir>)`);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = extname(path) ? null : join(root, 'index.html');
    if (!file || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', (e) => fail(new Error(`port ${port}: ${e.message} (another server on it?)`)));
    server.listen(port, () => {
      console.log(`serving ${root} on http://localhost:${port}`);
      ok({ url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
