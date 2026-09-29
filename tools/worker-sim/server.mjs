// Static files for the worker lab, cross-origin isolated (COOP + COEP require-corp) so that
// performance.now() has its fine resolution in both browsers.  node tools/worker-sim/server.mjs  -> :4250
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4250);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'text/html',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => console.log(`:${PORT}`));
