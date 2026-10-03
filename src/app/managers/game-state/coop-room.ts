import type { GameEventBus } from '../../game-engine/game-event-bus';
import type { CreditsLedger } from './credits-ledger';

/** What the room state needs of the GameStateManager */
export interface CoopRoomHost {
  readonly eventBus: GameEventBus;
  readonly creditsLedger: CreditsLedger;
  /** The players of the run in roster order */
  players(): readonly string[];
  /** The player at this client */
  localPlayerId(): string;
  /** The spawn points of the world, in order: alone, each is a lane of the player */
  spawnIds(): readonly string[];
  /** `playerId` left: out of a manned tower (TowerLifecycle.leave) */
  leaveTowers(playerId: string): void;
}

/** A lane: the spawn point the wave runs from and the player it belongs to */
export interface Lane {
  readonly spawnId: string;
  readonly playerId: string;
}

/**
 * The coop room as the simulation keeps it (docs/COOP_PLAN.md, C2d): which
 * spawn points are whose lanes, who is ready for the next wave, who left,
 * the gold players give each other and who may use the dev tools' commands.
 *
 * Every wave runs once on each lane (laneSchedule), and a player has as many
 * lanes as they took, one or more (docs/WAVE_SYSTEM.md (Spuren)). Alone, every spawn
 * point is a lane of the player.
 */
export class CoopRoom {
  /** Coop: the lanes the room gave, roster order; empty alone, where every spawn point is one (lanes) */
  private coopLanes: Lane[] = [];
  /** Coop: the players who are ready for the next wave (D15) */
  private readonly ready = new Set<string>();
  /** Coop: players who left the game (command:leave-game) */
  private readonly left = new Set<string>();
  /**
   * Coop: who may use the dev tools' commands (debug:*), by player id; null
   * lets everyone (single player). Every client sets the same rule at the
   * start from the room's options (docs/COOP_PLAN.md, R3, D38), so a cheat
   * acts on all of them or on none.
   */
  private cheatRule: ((playerId: string) => boolean) | null = null;

  constructor(private readonly host: CoopRoomHost) {}

  /** A new roster (setPlayers): nobody left, nobody ready */
  newRoster(): void {
    this.left.clear();
    this.ready.clear();
  }

  /** A wave starts or the run begins anew: the readiness was for the one before */
  clearReady(): void {
    this.ready.clear();
  }

  /**
   * Coop: which spawn points are whose lanes (D1), as [player, spawn] pairs,
   * a player in as many as they took. Kept in roster order, a player's lanes
   * in the order given; a pair of a player not in the run, or of a spawn
   * taken already, is left out. Empty: every spawn point is a lane of the
   * player alone.
   */
  setLanes(pairs: readonly (readonly [string, string])[]): void {
    const taken = new Set<string>();
    this.coopLanes = this.host.players().flatMap((playerId) => pairs.flatMap(([owner, spawnId]) => {
      if (owner !== playerId || taken.has(spawnId)) return [];
      taken.add(spawnId);
      return [{ spawnId, playerId }];
    }));
  }

  /** The lanes, roster order: the room's in coop, every spawn point of the player alone */
  get lanes(): readonly Lane[] {
    if (this.coopLanes.length > 0) return this.coopLanes;
    const players = this.host.players();
    if (players.length !== 1) return [];
    return this.host.spawnIds().map((spawnId) => ({ spawnId, playerId: players[0] }));
  }

  /** The spawn point ids of the lanes, roster order. */
  get laneSpawns(): readonly string[] {
    return this.lanes.map((lane) => lane.spawnId);
  }

  /**
   * A player is ready for the next wave, or no longer (command:set-ready).
   * Cleared when a wave starts. Announced as coop:ready-changed; the host
   * starts the wave once allReady() (D15).
   */
  setReady(playerId: string, ready: boolean): void {
    if (!this.host.players().includes(playerId) || this.ready.has(playerId) === ready) return;
    if (ready) this.ready.add(playerId);
    else this.ready.delete(playerId);
    this.host.eventBus.emit({
      type: 'coop:ready-changed',
      playerId,
      ready,
      local: playerId === this.host.localPlayerId(),
      allReady: this.allReady(),
    });
  }

  /**
   * Coop: `from` sends `amount` of their gold to `to` (command:give-credits).
   * Only whole gold, only what `from` has, only to another player still in
   * the run; anything else does nothing. Booked as 'gift' on both accounts.
   */
  giveCredits(from: string, to: string, amount: number): boolean {
    if (from === to || !this.host.players().includes(to) || this.left.has(to)) return false;
    if (!Number.isInteger(amount) || amount <= 0) return false;
    if (!this.host.creditsLedger.spend(amount, 'gift', from)) return false;
    this.host.creditsLedger.add(amount, 'gift', to);
    this.host.eventBus.emit({ type: 'coop:credits-given', from, to, amount, toLocal: to === this.host.localPlayerId() });
    return true;
  }

  /** The spawn point ids of `playerId`'s lanes; none without a lane */
  laneSpawnsOf(playerId: string): string[] {
    return this.lanes.filter((lane) => lane.playerId === playerId).map((lane) => lane.spawnId);
  }

  /** The player whose lane the spawn point `spawnId` is; null when it is no lane */
  laneOwnerOf(spawnId: string): string | null {
    return this.lanes.find((lane) => lane.spawnId === spawnId)?.playerId ?? null;
  }

  /** `playerId` said ready for the next wave (setReady) */
  isReady(playerId: string): boolean {
    return this.ready.has(playerId);
  }

  /** Every player still in the run is ready for the next wave. */
  allReady(): boolean {
    return this.host.players().every((playerId) => this.left.has(playerId) || this.ready.has(playerId));
  }

  /**
   * Coop: `playerId` left the game (command:leave-game, put in a tick by
   * the relay). Their lanes close, no more spawns there (D22, lane
   * collapse); their towers stay and keep shooting, their hero and account
   * stay as they are. They get out of a manned tower and count as ready.
   */
  playerLeft(playerId: string): void {
    const players = this.host.players();
    if (!players.includes(playerId) || this.left.has(playerId)) return;
    this.left.add(playerId);
    const index = players.indexOf(playerId);
    this.coopLanes = this.coopLanes.filter((lane) => lane.playerId !== playerId);
    this.host.leaveTowers(playerId);
    this.ready.delete(playerId);
    this.host.eventBus.emit({ type: 'coop:player-left', playerId, index, local: playerId === this.host.localPlayerId() });
  }

  setCheatRule(rule: ((playerId: string) => boolean) | null): void {
    this.cheatRule = rule;
  }

  /** `playerId` may use a cheat (see setCheatRule) */
  mayCheat(playerId: string): boolean {
    return this.cheatRule?.(playerId) ?? true;
  }
}
