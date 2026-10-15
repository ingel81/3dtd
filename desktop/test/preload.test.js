'use strict';

// The preload's side of the AI agent's calls (docs/AGENT_MCP.md): the page
// answers through a reply callback, so what its handler returns (a zone.js
// promise crosses the context bridge as a plain object) does not matter.
// The preload runs here against a fake electron module.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { TOOLS } = require('../src/agent-mcp');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');

/** Runs the preload; returns what it exposed, the main process's side of the IPC and the replies it sent */
function loadPreload() {
  const listeners = new Map();
  const sent = [];
  let exposed = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => (exposed = api) },
    ipcRenderer: {
      on: (channel, fn) => listeners.set(channel, fn),
      send: (channel, payload) => sent.push({ channel, payload }),
      invoke: async () => null,
    },
  };
  const fakeRequire = (name) => {
    if (name === 'electron') return electron;
    throw new Error(`the preload may not require ${name}`);
  };
  new Function('require', 'process', source)(fakeRequire, { argv: [] });
  const call = (id, tool, args = {}) => listeners.get('desktop:agent-call')({}, { id, tool, args });
  const replies = () => sent.filter((s) => s.channel === 'desktop:agent-reply').map((s) => s.payload);
  return { agent: exposed.agent, call, replies };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('preload: the agent bridge', () => {
  it('takes the answer from reply, not from what the handler returns', async () => {
    const { agent, call, replies } = loadPreload();
    // What a zone.js promise turns into on the way through the context bridge: an object without then
    agent.onCall((c, reply) => {
      setImmediate(() => reply({ text: `answer ${c.tool}` }));
      return { __zone_symbol__state: null };
    });
    call(1, 'map_summary');
    assert.deepEqual(replies(), []);
    await tick();
    assert.deepEqual(replies(), [{ id: 1, answer: { text: 'answer map_summary', isError: false } }]);
  });

  it('answers every tool of the server under its own id', async () => {
    const { agent, call, replies } = loadPreload();
    agent.onCall((c, reply) => void Promise.resolve().then(() => reply({ text: JSON.stringify({ tool: c.tool, args: c.args }) })));
    TOOLS.forEach(([name], k) => call(k + 1, name, { k }));
    await tick();
    const got = replies();
    assert.equal(got.length, TOOLS.length);
    for (const [k, [name]] of TOOLS.entries()) {
      const reply = got.find((r) => r.id === k + 1);
      assert.deepEqual(JSON.parse(reply.answer.text), { tool: name, args: { k } });
      assert.equal(reply.answer.isError, false);
    }
  });

  it('keeps a picture, sends one reply per call and turns bad answers into errors', async () => {
    const { agent, call, replies } = loadPreload();
    agent.onCall((c, reply) => {
      if (c.tool === 'top_down_picture') reply({ text: '{}', image: { mimeType: 'image/jpeg', data: 'AAAA', extra: 1 }, other: 2 });
      if (c.tool === 'map_summary') reply({ notText: true });
      if (c.tool === 'check_map') throw new Error('broken');
      reply({ text: 'second reply' });
    });
    call(1, 'top_down_picture');
    call(2, 'map_summary');
    call(3, 'check_map');
    assert.deepEqual(replies(), [
      { id: 1, answer: { text: '{}', isError: false, image: { mimeType: 'image/jpeg', data: 'AAAA' } } },
      { id: 2, answer: { text: 'The editor gave no answer', isError: true } },
      { id: 3, answer: { text: 'broken', isError: true } },
    ]);
  });

  it('says so without an open editor, and again once the editor left', () => {
    const { agent, call, replies } = loadPreload();
    call(1, 'map_summary');
    const stop = agent.onCall((c, reply) => reply({ text: 'here' }));
    call(2, 'map_summary');
    stop();
    call(3, 'map_summary');
    assert.deepEqual(
      replies().map((r) => [r.id, r.answer.isError]),
      [
        [1, true],
        [2, false],
        [3, true],
      ],
    );
    assert.match(replies()[0].answer.text, /map editor is not open/);
  });
});
