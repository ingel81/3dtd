import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { UIStore } from '../../store/ui.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_SLOT, SAVE_GAME } from '../../services/save-game/save-game.port';

/** sessionStorage: the bar was offered in this tab and went away; not again until the tab is new */
export const CONTINUE_OFFERED_KEY = 'td-continue-offered';

function offeredBefore(): boolean {
  try {
    return sessionStorage.getItem(CONTINUE_OFFERED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberOffered(): void {
  try {
    sessionStorage.setItem(CONTINUE_OFFERED_KEY, '1');
  } catch {
    // Blocked storage: the bar may come back after a reload, nothing worse
  }
}

/**
 * "Continue: Heilbronn, wave 12" at the bottom centre after the game has
 * loaded (docs/SAVE_LOAD_PLAN.md, decision 3): once a session, while the
 * new run has not begun (wave 0, no tower), alone, and only when an
 * autosave exists. A click loads it (SaveGamePort.continueAutosave, which
 * moves to the save's place if it is another one; a save of another
 * version says so in the notice banner); the cross, a first
 * tower or a first wave send it away for this tab.
 */
@Component({
  selector: 'app-continue-bar',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as offer) {
      <div class="cb" role="group" aria-label="Continue the last run">
        <button class="cb-go" type="button" [disabled]="busy()" (click)="go()"
                [attr.aria-label]="'Continue: ' + offer.location + ', wave ' + offer.wave">
          <td-icon name="play" [size]="13"></td-icon>
          <span class="cb-label">Continue</span>
          <span class="cb-where">{{ offer.location }}, wave {{ offer.wave }}</span>
        </button>
        <button class="cb-close" type="button" (click)="dismiss()" aria-label="Dismiss">
          <td-icon name="cross" [size]="12"></td-icon>
        </button>
      </div>
      @if (problem(); as text) {
        <p class="cb-problem" role="status">{{ text }}</p>
      }
    }
  `,
  styles: [`
    /* Placed by the bottom stack of the game component, above the hint box */
    :host {
      ${TD_CSS_VARS}
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      pointer-events: auto;
    }

    .cb {
      display: flex;
      align-items: stretch;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      -webkit-backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-mid);
      border-radius: 4px;
      box-shadow: inset 0 1px 0 rgba(122, 133, 128, 0.33), var(--td-shadow-soft);
    }

    .cb-go {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: none;
      border: none;
      color: var(--td-text-primary);
      font: 13px/1 var(--td-font-body);
      cursor: pointer;
    }

    .cb-go td-icon {
      color: var(--td-gold);
    }

    .cb-label {
      font: 700 11px/1 var(--td-font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--td-gold-light);
    }

    .cb-where {
      color: var(--td-text-secondary);
    }

    .cb-go:hover:not(:disabled) .cb-where,
    .cb-go:focus-visible .cb-where {
      color: var(--td-text-primary);
    }

    .cb-go:focus-visible,
    .cb-close:focus-visible {
      outline: 1px solid var(--td-gold-light);
      outline-offset: -2px;
    }

    .cb-close {
      display: grid;
      place-items: center;
      width: 30px;
      padding: 0;
      background: none;
      border: none;
      border-left: 1px solid var(--td-frame-dark);
      color: var(--td-text-muted);
      cursor: pointer;
    }

    .cb-close:hover {
      color: var(--td-text-primary);
    }

    .cb-problem {
      margin: 0;
      padding: 4px 10px;
      background: var(--td-glass-tint);
      font: 11px/1.4 var(--td-font-body);
      color: var(--td-warn-orange);
    }
  `],
})
export class ContinueBarComponent {
  private readonly saves = inject(SAVE_GAME);
  private readonly store = inject(TowerDefenseStore);
  private readonly coop = inject(COOP, { optional: true });
  private readonly ui = inject(UIStore);

  private readonly dismissed = signal(offeredBefore());
  readonly busy = signal(false);
  readonly problem = signal<string | null>(null);

  /** The autosave as the bar names it; null while the bar has nothing to offer */
  readonly shown = computed(() => {
    if (this.dismissed() || !this.saves.hasAutosave()) return null;
    if (this.store.loading() || this.store.error() || this.coop?.inGame()) return null;
    if (this.store.gameStarted() || this.store.towerCount() > 0) return null;
    const autosave = this.saves.slots().find((slot) => slot.id === AUTOSAVE_SLOT);
    return autosave ? { location: autosave.location, wave: autosave.wave } : null;
  });

  constructor() {
    // Offered once: when it goes away (a click, the cross, the run begins) it stays away in this tab
    let offered = false;
    effect(() => {
      if (this.shown()) {
        offered = true;
      } else if (offered) {
        rememberOffered();
        this.dismissed.set(true);
      }
    });
  }

  async go(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const result = await this.saves.continueAutosave();
      if (!result.ok) {
        this.problem.set(result.reason);
        return;
      }
      this.dismiss();
      // A save of another version: it loaded, the banner says values may differ
      if (result.note) this.ui.notice.set({ text: result.note });
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): void {
    rememberOffered();
    this.dismissed.set(true);
  }
}
