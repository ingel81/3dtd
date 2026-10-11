import { existsSync, readFileSync } from 'fs';
import { ByteWriter, findTestMap } from '../../../../test/w3x-fixtures';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { validateWaveTable } from '../../../director/sources/table/wave-table';
import { parseW3u, rawcodeToId } from '../formats/w3u';
import { importW3x } from '../import-w3x';
import { parseJass } from '../jass/jass-parser';
import { convertWaves } from './wave-convert';
import { wavesFromScript } from './wave-script';

const TEST_MAP = findTestMap(existsSync);

/** GUI-style waves: unit types and counts per level in arrays, bosses through a pointer slot */
const ARRAY_WAVES = `
globals
    integer array udg_Unit
    integer array udg_Count
    integer array udg_Boss
    integer array udg_BossWave
    integer udg_Level= 0
endglobals

function Setup takes nothing returns nothing
    set udg_Unit[1]='h000'
    set udg_Count[1]=20
    set udg_Unit[2]='h001'
    set udg_Count[2]=15
    set udg_Unit[3]='h002'
    set udg_Count[3]=10
    set udg_Boss[0]='H003'
    set udg_BossWave[0]=3
    set udg_BossWave[1]=-1
endfunction

function Spawn takes nothing returns nothing
    call CreateNUnitsAtLoc(udg_Count[udg_Level], udg_Unit[udg_Level], Player(11), GetRectCenter(gg_rct_A), bj_UNIT_FACING)
    if ( udg_Level == udg_BossWave[0] ) then
        call CreateUnitAtLoc(Player(11), udg_Boss[udg_BossWave[1]], GetRectCenter(gg_rct_A), bj_UNIT_FACING)
    endif
endfunction

function main takes nothing returns nothing
    call Setup()
endfunction
`;

/** Old-style waves: one level trigger after the other sets the unit type */
const SCALAR_WAVES = `
globals
    integer udg_UNIT= 'hfoo'
endglobals

function Level1 takes nothing returns nothing
    call CreateNUnitsAtLoc(15, udg_UNIT, Player(11), GetRectCenter(gg_rct_1), bj_UNIT_FACING)
endfunction

function Start2 takes nothing returns nothing
    set udg_UNIT='hrif'
endfunction

function Start3 takes nothing returns nothing
    set udg_UNIT='hkni'
endfunction
`;

function w3u(units: [string, string, [string, number, number | string][]][]): Uint8Array {
  const w = new ByteWriter().i32(2).i32(0).i32(units.length);
  for (const [base, id, fields] of units) {
    w.id4(base).id4(id).i32(fields.length);
    for (const [field, type, value] of fields) {
      w.id4(field).i32(type);
      if (type === 0) w.i32(value as number);
      else if (type === 3) w.cstr(value as string);
      else w.f32(value as number);
      w.id4(id);
    }
  }
  return w.done();
}

describe('waves from Warcraft maps', () => {
  it('reads unit types and counts from wave arrays, bosses through their wave array', () => {
    const found = wavesFromScript(parseJass(ARRAY_WAVES))!;
    expect(found.arrays).toEqual({ unit: 'udg_Unit', count: 'udg_Count', boss: 'udg_Boss', bossWave: 'udg_BossWave' });
    expect(found.waves).toEqual([
      { wave: 1, unit: 'h000', count: 20 },
      { wave: 2, unit: 'h001', count: 15 },
      { wave: 3, unit: 'h002', count: 10 },
    ]);
    expect(found.bosses).toEqual([{ wave: 3, unit: 'H003', count: 1 }]);
  });

  it('reads waves from a unit variable the level triggers set in turn', () => {
    const found = wavesFromScript(parseJass(SCALAR_WAVES))!;
    expect(found.waves.map((w) => [w.unit, w.count])).toEqual([
      ['hfoo', 15],
      ['hrif', 15],
      ['hkni', 15],
    ]);
  });

  it('reads unit data from war3map.w3u', () => {
    const types = parseW3u(
      w3u([
        ['hfoo', 'h000', [['uhpm', 0, 300], ['umvs', 2, 300], ['unam', 3, 'Peasant Mob']]],
        ['hgyr', 'h001', [['uhpm', 0, 900], ['umvt', 3, 'fly']]],
      ]),
    );
    expect(types.get('h000')?.fields.get('unam')).toBe('Peasant Mob');
    expect(types.get('h001')?.fields.get('umvt')).toBe('fly');
    expect(types.get('h001')?.base).toBe('hgyr');
    expect(rawcodeToId(0x68303030)).toBe('h000');
  });

  it('maps units onto our enemy types by what they are and keeps the curve inside our range', () => {
    const types = parseW3u(
      w3u([
        ['hfoo', 'h000', [['uhpm', 0, 300], ['umvs', 0, 270]]],
        ['hgyr', 'h001', [['uhpm', 0, 900], ['umvs', 0, 300], ['umvt', 3, 'fly']]],
        ['hkni', 'h002', [['uhpm', 0, 3000], ['umvs', 0, 270], ['udef', 0, 40]]],
        ['Hpal', 'H003', [['uhpm', 0, 30000], ['umvs', 0, 270]]],
      ]),
    );
    const found = wavesFromScript(parseJass(ARRAY_WAVES))!;
    const result = convertWaves(found, types);
    expect(validateWaveTable(result.table)).toEqual([]);
    expect(result.waves.map((w) => w.enemy)).toEqual(['zombie', 'hornet', 'tank']);
    expect(result.waves[2].bossEnemy).toBe('herbert');
    expect(ENEMY_TYPES[result.waves[1].enemy].isAirUnit).toBe(true);
    // Effective HP per lane grows with the map's own curve
    const totals = result.table.waves.map((r) =>
      Object.entries(r.enemies).reduce((s, [t, n]) => s + n * ENEMY_TYPES[t as keyof typeof ENEMY_TYPES].baseHp, 0) * r.hpMult);
    expect(totals[1]).toBeGreaterThan(totals[0]);
    expect(totals[2]).toBeGreaterThan(totals[1]);
    expect(result.k).toBeGreaterThan(0);
  });

  it.skipIf(!TEST_MAP)('takes the forty waves of the test map over as its wave list', async () => {
    const { doc, report } = await importW3x(new Uint8Array(readFileSync(TEST_MAP!)), { waves: true });
    const waves = doc.gameplay?.waves;
    expect(waves?.kind).toBe('table');
    const table = waves?.kind === 'table' ? waves.table : null;
    expect(table && validateWaveTable(table)).toEqual([]);
    expect(table?.waves.length).toBe(40);
    expect(report.waves?.rows.filter((r) => r.boss).map((r) => r.wave)).toEqual([4, 11, 21, 30, 38, 39, 40]);
    // The game's 26 first-wave enemies, times the lane share of ten lanes (1 / sqrt 10)
    expect(report.waves?.rows[0]).toMatchObject({ unit: 'n000', count: 8, hp: 650 });
    // Wave 2 flies
    expect(ENEMY_TYPES[report.waves!.rows[1].enemy as keyof typeof ENEMY_TYPES].isAirUnit).toBe(true);
  });
});
