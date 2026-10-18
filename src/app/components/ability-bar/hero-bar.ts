import { HERO, type HeroStatus } from '../../configs/hero.config';
import type { AbilityBarHero } from './ability-button';
import type { Messages } from '../../i18n/messages/en';

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
export function heroBarView(t: Messages, status: HeroStatus, selected: boolean, credits: number): HeroBarView | null {
  if (!status.unlocked) return null;
  if (!status.hired) {
    const short = HERO.cost - credits;
    const says = t.hud.heroButton;
    return {
      action: 'hire',
      icon: 'coin',
      name: says.hire(t.hero.name),
      hotkey: null,
      selected: false,
      detail: short > 0 ? says.short(HERO.cost, short) : says.once(HERO.cost),
    };
  }
  return {
    action: 'summon',
    icon: 'user',
    name: t.hero.name,
    hotkey: 'G',
    selected,
    detail: t.hud.heroButton.hired(status.level, t.hero.ammo[status.ammo]),
  };
}
