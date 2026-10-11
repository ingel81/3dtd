/**
 * A tiny complete Warcraft map built from scratch for the importer specs:
 * 16 x 16 tiles (2 tiles margin), one sunken brick lane from "Spawn West"
 * to "Castle" along y = 0, grass elsewhere, a pond in the north-west, a few
 * doodads, and a GUI trigger that sends entering units to the castle.
 */

import { ByteWriter, buildMpq } from './w3x-fixtures';

const TILES = 16;
const OFFSET = -1024;

function w3e(): Uint8Array {
  const n = TILES + 1;
  const w = new ByteWriter().id4('W3E!').i32(11).u8('L'.charCodeAt(0)).i32(0);
  w.i32(2).id4('Lgrs').id4('Lbtl').i32(1).id4('CLdi').i32(n).i32(n).f32(OFFSET).f32(OFFSET);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = OFFSET + i * 128;
      const y = OFFSET + j * 128;
      const lane = Math.abs(y) <= 128;
      const pond = x <= -640 && x >= -768 && y >= 512 && y <= 640;
      const flags = pond ? 0x40 : 0;
      // The pond's water stands 10 units above its ground
      const water = pond ? 0x2000 + 4 * 100 : 0x2000;
      w.i16(0x2000).u16(water).u8((lane ? 1 : 0) | flags).u8(0).u8(lane ? 1 : 2);
    }
  }
  return w.done();
}

function wpm(): Uint8Array {
  const n = TILES * 4;
  const w = new ByteWriter().id4('MP3W').i32(0).i32(n).i32(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const y = OFFSET + (j + 0.5) * 32;
      w.u8(Math.abs(y) < 160 ? 0x48 : 0x40);
    }
  }
  return w.done();
}

function w3i(): Uint8Array {
  const w = new ByteWriter().i32(25).i32(1).i32(6061).cstr('TRIGSTR_001').cstr('Tester').cstr('A test map').cstr('1');
  for (let i = 0; i < 8; i++) w.f32(0);
  w.i32(2).i32(2).i32(2).i32(2).i32(12).i32(12).u32(0).u8('L'.charCodeAt(0));
  w.i32(-1).cstr('').cstr('').cstr('').cstr('').i32(0).cstr('').cstr('').cstr('').cstr('');
  w.i32(0).f32(0).f32(0).f32(0).u8(0).u8(0).u8(0).u8(255).u32(0).cstr('').u8(0).u8(255).u8(255).u8(255).u8(255);
  w.i32(1).i32(0).i32(1).i32(1).i32(1).cstr('Player').f32(0).f32(0).u32(0).u32(0);
  w.i32(0);
  return w.done();
}

function w3r(): Uint8Array {
  const regions: [string, number, number][] = [
    ['Spawn West', -640, 0],
    ['Castle', 640, 0],
  ];
  const w = new ByteWriter().i32(5).i32(regions.length);
  regions.forEach(([name, x, y], k) => {
    w.f32(x - 96).f32(y - 96).f32(x + 96).f32(y + 96).cstr(name).i32(k).u32(0).cstr('').u8(0).u8(0).u8(0).u8(255);
  });
  return w.done();
}

function doo(): Uint8Array {
  const items: [string, number, number, number][] = [
    ['LTlt', 0, 640, 2], // tree north of the lane
    ['LTlt', 0, 0, 2], // tree on the lane: dropped
    ['YTpb', 300, 300, 2], // pathing blocker: a helper
    ['LRrk', 500, -600, 2], // rock
    ['LOca', -300, -500, 0], // invisible prop: a helper
    ['LTlt', 1000, 1000, 2], // outside the playable area
  ];
  const w = new ByteWriter().id4('W3do').i32(8).i32(11).i32(items.length);
  for (const [id, x, y, flags] of items) {
    w.id4(id).i32(0).f32(x).f32(y).f32(0).f32(0.5).f32(1.2).f32(1.2).f32(1.2).u8(flags).u8(100).i32(-1).i32(0).i32(0);
  }
  w.i32(0).i32(0);
  return w.done();
}

const SCRIPT = `globals
    rect gg_rct_Spawn_West= null
    rect gg_rct_Castle= null
    trigger gg_trg_Walk= null
endglobals

function Trig_Walk_Actions takes nothing returns nothing
    call IssuePointOrderLocBJ(GetTriggerUnit(), "move", GetRectCenter(gg_rct_Castle))
endfunction

function main takes nothing returns nothing
    set gg_rct_Spawn_West=Rect(- 736.0, - 96.0, - 544.0, 96.0)
    set gg_rct_Castle=Rect(544.0, - 96.0, 736.0, 96.0)
    set gg_trg_Walk=CreateTrigger()
    call TriggerRegisterEnterRectSimple(gg_trg_Walk, gg_rct_Spawn_West)
    call TriggerAddAction(gg_trg_Walk, function Trig_Walk_Actions)
endfunction
`;

export function buildSyntheticMap(options: { script?: boolean } = {}): Uint8Array {
  const enc = new TextEncoder();
  const files = [
    { name: 'war3map.w3e', data: w3e() },
    { name: 'war3map.wpm', data: wpm() },
    { name: 'war3map.w3i', data: w3i() },
    { name: 'war3map.wts', data: enc.encode('STRING 1\r\n{\r\n|cffffcc00Lane Test|r\r\n}\r\n') },
    { name: 'war3map.w3r', data: w3r() },
    { name: 'war3map.doo', data: doo() },
  ];
  if (options.script !== false) files.push({ name: 'war3map.j', data: enc.encode(SCRIPT) });
  return buildMpq(files);
}
