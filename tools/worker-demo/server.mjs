// Worker demo server (docs/archive/WORKER_PLAN.md): static files with the cross-origin isolation headers switchable per port.
//   node server.mjs   -> :4240 no headers, :4241 COOP + COEP require-corp, :4242 COOP + COEP credentialless
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const MODES = { 4240: null, 4241: 'require-corp', 4242: 'credentialless' };

for (const [port, coep] of Object.entries(MODES)) {
  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = join(ROOT, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
      if (coep) {
        headers['cross-origin-opener-policy'] = 'same-origin';
        headers['cross-origin-embedder-policy'] = coep;
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }).listen(Number(port), () => console.log(`:${port} coep=${coep ?? 'none'}`));
}
