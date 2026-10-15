'use strict';

/**
 * AI agents build and change maps in the open editor (TODO E171,
 * docs/AGENT_MCP.md): an MCP server (Streamable HTTP, the official SDK) in
 * the main process, on 127.0.0.1 only, off until the player allows it in the
 * settings. Each tool call goes to the page over IPC; the editor answers it
 * against the map it has open (src/app/editor/agent/editor-agent.ts), so a
 * player can watch every change land. The view picture is taken here.
 *
 * No token (the player's choice): any program on this machine may connect
 * while the switch is on. Web pages may not: a request with an Origin header
 * or a Host other than this address is refused, which stops a page in the
 * browser from posting to the port and DNS rebinding from reaching it.
 */

const http = require('node:http');
const path = require('node:path');
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server');
const z = require('zod');

/** The port tried first; the next few when it is taken. Kept once found, so an agent's setup stays valid */
const DEFAULT_PORT = 47171;
const PORT_TRIES = 10;
const MCP_PATH = '/mcp';
/** Largest request body (a script with its data), bytes */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** How long the editor may take for a call, ms; a script runs up to 30 s and plays up to 8 s */
const CALL_TIMEOUT_MS = 30_000;
const SCRIPT_TIMEOUT_MS = 120_000;
/** Widest view picture */
const MAX_VIEW_WIDTH = 1600;

/**
 * Whether a request may reach the server: Host names this address (loopback
 * name and the port), no Origin (browsers send one with every cross-origin
 * POST, other programs do not), no browser fetch metadata. `{ ok }` or the
 * status and why.
 */
function checkRequest(headers, port) {
  const host = String(headers.host ?? '').toLowerCase();
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(host)) return { ok: false, status: 403, reason: `Host ${host || '(none)'} is not this server` };
  if (headers.origin !== undefined) return { ok: false, status: 403, reason: 'Requests from web pages are refused' };
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'none') return { ok: false, status: 403, reason: 'Requests from web pages are refused' };
  return { ok: true };
}

/** The settings file's content: enabled and the port, sane defaults for anything else */
function readSettings(text) {
  try {
    const raw = JSON.parse(text);
    const port = Number.isInteger(raw?.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : DEFAULT_PORT;
    return { enabled: raw?.enabled === true, port };
  } catch {
    return { enabled: false, port: DEFAULT_PORT };
  }
}

const rect = {
  x0: z.number().describe('West edge, metres'),
  y0: z.number().describe('South edge, metres'),
  x1: z.number().describe('East edge, metres'),
  y1: z.number().describe('North edge, metres'),
};
const optionalRect = Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, v.optional()]));
const placement = {
  z: z.number().optional().describe('Height over the ground, metres'),
  rotation: z.number().optional().describe('Turn, radians counter-clockwise from north'),
  scale: z.number().positive().optional(),
  pitch: z.number().optional().describe('Tilt about the model x axis, radians'),
  roll: z.number().optional().describe('Tilt about the model z axis, radians'),
  tint: z.string().optional().describe('Colour like #aabbcc'),
  blocksBuild: z.boolean().optional(),
  blocksLos: z.boolean().optional(),
};
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/**
 * The tools: name, what the agent reads about it, its input and whether it
 * only reads. All but view_picture are answered by the editor.
 */
