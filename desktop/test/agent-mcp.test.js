'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { describe, it, after } = require('node:test');
const { DEFAULT_PORT, TOOLS, checkRequest, createAgentServer, readSettings, setUpAgentMcp } = require('../src/agent-mcp');

const silent = { info: () => {}, warn: () => {} };

/** A raw HTTP request, so the test sets Host and Origin as a browser or another program would */
function send(port, { method = 'POST', path = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
          ...(data ? { 'content-length': data.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** The JSON-RPC message of an SSE or JSON answer */
function message(text) {
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : text);
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const initialize = rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });

describe('checkRequest', () => {
  it('takes a program on this machine that names this address', () => {
    assert.deepEqual(checkRequest({ host: '127.0.0.1:47171' }, 47171), { ok: true });
    assert.deepEqual(checkRequest({ host: 'localhost:47171', 'sec-fetch-site': 'none' }, 47171), { ok: true });
  });

  it('refuses another Host: DNS rebinding, another port, none', () => {
    for (const host of ['evil.example:47171', '127.0.0.1:47172', '127.0.0.1', '192.168.1.5:47171', undefined]) {
      assert.equal(checkRequest({ host }, 47171).ok, false, String(host));
    }
  });

  it('refuses every web page, even one on localhost', () => {
    for (const origin of ['https://evil.example', 'http://localhost:4200', 'null', 'app://app']) {
      assert.deepEqual(checkRequest({ host: '127.0.0.1:47171', origin }, 47171), { ok: false, status: 403, reason: 'Requests from web pages are refused' });
    }
    assert.equal(checkRequest({ host: '127.0.0.1:47171', 'sec-fetch-site': 'cross-site' }, 47171).ok, false);
  });
});

describe('readSettings', () => {
  it('is off on the default port unless the file says otherwise', () => {
    assert.deepEqual(readSettings('garbage'), { enabled: false, port: DEFAULT_PORT });
    assert.deepEqual(readSettings('{"enabled":"yes","port":80}'), { enabled: false, port: DEFAULT_PORT });
    assert.deepEqual(readSettings('{"enabled":true,"port":47180}'), { enabled: true, port: 47180 });
  });
});

describe('createAgentServer', () => {
  const calls = [];
  const server = createAgentServer({
    callEditor: async (tool, args) => {
      calls.push({ tool, args });
      return tool === 'top_down_picture' ? { text: '{}', image: { mimeType: 'image/jpeg', data: 'AAAA' } } : { text: JSON.stringify({ tool, args }) };
    },
    captureView: async (width) => ({ mimeType: 'image/jpeg', data: `w${width}` }),
    log: silent,
    version: 'test',
  });
  after(() => server.close());

  it('serves the tools over Streamable HTTP and hands each call to the editor', async () => {
    const port = await server.listen(0);
    const init = await send(port, { body: initialize });
    assert.equal(init.status, 200);
    assert.equal(message(init.text).result.serverInfo.name, '3dtd-map-editor');
    assert.match(message(init.text).result.instructions, /undo step/);

    const list = message((await send(port, { body: rpc(2, 'tools/list') })).text);
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), TOOLS.map(([name]) => name).sort());
    const info = list.result.tools.find((t) => t.name === 'set_map_info');
    assert.deepEqual(Object.keys(info.inputSchema.properties).sort(), ['description', 'name']);
    const script = list.result.tools.find((t) => t.name === 'run_script');
    assert.deepEqual(script.inputSchema.required, ['source']);
    assert.equal(script.annotations.readOnlyHint, false);

    const answer = message((await send(port, { body: rpc(3, 'tools/call', { name: 'map_heights', arguments: { x0: -1, y0: -1, x1: 1, y1: 1 } }) })).text);
    assert.deepEqual(JSON.parse(answer.result.content[0].text), { tool: 'map_heights', args: { x0: -1, y0: -1, x1: 1, y1: 1 } });

    const picture = message((await send(port, { body: rpc(4, 'tools/call', { name: 'top_down_picture', arguments: {} }) })).text);
    assert.deepEqual(picture.result.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    const view = message((await send(port, { body: rpc(5, 'tools/call', { name: 'view_picture', arguments: { max_width: 800 } }) })).text);
    assert.equal(view.result.content[1].data, 'w800');
    assert.ok(!calls.some((c) => c.tool === 'view_picture'), 'the view is pictured in the main process');
  });

  it('checks the arguments before the editor sees them', async () => {
    const before = calls.length;
    const bad = message((await send(server.port, { body: rpc(6, 'tools/call', { name: 'run_script', arguments: { source: 42 } }) })).text);
    assert.ok(bad.error || bad.result?.isError, JSON.stringify(bad));
    assert.equal(calls.length, before);
  });

  it('refuses web pages and a foreign Host before anything runs', async () => {
    const before = calls.length;
    const call = rpc(7, 'tools/call', { name: 'map_summary', arguments: {} });
    const fromPage = await send(server.port, { body: call, headers: { origin: 'https://evil.example' } });
    assert.equal(fromPage.status, 403);
    const rebound = await send(server.port, { body: call, headers: { host: `evil.example:${server.port}` } });
    assert.equal(rebound.status, 403);
    assert.equal(calls.length, before);
    assert.equal((await send(server.port, { path: '/other', body: call })).status, 404);
  });

  const lan = Object.values(require('node:os').networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  it('listens on loopback only, not on the network', { skip: !lan && 'no network address' }, async () => {
    const reached = await new Promise((resolve) => {
      const socket = require('node:net').connect(server.port, lan.address);
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
    });
    assert.equal(reached, false);
  });
});

describe('setUpAgentMcp', () => {
  function fakeIpc() {
    const handlers = new Map();
    return {
      handle: (name, fn) => handlers.set(name, fn),
      on: (name, fn) => handlers.set(name, fn),
      call: (name, ...args) => handlers.get(name)(...args),
    };
  }

  function fakeFs(files = {}) {
    return {
      files,
      readFileSync: (p) => {
        if (!(p in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return files[p];
      },
      writeFileSync: (p, text) => {
        files[p] = text;
      },
    };
  }

  it('is off until switched on, then answers through the page and keeps the switch', async () => {
    const ipc = fakeIpc();
    const fs = fakeFs();
    const sent = [];
    const contents = {
      send: (channel, call) => {
        sent.push(call);
        // The page answers as the preload does
        setImmediate(() => ipc.call('desktop:agent-reply', { sender: contents }, { id: call.id, answer: { text: `answer ${call.tool}` } }));
      },
    };
    const window = { isDestroyed: () => false, webContents: contents };
    const app = { sender: contents };
    const agent = setUpAgentMcp({ ipcMain: ipc, getWindow: () => window, userDataDir: '/data', fs, log: silent, isAppSender: (e) => e === app || e.sender === contents, version: 'test' });
    await agent.started;
    assert.deepEqual(await ipc.call('desktop:agent-status', app), { enabled: false, url: null });

    const on = await ipc.call('desktop:agent-set-enabled', app, true);
    assert.equal(on.enabled, true);
    assert.match(on.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.equal(JSON.parse(Object.values(fs.files)[0]).enabled, true);
    const port = Number(new URL(on.url).port);

    await send(port, { body: initialize });
    const answer = message((await send(port, { body: rpc(2, 'tools/call', { name: 'check_map', arguments: {} }) })).text);
    assert.equal(answer.result.content[0].text, 'answer check_map');
    assert.deepEqual(sent.map((c) => c.tool), ['check_map']);

    // A page elsewhere cannot switch it or answer for the editor
    assert.equal(await ipc.call('desktop:agent-set-enabled', { sender: {} }, false), null);

    const off = await ipc.call('desktop:agent-set-enabled', app, false);
    assert.deepEqual(off, { enabled: false, url: null });
    await assert.rejects(send(port, { body: initialize }));
    await agent.close();
  });

  it('starts at once when the switch was left on, on the port it had', async () => {
    const fs = fakeFs({ ['/data/agent-mcp.json'.replace(/\//g, require('node:path').sep)]: JSON.stringify({ enabled: true, port: 47290 }) });
    const ipc = fakeIpc();
    const agent = setUpAgentMcp({ ipcMain: ipc, getWindow: () => null, userDataDir: '/data', fs, log: silent, isAppSender: () => true, version: 'test' });
    await agent.started;
    const status = agent.status();
    assert.equal(status.enabled, true);
    assert.match(status.url, /^http:\/\/127\.0\.0\.1:472(9\d|\d\d)\/mcp$/);
    // Without a window the call says so
    const port = Number(new URL(status.url).port);
    await send(port, { body: initialize });
    const answer = message((await send(port, { body: rpc(2, 'tools/call', { name: 'map_summary', arguments: {} }) })).text);
    assert.equal(answer.result.isError, true);
    assert.match(answer.result.content[0].text, /window is closed/);
    await agent.close();
  });
});
