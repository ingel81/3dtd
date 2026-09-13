import { HERO, HERO_AMMO, type HeroStatus } from '../../configs/hero.config';
import type { AbilityBarHero } from './ability-button';

/** The hero's button at the top of the ability bar, with what a press does. */
export interface HeroBarView extends AbilityBarHero {
  /**
   *   hire    the research is done, he is not hired yet: a press hires him
   *   summon  he is hired: a press does what G does
   */
  action: 'hire' | 'summon';
}

/**
 * Missing until the research is done, then the offer with the price, after
 * the hire the hero himself with G as his key.
 *
 * @param status   GameStore.hero
 * @param selected whether he is selected (HeroControlService.selected)
 * @param credits  credits on hand, to say how many are missing
 */
export function heroBarView(status: HeroStatus, selected: boolean, credits: number): HeroBarView | null {
  if (!status.unlocked) return null;
  if (!status.hired) {
    const price = HERO.cost.toLocaleString('en-US');
    const short = HERO.cost - credits;
    return {
      action: 'hire',
      icon: 'coin',
      name: `Hire ${HERO.name}`,
      hotkey: null,
      selected: false,
      detail: short > 0
        ? `${price} credits, ${short.toLocaleString('en-US')} short.`
        : `${price} credits, once. He takes his post on the route next to the HQ.`,
    };
  }
  return {
    action: 'summon',
    icon: 'user',
    name: HERO.name,
    hotkey: 'G',
    selected,
    detail: `Level ${status.level}, ${HERO_AMMO[status.ammo].name.toLowerCase()}. `
      + 'A press selects him, a second brings him into view.',
  };
}
