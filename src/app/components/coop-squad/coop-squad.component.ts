import { ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../icon/icon.component';
import { PingBarsComponent } from '../coop-ui/ping-bars.component';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX } from '../ability-bar/ability-button';
import { CoopChatComponent } from '../coop-chat/coop-chat.component';
import { CoopService } from '../../services/coop.service';
import { GameStore } from '../../store/game.store';
import { laneCss } from '../../coop/lane-color';
import { openResearchDialog } from '../research-dialog/open-research-dialog';
import { splitBold } from '../../i18n/format';
import { injectT } from '../../i18n/i18n.service';

/** What the gold menu offers to send */
const GIFT_AMOUNTS = [50, 100, 250, 500];

/** A squad row's state beside ready or building (D45: lag now; drop and resync later) */
type RowState = 'ok' | 'lag' | 'slow' | 'left';

/**
 * The social block of a coop game (docs/COOP_PLAN.md, C8), bottom left: the
 * squad box on top, the chat under it (CoopChatComponent). One row a player,
 * this one first: lane colour, name with YOU and HOST, lane and state,
 * credits, ping; a check for this player's readiness for the next wave; at a
 * partner's a button for their research (read only, TODO E35) and one for gold. The footer says who the wave waits on, or
 * what is wrong: a slow connection, someone catching up or gone, the games
 * apart, the connection lost (with "Continue alone").
 */

/** How long a first click on "take out" stays armed, ms */
const KICK_ARM_MS = 3000;
@Component({
  selector: 'app-coop-squad',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent, PingBarsComponent, CoopChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Right of the ability bar, like the dock: at 1280x720 the box covered its lower buttons (plan U8)
  host: { '[style.left.px]': 'left' },
  templateUrl: './coop-squad.component.html',
  styleUrl: './coop-squad.component.scss',
})
export class CoopSquadComponent {
  protected readonly t = injectT();
  readonly coop = inject(CoopService);
  protected readonly left = ABILITY_BAR_EDGE_PX + ABILITY_BAR_PX.clear;
  private readonly gameStore = inject(GameStore);
  private readonly dialog = inject(MatDialog);
  // From inside the game component: the dialog needs its facade (openResearchDialog)
  private readonly injector = inject(Injector);

  readonly amounts = GIFT_AMOUNTS;
  readonly collapsed = signal(false);
  /** The partner the gold menu is open for */
  readonly giftTo = signal<string | null>(null);
  readonly waveActive = this.gameStore.waveActive;

  readonly rows = computed(() => {
    const me = this.coop.playerId();
    const ready = this.coop.readyIds();
    const left = this.coop.leftIds();
    const gold = this.coop.gold();
    const lanes = this.coop.room()?.spawnIds ?? [];
    const hostId = this.coop.room()?.hostId ?? null;
    // This player first, the others in the room's order
    const roster = [...this.coop.roster()].sort((a, b) => Number(b.id === me) - Number(a.id === me));
    return roster.map((p) => {
      const index = p.spawnIds.length === 0 ? -1 : lanes.indexOf(p.spawnIds[0]);
      const state: RowState = left.has(p.id) ? 'left'
        : p.id === this.coop.waitingFor() ? 'slow'
          : this.coop.lagging(p.id) ? 'lag' : 'ok';
      return {
        id: p.id,
        name: p.name,
        me: p.id === me,
        host: p.id === hostId,
        lane: index < 0 ? null : this.t().coop.dock.spawn(index + 1),
        color: laneCss(index),
        ready: ready.has(p.id),
        leaks: this.coop.waveLeaks().get(p.id) ?? 0,
        state,
        gold: gold.get(p.id) ?? 0,
        latency: this.coop.latencyTo(p.id),
      };
    });
  });

  private readonly present = computed(() => this.rows().filter((r) => r.state !== 'left'));
  readonly readyCount = computed(() => this.present().filter((r) => r.ready).length);
  readonly myGold = computed(() => this.coop.gold().get(this.coop.playerId() ?? '') ?? 0);
  readonly myReady = computed(() => this.rows().find((r) => r.me)?.ready ?? false);

  /** Something is wrong: shown in the header, and collapsed as "Issue" with a warning icon; the CSS sets the caps */
  readonly issue = computed(() => {
    const w = this.t().coop.squad;
    if (this.coop.lostInGame()) return w.offline;
    if (this.coop.desync()) return w.outOfSyncShort;
    const rows = this.rows();
    const gone = rows.filter((r) => r.state === 'left').length;
    if (gone > 0) return w.unmanned(gone);
    return null;
  });

