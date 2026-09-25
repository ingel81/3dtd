import { Component, ChangeDetectionStrategy, computed, effect, inject, input, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { GameStore } from '../../store/game.store';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX } from '../ability-bar/ability-button';
import { CoopChatComponent } from '../coop-chat/coop-chat.component';

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
 *
 * At the left edge, one player a row, right of the ability bar and below the
 * info overlay (playtest T5, T8); the gold menu stays open for more gifts.
 */
@Component({
  selector: 'app-coop-players',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, CoopChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.left.px]': 'left',
    '[style.top.px]': 'topInset() + clear',
  },
  template: `
    @if (coop.roster().length > 0) {
      <ul class="players" aria-label="Players">
        @for (player of players(); track player.id) {
          <li class="player" [class.is-me]="player.me" [class.has-left]="player.left">
            <span class="lane-dot" [style.background]="player.color"></span>
            <span class="name">{{ player.name }}</span>
            @if (player.me) { <span class="tag tag-me">you</span> }
            @if (player.host) { <span class="tag">host</span> }
            @if (player.left) {
              <span class="state">left</span>
            } @else if (player.slowing) {
              <span class="state is-slow" matTooltip="The room waits for them to catch up" matTooltipPosition="below">catching up</span>
            } @else if (!waveActive()) {
              <span class="state" [class.is-ready]="player.ready">{{ player.ready ? 'ready' : 'building' }}</span>
            }
            @if (player.leaks > 0) {
              <span class="leaks" [matTooltip]="leaksTip(player)"
                    matTooltipPosition="below">{{ player.leaks }} through</span>
            }
            @if (!player.left && player.latency !== null) {
              <span class="ping" [matTooltip]="player.me ? 'Your round trip to the coop server' : 'To them and back over the coop server, about'"
                    matTooltipPosition="below">{{ player.latency }} ms</span>
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
        @if (coop.lostInGame()) {
          <button class="amount-btn continue-btn" type="button" (click)="coop.continueAlone()">Continue alone</button>
        }
      </div>
    }
    <!-- The chat right under the players (PLAYTEST T39); it shows only in the game -->
    <app-coop-chat />
  `,
  styles: `
    /* Left, right of the ability bar; left and top from the host bindings */
    :host {
      position: absolute;
      z-index: 6;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      max-width: 340px;
      pointer-events: none;
      ${TD_CSS_VARS}
    }
    .players,
    .gift-menu {
      pointer-events: auto;
    }
    .players {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 3px;
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
      padding: 5px 8px 5px 10px;
      font-size: 13px;
      border-color: var(--td-gold-dark);
    }
    .player.is-me .lane-dot {
      width: 10px;
      height: 10px;
    }
    .tag {
      padding: 1px 4px;
      border: 1px solid var(--td-frame-mid);
      font: 600 8.5px/1 var(--td-font-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--td-text-muted);
    }
    .tag-me {
      border-color: var(--td-gold-dark);
      color: var(--td-gold-light);
    }
    .player.has-left {
      opacity: 0.5;
    }
    .player.has-left .name {
      text-decoration: line-through;
    }
    .name {
      flex: 1;
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
    .state.is-slow {
      color: var(--td-warn-orange);
    }
    .state.is-ready {
      color: var(--td-teal);
    }
    .leaks {
      font: 600 9px/1 var(--td-font-mono);
      color: var(--td-warn-orange);
    }
    .ping {
      font: 600 9px/1 var(--td-font-mono);
      color: var(--td-text-muted);
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
    .continue-btn {
      pointer-events: auto;
      padding: 5px 10px;
      color: var(--td-gold-light);
      border-color: var(--td-gold-dark);
    }
    .notices {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
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
  /**
   * Bottom edge of the info overlay, px from the top of the canvas area
   * (UIStore.infoOverlayBottom), as the ability bar takes it
   */
  readonly topInset = input(0);
  protected readonly left = ABILITY_BAR_EDGE_PX + ABILITY_BAR_PX.clear;
  protected readonly clear = ABILITY_BAR_PX.clear;
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
    const hostId = this.coop.room()?.hostId ?? null;
    // This player on top, the others in the room's order
    const roster = [...this.coop.roster()].sort((a, b) => Number(b.id === me) - Number(a.id === me));
    return roster.map((p) => {
      const index = p.spawnId === null ? -1 : lanes.indexOf(p.spawnId);
      return {
        id: p.id,
        name: p.name,
        me: p.id === me,
        host: p.id === hostId,
        slowing: p.id === this.coop.waitingFor(),
        leaks: this.coop.waveLeaks().get(p.id) ?? 0,
        ready: ready.has(p.id),
        left: left.has(p.id),
        gold: gold.get(p.id) ?? 0,
        latency: this.coop.latencyTo(p.id),
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

  /** "3 enemies got through Bob's lane this wave" */
  leaksTip(player: { me: boolean; name: string; leaks: number }): string {
    return `${player.leaks} enemies got through ${player.me ? 'your' : `${player.name}'s`} lane this wave`;
  }

  nameOf(playerId: string): string {
    return this.coop.nameOf(playerId);
  }

  toggleGift(playerId: string): void {
    this.giftTo.set(this.giftTo() === playerId ? null : playerId);
  }

  /** The menu stays open: several clicks send more; the gift button closes it */
  give(playerId: string, amount: number): void {
    this.coop.giveGold(playerId, amount);
  }
}
