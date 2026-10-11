import { existsSync, readFileSync } from 'fs';
import { ByteWriter, findTestMap } from '../../../../test/w3x-fixtures';
import { MpqArchive } from '../mpq';
import { parseDoo, parseUnits } from './doo';
import { cornerWaterZ, cornerZ, parseW3e } from './w3e';
import { isReforged, parseW3i } from './w3i';
import { parseW3r, regionVariable } from './w3r';
import { laneCell, parseWpm } from './wpm';
import { parseW3u } from './w3u';
import { parseWts, plainText, resolveTrigStr } from './wts';

const TEST_MAP = findTestMap(existsSync);

function w3iBytes(version: 18 | 25 | 28 | 31, tables: 'none' | 'full' | 'junk' | 'cut' = 'none'): Uint8Array {
  const w = new ByteWriter().i32(version).i32(3).i32(6061);
  if (version >= 28) w.i32(1).i32(32).i32(10).i32(18000);
  w.cstr('TRIGSTR_001').cstr('Author').cstr('Desc').cstr('Any');
  for (let i = 0; i < 8; i++) w.f32(i * 100);
  w.i32(16).i32(15).i32(9).i32(16).i32(97).i32(103).u32(0xc462).u8('X'.charCodeAt(0));
  if (version === 18) {
    w.i32(-1).cstr('').cstr('').cstr('').i32(0).cstr('').cstr('').cstr('');
  } else {
    w.i32(-1).cstr('Loading.mdx').cstr('').cstr('').cstr('').i32(0).cstr('').cstr('').cstr('').cstr('');
    w.i32(1).f32(3000).f32(5000).f32(0.5).u8(10).u8(20).u8(30).u8(255);
    w.id4('RAhr').cstr('').u8(0).u8(1).u8(2).u8(3).u8(4);
    if (version >= 28) w.i32(1);
    if (version >= 31) w.i32(0).i32(1);
  }
  w.i32(2);
  for (let p = 0; p < 2; p++) {
    w.i32(p).i32(1).i32(0).i32(1).cstr(`P${p}`).f32(p * 64).f32(-p * 64).u32(0).u32(0);
    if (version >= 31) w.u32(0).u32(0);
  }
  if (tables === 'none') {
    w.i32(0); // forces
    return w.done();
  }
  if (tables === 'junk') {
    w.i32(-7).u32(0xdeadbeef);
    return w.done();
  }
  // Two forces, one upgrade, one tech, a random unit table of two positions and two lines
  w.i32(2).u32(1).u32(0b01).cstr('Defenders').u32(0).u32(0b10).cstr('Creeps');
  // An optimiser cut the tables off after the forces, one stray byte left
  if (tables === 'cut') return w.u8(0xff).done();
  w.i32(1).u32(0xffff).id4('Rhme').i32(1).i32(2);
  w.i32(1).u32(0xffff).id4('hkni');
  w.i32(1).i32(0).cstr('Group').i32(2).i32(0).i32(1);
  w.i32(2).i32(50).id4('hfoo').id4('hrif').i32(50).id4('hkni').id4('hmpr');
  // A random item table with two sets (TFT on)
  if (version >= 25) w.i32(1).i32(0).cstr('Drops').i32(2).i32(1).i32(100).id4('ratc').i32(2).i32(50).id4('rde1').i32(50).id4('rde2');
  return w.done();
}