  /** The footer: what is wrong first, else who the next wave waits on */
  readonly footer = computed<{ lead: string; bold: string; text: string; key: boolean; alert: boolean } | null>(() => {
    const rows = this.rows();
    const w = this.t().coop.squad.foot;
    const line = (words: string, alert = false, key = false) => ({ ...splitBold(words), key, alert });
    if (this.coop.lostInGame()) return line(w.standsStill, true);
    const waiting = this.coop.waitingFor();
    if (waiting) return line(waiting === this.coop.playerId() ? w.othersWait : w.waitingFor(this.coop.nameOf(waiting)), true);
    const lagging = rows.find((r) => !r.me && r.state === 'lag');
    if (lagging) return line(w.slow(lagging.name), true);
    const gone = rows.find((r) => r.state === 'left');
    if (gone) return line(w.noDefender(gone.lane ?? gone.name), true);
    if (this.waveActive()) return null;
    const rule = this.coop.options().wave;
    const seconds = this.gameStore.autoWaveSecondsLeft();
    if (rule === 'host') {
      return this.coop.isHost() ? line(w.startWhenYouLike, false, true) : line(w.hostStarts(this.coop.nameOf(this.coop.room()?.hostId ?? '')));
    }
    const auto = rule === 'auto' && seconds !== null ? w.nextIn(seconds) : '';
    const notReady = this.present().filter((r) => !r.ready);
    if (notReady.length === 0) return line(w.allReady(auto));
    if (!this.myReady()) {
      const others = this.present().filter((r) => !r.me && r.ready).map((r) => r.name);
      return line(w.readyUp(others.join(', '), auto), false, true);
    }
    return line(w.waitingForAll(notReady.map((r) => r.name).join(', '), auto));
  });

  /** Lane and state under the name; the CSS sets the caps */
  subLine(row: { lane: string | null; ready: boolean; leaks: number; state: RowState }): string {
    const w = this.t().coop.squad.sub;
    const lane = row.lane ?? this.t().coop.table.noLane;
    if (row.state === 'left') return w.left;
    if (row.state === 'lag') return w.lagging(lane);
    if (row.state === 'slow') return w.catchingUp(lane);
    if (this.waveActive()) return row.leaks > 0 ? w.through(lane, row.leaks) : lane;
    return row.ready ? w.ready(lane) : w.building(lane);
  }

  /** "3 enemies got through Bob's lane this wave" */
  leaksTip(row: { me: boolean; name: string; leaks: number }): string {
    if (row.leaks === 0) return '';
    return row.me ? this.t().coop.squad.leaksMine(row.leaks) : this.t().coop.squad.leaksTheirs(row.leaks, row.name);
  }

  nameOf(playerId: string): string {
    return this.coop.nameOf(playerId);
  }

  /** The player a first click on "take out" armed; a second within KICK_ARM_MS takes them out */
  readonly armedKick = signal<string | null>(null);
  private kickTimer: ReturnType<typeof setTimeout> | null = null;

  kick(playerId: string): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    if (this.armedKick() === playerId) {
      this.armedKick.set(null);
      this.coop.kick(playerId);
      return;
    }
    this.armedKick.set(playerId);
    this.kickTimer = setTimeout(() => this.armedKick.set(null), KICK_ARM_MS);
  }

  /** The research window on this partner's tab, read only (TODO E35) */
  openResearch(playerId: string): void {
    void openResearchDialog(this.dialog, this.injector, playerId);
  }

  researchTip(name: string): string {
    return this.t().coop.squad.research(name);
  }

  toggleGift(playerId: string): void {
    this.giftTo.set(this.giftTo() === playerId ? null : playerId);
  }

  /** The amount typed into the gold menu, null while empty or no whole number */
  readonly anyAmount = signal<number | null>(null);
  readonly canGiveAny = computed(() => {
    const amount = this.anyAmount();
    return amount !== null && amount >= 1 && amount <= this.myGold();
  });

  setAnyAmount(text: string): void {
    const amount = Number(text);
    this.anyAmount.set(text.trim() !== '' && Number.isInteger(amount) ? amount : null);
  }

  /** Send the typed amount; the field stays filled for another click */
  giveAny(playerId: string): void {
    if (!this.canGiveAny()) return;
    this.give(playerId, this.anyAmount()!);
  }

  /** The menu stays open: several clicks send more; the gift button closes it */
  give(playerId: string, amount: number): void {
    this.coop.giveGold(playerId, amount);
  }
}

