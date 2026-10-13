// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { COMMAND_MAX, cleanText, parseClientMessage } from './validate.ts';

describe('parseClientMessage (relay review K1, H1, N1)', () => {
  it('takes a good message of each kind as it came', () => {
    expect(parseClientMessage({ t: 'chat', text: 'hi' })).toEqual({ t: 'chat', text: 'hi' });
    expect(parseClientMessage({ t: 'pick', spawnId: null })).toEqual({ t: 'pick', spawnId: null });
    expect(parseClientMessage({ t: 'hash', tick: 30, hash: 5, parts: [1, 2] })).toEqual({ t: 'hash', tick: 30, hash: 5, parts: [1, 2] });
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:sell-tower', towerId: 't1' } }))
      .toEqual({ t: 'cmd', command: { type: 'command:sell-tower', towerId: 't1' } });
  });

  it('takes a piece of a custom map within the piece limits only', () => {
    const piece = { t: 'map', mapId: 'demo-valley', hash: 'abc', part: 1, parts: 4, data: 'AAAA' };
    expect(parseClientMessage(piece)).toEqual(piece);
    expect(parseClientMessage({ ...piece, part: 4 })).toBeNull();
    expect(parseClientMessage({ ...piece, parts: 65 })).toBeNull();
    expect(parseClientMessage({ ...piece, data: 'not base64!' })).toBeNull();
    expect(parseClientMessage({ ...piece, data: 'A'.repeat(800 * 1024) })).toBeNull();
    expect(parseClientMessage({ ...piece, mapId: '' })).toBeNull();
    expect(parseClientMessage({ t: 'map-got', hash: 'abc', part: 3 })).toEqual({ t: 'map-got', hash: 'abc', part: 3 });
    expect(parseClientMessage({ t: 'map-got', hash: 'abc', part: 64 })).toBeNull();
    expect(parseClientMessage({ t: 'map-got', part: 1 })).toBeNull();
  });

  it('passes a command on with its own fields only, and no unknown command', () => {
    const position = { lat: 1, lon: 2, extra: 'stays: the client checks what a field holds' };
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:place-tower', position, typeId: 'basic', x: 1, note: 'y' } }))
      .toEqual({ t: 'cmd', command: { type: 'command:place-tower', position, typeId: 'basic' } });
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:leave-tower', towerId: 't1' } }))
      .toEqual({ t: 'cmd', command: { type: 'command:leave-tower' } });
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:made-up' } })).toBeNull();
    expect(parseClientMessage({ t: 'cmd', command: { type: 'toString' } })).toBeNull();
  });

  it('refuses what is no message, an unknown type and a field of the wrong type', () => {
    for (const value of [null, 1, 'x', [], {}, { t: 1 }, { t: 'nope' }]) expect(parseClientMessage(value)).toBeNull();
    expect(parseClientMessage({ t: 'chat' })).toBeNull();
    expect(parseClientMessage({ t: 'chat', text: { toString: 1 } })).toBeNull();
    expect(parseClientMessage({ t: 'join', room: 42 })).toBeNull();
    expect(parseClientMessage({ t: 'world', spawnIds: 'x' })).toBeNull();
    expect(parseClientMessage({ t: 'hash', tick: 1.5, hash: 1 })).toBeNull();
    expect(parseClientMessage({ t: 'hash', tick: -30, hash: 1 })).toBeNull();
    expect(parseClientMessage({ t: 'stats', stats: { frames: 1 } })).toBeNull();
    expect(parseClientMessage({ t: 'ping', lat: null, lon: 1, height: 1 })).toBeNull();
  });

  it('cuts the hello\'s strings and takes nothing but its fields', () => {
    const hello = parseClientMessage({
      t: 'hello', protocol: 1, name: 'n'.repeat(100), gameVersion: 'v'.repeat(1_000_000), configHash: 'h', extra: 'x',
    });
    expect(hello).toMatchObject({ name: 'n'.repeat(32), configHash: 'h' });
    expect((hello as { gameVersion: string }).gameVersion).toHaveLength(64);
    expect(hello).not.toHaveProperty('extra');
  });

  it('refuses a command too large or with a key that reaches a prototype', () => {
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:start-wave', plan: 'y'.repeat(COMMAND_MAX) } })).toBeNull();
    expect(parseClientMessage({ t: 'cmd', command: JSON.parse('{"type":"command:start-wave","plan":{"__proto__":{"p":1}}}') })).toBeNull();
    expect(parseClientMessage({ t: 'cmd', command: { type: 'command:start-wave', constructor: 1 } })).toBeNull();
  });
});

describe('cleanText', () => {
  it('takes control characters and line separators out, trims and cuts', () => {
    const [newline, nul, separator] = [10, 0, 0x2028].map((code) => String.fromCharCode(code));
    expect(cleanText(`  Ann${newline}fake log line${nul}${separator}x  `, 100)).toBe('Ann fake log line  x');
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(cleanText(5, 3)).toBeNull();
  });
});
