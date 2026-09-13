import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core';
import { GameStateManager } from '../../managers/game-state.manager';
import { PulseThrottle } from '../../utils/pulse-throttle';

/** Fade of the red edge: in fast, out slower */
const LEAK_PULSE: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.2 },
  { opacity: 0 },
];
const LEAK_PULSE_MS = 650;
/** A swarm breaking through pulses about once a second instead of glowing */
const LEAK_PULSE_MIN_INTERVAL_MS = 900;

/**
 * Red edge over the canvas when an enemy reaches the HQ, and while an ooze
 * flows in. Listens on the event bus directly: the handler runs in the game
 * loop, outside Angular, and does one time comparison per leak. The pulse is
 * a Web Animation on one element, so no change detection runs for it.
 */
@Component({
  selector: 'app-leak-vignette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './leak-vignette.component.html',
  styleUrl: './leak-vignette.component.scss',
})
export class LeakVignetteComponent {
  private readonly edge = viewChild<ElementRef<HTMLElement>>('edge');
  private readonly throttle = new PulseThrottle(LEAK_PULSE_MIN_INTERVAL_MS);

  constructor() {
    const bus = inject(GameStateManager).getEventBus();
    const subs = [
      bus.on('enemy:reached-base', () => this.pulse()),
      bus.on('enemy:leaking', () => this.pulse()),
    ];
    inject(DestroyRef).onDestroy(() => subs.forEach((sub) => sub.dispose()));
  }

  private pulse(): void {
    if (!this.throttle.tryPulse(performance.now())) return;
    const el = this.edge()?.nativeElement;
    if (el && typeof el.animate === 'function') {
      el.animate(LEAK_PULSE, { duration: LEAK_PULSE_MS, easing: 'ease-out' });
    }
  }
}