const TOOLS = [
  ['map_summary', 'The map open in the editor at a glance: size, heights, ground layers, water, roads, spawns with their lane lengths, HQ, objects by category, scene cost, sky, rules and the undo history. Start here.', {}, READ],
  ['map_heights', 'Ground heights over a rectangle, downsampled to `samples` a side (default 32, at most 128); rows from south to north, metres rounded to 0.1.', { ...rect, samples: z.number().int().min(2).max(128).optional() }, READ],
  ['map_objects', 'Objects in a rectangle (all without one), optionally of one asset; at most 1000 listed.', { ...optionalRect, asset: z.string().optional() }, READ],
  ['check_map', "The editor's check of the open map as data: errors (the map cannot be played) and warnings, each with where to look.", {}, READ],
  ['catalog', 'What can be painted and placed: ground materials, object assets, landscape biomes, generator presets, landforms. Without a filter only the ids, grouped; with category (an object category or "Materials"), tag (e.g. winter, volcanic, coast) or search the full rows (size, tags, whether it blocks building).', { category: z.string().optional(), tag: z.string().optional(), search: z.string().optional() }, READ],
  ['script_api', 'The commands and reads a run_script script has (`map.*`), with their arguments. Read it before the first script.', {}, READ],
  ['view_picture', 'A picture of the app window as the player sees it (the editor view and its panels). Use it sparingly; the check and the numbers usually say enough.', { max_width: z.number().int().min(320).max(MAX_VIEW_WIDTH).optional() }, READ],
  ['top_down_picture', 'The open map from straight above, north up, `size` pixels a side (default 512, at most 1024): roads, spawns and the HQ drawn over the ground, the relief shaded with light from the north-west.', { size: z.number().int().min(128).max(1024).optional() }, READ],
  ['list_maps', "The player's own maps and the shipped ones; which is open.", {}, READ],
  ['read_map', 'Read any map without opening it: its summary, heights or objects (as map_summary, map_heights, map_objects). Never changes it.', { id: z.string(), what: z.enum(['summary', 'heights', 'objects']).optional(), ...optionalRect, samples: z.number().int().min(2).max(128).optional(), asset: z.string().optional() }, READ],
  [
    'run_script',
    'Run a JavaScript script against the open map (`map.raise(...)`, `map.road(...)`, `map.biome(...)` …; see script_api). It runs sandboxed on a copy first (no network, no files, 30 s); then the editor plays its commands on the map, animated for the player, as ONE undo step. A failing script changes nothing, nor does one that leaves the map as it was. The answer carries the findings of the check. dry_run: true only runs it on the copy (to try reads or a command) and changes nothing. Prefer few scripts with many commands, strokes along lines over single dabs.',
    {
      source: z.string().min(1).max(1_000_000).describe('The script body; `return` a value to get it back'),
      label: z.string().max(60).optional().describe('Name of the undo step, after "Agent: "'),
      seed: z.number().int().optional().describe('Seed of the random strokes (default 1)'),
      animate: z.boolean().optional().describe('Draw it over a few seconds for the player (default true)'),
      dry_run: z.boolean().optional().describe('Run on a copy only and return its logs and value; the map stays as it is (default false)'),
    },
    WRITE,
  ],
  ['move_marker', 'Move the HQ (target "hq") or a spawn (its id or name) to a point.', { target: z.string(), x: z.number(), y: z.number() }, WRITE],
  ['place_object', 'Place one object of a catalog asset.', { asset: z.string(), x: z.number(), y: z.number(), ...placement }, WRITE],
  ['move_object', 'Move, turn, scale or tint one object by id.', { id: z.string(), x: z.number().optional(), y: z.number().optional(), ...placement }, WRITE],
  ['delete_objects', 'Delete objects by id (map_objects lists them). Roads are no objects: map.removeRoads in run_script deletes them.', { ids: z.array(z.string()).min(1) }, WRITE],
  ['set_rules', "Change the rules (gameplay), merged into the map's: startCredits, hqHealth, towers (tower ids, all when left out), destructible (true|false), difficulty 50..200 (percent on the wave budget, 100 normal). waves is { kind: 'budget' } (the game's waves, the default) or a map's own table; there is no wave count.", { rules: z.record(z.string(), z.unknown()) }, WRITE],
  ['set_sky', "Change sky and air: sky (day, dusk, night, overcast), sunAzimuth, sunElevation (degrees), fogDensity, tint ('#rrggbb'), weather (clear, rain, snow, fog), weatherStrength 0..1, biome (the look of sky, light and air: temperate, hell, moon, mars, arctic, apocalypse, swamp, desert, mountain, city), snowCover 0..1, moonlight 0..1, wind { strength 0..1, direction degrees, gusts 0..1 }.", { environment: z.record(z.string(), z.unknown()) }, WRITE],
  ['undo_last', "Undo the agent's own last step; a step of the player stays.", {}, WRITE],
  ['copy_map', 'Copy any map (own or shipped) as a new own map; returns its id. The open map stays open; other maps are never changed.', { id: z.string(), name: z.string().max(80).optional() }, WRITE],
];

