import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { getAllTowerTypes, TowerTypeId } from '../../../configs/tower-types.config';
import { waveHasAir } from '../../../director/wave-rules';
import { isAntiEtherealTower } from '../../../director/defense-analyzer';
import { canTargetAirEffective } from '../../../entities/tower-targeting.util';

/**
 * Wave alerts in the WAVE panel (MASTER_GAME_DESIGN §9): an icon and a sound
 * two waves before enemies arrive that only some towers answer. The same rule
 * for each kind: air units, which only towers that hit air can shoot, and
 * ethereal ones, which only magic, ice and lightning hurt. Pure functions,
 * the panel feeds in the wave number and the placed towers.
 */

/** Waves an alert looks ahead: the next one and the one after. */
export const WAVE_ALERT_LOOKAHEAD = 2;

export type WaveAlertKind = 'air' | 'ethereal';

/** The kinds in the order the panel shows them */
export const WAVE_ALERT_KINDS: readonly WaveAlertKind[] = ['air', 'ethereal'];

export interface WaveAlert {
  kind: WaveAlertKind;
  /** First wave of this kind within the lookahead */
  wave: number;
  /** 1 = the next wave, 2 = the one after */
  wavesAhead: number;
  /** Placed towers that answer it now */
  answering: number;
}

export interface WaveAlertView {
  kind: WaveAlertKind;
  icon: 'plane' | 'ghost';
  title: string;
  when: string;
  defense: string;
  /** At least one placed tower answers it */
  covered: boolean;
  tooltip: string;
}

const isEtherealEnemy = (id: string): boolean => ENEMY_TYPES[id]?.armorType === 'ethereal';

/**
 * Whether `wave` brings enemies of `kind`, as far as the source fixes the wave
 * in advance (both of today's sources fix every wave).
 */
export function waveBrings(kind: WaveAlertKind, wave: number): boolean {
  return kind === 'air'
    ? waveHasAir(wave, (id) => ENEMY_TYPES[id]?.isAirUnit === true)
    : waveHasAir(wave, isEtherealEnemy);
}

/**
 * The alert of `kind` after wave `lastWave`, null when neither of the next two
 * waves brings it. Callers show it only in the build phase.
 */
export function upcomingWaveAlert(kind: WaveAlertKind, lastWave: number, answering: number): WaveAlert | null {
  for (let ahead = 1; ahead <= WAVE_ALERT_LOOKAHEAD; ahead++) {
    const wave = lastWave + ahead;
    if (waveBrings(kind, wave)) return { kind, wave, wavesAhead: ahead, answering };
  }
  return null;
}

/**
 * When an alert tone plays: once per wave of its kind, when the alert first
 * names it, and again in a new run (restart or new location, the wave number
 * falls back). A wave counts as announced only once the tone actually came
 * out. One announcer per kind.
 */
export class WaveAlertAnnouncer {
  /** Wave the tone last played for */
  private announcedWave = 0;
  /** Wave whose tone was asked for and has not answered yet */
  private pendingWave = 0;
  private lastWaveNumber = 0;
  /** Counts the runs, so a tone that answers late is not credited to the next one */
  private run = 0;

  /**
   * `play` plays the tone and answers whether it came out; a rejection
   * counts as silent. Until it answers, the same wave is not asked again.
   */
  update(waveNumber: number, alert: WaveAlert | null, play: () => Promise<boolean>): void {
    if (waveNumber < this.lastWaveNumber) {
      this.run++;
      this.announcedWave = 0;
      this.pendingWave = 0;
    }
    this.lastWaveNumber = waveNumber;
    if (!alert || alert.wave === this.announcedWave || alert.wave === this.pendingWave) return;

    const { wave } = alert;
    const run = this.run;
    this.pendingWave = wave;
    const settle = (played: boolean) => {
      if (run !== this.run || this.pendingWave !== wave) return;
      this.pendingWave = 0;
      if (played) this.announcedWave = wave;
    };
    void play().then(settle, () => settle(false));
  }
}

/** Placed towers of these types that hit air, research included. */
export function countAntiAirTowers(typeIds: Iterable<TowerTypeId>, airTargetingUnlocked: boolean): number {
  let n = 0;
  for (const id of typeIds) {
    if (canTargetAirEffective(id, airTargetingUnlocked)) n++;
  }
  return n;
}

/** Placed towers of these types that hurt ethereal armor. */
export function countAntiEtherealTowers(typeIds: Iterable<TowerTypeId>): number {
  let n = 0;
  for (const id of typeIds) {
    if (isAntiEtherealTower(id)) n++;
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

/** Tower names that hurt ethereal armor */
function etherealTowerNames(): string {
  return getAllTowerTypes()
    .filter((t) => isAntiEtherealTower(t.id))
    .map((t) => t.name)
    .join(', ');
}

export function waveAlertView(alert: WaveAlert, airTargetingUnlocked: boolean): WaveAlertView {
  const n = alert.answering;
  const when = alert.wavesAhead === 1 ? 'next wave' : `in ${alert.wavesAhead} waves`;
  if (alert.kind === 'air') {
    return {
      kind: 'air',
      icon: 'plane',
      title: `Air · Wave ${alert.wave}`,
      when,
      defense: n === 0 ? 'No tower hits air yet' : `${n} ${n === 1 ? 'tower hits' : 'towers hit'} air`,
      covered: n > 0,
      tooltip: `Air units fly over the route. Only towers that hit air can shoot them: ${airTowerNames(airTargetingUnlocked)}.`,
    };
  }
  return {
    kind: 'ethereal',
    icon: 'ghost',
    title: `Ethereal · Wave ${alert.wave}`,
    when,
    defense: n === 0 ? 'No tower hurts ethereal yet' : `${n} ${n === 1 ? 'tower hurts' : 'towers hurt'} ethereal`,
    covered: n > 0,
    tooltip: 'Ethereal enemies shrug off most damage: arrows, bullets and fire deal a tenth. '
      + `These towers get through: ${etherealTowerNames()}.`,
  };
}
