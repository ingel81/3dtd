// A recorded agent: the MCP calls of a fixture (tools/showreel/fixtures/agent-<name>.json) sent again, one after
// the other, as an MCP client over Streamable HTTP (JSON-RPC posts, as the SDK's client sends them). No language
// model in the take: the same calls on the same map give the same result. The relay (relay.mjs) calls it when the
// scene asks; for development it also runs alone against a relay with a page connected:
//
//   node tools/showreel/agent/replay.mjs castle [--url http://127.0.0.1:47171/mcp]
//   node tools/showreel/agent/replay.mjs --call map_summary '{}'            one call, its answer printed
//   node tools/showreel/agent/replay.mjs --call run_script '{"dry_run":true}' --source <file.js>
//   node tools/showreel/agent/replay.mjs --call top_down_picture '{"size":1024}' --image <file.jpg>
//
// Fixture: { client, request, calls: [{ tool, args, source?, hold? }] }; `source` names a script file beside it
// (run_script's `source`), `hold` the seconds before the next call (the agent reading the answer).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

/** One JSON-RPC message to the server; the answer of an SSE or JSON response, null for a notification */
async function post(url, message) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${message.method}: HTTP ${response.status} ${text.slice(0, 200)}`);
  if (message.id === undefined || !text) return null;
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  const answer = JSON.parse(line ? line.slice(6) : text);
  if (answer.error) throw new Error(`${message.method}: ${answer.error.message}`);
  return answer.result;
}

/** An MCP session of a client named `name`: initialize, then tool calls */
async function connect(url, name) {
  let id = 1;
  await post(url, { jsonrpc: '2.0', id: id++, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } } });
  await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    async call(tool, args) {
      const result = await post(url, { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool, arguments: args } });
      const text = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      const image = (result?.content ?? []).find((c) => c.type === 'image');
      return { ok: !result?.isError, text, image };
    },
  };
}

const pause = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** The fixture's calls against the server at `url`; each call's tool, ok and the start of its answer */
export async function replay(name, url, log = () => {}) {
  const file = name.endsWith('.json') ? resolve(name) : join(FIXTURES, `agent-${name}.json`);
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const session = await connect(url, fixture.client ?? 'Agent');
  const results = [];
  for (const c of fixture.calls) {
    const args = { ...(c.args ?? {}) };
    if (c.source) args.source = readFileSync(join(dirname(file), c.source), 'utf8');
    const { ok, text } = await session.call(c.tool, args);
    log(`${c.tool}${args.dry_run ? ' (dry run)' : ''}: ${ok ? 'ok' : 'FAILED'} ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    results.push({ tool: c.tool, ok, text: text.slice(0, 2000) });
    if (!ok) throw new Error(`${c.tool} failed: ${text.slice(0, 500)}`);
    if (c.hold) await pause(c.hold);
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = (n, f) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : f);
  const url = option('url', 'http://127.0.0.1:47171/mcp');
  if (argv.includes('--call')) {
    const tool = option('call');
    const args = JSON.parse(argv[argv.indexOf('--call') + 2] ?? '{}');
    const source = option('source');
    if (source) args.source = readFileSync(source, 'utf8');
    const session = await connect(url, option('client', 'Agent'));
    const { ok, text, image } = await session.call(tool, args);
    console.log(ok ? text : `FAILED ${text}`);
    if (image && option('image')) writeFileSync(option('image'), Buffer.from(image.data, 'base64'));
  } else {
    await replay(argv[0], url, console.log);
  }
}