const INSTRUCTIONS = [
  '3DTD map editor: you build and change the map the player has open, while they may watch.',
  'Coordinates are metres, x east, y north, (0, 0) the map centre. Each change is one undo step named "Agent: …".',
  'Work in few run_script calls (read script_api first): strokes along lines and polygons, many commands per script.',
  'Then check_map and map_summary; pictures only now and then. Other maps can be read and copied, not changed.',
  'A new map may already hold a spawn, a road and the HQ: map_summary lists them.',
].join(' ');

/** An editor answer as an MCP tool result */
function toolResult(answer) {
  const content = [{ type: 'text', text: String(answer?.text ?? '') }];
  if (answer?.image?.data) content.push({ type: 'image', data: answer.image.data, mimeType: answer.image.mimeType || 'image/jpeg' });
  return { content, isError: !!answer?.isError };
}

/**
 * The MCP server over node:http. `callEditor(tool, args)` resolves with the
 * editor's answer ({ text, image?, isError? }); `captureView(maxWidth)` with
 * a picture of the window ({ mimeType, data }) or null.
 */
function createAgentServer({ callEditor, captureView, log, version }) {
  const factory = () => {
    const server = new McpServer({ name: '3dtd-map-editor', version }, { instructions: INSTRUCTIONS });
    for (const [name, description, shape, annotations] of TOOLS) {
      server.registerTool(name, { description, inputSchema: z.object(shape), annotations }, async (args) => {
        log.info(`[agent] ${name}`);
        if (name === 'view_picture') {
          const image = await captureView(args?.max_width ?? 1280);
          return toolResult(image ? { text: 'The app window as the player sees it', image } : { text: 'No window to picture', isError: true });
        }
        return toolResult(await callEditor(name, args ?? {}));
      });
    }
    return server;
  };
  // Made anew at each listen: a closed handler aborts what it serves
  let handler = null;
  let server = null;
  let port = null;

  const serve = async (req, res) => {
    const mcp = handler;
    if (!mcp) {
      res.writeHead(503).end();
      return;
    }
    const verdict = checkRequest(req.headers, port);
    if (!verdict.ok) {
      log.warn(`[agent] refused a request: ${verdict.reason}`);
      res.writeHead(verdict.status, { 'content-type': 'text/plain' }).end(verdict.reason);
      return;
    }
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`The MCP endpoint is ${MCP_PATH}`);
      return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'content-type': 'text/plain' }).end('Request too large');
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks);
    const response = await mcp.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    req.on('close', () => void reader.cancel().catch(() => {}));
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };

  return {
    /** Listens on 127.0.0.1, `preferred` first; resolves with the port */
    listen(preferred = DEFAULT_PORT, tries = PORT_TRIES) {
      return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryPort = (p) => {
          const s = http.createServer((req, res) =>
            serve(req, res).catch((error) => {
              log.warn(`[agent] request failed: ${error.message}`);
              if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
              res.end();
            })
          );
          s.once('error', (error) => {
            if (error.code === 'EADDRINUSE' && ++attempt < tries && p !== 0) tryPort(p + 1);
            else reject(error);
          });
          s.listen(p, '127.0.0.1', () => {
            server = s;
            port = s.address().port;
            handler = createMcpHandler(factory, { onerror: (error) => log.warn(`[agent] ${error.message}`) });
            resolve(port);
          });
        };
        tryPort(preferred);
      });
    },
    get port() {
      return port;
    },
    async close() {
      const s = server;
      const h = handler;
      server = null;
      port = null;
      handler = null;
      await h?.close().catch(() => {});
      if (s) await new Promise((resolve) => s.close(() => resolve()));
      s?.closeAllConnections?.();
    },
  };
}

