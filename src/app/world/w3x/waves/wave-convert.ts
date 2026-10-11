/**
 * A Warcraft TD's waves as the map's own wave list (the table wave source).
 *
 * Each Warcraft unit becomes one of our enemy types by what it is: flying,
 * boss, ethereal (hovering or floating), armoured, fast or plain, compared
 * with the map's other wave units (median speed, upper quartile of armour),
 * with variety by wave number among the fitting types.
 *
 * Size: a Warcraft TD gives each player one lane; here one player holds all
 * of them, and every lane gets its own copy of a wave. So a lane gets the
 * share 1 / sqrt(lanes) of a one-lane wave: all lanes together bring
 * sqrt(lanes) times one lane's worth (10 lanes: 3.2 times). Counts are the
 * map's, scaled so its first wave has as many enemies as the game's own,
 * times that share. Hit points follow the map's curve, compressed to ours:
 * a wave's total HP (count times HP, bosses included) relative to wave 1 is
 * raised to the power `k` that makes the map's last wave as much harder than
 * its first as the game's own wave list is at that wave, then scaled to the
 * game's first wave and the lane share.
 */

import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import { MAX_WAVE_DURATION_MS, WAVE_TABLE } from '../../../director/sources/table/wave-table';
import type { MapWaveRow, MapWaveTable } from '../../custom-map/map-document';
import type { W3UnitType } from '../formats/w3u';
import { plainText } from '../formats/wts';
import type { ScriptWaves } from './wave-script';

/** Warcraft's default ground speed and hit points where a unit leaves them unchanged */
const DEFAULT_SPEED = 270;
const DEFAULT_HP = 420;
const MAX_COUNT = 150;
/** Units per lane where the script does not say how many (the game's first wave has 26) */
const DEFAULT_COUNT = 20;
const BASE_SPAWN_DELAY = 600;

type Kind = 'air' | 'boss' | 'air-boss' | 'ethereal' | 'armored' | 'fast' | 'plain';

const CANDIDATES: Record<Kind, EnemyTypeId[]> = {
  air: ['hornet', 'bat', 'dragon'],
  boss: ['herbert', 'golem-king'],
  'air-boss': ['dragon-matriarch'],
  ethereal: ['ghost', 'wraith'],
  armored: ['tank', 'zombie-soldier', 'mech', 'mammoth', 'stone-golem'],
  fast: ['spider', 'penguin', 'wallsmasher'],
  plain: ['zombie', 'bear', 'zombie-v2'],
};

export interface WaveUnitInfo {
  unit: string;
  name: string;
  hp: number;
  /** Warcraft units per second */
  speed: number;
  armor: number;
  move: string;
}

export interface ConvertedWave {
  wave: number;
  from: WaveUnitInfo;
  boss: (WaveUnitInfo & { count: number }) | null;
  enemy: EnemyTypeId;
  bossEnemy: EnemyTypeId | null;
  count: number;
  hpMult: number;
}

export interface WaveConversion {
  table: MapWaveTable;
  waves: ConvertedWave[];
  /** The HP curve's exponent; null where the map has no unit data and the game's own curve stands in */
  k: number | null;
  /** What the conversion had to guess */
  warnings: string[];
}

