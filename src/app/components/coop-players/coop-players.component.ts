import { Component, ChangeDetectionStrategy, computed, effect, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { GameStore } from '../../store/game.store';
import { SPAWN_COLORS } from '../../configs/map-constants.config';

/** What the gold menu offers to send */
const GIFT_AMOUNTS = [50, 100, 250, 500];

/** How long a notice stays, ms; a chat line a bit longer */
const NOTICE_MS = 6000;
const CHAT_NOTICE_MS = 10000;

/**
 * The players bar of a coop game (docs/COOP_PLAN.md, lobby wishes A): every
 * player in their lane colour with name, gold and, between waves, whether
 * they are ready for the next one; who left stays greyed out. A partner's
 * gold button sends them gold (command:give-credits, it moves at the tick).
 * Under it the coop notices (joined, left, host, connection, chat, gold) for
 * a few seconds. Shown from the start of a coop game until the player leaves
 * the room, also after the connection dropped.
 */
@Component({
  selector: 'app-coop-players',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (coop.roster().length > 0) {
      <ul class="players" aria-label="Players">
        @for (player of players(); track player.id) {
          <li class="player" [class.is-me]="player.me" [class.has-left]="player.left">
            <span class="lane-dot" [style.background]="player.color"></span>
            <span class="name">{{ player.name }}</span>
            @if (player.left) {
              <span class="state">left</span>
            } @else if (!waveActive()) {
              <span class="state" [class.is-ready]="player.ready">{{ player.ready ? 'ready' : 'building' }}</span>
            }
            <span class="gold" [attr.aria-label]="player.gold + ' gold'">
              <td-icon name="coin" [size]="11"></td-icon>{{ player.gold }}
            </span>
            @if (!player.me && !player.left) {
              <button class="gift-btn" type="button" (click)="toggleGift(player.id)"
                      [class.is-open]="giftTo() === player.id"
                      [matTooltip]="'Send ' + player.name + ' gold'" matTooltipPosition="below"
                      [attr.aria-label]="'Send ' + player.name + ' gold'" [attr.aria-expanded]="giftTo() === player.id">
                <td-icon name="share" [size]="11"></td-icon>
              </button>
            }
          </li>
        }
      </ul>
      @if (giftTo(); as to) {
        <div class="gift-menu" role="group" [attr.aria-label]="'Send ' + nameOf(to) + ' gold'">
          <span class="gift-label">To {{ nameOf(to) }}</span>
          @for (amount of amounts; track amount) {
            <button class="amount-btn" type="button" [disabled]="amount > myGold()" (click)="give(to, amount)">{{ amount }}</button>
          }
        </div>
      }
      @if (waitingFor(); as waiting) {
        <div class="notice" role="status">Waiting for {{ waiting }}</div>
      }
      <div class="notices" role="log" aria-live="polite">
        @for (notice of visibleNotices(); track notice.id) {
          <div class="notice" [class.is-warn]="notice.kind === 'warn'" [class.is-chat]="notice.kind === 'chat'">{{ notice.text }}</div>
        }
      </div>
    }
  `,
  styles: `
    /* Placed by .td-hud-top in the game component, under game speed and boss bar */
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      pointer-events: auto;
      ${TD_CSS_VARS}
    }
    .players {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .player {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px 3px 8px;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow: inset 0 1px 0 rgba(122, 133, 128, 0.33), var(--td-shadow-soft);
      font: 600 11px/1.2 var(--td-font-body);
      color: var(--td-text-primary);
    }
    .player.is-me {
      border-color: var(--td-gold-dark);
    }
    .player.has-left {
      opacity: 0.5;
    }
    .player.has-left .name {
      text-decoration: line-through;
    }
    .lane-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .state {
      font: 600 9px/1 var(--td-font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }
    .state.is-ready {
      color: var(--td-teal);
    }
    .gold {
      display: flex;
      align-items: center;
      gap: 2px;
      font-family: var(--td-font-mono);
      color: var(--td-gold-light);
    }
    .gift-btn,
    .amount-btn {
      display: flex;
      align-items: center;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font: 600 11px/1 var(--td-font-mono);
      cursor: pointer;
    }
    .gift-btn {
      padding: 2px 4px;
    }
    .amount-btn {
      padding: 3px 7px;
    }
    .gift-btn:hover,
    .amount-btn:hover:not(:disabled),
    .gift-btn.is-open {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }
    .amount-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .gift-menu,
    .notice {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      font: 600 11px/1.2 var(--td-font-body);
      color: var(--td-text-secondary);
    }
    .gift-label {
      margin-right: 2px;
    }
    .notices {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }
    .notice.is-warn {
      color: var(--td-warn-orange);
      border-color: var(--td-warn-orange);
    }
    .notice.is-chat {
      color: var(--td-text-primary);
    }
  `,
})
export class CoopPlayersComponent {
  readonly coop = inject(CoopService);
  private readonly gameStore = inject(GameStore);

  readonly amounts = GIFT_AMOUNTS;
  readonly waveActive = this.gameStore.waveActive;
  /** The partner the gold menu is open for */
  readonly giftTo = signal<string | null>(null);
  private readonly now = signal(0);

  readonly players = computed(() => {
    const me = this.coop.playerId();
    const ready = this.coop.readyIds();
    const left = this.coop.leftIds();
    const gold = this.coop.gold();
    const lanes = this.coop.room()?.spawnIds ?? [];
    return this.coop.roster().map((p) => {
      const index = p.spawnId === null ? -1 : lanes.indexOf(p.spawnId);
      return {
        id: p.id,
        name: p.name,
        me: p.id === me,
        ready: ready.has(p.id),
        left: left.has(p.id),
        gold: gold.get(p.id) ?? 0,
        color: index < 0 ? 'transparent' : `#${SPAWN_COLORS[index % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`,
      };
    });
  });

  readonly myGold = computed(() => this.coop.gold().get(this.coop.playerId() ?? '') ?? 0);

  /** Between waves, once this player is ready: who the wave still waits for */
  readonly waitingFor = computed(() => {
    if (this.waveActive()) return null;
    const players = this.players();
    const me = players.find((p) => p.me);
    if (!me?.ready) return null;
    const waiting = players.filter((p) => !p.ready && !p.left).map((p) => p.name);
    return waiting.length > 0 ? waiting.join(', ') : null;
  });

  /** The notices young enough to show; a lost connection stays */
  readonly visibleNotices = computed(() => {
    const now = this.now();
    const connectionLost = this.coop.status() === 'closed';
    return this.coop.notices().filter((n) =>
      now - n.at < (n.kind === 'chat' ? CHAT_NOTICE_MS : NOTICE_MS) || (connectionLost && n.kind === 'warn'));
  });

  constructor() {
    // Re-read the clock when a notice comes and when the youngest one runs out
    effect((onCleanup) => {
      const notices = this.coop.notices();
      this.now.set(performance.now());
      const timers = notices.map((n) => {
        const ms = n.at + (n.kind === 'chat' ? CHAT_NOTICE_MS : NOTICE_MS) - performance.now();
        return ms > 0 ? setTimeout(() => this.now.set(performance.now()), ms + 20) : null;
      });
      onCleanup(() => timers.forEach((t) => t !== null && clearTimeout(t)));
    });
  }

  nameOf(playerId: string): string {
    return this.coop.nameOf(playerId);
  }

  toggleGift(playerId: string): void {
    this.giftTo.set(this.giftTo() === playerId ? null : playerId);
  }

  give(playerId: string, amount: number): void {
    this.coop.giveGold(playerId, amount);
    this.giftTo.set(null);
  }
}
