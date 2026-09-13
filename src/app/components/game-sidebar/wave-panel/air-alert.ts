import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { getAllTowerTypes, TowerTypeId } from '../../../configs/tower-types.config';
import { templateObjectForWave } from '../../../configs/wave-curriculum.config';
import { canTargetAirEffective } from '../../../entities/tower-targeting.util';

/**
 * Air alert in the WAVE panel (MASTER_GAME_DESIGN §9: red air icon and a
 * sound two waves before air arrives). Pure functions, the panel feeds in the
 * wave number and the placed towers.
 */

/** Waves the alert looks ahead: the next one and the one after. */
export const AIR_ALERT_LOOKAHEAD = 2;

export interface AirAlert {
  /** First wave with air units within the lookahead */
  wave: number;
  /** 1 = the next wave, 2 = the one after */
  wavesAhead: number;
  /** Placed towers that can hit air now */
  antiAirTowers: number;
}

export interface AirAlertView {
  title: string;
  when: string;
  defense: string;
  /** At least one placed tower hits air */
  covered: boolean;
  tooltip: string;
}

/**
 * Whether the curriculum template of `wave` brings air units. False past the
 * curriculum: there the director picks the template when the wave starts.
 */
export function curriculumWaveHasAir(wave: number): boolean {
  const template = templateObjectForWave(wave);
  return !!template && template.enemies.some(([id]) => ENEMY_TYPES[id]?.isAirUnit === true);
}

/**
 * The alert after wave `lastWave`, null when neither of the next two waves
 * brings air. Callers show it only in the build phase.
 */
export function upcomingAirAlert(lastWave: number, antiAirTowers: number): AirAlert | null {
  for (let ahead = 1; ahead <= AIR_ALERT_LOOKAHEAD; ahead++) {
    const wave = lastWave + ahead;
    if (curriculumWaveHasAir(wave)) return { wave, wavesAhead: ahead, antiAirTowers };
  }
  return null;
}

/** Placed towers of these types that hit air, research included. */
export function countAntiAirTowers(typeIds: Iterable<TowerTypeId>, airTargetingUnlocked: boolean): number {
  let n = 0;
  for (const id of typeIds) {
    if (canTargetAirEffective(id, airTargetingUnlocked)) n++;
  }
  return n;
}

/** Tower names that hit air, those that need research marked as such. */
function airTowerNames(airTargetingUnlocked: boolean): string {
  return getAllTowerTypes()
    .filter((t) => canTargetAirEffective(t.id, true))
    .map((t) => (canTargetAirEffective(t.id, airTargetingUnlocked) ? t.name : `${t.name} (after research)`))
    .join(', ');
}

export function airAlertView(alert: AirAlert, airTargetingUnlocked: boolean): AirAlertView {
  const n = alert.antiAirTowers;
  return {
    title: `Air · Wave ${alert.wave}`,
    when: alert.wavesAhead === 1 ? 'next wave' : `in ${alert.wavesAhead} waves`,
    defense: n === 0 ? 'No tower hits air yet' : `${n} ${n === 1 ? 'tower hits' : 'towers hit'} air`,
    covered: n > 0,
    tooltip: `Air units fly over the route. Only towers that hit air can shoot them: ${airTowerNames(airTargetingUnlocked)}.`,
  };
}
