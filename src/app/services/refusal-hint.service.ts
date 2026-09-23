import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ABILITIES, type AbilityId, type AbilityRejectReason } from '../configs/abilities.config';
import { HERO, type HeroRejectReason } from '../configs/hero.config';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { UPGRADE_HINT_MS } from './upgrade-hint.service';
import { uiSound } from './ui-sound';

/** A refused press on an ability or the hero: whose, and why. */
export interface Refusal {
  /** The ability's or the hero's name, the title of the box */
  subject: string;
  /** Why nothing happened, the box's warning */
  reason: string;
}

/** Where no route cell is in reach of an ability's aim. The targeting mode warns with it too. */
export function abilityNoRouteText(id: AbilityId): string {
  return `No route within ${ABILITIES[id].snapRadiusM} m`;
}

/**
 * Why an ability did not arm or fire, for the player. Null for a reason the
 * player cannot act on: `locked` (before its research an ability has no
 * button and its key does nothing) and `unknown`.
 *
 * @param wavesUntilCharge completed waves to the next charge (AbilityStatus)
 */
export function abilityRefusalText(id: AbilityId, reason: AbilityRejectReason, wavesUntilCharge = 0): string | null {
  switch (reason) {
    case 'no-launch-site': {
      const from = ABILITIES[id].launchFrom;
      return from ? `Build a ${TOWER_TYPES[from].name} first` : null;
    }
    case 'no-wave': return 'Only during a wave';
    case 'no-charge':
      return wavesUntilCharge > 0
        ? `No charges, recharges in ${wavesUntilCharge} ${wavesUntilCharge === 1 ? 'wave' : 'waves'}`
        : 'No charges';
    case 'no-route': return abilityNoRouteText(id);
    case 'locked':
    case 'unknown':
      return null;
  }
}

/**
 * Why a hire or an order of the hero was refused, for the player. Null for
 * the reasons no button or key of the game can run into (`locked`, `hired`,
 * `no-hero`, `unknown-ammo`).
 *
 * @param credits credits on hand, to say how many are missing
 * @param hired whether he is hired: `no-route` refuses a hire before, an order after
 */
export function heroRefusalText(reason: HeroRejectReason, credits: number, hired: boolean): string | null {
  switch (reason) {
    case 'credits': return `Need ${(HERO.cost - credits).toLocaleString('en-US')} credits`;
    // An order to a part no route leads to, a hire without a route to stand on
    case 'no-route': return hired ? 'No way there along the routes' : 'No route to stand on';
    default: return null;
  }
}

/**
 * Why the last press on an ability or the hero did nothing, for
 * UPGRADE_HINT_MS in the context hint box (the game component shows it
 * before every other box): the ability's or the hero's name over the
 * reason. What the U key's refusal is for an upgrade, for the presses that
 * have no tower to rise over.
 *
 * Two ways in: the targeting mode's own check before it arms
 * (AbilityTargetingService.start), and `ability:rejected` and
 * `hero:rejected` for a command a manager refused (connect). A bot's
 * commands get none, like its upgrades.
 *
 * A pointer mode that starts after the refusal (build mode, map placement,
 * aiming, the hero selected) ends it: the refusal answered the press before.
 *
 * Wall clock, like UpgradeHintService: it has to run out while the game is
 * paused as well.
 */
@Injectable({ providedIn: 'root' })
export class RefusalHintService {
  private readonly store = inject(TowerDefenseStore);
  private readonly uiStore = inject(UIStore);

  /** The last refusal, null once UPGRADE_HINT_MS have passed or a pointer mode started */
  readonly refusal = signal<Refusal | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly subs = new SubscriptionBag();

  constructor() {
    effect(() => {
      const busy = this.uiStore.buildMode()
        || this.uiStore.mapPlacementMode() !== null
        || this.uiStore.abilityTargeting() !== null
        || this.uiStore.heroSelected();
      if (busy) untracked(() => this.clear());
    });
  }

  /** Follow the managers' refusals of a game session. */
  connect(bus: GameEventBus, fromPlayer: () => boolean = () => true): void {
    this.subs.disposeAll();
    this.subs.add(bus.on('ability:rejected', (event) => {
      if (fromPlayer()) this.ability(event.abilityId, event.reason);
    }));
    this.subs.add(bus.on('hero:rejected', (event) => {
      if (fromPlayer()) this.hero(event.reason);
    }));
    this.subs.add(bus.on('game:reset', () => this.clear()));
  }

  disconnect(): void {
    this.subs.disposeAll();
    this.clear();
  }

  /** `id` did not arm or fire: say why, if the player can act on it. */
  ability(id: AbilityId, reason: AbilityRejectReason): void {
    const text = abilityRefusalText(id, reason, this.store.abilities()[id]?.wavesUntilCharge ?? 0);
    if (!text) return;
    uiSound.play('denied');
    this.show({ subject: ABILITIES[id].name, reason: text });
  }

  /** The hero was not hired or did not go: say why, if the player can act on it. */
  hero(reason: HeroRejectReason): void {
    const hired = this.store.hero().hired;
    const text = heroRefusalText(reason, this.store.credits(), hired);
    if (!text) return;
    uiSound.play(reason === 'credits' ? 'noMoney' : 'denied');
    this.show({ subject: hired ? HERO.name : `Hire ${HERO.name}`, reason: text });
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.refusal.set(null);
  }

  private show(refusal: Refusal): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.refusal.set(refusal);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refusal.set(null);
    }, UPGRADE_HINT_MS);
  }
}
