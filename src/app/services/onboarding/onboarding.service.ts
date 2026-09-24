import { Injectable, computed, signal } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import {
  INITIAL_ONBOARDING,
  INITIAL_PROGRESS,
  ONBOARDING_STEPS,
  OnboardingAction,
  OnboardingProgress,
  OnboardingState,
  OnboardingTip,
  advanceOnboarding,
  currentStep,
  loadOnboarding,
  sameProgress,
  saveOnboarding,
  tipFor,
} from './onboarding';

/** The tip on screen with its place in the sequence */
export interface ActiveOnboardingTip extends OnboardingTip {
  index: number;
  total: number;
}

/**
 * First-run tips: short hints in the context-hint box, each gone once the
 * player does what it says or skips it. The first three walk the first
 * wave; the later ones wait until what they talk about is there (a wave or
 * two done, a research center, an ability or the hero researched). The
 * state machine is in onboarding.ts, the state in localStorage
 * (td_onboarding_v2), the game's progress only here. The sidebar footer's
 * Tips button starts them again from the first the running game has not done.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  readonly state = signal<OnboardingState>(loadOnboarding());
  /** How far the running game is, from its events */
  readonly progress = signal<OnboardingProgress>(INITIAL_PROGRESS, { equal: sameProgress });

  /** Tip to show, null while none is due or once the tips are over */
  readonly tip = computed<ActiveOnboardingTip | null>(() => {
    const progress = this.progress();
    const step = currentStep(this.state(), progress);
    if (!step) return null;
    return { ...tipFor(step, progress), index: ONBOARDING_STEPS.indexOf(step) + 1, total: ONBOARDING_STEPS.length };
  });

  /**
   * The same machine over this game's own actions, no skips: what the
   * running game has done. Tips leaves those steps out. Not stored.
   */
  private game: OnboardingState = INITIAL_ONBOARDING;

  private readonly subs = new SubscriptionBag();

  /** Follow the game's events; called per game session next to GameStateSyncService. */
  connect(bus: GameEventBus): void {
    this.subs.disposeAll();
    this.newGame();
    this.subs.add(bus.onLive('tower:placed', (e) => {
      this.play({ kind: 'tower-placed', towerType: e.tower.typeConfig.id });
    }));
    this.subs.add(bus.onLive('tower:upgraded', (e) => {
      this.play({ kind: 'tower-upgraded', towerType: e.tower.typeConfig.id });
    }));
    this.subs.add(bus.onLive('research:started', (e) => { if (e.local) this.play({ kind: 'research-started' }); }));
    this.subs.add(bus.onLive('wave:started', () => this.play({ kind: 'wave-started' })));
    this.subs.add(bus.onLive('ability:used', (e) => { if (e.local) this.play({ kind: 'ability-used' }); }));
    this.subs.add(bus.onLive('hero:state-changed', (e) => {
      if (!e.local) return;
      this.updateProgress({ heroUnlocked: e.hero.unlocked });
      if (e.hero.hired) this.play({ kind: 'hero-hired' });
    }));

    this.subs.add(bus.onLive('wave:completed', (e) => this.updateProgress({ wavesCompleted: e.wave })));
    // Dev cheat: the waves it skipped count as done
    this.subs.add(bus.onLive('wave:jumped', (e) => this.updateProgress({ wavesCompleted: e.wave - 1 })));
    this.subs.add(bus.onLive('research:state-changed', (e) => { if (e.local) this.updateProgress({ centerPlaced: e.centerLevel > 0 }); }));
    // The abilities with a button in the bar: researched, and launch site standing
    this.subs.add(bus.onLive('ability:state-changed', (e) => {
      if (!e.local) return;
      this.updateProgress({ abilities: e.abilities.filter((a) => a.unlocked && a.launchSite).map((a) => a.id) });
    }));
    this.subs.add(bus.onLive('game:reset', () => this.newGame()));
  }

  disconnect(): void {
    this.subs.disposeAll();
  }

  skip(): void {
    const step = currentStep(this.state(), this.progress());
    if (step) this.dispatch({ kind: 'skip', step });
  }

  hide(): void {
    this.dispatch({ kind: 'hide' });
  }

  restart(): void {
    this.dispatch({ kind: 'restart', doneInGame: this.game.completed });
  }

  private newGame(): void {
    this.progress.set(INITIAL_PROGRESS);
    this.game = INITIAL_ONBOARDING;
  }

  private updateProgress(patch: Partial<OnboardingProgress>): void {
    this.progress.set({ ...this.progress(), ...patch });
  }

  /** An action of the game: counts for this game and for the tips. */
  private play(action: OnboardingAction): void {
    this.game = advanceOnboarding(this.game, action);
    this.dispatch(action);
  }

  private dispatch(action: OnboardingAction): void {
    const next = advanceOnboarding(this.state(), action);
    if (next === this.state()) return;
    this.state.set(next);
    saveOnboarding(next);
  }
}