describe('w3x formats', () => {
  it('reads wts strings with comments, multiple lines and a BOM', () => {
    const text = '\ufeffSTRING 1\r\n{\r\nMafa TD\r\n}\r\n\r\nSTRING 2\r\n// comment\r\n{\r\nline one\r\nline {two}\r\n}\r\n';
    const t = parseWts(new TextEncoder().encode(text));
    expect(t.get(1)).toBe('Mafa TD');
    expect(t.get(2)).toBe('line one\nline {two}');
    expect(resolveTrigStr('TRIGSTR_002', t)).toBe('line one\nline {two}');
    expect(resolveTrigStr('plain', t)).toBe('plain');
    expect(plainText('|c007733ffMafa TD|r Queen')).toBe('Mafa TD Queen');
  });

  it('reads a large wts without closing braces in linear time', () => {
    // 5 MB of strings that never close: a regular expression over the text took minutes here
    const text = 'STRING 1\n{\nkept\n}\n' + `STRING 9\n{\n${'y'.repeat(40)}\n`.repeat(100000);
    const t0 = performance.now();
    const t = parseWts(new TextEncoder().encode(text));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect([...t.keys()]).toEqual([1]);
  });

  it.each([18, 25, 28, 31] as const)('reads w3i version %i', (version) => {
    const wts = parseWts(new TextEncoder().encode('STRING 1\n{\nMy Map\n}\n'));
    const info = parseW3i(w3iBytes(version), wts);
    expect(info.name).toBe('My Map');
    expect(info.tileset).toBe('X');
    expect(info.margins).toEqual([16, 15, 9, 16]);
    expect(info.playableWidth).toBe(97);
    expect(info.players.map((p) => p.name)).toEqual(['P0', 'P1']);
    expect(info.players[1].startX).toBe(64);
    if (version >= 25) {
      expect(info.fogStyle).toBe(1);
      expect(info.fogColor).toEqual([10, 20, 30, 255]);
      expect(info.weather).toBe('RAhr');
    } else {
      expect(info.fogStyle).toBeNull();
    }
    expect(info.scriptLanguage).toBe(version >= 28 ? 1 : 0);
    expect(isReforged(info)).toBe(version >= 28);
    expect(info.supportedModes).toBe(version >= 31 ? 0 : null);
    expect(info.gameDataVersion).toBe(version >= 31 ? 1 : null);
    expect([info.tablesRead, info.trailing]).toEqual([true, 0]);
  });

  it.each([18, 25, 28, 31] as const)('reads w3i version %i to its end: forces, availability, random tables', (version) => {
    const info = parseW3i(w3iBytes(version, 'full'));
    expect(info.forces).toEqual([
      { name: 'Defenders', flags: 1, players: 1 },
      { name: 'Creeps', flags: 0, players: 2 },
    ]);
    expect([info.upgrades, info.techs, info.randomUnitTables, info.randomItemTables]).toEqual([1, 1, 1, version >= 25 ? 1 : 0]);
    expect([info.tablesRead, info.trailing]).toEqual([true, 0]);
  });

  it('keeps the players of a w3i whose tables are junk', () => {
    const info = parseW3i(w3iBytes(31, 'junk'));
    expect(info.players.map((p) => p.name)).toEqual(['P0', 'P1']);
    expect(info.tablesRead).toBe(false);
    expect(info.forces).toEqual([]);
  });

  it('keeps the forces of a w3i an optimiser cut off after them', () => {
    const cut = parseW3i(w3iBytes(25, 'cut'));
    expect(cut.forces.map((f) => f.name)).toEqual(['Defenders', 'Creeps']);
    expect([cut.tablesRead, cut.trailing]).toEqual([false, 1]);
  });

  it('reads w3e corners and their heights', () => {
    const w = new ByteWriter().id4('W3E!').i32(11).u8('L'.charCodeAt(0)).i32(0);
    w.i32(2).id4('Ldrt').id4('Lgrs').i32(1).id4('CLdi').i32(2).i32(2).f32(-128).f32(-128);
    // (h, water, texture|flags, variation, cliff|layer)
    const corners: [number, number, number, number, number][] = [
      [0x2000, 0x2000, 0x00, 0, 0x02],
      [0x2000 + 400, 0x2000 + 0x4000, 0x01 | 0x40, 3, 0x03],
      [0x2000, 0x2000, 0x10, 0, 0x02],
      [0x2000 - 400, 0x2000, 0x01, 0, 0x01],
    ];
    for (const [h, water, ft, v, cl] of corners) w.i16(h).u16(water).u8(ft).u8(v).u8(cl);
    const t = parseW3e(w.done());
    expect(t.groundTiles).toEqual(['Ldrt', 'Lgrs']);
    expect([t.width, t.height, t.offsetX]).toEqual([2, 2, -128]);
    expect(t.texture[1]).toBe(1);
    expect(t.flags[1]).toBe(0x40);
    expect(t.mapEdge[1]).toBe(1);
    expect(t.layer[1]).toBe(3);
    expect(cornerZ(t, 0)).toBe(0);
    expect(cornerZ(t, 1)).toBe(100 + 128);
    expect(cornerZ(t, 3)).toBe(-100 - 128);
    expect(cornerWaterZ(t, 1)).toBeCloseTo(-89.6);
  });

  function doodad(w: ByteWriter, id: string, x: number, skin: boolean, tft: boolean): void {
    w.id4(id).i32(0).f32(x).f32(64).f32(0).f32(1.5).f32(1).f32(1).f32(1);
    if (skin) w.id4(id);
    w.u8(2).u8(100);
    if (tft) w.i32(-1).i32(1).i32(1).id4('ratc').i32(100);
    w.i32(7);
  }

  it.each([
    { version: 7, sub: 9, skin: false },
    { version: 8, sub: 11, skin: false },
    { version: 8, sub: 11, skin: true },
  ])('reads doo v$version/$sub (skins $skin) whatever the hint', ({ version, sub, skin }) => {
    const w = new ByteWriter().id4('W3do').i32(version).i32(sub).i32(2);
    doodad(w, 'LTlt', 10, skin, version === 8);
    doodad(w, 'LOca', 20, skin, version === 8);
    w.i32(0).i32(1).id4('YTpb').i32(0).i32(5).i32(6);
    for (const hint of [false, true]) {
      const doo = parseDoo(w.done(), hint);
      expect(doo.skins).toBe(skin);
      expect(doo.doodads.map((d) => [d.id, d.x, d.flags])).toEqual([
        ['LTlt', 10, 2],
        ['LOca', 20, 2],
      ]);
      expect(doo.doodads[0].angle).toBeCloseTo(1.5);
      expect(doo.special).toEqual([{ id: 'YTpb', x: 5, y: 6 }]);
    }
  });

  it('reads w3e with custom tilesets and all sixteen ground tiles', () => {
    const tiles = Array.from({ length: 16 }, (_, k) => `X${String.fromCharCode(97 + k)}tl`);
    const w = new ByteWriter().id4('W3E!').i32(11).u8('X'.charCodeAt(0)).i32(1).i32(16);
    for (const t of tiles) w.id4(t);
    w.i32(0).i32(2).i32(2).f32(0).f32(0);
    for (let i = 0; i < 4; i++) w.i16(0x2000).u16(0x2000).u8(15).u8(0).u8(0x02);
    const t = parseW3e(w.done());
    expect([t.customTilesets, t.groundTiles.length, t.cliffTiles.length]).toEqual([true, 16, 0]);
    expect(t.groundTiles[t.texture[3]]).toBe('Xptl');
  });

  it('refuses a w3e of another version and a giant size', () => {
    expect(() => parseW3e(new ByteWriter().id4('W3E!').i32(12).done())).toThrow(/unsupported version 12/);
    const big = new ByteWriter().id4('W3E!').i32(11).u8(76).i32(0).i32(0).i32(0).i32(4000).i32(4000).f32(0).f32(0);
    expect(() => parseW3e(big.done())).toThrow(/bad size/);
  });

  function unit(w: ByteWriter, id: string, x: number, skin: boolean): void {
    w.id4(id).i32(0).f32(x).f32(-200).f32(0).f32(0).f32(1).f32(1).f32(1);
    if (skin) w.id4(id);
    w.u8(2).i32(3).u8(0).u8(0);
    w.i32(-1).i32(-1).i32(-1).i32(0).i32(0).f32(-1).i32(1).i32(0).i32(0).i32(0).i32(0).i32(0);
    w.i32(0).u32(0).i32(-1).i32(-1).i32(0);
  }

  it.each([false, true])('reads preplaced units with skins %s whatever the hint', (skin) => {
    const w = new ByteWriter().id4('W3do').i32(8).i32(11).i32(2);
    unit(w, 'sloc', 100, skin);
    unit(w, 'hfoo', 300, skin);
    for (const hint of [false, true]) {
      expect(parseUnits(w.done(), hint).map((u) => [u.id, u.x, u.player])).toEqual([
        ['sloc', 100, 3],
        ['hfoo', 300, 3],
      ]);
    }
  });

  it('reads w3u object data of versions 2 and 3 (changes in sets, the first one kept)', () => {
    const v2 = new ByteWriter().i32(2).i32(1).id4('hfoo').id4('\0\0\0\0').i32(1).id4('uhpm').i32(0).i32(500).id4('hfoo').i32(0);
    expect(parseW3u(v2.done()).get('hfoo')!.fields.get('uhpm')).toBe(500);
    const v3 = new ByteWriter().i32(3).i32(0).i32(2);
    v3.id4('hfoo').id4('h000').i32(2);
    v3.i32(0).i32(2).id4('uhpm').i32(0).i32(900).id4('h000').id4('unam').i32(3).cstr('TRIGSTR_001').id4('h000');
    v3.i32(1).i32(1).id4('uhpm').i32(0).i32(1).id4('h000');
    v3.id4('hrif').id4('h001').i32(0);
    const units = parseW3u(v3.done(), parseWts(new TextEncoder().encode('STRING 1\n{\nBrute\n}\n')));
    expect(units.get('h000')).toMatchObject({ base: 'hfoo' });
    expect([...units.get('h000')!.fields]).toEqual([
      ['uhpm', 900],
      ['unam', 'Brute'],
    ]);
    expect(units.get('h001')!.fields.size).toBe(0);
    expect(() => parseW3u(new ByteWriter().i32(4).done())).toThrow(/unsupported version 4/);
  });

  it('reads preplaced units', () => {
    const w = new ByteWriter().id4('W3do').i32(8).i32(11).i32(1);
    w.id4('sloc').i32(0).f32(100).f32(-200).f32(0).f32(0).f32(1).f32(1).f32(1).u8(2).i32(3).u8(0).u8(0);
    w.i32(-1).i32(-1).i32(-1).i32(0).i32(0).f32(-1).i32(1).i32(0).i32(0).i32(0).i32(0).i32(0);
    w.i32(0).u32(0).i32(-1).i32(-1).i32(0);
    expect(parseUnits(w.done())).toEqual([{ id: 'sloc', x: 100, y: -200, z: 0, angle: 0, player: 3 }]);
  });

  it('reads regions and their script names', () => {
    const w = new ByteWriter().i32(5).i32(1);
    w.f32(-352).f32(-1344).f32(320).f32(-1216).cstr('The Throne').i32(1).u32(0).cstr('').u8(1).u8(2).u8(3).u8(255);
    const [r] = parseW3r(w.done());
    expect(r).toMatchObject({ name: 'The Throne', variable: 'gg_rct_The_Throne', left: -352, top: -1216 });
    expect(regionVariable('Spawn 001 (Left)')).toBe('gg_rct_Spawn_001__Left_');
  });

  it('reads the pathing map', () => {
    const w = new ByteWriter().id4('MP3W').i32(0).i32(2).i32(1).u8(0x48).u8(0x40);
    const p = parseWpm(w.done());
    expect(p.width).toBe(2);
    expect(laneCell(p.cells[0])).toBe(true);
    expect(laneCell(p.cells[1])).toBe(false);
  });

  it.skipIf(!TEST_MAP)('parses every file of the test map', () => {
    const mpq = new MpqArchive(new Uint8Array(readFileSync(TEST_MAP!)));
    const wts = parseWts(mpq.read('war3map.wts')!);
    const info = parseW3i(mpq.read('war3map.w3i')!, wts);
    expect(info.version).toBe(25);
    expect(plainText(info.name)).toBe('Mafa TD Queen v14.6');
    expect(info.tileset).toBe('X');
    const t = parseW3e(mpq.read('war3map.w3e')!);
    expect([t.width, t.height, t.offsetX]).toEqual([129, 129, -8192]);
    const doo = parseDoo(mpq.read('war3map.doo')!, isReforged(info));
    expect(doo.doodads.length).toBe(1506);
    expect(doo.doodads.filter((d) => d.id === 'ITtw').length).toBe(640);
    expect(parseUnits(mpq.read('war3mapUnits.doo')!).filter((u) => u.id === 'sloc').length).toBe(12);
    const regions = parseW3r(mpq.read('war3map.w3r')!);
    expect(regions.length).toBe(31);
    expect(regions.find((r) => r.name === 'The Throne')).toMatchObject({ left: -352, bottom: -1344 });
    expect(parseWpm(mpq.read('war3map.wpm')!).width).toBe(512);
  });
});
