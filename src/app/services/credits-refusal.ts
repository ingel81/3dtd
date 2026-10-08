import { signal } from '@angular/core';
import { uiSound } from './ui-sound';

/**
 * Presses the game refused for too few credits (a build card, an upgrade, a
 * path, the hero's hire), counted up on each. The header flashes its credits
 * plate on a new count. Presentation only: the simulation checks the credits
 * on its own and never sees this.
 *
 * One for the app like uiSound, for the same reason: its callers are
 * services with every kind of test setup.
 */
export const creditsRefusals = signal(0);

/** A press refused for too few credits: the refusal cue and the flash of the credits plate. */
export function refuseForCredits(): void {
  uiSound.play('noMoney');
  creditsRefusals.update((n) => n + 1);
}
