import { Injectable, computed, signal } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import {
  ONBOARDING_STEPS,
  ONBOARDING_TIPS,
  OnboardingAction,
  OnboardingState,
  OnboardingTip,
  advanceOnboarding,
  currentStep,
  loadOnboarding,
  saveOnboarding,
} from './onboarding';

/** The tip on screen with its place in the sequence */
export interface ActiveOnboardingTip extends OnboardingTip {
  index: number;
  total: number;
}

/**
 * First-run tips: four short hints in the context-hint box, each gone once
 * the player does what it says or skips it. The state machine is in
 * onboarding.ts, the state in localStorage (td_onboarding_v1). The sidebar
 * footer's Tips button starts them again.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  readonly state = signal<OnboardingState>(loadOnboarding());

  /** Tip to show, null once the tips are over */
  readonly tip = computed<ActiveOnboardingTip | null>(() => {
    const step = currentStep(this.state());
    if (!step) return null;
    return { ...ONBOARDING_TIPS[step], index: ONBOARDING_STEPS.indexOf(step) + 1, total: ONBOARDING_STEPS.length };
  });

  private readonly subs = new SubscriptionBag();

  /** Follow the game's events; called per game session next to GameStateSyncService. */
  connect(bus: GameEventBus): void {
    this.subs.disposeAll();
    this.subs.add(bus.on('tower:placed', (e) => {
      this.dispatch({ kind: 'tower-placed', towerType: e.tower.typeConfig.id });
    }));
    this.subs.add(bus.on('tower:selected', (e) => {
      this.dispatch({ kind: 'tower-selected', towerType: e.tower.typeConfig.id });
    }));
    this.subs.add(bus.on('research:started', () => this.dispatch({ kind: 'research-started' })));
    this.subs.add(bus.on('wave:started', () => this.dispatch({ kind: 'wave-started' })));
  }

  disconnect(): void {
    this.subs.disposeAll();
  }

  skip(): void {
    this.dispatch({ kind: 'skip' });
  }

  hide(): void {
    this.dispatch({ kind: 'hide' });
  }

  restart(): void {
    this.dispatch({ kind: 'restart' });
  }

  private dispatch(action: OnboardingAction): void {
    const next = advanceOnboarding(this.state(), action);
    if (next === this.state()) return;
    this.state.set(next);
    saveOnboarding(next);
  }
}