/**
 * The switch, the server and the IPC to the page. `getWindow()` is the main
 * window, whose editor answers; `isAppSender(event)` keeps the channels to
 * the app's own page; settings live in `userData/agent-mcp.json`.
 */
function setUpAgentMcp({ ipcMain, getWindow, userDataDir, fs, log, isAppSender, version }) {
  const settingsFile = path.join(userDataDir, 'agent-mcp.json');
  let settings = { enabled: false, port: DEFAULT_PORT };
  try {
    settings = readSettings(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    // No file yet: off
  }
  const save = () => {
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(settings));
    } catch (error) {
      log.warn(`[agent] could not save the setting: ${error.message}`);
    }
  };

  let nextId = 1;
  const pending = new Map();

  ipcMain.on('desktop:agent-reply', (event, reply) => {
    if (!isAppSender(event)) return;
    const waiting = pending.get(reply?.id);
    if (!waiting || event.sender !== waiting.contents) return;
    pending.delete(reply.id);
    clearTimeout(waiting.timer);
    waiting.resolve(reply.answer && typeof reply.answer === 'object' && typeof reply.answer.text === 'string' ? reply.answer : { text: 'The editor gave no answer', isError: true });
  });

  const callEditor = (tool, args) =>
    new Promise((resolve) => {
      const window = getWindow();
      if (!window || window.isDestroyed()) {
        resolve({ text: 'The game window is closed', isError: true });
        return;
      }
      const id = nextId++;
      const contents = window.webContents;
      const timeout = tool === 'run_script' ? SCRIPT_TIMEOUT_MS : CALL_TIMEOUT_MS;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ text: `The editor did not answer within ${timeout / 1000} s`, isError: true });
      }, timeout);
      pending.set(id, { resolve, timer, contents });
      contents.send('desktop:agent-call', { id, tool, args });
    });

  const captureView = async (maxWidth) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return null;
    let image = await window.webContents.capturePage();
    const { width } = image.getSize();
    const target = Math.min(MAX_VIEW_WIDTH, maxWidth);
    if (width > target) image = image.resize({ width: target, quality: 'good' });
    return { mimeType: 'image/jpeg', data: image.toJPEG(82).toString('base64') };
  };

  const agentServer = createAgentServer({ callEditor, captureView, log, version });
  let error = null;

  const status = () => ({ enabled: settings.enabled, url: agentServer.port ? `http://127.0.0.1:${agentServer.port}${MCP_PATH}` : null, ...(error ? { error } : {}) });

  const apply = async () => {
    error = null;
    if (!settings.enabled) {
      if (agentServer.port) log.info('[agent] MCP server stopped');
      await agentServer.close();
      return;
    }
    if (agentServer.port) return;
    try {
      const port = await agentServer.listen(settings.port);
      log.info(`[agent] MCP server on http://127.0.0.1:${port}${MCP_PATH}`);
      if (port !== settings.port) {
        settings.port = port;
        save();
      }
    } catch (e) {
      error = `The server could not start: ${e.message}`;
      log.warn(`[agent] ${error}`);
    }
  };

  ipcMain.handle('desktop:agent-status', (event) => (isAppSender(event) ? status() : null));
  ipcMain.handle('desktop:agent-set-enabled', async (event, on) => {
    if (!isAppSender(event)) return null;
    settings.enabled = on === true;
    save();
    await apply();
    return status();
  });

  const started = apply();
  return {
    started,
    status,
    async close() {
      for (const [, waiting] of pending) {
        clearTimeout(waiting.timer);
        waiting.resolve({ text: 'The app is closing', isError: true });
      }
      pending.clear();
      await agentServer.close();
    },
  };
}

module.exports = { DEFAULT_PORT, MCP_PATH, TOOLS, checkRequest, readSettings, createAgentServer, setUpAgentMcp };
