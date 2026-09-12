import type { AbilityStatus } from '../../../configs/abilities.config';

/** What the ability button next to the wave button shows, derived outside the template. */
export interface AbilityButtonView {
  /** Hidden until the research is done */
  visible: boolean;
  /**
   *   ready       charged and a wave runs: a press arms the targeting mode
   *   armed       the targeting mode is on: a press leaves it
   *   waiting     charged, but no wave runs
   *   pending     the strike is on its way
   *   recharging  waiting for completed waves
   */
  state: 'ready' | 'armed' | 'waiting' | 'pending' | 'recharging';
  /** A press does something (arm or leave the targeting mode) */
  enabled: boolean;
  /** One per completed wave the charge needs, true once done; all true while charged */
  pips: boolean[];
  /** Tooltip and accessible name */
  label: string;
}

/**
 * @param name          ability name for the label
 * @param status        the ability's snapshot (GameStore.abilities)
 * @param rechargeWaves completed waves per charge
 * @param waveActive    whether a wave runs
 * @param targeting     whether the targeting mode is on for this ability
 */
export function abilityButtonView(
  name: string,
  status: AbilityStatus,
  rechargeWaves: number,
  waveActive: boolean,
  targeting: boolean,
): AbilityButtonView {
  const charged = status.charges > 0;
  const done = charged ? rechargeWaves : rechargeWaves - status.wavesUntilCharge;
  const pips = Array.from({ length: rechargeWaves }, (_, i) => i < done);
  const view = (state: AbilityButtonView['state'], enabled: boolean, label: string): AbilityButtonView =>
    ({ visible: status.unlocked, state, enabled, pips, label: `${name}: ${label}` });

  if (!status.unlocked) return view('recharging', false, 'locked');
  if (status.pending) return view('pending', false, 'incoming');
  if (charged && targeting) return view('armed', true, 'pick a spot on the route, Esc cancels');
  if (charged && waveActive) return view('ready', true, 'ready');
  if (charged) return view('waiting', false, 'ready, fires during a wave');
  const waves = status.wavesUntilCharge;
  return view('recharging', false, `recharges in ${waves} ${waves === 1 ? 'wave' : 'waves'}`);
}
