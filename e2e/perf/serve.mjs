// A build for the perf runners (e2e/perf/sim-load.ts): static files, index.html for routes, and with --isolate
// cross-origin isolated (COOP same-origin, COEP credentialless) as the game is served (docs/SIM_WORKER.md).
//   node e2e/perf/serve.mjs <dir> <port> [--isolate]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [dir, port] = process.argv.slice(2);
const ISOLATE = process.argv.includes('--isolate');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.bin': 'application/octet-stream',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = extname(path) ? join(dir, path) : join(dir, 'index.html');
  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
  if (ISOLATE) {
    headers['cross-origin-opener-policy'] = 'same-origin';
    headers['cross-origin-embedder-policy'] = 'credentialless';
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end();
  }
}).listen(Number(port), () => console.log(`${dir} on :${port}${ISOLATE ? ' isolated' : ''}`));
