import { ABILITY_IDS, type AbilityConfig, type AbilityId, type AbilityStatus } from '../../configs/abilities.config';
import type { TdIconName } from '../icon/icon.component';
import type { TdTooltipData } from '../tooltip/tooltip-data.types';
import type { Messages } from '../../i18n/messages/en';

/**
 * The abilities the bar has a button for: those whose research is done and
 * whose launch site stands (the nuclear strike: a missile silo), in
 * ABILITIES order. Until then an ability has no button at all.
 */
export function abilityBarIds(statuses: Readonly<Record<AbilityId, AbilityStatus>>): AbilityId[] {
  return ABILITY_IDS.filter((id) => statuses[id].unlocked && statuses[id].launchSite);
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
  /**
   * A rivet per charge the ability holds, as its fill from 0 to 1: 1 for a
   * charge on hand, the share of the completed waves the next charge needs
   * for the one that fills, 0 for the ones after it
   */
  rivets: number[];
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
  t: Messages,
  config: Pick<AbilityConfig, 'id' | 'rechargeWaves' | 'maxCharges'>,
  status: AbilityStatus,
  waveActive: boolean,
  targeting: boolean,
): AbilityButtonView {
  const { rechargeWaves, maxCharges } = config;
  const name = t.abilities[config.id].name;
  const says = t.hud.ability;
  const charged = status.charges > 0;
  const rivets = chargeRivets(status.charges, maxCharges, rechargeWaves, status.wavesUntilCharge);
  const view = (state: AbilityButtonView['state'], enabled: boolean, text: string): AbilityButtonView =>
    ({ state, enabled, rivets, status: text, label: says.label(name, text) });

  if (status.pending) return view('pending', false, says.incoming);
  if (charged && targeting) return view('armed', true, says.armed);
  if (charged && waveActive) return view('ready', true, says.ready);
  if (charged) return view('waiting', false, says.waiting);
  return view('recharging', false, says.recharges(status.wavesUntilCharge));
}

/**
 * The rivets of an ability button, one per charge it holds, as fills from 0
 * to 1: the charges on hand full, the next one filled by the completed waves
 * it needs, the rest empty. A full ability fills every rivet.
 */
export function chargeRivets(charges: number, maxCharges: number, rechargeWaves: number, wavesUntilCharge: number): number[] {
  const next = rechargeWaves > 0 ? Math.min(Math.max((rechargeWaves - wavesUntilCharge) / rechargeWaves, 0), 1) : 0;
  return Array.from({ length: maxCharges }, (_, i) => (i < charges ? 1 : i === charges ? next : 0));
}

/**
 * Rich tooltip of an ability button: name, state and key in the head, the
 * charges and the recharge, the description.
 */
export function abilityTooltip(
  t: Messages,
  config: Pick<AbilityConfig, 'id' | 'hotkey' | 'maxCharges' | 'rechargeWaves'>,
  status: AbilityStatus,
  view: AbilityButtonView,
): TdTooltipData {
  const text = t.abilities[config.id];
  return {
    title: text.name,
    category: view.status.toUpperCase(),
    hotkey: config.hotkey.toUpperCase(),
    accent: view.state === 'recharging' ? 'neutral' : 'gold',
    stats: [
      { label: t.hud.ability.charges, value: `${status.charges}/${config.maxCharges}` },
      { label: t.hud.ability.recharge, value: t.hud.ability.waves(config.rechargeWaves) },
    ],
    flavor: text.description,
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
export function heroTooltip(t: Messages, hero: AbilityBarHero): TdTooltipData {
  return {
    title: hero.name,
    category: t.hud.heroButton.category,
    hotkey: hero.hotkey?.toUpperCase(),
    accent: 'gold',
    flavor: hero.detail ?? t.hud.heroButton.selectHint,
  };
}

/**
 * Measures of the bar in px: its `left` on the canvas, its border, its
 * padding, the square buttons and the room it keeps clear below the info
 * overlay and above the logo row (`clear`). AbilityBarComponent hands them
 * to its SCSS as custom properties, so the bar is drawn from these numbers.
 */
// No strip behind the stones: no border, and the padding is room for their
// shadow, so the stones stand 12 px from the canvas edge (left + padding)
export const ABILITY_BAR_PX = { left: 7, border: 0, padding: 5, button: 48, clear: 3 } as const;

/**
 * Outer right edge of the bar in px from the left edge of the canvas: its
 * `left` plus its width (border, padding, a button, padding, border). The
 * off-screen arrows keep clear of it.
 */
export const ABILITY_BAR_EDGE_PX =
  ABILITY_BAR_PX.left + 2 * (ABILITY_BAR_PX.border + ABILITY_BAR_PX.padding) + ABILITY_BAR_PX.button;
