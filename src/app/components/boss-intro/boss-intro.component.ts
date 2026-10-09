import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BossIntroService } from '../../services/boss-intro.service';
import { BOSS_INTRO_TIMING } from '../../utils/boss-intro';

/**
 * What the boss intro puts over the canvas (BossIntroService): a dark veil
 * that fades in before each camera cut and out after it, and while the
 * portal shot holds a title card in the lower third, the boss's name over a
 * thin gold rule. Until the view is back, a transparent button over the
 * whole canvas area skips the intro on a click, and keeps the click from the
 * map, the HUD and the pause button under it. Always in the canvas area, so
 * the veil's first fade has an opacity to start from; without an intro it
 * is transparent and lets every click through.
 */
@Component({
  selector: 'app-boss-intro',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="veil" [class.dim]="dim()"
         [style.transition-duration.ms]="dim() ? timing.dipMs : timing.revealMs"></div>
    @if (card(); as card) {
      <div class="scrim" [class.shown]="shown()"></div>
      <!-- The announcer reads it out when the intro starts -->
      <div class="card" [class.shown]="shown()" aria-hidden="true">
        <span class="td-caps overline">Boss, wave {{ card.wave }}</span>
        <span class="name">{{ card.name }}</span>
        @if (card.epithet) {
          <span class="td-caps epithet">{{ card.epithet }}</span>
        }
        <span class="td-rule rule"></span>
        <span class="td-note"><kbd class="td-kbd">Esc</kbd> or click to skip</span>
      </div>
    }
    @if (skippable()) {
      <button type="button" class="skip-layer" aria-label="Skip the boss intro" (click)="skip()"></button>
    }
  `,
  styles: [`
    :host {
      position: absolute;
      inset: 0;
      z-index: 25;
      overflow: hidden;
      pointer-events: none;
    }

    .veil {
      position: absolute;
      inset: 0;
      background: var(--td-panel-shadow);
      opacity: 0;
      transition-property: opacity;
      transition-timing-function: ease-out;
    }

    .veil.dim {
      opacity: 1;
      transition-timing-function: ease-in;
    }

    /* Keeps the name readable over bright facades */
    .scrim {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 45%;
      background: var(--td-scrim-bottom);
      opacity: 0;
      transition: opacity 220ms ease-in;
    }

    .scrim.shown {
      opacity: 1;
      transition: opacity 400ms ease-out;
    }

    .card {
      position: absolute;
      left: 50%;
      bottom: 16%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      white-space: nowrap;
      opacity: 0;
      transform: translate(-50%, 8px);
      transition: opacity 220ms ease-in, transform 220ms ease-in;
    }

    /* Comes up once the veil has lifted off the portal */
    .card.shown {
      opacity: 1;
      transform: translate(-50%, 0);
      transition: opacity 360ms ease-out 140ms, transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1) 140ms;
    }

    .overline {
      color: var(--td-brass);
    }

    /* The left padding balances the tracking after the last letter */
    .name {
      padding-left: 0.12em;
      font-size: var(--td-fs-hero);
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--td-text-engraved);
    }

    .card.shown .name {
      animation: name-settle 900ms cubic-bezier(0.2, 0.7, 0.2, 1) 140ms both;
    }

    @keyframes name-settle {
      from { letter-spacing: 0.26em; }
      to { letter-spacing: 0.12em; }
    }

    /* The boss's honorific, tucked under its name (worm's "Skarnax") */
    .epithet {
      margin-top: -6px;
      color: var(--td-text-secondary);
    }

    .rule {
      width: 88px;
    }

    .skip-layer {
      position: absolute;
      inset: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      pointer-events: auto;
    }

    .skip-layer:focus-visible {
      outline: var(--td-focus-width) solid var(--td-focus-color);
      outline-offset: -4px;
    }

    @media (prefers-reduced-motion: reduce) {
      .card,
      .card.shown {
        transform: translate(-50%, 0);
      }

      .card.shown .name {
        animation: none;
      }
    }
  `],
})
export class BossIntroComponent {
  private readonly bossIntro = inject(BossIntroService);

  readonly card = this.bossIntro.card;
  readonly timing = BOSS_INTRO_TIMING;
  /** The veil is dark around each cut */
  readonly dim = computed(() => {
    const stage = this.bossIntro.stage();
    return stage === 'dip-in' || stage === 'dip-out';
  });
  /** The card shows while the portal shot holds */
  readonly shown = computed(() => this.bossIntro.stage() === 'hold');
  /** Until the view is back; while the veil lifts off it the map takes clicks again */
  readonly skippable = computed(() => {
    const stage = this.bossIntro.stage();
    return stage !== null && stage !== 'reveal';
  });

  skip(): void {
    this.bossIntro.skip();
  }
}