function unitInfo(unit: string, types: Map<string, W3UnitType>): WaveUnitInfo {
  const f = types.get(unit)?.fields;
  const num = (id: string, fallback: number): number => {
    const v = f?.get(id);
    return typeof v === 'number' && v > 0 ? v : fallback;
  };
  const name = f?.get('unam');
  const move = f?.get('umvt');
  return {
    unit,
    name: typeof name === 'string' && name.trim() ? plainText(name) : unit,
    hp: num('uhpm', DEFAULT_HP),
    speed: num('umvs', DEFAULT_SPEED),
    armor: typeof f?.get('udef') === 'number' ? (f.get('udef') as number) : 0,
    move: typeof move === 'string' ? move : 'foot',
  };
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function kindOf(u: WaveUnitInfo, speedMedian: number, armorHigh: number, boss: boolean): Kind {
  const air = u.move === 'fly';
  if (boss) return air ? 'air-boss' : 'boss';
  if (air) return 'air';
  if (u.move === 'hover' || u.move === 'float') return 'ethereal';
  if (u.armor >= armorHigh && armorHigh > 0) return 'armored';
  if (u.speed >= speedMedian * 1.2) return 'fast';
  return 'plain';
}

/** Total HP of one lane of a wave of the game's own list, its effective HP (base x hpMult) */
function tableTotal(wave: number): number {
  const row = WAVE_TABLE.waves.find((r) => r.wave === wave);
  if (!row) return 0;
  return Object.entries(row.enemies).reduce((sum, [type, n]) => sum + n * ENEMY_TYPES[type as EnemyTypeId].baseHp, 0) * row.hpMult;
}

/** Enemies of one lane in a wave of the game's own list */
function tableCount(wave: number): number {
  const row = WAVE_TABLE.waves.find((r) => r.wave === wave);
  return row ? Object.values(row.enemies).reduce((a, b) => a + b, 0) : 20;
}

/** The game's own growth at wave `n` (1 at wave 1), the list's last value past its end */
function tableGrowthAt(n: number): number {
  return n <= 1 ? 1 : tableGrowth(n);
}

/** The game's wave-list growth at wave `n`, smoothed over the waves around it (geometric mean) */
function tableGrowth(n: number): number {
  const first = tableTotal(1);
  const last = WAVE_TABLE.waves[WAVE_TABLE.waves.length - 1].wave;
  const at = Math.min(Math.max(n, 3), last - 2);
  let log = 0;
  for (let w = at - 2; w <= at + 2; w++) log += Math.log(Math.max(1, tableTotal(w)));
  return Math.exp(log / 5) / first;
}

export function convertWaves(script: ScriptWaves, types: Map<string, W3UnitType>, lanes = 1): WaveConversion {
  const warnings: string[] = [];
  const laneShare = 1 / Math.sqrt(Math.max(1, lanes));
  const infos = script.waves.map((w) => unitInfo(w.unit, types));
  const statsKnown = script.waves.some((w) => typeof types.get(w.unit)?.fields.get('uhpm') === 'number');
  if (!statsKnown) warnings.push('waves: the map has no hit points of its units; HP follow the wave curve of the game');
  if (script.waves.some((w) => w.count === null)) {
    warnings.push(`waves: the script does not say how many units a wave has; ${DEFAULT_COUNT} per lane`);
  }
  const rawCount = (i: number): number => Math.min(MAX_COUNT, script.waves[i].count ?? DEFAULT_COUNT);
  // The game's first wave count over the map's, so the first waves are alike in number
  const countScale = tableCount(1) / Math.max(1, rawCount(0));
  const countOf = (i: number): number => Math.max(2, Math.min(MAX_COUNT, Math.round(rawCount(i) * countScale * laneShare)));
  const speedMedian = median(infos.map((i) => i.speed));
  const armors = [...infos.map((i) => i.armor)].sort((a, b) => a - b);
  const armorHigh = armors[Math.floor(armors.length * 0.75)] ?? 0;
  const bossesByWave = new Map(script.bosses.map((b) => [b.wave, b]));

  const total = (i: number): number => {
    const w = script.waves[i];
    const boss = bossesByWave.get(w.wave);
    return countOf(i) * infos[i].hp + (boss ? boss.count * unitInfo(boss.unit, types).hp : 0);
  };
  const first = Math.max(1, total(0));
  const lastIndex = script.waves.length - 1;
  const mapGrowth = Math.max(1.0001, total(lastIndex) / first);
  const ourGrowth = Math.max(1.0001, tableGrowth(script.waves[lastIndex].wave));
  const k = Math.min(1, Math.max(0.2, Math.log(ourGrowth) / Math.log(mapGrowth)));
  const ourFirst = tableTotal(1);

  const used = new Map<Kind, number>();
  const pick = (kind: Kind): EnemyTypeId => {
    const n = used.get(kind) ?? 0;
    used.set(kind, n + 1);
    const list = CANDIDATES[kind];
    return list[n % list.length];
  };

  const waves: ConvertedWave[] = [];
  const rows: MapWaveRow[] = [];
  script.waves.forEach((w, i) => {
    const info = infos[i];
    const bossEntry = bossesByWave.get(w.wave);
    const boss = bossEntry ? { ...unitInfo(bossEntry.unit, types), count: bossEntry.count } : null;
    const enemy = pick(kindOf(info, speedMedian, armorHigh, false));
    const bossEnemy = boss ? pick(kindOf(boss, speedMedian, armorHigh, true)) : null;
    const count = countOf(i);
    const growth = statsKnown ? Math.pow(Math.max(1e-6, total(i) / first), k) : tableGrowthAt(i + 1);
    const target = ourFirst * growth * laneShare;
    const base = count * ENEMY_TYPES[enemy].baseHp + (boss && bossEnemy ? boss.count * ENEMY_TYPES[bossEnemy].baseHp : 0);
    const hpMult = Math.round((target / base) * 1000) / 1000;
    const enemies: Record<string, number> = { [enemy]: count };
    if (boss && bossEnemy) enemies[bossEnemy] = (enemies[bossEnemy] ?? 0) + boss.count;
    const spawned = count + (boss?.count ?? 0);
    rows.push({
      wave: w.wave,
      name: boss ? `${info.name} + ${boss.name}` : info.name,
      enemies,
      hpMult: Math.max(0.01, hpMult),
      spawnDelay: Math.max(50, Math.min(BASE_SPAWN_DELAY, Math.floor(MAX_WAVE_DURATION_MS / spawned) - 1)),
      spawnDelayVariation: 0.2,
      note: `Warcraft ${info.unit}: ${Math.round(info.hp)} HP, ${Math.round(info.speed)} speed, armour ${info.armor}, ${info.move}`,
    });
    waves.push({ wave: w.wave, from: info, boss, enemy, bossEnemy, count, hpMult: Math.max(0.01, hpMult) });
  });

  // Waves numbered from 1 without gaps, as the table source reads them
  rows.forEach((r, i) => (r.wave = i + 1));
  waves.forEach((w, i) => (w.wave = i + 1));
  return {
    table: { cycle: { fromWave: rows.length, hpGrowth: 1.25 }, waves: rows },
    waves,
    k: statsKnown ? Math.round(k * 1000) / 1000 : null,
    warnings,
  };
}
