import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { GameStateManager } from '../../managers/game-state.manager';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { TdIconComponent } from '../icon/icon.component';
import { bloodMoonBanner } from './blood-moon-banner';

/** In fast, a while on screen, out slower */
const BANNER_FADE: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: 0.12 },
  { opacity: 1, offset: 0.72 },
  { opacity: 0 },
];
const BANNER_MS = 3600;

/**
 * "Blood Moon" over the canvas for a few seconds when a blood moon wave
 * starts (isBloodMoonWave), unless its look is switched off. Listens on the
 * event bus directly like the leak vignette; the fade is a Web Animation on
 * one element. Screen readers hear it through the LiveAnnouncer; the chip
 * itself is decoration. Photo mode hides it with the rest of the HUD.
 */
@Component({
  selector: 'app-blood-moon-banner',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './blood-moon-banner.component.html',
  styleUrl: './blood-moon-banner.component.scss',
})
export class BloodMoonBannerComponent {
  private readonly chip = viewChild<ElementRef<HTMLElement>>('chip');
  private readonly vfx = inject(DebugFacadeService).vfx;
  private readonly announcer = inject(LiveAnnouncer);

  readonly waveLabel = signal('');

  constructor() {
    const sub = inject(GameStateManager).getEventBus().on('wave:started', ({ wave }) => this.show(wave));
    inject(DestroyRef).onDestroy(() => sub.dispose());
  }

  private show(wave: number): void {
    const banner = bloodMoonBanner(wave, this.vfx().bloodMoon);
    if (!banner) return;
    this.waveLabel.set(banner.wave);
    void this.announcer.announce(banner.announcement);
    const el = this.chip()?.nativeElement;
    if (el && typeof el.animate === 'function') {
      el.animate(BANNER_FADE, { duration: BANNER_MS, easing: 'ease-out' });
    }
  }
}
