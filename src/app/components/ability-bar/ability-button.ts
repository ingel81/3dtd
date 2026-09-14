import { ABILITY_IDS, type AbilityConfig, type AbilityId, type AbilityStatus } from '../../configs/abilities.config';
import type { TdIconName } from '../icon/icon.component';
import type { TdTooltipData } from '../tooltip/tooltip-data.types';

/**
 * The abilities the bar has a button for: those whose research is done, in
 * ABILITIES order. Until then an ability has no button at all.
 */
export function abilityBarIds(statuses: Readonly<Record<AbilityId, AbilityStatus>>): AbilityId[] {
  return ABILITY_IDS.filter((id) => statuses[id].unlocked);
}

/** What an ability button in the ability bar shows, derived outside the template. */
export interface AbilityButtonView {
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
  /** Charges on hand for an ability that holds more than one, else null */
  charges: number | null;
  /** What the state means: "recharges in 2 waves" */
  status: string;
  /** Accessible name: "Nuclear Strike: recharges in 2 waves" */
  label: string;
}

/**
 * @param config     the ability's entry in ABILITIES
 * @param status     the ability's snapshot (GameStore.abilities), researched (abilityBarIds)
 * @param waveActive whether a wave runs
 * @param targeting  whether the targeting mode is on for this ability
 */
export function abilityButtonView(
  config: Pick<AbilityConfig, 'name' | 'rechargeWaves' | 'maxCharges'>,
  status: AbilityStatus,
  waveActive: boolean,
  targeting: boolean,
): AbilityButtonView {
  const { name, rechargeWaves, maxCharges } = config;
  const charged = status.charges > 0;
  const done = charged ? rechargeWaves : rechargeWaves - status.wavesUntilCharge;
  const pips = Array.from({ length: rechargeWaves }, (_, i) => i < done);
  const charges = maxCharges > 1 ? status.charges : null;
  const view = (state: AbilityButtonView['state'], enabled: boolean, text: string): AbilityButtonView =>
    ({ state, enabled, pips, charges, status: text, label: `${name}: ${text}` });

  if (status.pending) return view('pending', false, 'incoming');
  if (charged && targeting) return view('armed', true, 'pick a spot on the route, Esc cancels');
  if (charged && waveActive) return view('ready', true, 'ready');
  if (charged) return view('waiting', false, 'ready, fires during a wave');
  const waves = status.wavesUntilCharge;
  return view('recharging', false, `recharges in ${waves} ${waves === 1 ? 'wave' : 'waves'}`);
}

/**
 * Rich tooltip of an ability button: name, state and key in the head, the
 * charges and the recharge, the description.
 */
export function abilityTooltip(
  config: Pick<AbilityConfig, 'name' | 'description' | 'hotkey' | 'maxCharges' | 'rechargeWaves'>,
  status: AbilityStatus,
  view: AbilityButtonView,
): TdTooltipData {
  const waves = config.rechargeWaves;
  return {
    title: config.name,
    category: view.status.toUpperCase(),
    hotkey: config.hotkey.toUpperCase(),
    accent: view.state === 'recharging' ? 'neutral' : 'gold',
    stats: [
      { label: 'CHARGES', value: `${status.charges}/${config.maxCharges}` },
      { label: 'RECHARGE', value: `${waves} ${waves === 1 ? 'wave' : 'waves'}` },
    ],
    flavor: config.description,
  };
}

/**
 * The hero's place at the top of the ability bar. The hero feature fills it
 * (AbilityBarComponent.hero); without a hero the bar has no such button.
 */
export interface AbilityBarHero {
  icon: TdIconName;
  /** Tooltip title and accessible name */
  name: string;
  /** Key that does what the button does, shown as a key cap; null for none */
  hotkey: string | null;
  /** The hero is selected: the button shows it pressed */
  selected: boolean;
  /** One line for the tooltip, e.g. level and damage type; the default says what a press does */
  detail?: string;
}

/** Tooltip of the hero button. */
export function heroTooltip(hero: AbilityBarHero): TdTooltipData {
  return {
    title: hero.name,
    category: 'HERO',
    hotkey: hero.hotkey?.toUpperCase(),
    accent: 'gold',
    flavor: hero.detail ?? 'Select the hero and bring it into view.',
  };
}

/**
 * Measures of the bar in px: its `left` on the canvas, its border, its
 * padding, the square buttons and the room it keeps clear below the info
 * overlay and above the logo row (`clear`). AbilityBarComponent hands them
 * to its SCSS as custom properties, so the bar is drawn from these numbers.
 */
export const ABILITY_BAR_PX = { left: 12, border: 1, padding: 5, button: 44, clear: 8 } as const;

/**
 * Outer right edge of the bar in px from the left edge of the canvas: its
 * `left` plus its width (border, padding, a button, padding, border). The
 * off-screen arrows keep clear of it.
 */
export const ABILITY_BAR_EDGE_PX =
  ABILITY_BAR_PX.left + 2 * (ABILITY_BAR_PX.border + ABILITY_BAR_PX.padding) + ABILITY_BAR_PX.button;
