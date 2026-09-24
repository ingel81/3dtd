/**
 * The run log's collector.
 *
 * Listens on the event bus, stamps everything with the sub-step it happened
 * in, and closes one block per wave. Angular-free on purpose: the bots drive
 * it in DevWorld, the desktop app writes it to disk, and a spec can play a
 * whole run into it without a DOM (docs/RUN_LOG.md).
 *
 * Cost: a handful of counters per event, one sample per second of game time
 * and one pass over the towers at a wave's end. Nothing per hit and nothing
 * per sub-step, which is what keeps it out of the way at 5000 enemies.
 */

import type { GameEventBus, SubscriptionBag, CreditsSource } from '../game-engine/game-event-bus';
import type { Tower } from '../entities/tower.entity';
import type { WaveSourceId } from '../director/wave-source';
import {
  RUN_LOG_FORMAT,
  reconcileWave,
  type RunEndReason,
  type RunLog,
  type RunLogEvent,
  type RunLogEventKind,
  type RunLogHead,
  type RunLogRecord,
  type RunLogTowerWave,
  type RunLogWave,
  type RunMap,
  type RunPlayer,
} from './run-log.types';
import { balanceConfigHash } from './config-hash';
import { BUILD_VERSION } from '../configs/build-info.config';
import { buildCommit } from './build-commit';

/** Game time between two samples. */
export const SAMPLE_INTERVAL_MS = 1000;

/** What the collector reads from the running game when it writes a record. */
export interface RunLogWorld {
  /** Sub-steps since the run started (GameClock.subStep). */
  step: () => number;
  /** Game time in ms. */
  timeMs: () => number;
  credits: () => number;
  baseHealth: () => number;
  enemiesAlive: () => number;
  /** Total DPS of the defense, hero included. */
  dps: () => number;
  /** The towers that stand right now. */
  towers: () => readonly Tower[];
}

/** What the head says about the run, beyond what the collector knows itself. */
export interface RunLogContext {
  seed: number;
  map: RunMap;
  player: RunPlayer;
  botSkill?: string;
  location?: { name: string; lat: number; lon: number };
  routeFingerprint?: string;
  directorParams?: string;
  /** The wave source this run plays; the config hash follows it. */
  waveSource?: WaveSourceId;
}

/** A tower's numbers when a wave started, to subtract at its end. */
interface TowerMark {
  damage: number;
  kills: number;
}

export class RunLogCollector {
  private head: RunLogHead | null = null;
  private records: RunLogRecord[] = [];
  private world: RunLogWorld | null = null;

  private wave = 0;
  private waveStartStep = 0;
  private waveStartTimeMs = 0;
  private waveStartCredits = 0;
  private waveStartHealth = 0;
  private income: Partial<Record<CreditsSource, number>> = {};
  private spending: Partial<Record<CreditsSource, number>> = {};
  /** Build and upgrade gold per tower type, for damage per gold per type. */
  private towerSpending: Record<string, number> = {};
  private enemiesSpawned = 0;
  /** Enemies still standing when the block began; the last wave's leftovers. */
  private enemiesAtStart = 0;
  private killsByTower = 0;
  private killsByHero = 0;
  private killsByAbility = 0;
  private killsByDebug = 0;
  private killsByOther = 0;
  private leaked = 0;
  /** An ooze counts once: as a leak from its first point, not again on arrival. */
  private readonly leaking = new Set<string>();
  private readonly towerMarks = new Map<string, TowerMark>();
  /** Towers sold during the wave keep the numbers they had at the sale. */
  private soldThisWave: RunLogTowerWave[] = [];
  private nextSampleAtMs = 0;
  private waveGold: RunLogWave['waveGold'] | undefined;
  /** A wave is running and has no block yet. */
  private waveOpen = false;
  /** Records already handed to the bot server. */
  private drained = 0;
  /**
   * The run ended, but its records are still here to be picked up.
   *
   * Game over reaches two listeners: this log closes the run, and the bot
   * session sends what is left to the server. Whoever runs second used to
   * find an empty collector, so every bot run on the server lacked its last
   * wave and its end record. The run stays readable until the next one opens.
   */
  private closed = false;

  /** The run so far, or null before one was opened. */
  current(): RunLog | null {
    return this.head ? { head: this.head, records: [...this.records] } : null;
  }

  /**
   * The records written since the last drain, for the bot server.
   *
   * A bot sends its log per wave, so a tab that freezes or is closed costs
   * the server at most the running wave (BALANCING_PLAN.md, phase 2b).
   */
  drain(): RunLogRecord[] {
    const fresh = this.records.slice(this.drained);
    this.drained = this.records.length;
    return fresh;
  }

