import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { SimClient } from '../../sim/client/sim-client.service';
import { GameStore } from '../../store/game.store';
import { WorldContext } from '../../world/world-context.service';
import { TdIconComponent } from '../icon/icon.component';
import { waveEventLines } from './map-event-banner';

/** In fast, a while on screen, out slower (as the blood moon banner) */
const BANNER_FADE: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.08 },
  { opacity: 1, offset: 0.8 },
  { opacity: 0 },
];
/** On screen at least this long, longer for more text */
const BANNER_MIN_MS = 5000;
const BANNER_MS_PER_CHAR = 45;
const BANNER_MAX_MS = 12000;

/**
 * A custom map's wave events over the canvas (TODO E170): when the game runs
 * into the build phase before a wave whose events have messages or open a
 * portal (`map:wave-events`), its lines for a few seconds, longer the more
 * they say. Live only: a replay's seek or a restore shows nothing. Wave 1's
 * happened while the world loaded, before the HUD stood: they show as it
 * comes up, on a fresh run (wave 0). Screen
 * readers hear it through the LiveAnnouncer. Photo mode hides it with the
 * rest of the HUD.
 */
@Component({
  selector: 'app-map-event-banner',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meb td-chip" #chip aria-hidden="true" data-test="map-event-banner">
      <td-icon class="meb-icon" name="flag" [size]="18"></td-icon>
      <div class="td-stack meb-text">
        <span class="td-section">Before wave {{ wave() }}</span>
        @for (line of lines(); track $index) {
          <span class="meb-line">{{ line }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `:host { position: absolute; top: 27%; left: 0; right: 0; z-index: 5; display: flex; justify-content: center; pointer-events: none; }
     .meb { opacity: 0; max-width: min(560px, calc(100% - 32px)); align-items: flex-start; }
     .meb-icon { margin-top: 2px; }
     .meb-text { gap: 4px; }
     .meb-line { white-space: normal; }`,
  ],
})
export class MapEventBannerComponent {
  private readonly chip = viewChild<ElementRef<HTMLElement>>('chip');
  private readonly announcer = inject(LiveAnnouncer);
  private run: Animation | null = null;

  readonly wave = signal(0);
  readonly lines = signal<string[]>([]);

  constructor() {
    const bus = inject(SimClient).bus;
    const subs = [
      bus.onLive('map:wave-events', ({ wave, messages, opened }) => this.show(wave, waveEventLines(messages, opened))),
      bus.onLive('game:reset', () => this.run?.cancel()),
    ];
    inject(DestroyRef).onDestroy(() => {
      for (const sub of subs) sub.dispose();
      this.run?.cancel();
    });
    const world = inject(WorldContext);
    const game = inject(GameStore);
    afterNextRender(() => {
      const first = world.provider()?.waveMessages?.(1) ?? [];
      if (game.waveNumber() === 0 && game.phase() === 'setup') this.show(1, waveEventLines(first, []));
    });
  }

  private show(wave: number, lines: string[]): void {
    if (!lines.length) return;
    this.wave.set(wave);
    this.lines.set(lines);
    void this.announcer.announce(`Before wave ${wave}: ${lines.join(' ')}`);
    const el = this.chip()?.nativeElement;
    if (!el || typeof el.animate !== 'function') return;
    this.run?.cancel();
    const chars = lines.reduce((n, line) => n + line.length, 0);
    const duration = Math.min(BANNER_MAX_MS, BANNER_MIN_MS + chars * BANNER_MS_PER_CHAR);
    this.run = el.animate(BANNER_FADE, { duration, easing: 'ease-out' });
  }
}
