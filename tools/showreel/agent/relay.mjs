// The AI agent's take without the desktop app (DREHBUCH_R4 2.5, docs/AGENT_MCP.md): the app's own MCP server
// (desktop/src/agent-mcp.js, unchanged) runs here in Node, and its IPC to the window goes over a WebSocket to the
// showreel page, whose hook stands in for the desktop preload (src/app/showreel/agent-bridge.ts). When the page's
// scene asks (`act('agent', { replay, reset })`), replay.mjs sends the recorded calls of a fixture to that server as an
// MCP client over HTTP, so the editor, its Agent button and its agent band see what they would see in the app.
//
//   node tools/showreel/agent/relay.mjs [--port 47171] [--ws 47190]
//
// Start it before the run, beside the dev server; the scene's page carries `agent=<ws port>`. One page at a time
// (the newest connection is the window). Ctrl+C ends it.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { replay } from './replay.mjs';

const require = createRequire(import.meta.url);
const { setUpAgentMcp } = require('../../../desktop/src/agent-mcp.js');

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const mcpPort = Number(option('port', 47171));
const wsPort = Number(option('ws', 47190));

/** The window's side of Electron's IPC: handlers by channel, as ipcMain keeps them */
const handlers = new Map();
const ipcMain = {
  handle: (channel, fn) => handlers.set(channel, fn),
  on: (channel, fn) => handlers.set(channel, fn),
};

/** The page connected now; its messages are the window's */
let socket = null;
const contents = {
  send(channel, payload) {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ t: 'ipc', channel, payload }));
  },
  // view_picture: the take does not ask for one
  capturePage: () => Promise.reject(new Error('No window picture in the showreel relay')),
};
const window = { isDestroyed: () => !socket, webContents: contents };
const event = { sender: contents };

// The switch on from the start, as after the player allowed agents once
const userDataDir = mkdtempSync(join(tmpdir(), '3dtd-agent-relay-'));
writeFileSync(join(userDataDir, 'agent-mcp.json'), JSON.stringify({ enabled: true, port: mcpPort }));
const log = { info: (m) => console.log(m), warn: (m) => console.log(m) };
const agent = setUpAgentMcp({ ipcMain, getWindow: () => window, userDataDir, fs, log, isAppSender: () => true, version: 'showreel' });
await agent.started;
const url = agent.status().url;
if (!url) throw new Error(`the MCP server did not start: ${agent.status().error}`);

const wss = new WebSocketServer({ host: '127.0.0.1', port: wsPort });
wss.on('connection', (ws) => {
  socket = ws;
  console.log('[relay] a page connected');
  ws.on('close', () => {
    if (socket === ws) socket = null;
  });
  ws.on('message', async (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    const answer = (value, error) => ws.send(JSON.stringify({ t: 'result', id: m.id, value, ...(error ? { error } : {}) }));
    try {
      if (m.t === 'invoke') answer(await handlers.get(m.channel)?.(event, m.arg));
      else if (m.t === 'send') handlers.get(m.channel)?.(event, m.arg);
      else if (m.t === 'replay') {
        const results = await replay(m.name, url, (line) => console.log(`[replay] ${line}`));
        // `reset`: the switch off and on, as the player would: no agent seen, the band gone (after a warm-up)
        if (m.reset) {
          await handlers.get('desktop:agent-set-enabled')(event, false);
          await handlers.get('desktop:agent-set-enabled')(event, true);
        }
        answer(results);
      }
    } catch (e) {
      answer(null, String(e?.message ?? e));
    }
  });
});
console.log(`[relay] MCP ${url}, page socket ws://127.0.0.1:${wsPort}`);

process.on('SIGINT', async () => {
  await agent.close();
  wss.close();
  process.exit(0);
});