  /** True while a run is open. A closed run can still be read and drained. */
  get isOpen(): boolean {
    return this.head !== null && !this.closed;
  }

  /**
   * Start a run. Everything from a previous one is dropped, so a restart
   * cannot bleed into the next log.
   */
  open(context: RunLogContext, world: RunLogWorld, now = new Date()): RunLogHead {
    this.world = world;
    this.records = [];
    this.drained = 0;
    this.closed = false;
    this.wave = 0;
    this.beginBlock();
    this.nextSampleAtMs = 0;

    this.head = {
      kind: 'head',
      format: RUN_LOG_FORMAT,
      runId: `${now.toISOString().replace(/[:.]/g, '-')}-${context.map}`,
      startedAt: now.toISOString(),
      gameVersion: BUILD_VERSION,
      commit: buildCommit(),
      configHash: balanceConfigHash(context.waveSource),
      seed: context.seed,
      player: context.player,
      ...(context.botSkill ? { botSkill: context.botSkill } : {}),
      map: context.map,
      ...(context.location ? { location: context.location } : {}),
      ...(context.routeFingerprint ? { routeFingerprint: context.routeFingerprint } : {}),
      ...(context.directorParams ? { directorParams: context.directorParams } : {}),
      ...(context.waveSource ? { waveSource: context.waveSource } : {}),
    };
    this.records.push(this.head);
    this.event('run-opened', { id: context.map });
    return this.head;
  }

  /**
   * Close the run and hand back what it came to. A second call returns null,
   * so game over followed by a reset writes exactly one end record.
   */
  close(reason: RunEndReason): RunLog | null {
    const head = this.head;
    if (!head || this.closed) return null;
    this.flushOpenWave();
    this.records.push({
      kind: 'end',
      step: this.step(),
      timeMs: this.timeMs(),
      waveReached: this.wave,
      reason,
    });
    this.closed = true;
    return { head, records: [...this.records] };
  }

  /** Waves the run finished. */
  get waveReached(): number {
    return this.wave;
  }

  /**
   * Stamp the build's commit into the head of the open run.
   *
   * The commit is fetched once at startup and arrives a moment after the
   * first run was opened, so the head would keep the `unknown` it was born
   * with. Only an `unknown` is replaced; a head that already names a commit
   * is never rewritten.
   */
  setCommit(commit: string): void {
    if (this.head && this.head.commit === 'unknown' && commit !== 'unknown') {
      this.head.commit = commit;
    }
  }

  /**
   * Write the block of a wave that is still running.
   *
   * The wave the base falls in never completes, and it is the most
   * interesting one of the run. Idempotent: a second call does nothing, so
   * game over, the summary and the close all see the same one block.
   */
  flushOpenWave(): void {
    if (this.waveOpen) this.onWaveCompleted();
  }

