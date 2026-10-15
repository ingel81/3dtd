/**
 * Balance aids of the Rules panel (TODO E170, ED-K13): what each wave of a
 * wave list brings, read without playing it. HP is the enemies' base HP
 * times the row's HP factor (the cycle's growth past the list), splits
 * included (lineageHp); a wave that got through whole would cost the HQ its
 * leak damage (lineageLeakDamage); the spawning takes count times delay.
 * Per lane: every open lane brings the whole wave.
 */
import { ENEMY_TYPES, lineageHp, lineageLeakDamage, type EnemyTypeId } from '../../../configs/enemy-types.config';
import { tableRowForWave, type WaveTable } from '../../../director/sources/table/wave-table';

export interface WavePoint {
  wave: number;
  name: string;
  /** Enemies the row spawns */
  enemies: number;
  /** Their HP, splits included */
  hp: number;
  /** HQ damage if every one got through */
  leak: number;
  /** Seconds the spawning takes */
  seconds: number;
}

/** Waves 1 to `waves` of a list, the cycle past its end; an empty list gives none */
export function waveCurve(table: WaveTable, waves: number): WavePoint[] {
  const out: WavePoint[] = [];
  if (!table.waves.length) return out;
  for (let wave = 1; wave <= waves; wave++) {
    const lookup = tableRowForWave(wave, table);
    if (!lookup) continue;
    let enemies = 0;
    let hp = 0;
    let leak = 0;
    for (const [type, count] of Object.entries(lookup.row.enemies)) {
      if (!ENEMY_TYPES[type as EnemyTypeId] || !(count > 0)) continue;
      enemies += count;
      hp += count * lineageHp(type as EnemyTypeId) * lookup.hpMult;
      leak += count * lineageLeakDamage(type as EnemyTypeId);
    }
    out.push({ wave, name: lookup.row.name, enemies, hp: Math.round(hp), leak, seconds: Math.round((enemies * lookup.row.spawnDelay) / 100) / 10 });
  }
  return out;
}

/** A compact number: 950, 12.4k, 3.1M */
export function shortNumber(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(v));
}