  /** Subscribe to the bus; the bag owns the subscriptions. */
  attach(bus: GameEventBus, bag: SubscriptionBag): void {
    bag.add(bus.onLive('wave:started', (e) => this.onWaveStarted(e.wave)));
    bag.add(bus.onLive('wave:completed', (e) => {
      this.waveGold = e.creditsBreakdown;
      this.onWaveCompleted();
    }));
    bag.add(bus.onLive('wave:jumped', (e) => {
      this.event('wave-jump', { credits: e.credits, value: e.skipped });
      this.wave = e.wave - 1;
    }));

    bag.add(bus.onLive('enemy:spawned', () => { this.enemiesSpawned++; }));
    bag.add(bus.onLive('enemy:died', (e) => {
      // An ooze that dies while it flows in was already counted as a leak
      if (this.leaking.delete(e.enemy.id)) return;
      switch (e.killedBy?.kind) {
        case 'tower': this.killsByTower++; break;
        case 'hero': this.killsByHero++; break;
        case 'ability': this.killsByAbility++; break;
        case 'debug': this.killsByDebug++; break;
        default: this.killsByOther++; break;
      }
    }));
    bag.add(bus.onLive('enemy:leaking', (e) => {
      if (this.leaking.has(e.enemy.id)) return;
      this.leaking.add(e.enemy.id);
      this.countLeak(e.enemy.typeConfig?.id, e.damage);
    }));
    bag.add(bus.onLive('enemy:reached-base', (e) => {
      if (this.leaking.delete(e.enemy.id)) return;
      this.countLeak(e.enemy.typeConfig?.id, e.damage);
    }));

    // The run log is this player's run: a coop partner's bookings are theirs
    bag.add(bus.onLive('credits:changed', (e) => { if (e.local) this.book(e.delta, e.source); }));

    bag.add(bus.onLive('tower:placed', (e) => {
      this.towerMarks.set(e.tower.id, { damage: e.tower.combat.damageDealt, kills: e.tower.combat.kills });
      this.bookTower(e.tower.typeConfig.id, e.cost);
      this.event('tower-built', {
        id: e.tower.typeConfig.id,
        credits: -e.cost,
        at: { lat: e.position.lat, lon: e.position.lon },
      });
    }));
    bag.add(bus.onLive('tower:upgraded', (e) => {
      if (e.cost <= 0) return;   // the dev max-upgrade is not a decision
      this.bookTower(e.tower.typeConfig.id, e.cost);
      this.event('tower-upgraded', { id: e.tower.typeConfig.id, credits: -e.cost, value: e.upgradeId });
    }));
    bag.add(bus.onLive('tower:sold', (e) => {
      this.soldThisWave.push({ ...this.towerWave(e.tower), sold: true });
      this.towerMarks.delete(e.tower.id);
      this.event('tower-sold', { id: e.tower.typeConfig.id, credits: e.refund });
    }));

    bag.add(bus.onLive('research:started', (e) => this.event('research-started', { id: e.researchId })));
    bag.add(bus.onLive('research:completed', (e) => this.event('research-completed', { id: e.researchId })));
    bag.add(bus.onLive('research:cancelled', (e) => {
      this.event('research-cancelled', { id: e.researchId, credits: e.refund });
    }));

    bag.add(bus.onLive('ability:used', (e) => this.event('ability-used', { id: e.abilityId })));
    bag.add(bus.onLive('hero:level-up', (e) => this.event('hero-level', { value: e.level })));

    bag.add(bus.onLive('debug:add-credits', (e) => this.event('cheat', { id: 'credits', credits: e.amount })));
  }

  /**
   * Once per frame: writes a sample when a second of game time has passed.
   * Reading the world costs a loop over the towers, so it stays at 1 Hz.
   */
  tick(): void {
    if (!this.isOpen || !this.world) return;
    const timeMs = this.timeMs();
    if (timeMs < this.nextSampleAtMs) return;
    this.nextSampleAtMs = timeMs + SAMPLE_INTERVAL_MS;
    this.records.push({
      kind: 'sample',
      step: this.step(),
      timeMs,
      wave: this.wave,
      credits: this.world.credits(),
      baseHealth: this.world.baseHealth(),
      enemiesAlive: this.world.enemiesAlive(),
      dps: Math.round(this.world.dps()),
    });
  }

  /** What the director decided for the wave that is about to run. */
  noteDirectorDecision(decision: {
    /** Which wave source planned it, so a run is attributable to one. */
    waveSource?: WaveSourceId;
    template?: string;
    reason?: string[];
    survivableCount?: number | null;
    pressureMultiplier?: number;
    targetPressure?: number;
    /** Numbers only this source knows; stored as they come. */
    diagnostics?: Readonly<Record<string, number | string | boolean | null>>;
    composition?: { type: string; count: number; hp: number }[];
  }): void {
    this.pendingDecision = decision;
  }

  /** The game speed changed (also the bots' 75x). */
  noteSpeed(speed: number): void {
    this.event('speed', { value: speed });
  }

  /** The game was paused or resumed. */
  notePause(paused: boolean): void {
    this.event('pause', { value: paused });
  }

  /** The hero was hired. */
  noteHeroHired(cost: number): void {
    this.event('hero-hired', { credits: -cost });
  }

  /** A boss came through the portal. */
  noteBossSpawned(enemyType: string): void {
    this.event('boss-spawned', { id: enemyType });
  }

  private pendingDecision: Parameters<RunLogCollector['noteDirectorDecision']>[0] | null = null;

  // === INTERNALS ===

  private step(): number {
    return this.world?.step() ?? 0;
  }

  private timeMs(): number {
    return this.world?.timeMs() ?? 0;
  }

  private event(event: RunLogEventKind, fields: Partial<RunLogEvent> = {}): void {
    if (!this.isOpen) return;
    this.records.push({
      kind: 'event',
      event,
      step: this.step(),
      timeMs: this.timeMs(),
      wave: this.wave,
      ...fields,
    });
  }

  private book(delta: number, source: CreditsSource): void {
    if (!this.isOpen || delta === 0) return;
    const into = delta > 0 ? this.income : this.spending;
    into[source] = (into[source] ?? 0) + Math.abs(delta);
  }

  /**
   * Gold that went into one tower type. A build and an upgrade land in the
   * same number: what a type cost is the tower plus everything bought on it.
   */
  private bookTower(type: string, cost: number): void {
    if (!this.isOpen || cost <= 0) return;
    this.towerSpending[type] = (this.towerSpending[type] ?? 0) + cost;
  }

  private countLeak(enemyType: string | undefined, damage: number): void {
    this.leaked++;
    this.event('leak', { id: enemyType, value: damage });
  }

  private onWaveStarted(wave: number): void {
    this.wave = wave;
    this.waveStartStep = this.step();
    this.waveStartTimeMs = this.timeMs();
    this.waveOpen = true;
    this.event('wave-started', { value: wave });
  }

  /**
   * Start a new block. It runs from the end of the last wave to the end of
   * the next one, so the build phase in between belongs to the wave it
   * prepares: that is where the player spends, and a block that started at
   * `wave:started` lost every one of those bookings.
   */
  private beginBlock(): void {
    this.waveStartStep = this.step();
    this.waveStartTimeMs = this.timeMs();
    this.waveStartCredits = this.world?.credits() ?? 0;
    this.waveStartHealth = this.world?.baseHealth() ?? 0;
    this.income = {};
    this.spending = {};
    this.towerSpending = {};
    this.enemiesSpawned = 0;
    this.enemiesAtStart = this.world?.enemiesAlive() ?? 0;
    this.killsByTower = 0;
    this.killsByHero = 0;
    this.killsByAbility = 0;
    this.killsByDebug = 0;
    this.killsByOther = 0;
    this.leaked = 0;
    this.leaking.clear();
    this.soldThisWave = [];
    this.waveGold = undefined;
    this.waveOpen = false;
    this.markTowers();
  }

  /** Remember what every standing tower had, so the wave's share is a difference. */
  private markTowers(): void {
    this.towerMarks.clear();
    for (const tower of this.world?.towers() ?? []) {
      this.towerMarks.set(tower.id, { damage: tower.combat.damageDealt, kills: tower.combat.kills });
    }
  }

  private towerWave(tower: Tower): RunLogTowerWave {
    const mark = this.towerMarks.get(tower.id) ?? { damage: 0, kills: 0 };
    const levels: Record<string, number> = {};
    for (const upgrade of tower.typeConfig.upgrades) {
      const level = tower.getUpgradeLevel(upgrade.id);
      if (level > 0) levels[upgrade.id] = level;
    }
    return {
      id: tower.id,
      type: tower.typeConfig.id,
      levels,
      damage: Math.round(tower.combat.damageDealt - mark.damage),
      kills: tower.combat.kills - mark.kills,
    };
  }

  private onWaveCompleted(): void {
    if (!this.isOpen || this.wave <= 0) return;
    this.waveOpen = false;

    const towers = [
      ...(this.world?.towers() ?? []).map((t) => this.towerWave(t)),
      ...this.soldThisWave,
    ].filter((t) => t.damage > 0 || t.kills > 0 || Object.keys(t.levels).length > 0);

    const record: RunLogWave = {
      kind: 'wave',
      wave: this.wave,
      step: this.waveStartStep,
      timeMs: this.waveStartTimeMs,
      durationMs: Math.round(this.timeMs() - this.waveStartTimeMs),
      ...(this.pendingDecision ?? {}),
      creditsStart: this.waveStartCredits,
      creditsEnd: this.world?.credits() ?? 0,
      income: this.income,
      spending: this.spending,
      towerSpending: this.towerSpending,
      ...(this.waveGold ? { waveGold: this.waveGold } : {}),
      enemiesSpawned: this.enemiesSpawned,
      killsByTower: this.killsByTower,
      killsByHero: this.killsByHero,
      killsByAbility: this.killsByAbility,
      killsByDebug: this.killsByDebug,
      killsByOther: this.killsByOther,
      leaked: this.leaked,
      enemiesAtStart: this.enemiesAtStart,
      enemiesAlive: this.world?.enemiesAlive() ?? 0,
      healthStart: this.waveStartHealth,
      healthEnd: this.world?.baseHealth() ?? 0,
      towers,
    };

    const mismatches = reconcileWave(record);
    if (mismatches.length > 0) record.mismatches = mismatches;

    this.records.push(record);
    this.pendingDecision = null;
    this.beginBlock();
  }
}
