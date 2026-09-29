/**
 * The run log in the running game.
 *
 * Opens a run when the world is ready and after every reset, feeds the
 * collector from the event bus, writes the run to IndexedDB once a wave is
 * done, and closes it on defeat, restart or a change of location
 * (docs/RUN_LOG.md).
 *
 * The collector itself is Angular-free; this is the part that knows the
 * services.
 */

import { Injectable, effect, inject, signal } from '@angular/core';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import type { Tower } from '../entities/tower.entity';
import { SimClient } from '../sim/client/sim-client.service';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { LocationManagementService } from '../services/location/location-management.service';
import { DevWorldService } from '../devworld/devworld.service';
import { GameStore } from '../store/game.store';
import { HERO } from '../configs/hero.config';
import { calculateTotalDPS } from '../director/defense-analyzer';
import { directorParamsName } from '../director/director-params';
import type { WaveSourceId } from '../director/wave-source';
import { RunLogCollector, type RunLogWorld } from './run-log.service';
import { killOwnership } from './kill-ownership';
import { WaveSeriesRecorder, type WaveSeriesPoint } from './wave-series';
import { RunLogStore } from './run-log.store';
import { loadBuildCommit } from './build-commit';
import { downloadRun, runFileName, toJsonl } from './run-log.export';
import { readDesktopBridge } from '../core/desktop-bridge';
import type { RunEndReason, RunLog, RunPlayer } from './run-log.types';

@Injectable({ providedIn: 'root' })
export class RunLogFacade {
  private readonly locations = inject(LocationManagementService);
  private readonly devWorld = inject(DevWorldService);
  private readonly gameStore = inject(GameStore);
  private readonly sim = inject(SimClient);
  private readonly mirror = inject(SimMirror);

  constructor() {
    // Speed and pause are store signals, not events; the log follows them so
    // a run says at what speed it was played (a bot run goes at 75x).
    let lastSpeed = this.gameStore.gameSpeed();
    effect(() => {
      const speed = this.gameStore.gameSpeed();
      if (speed !== lastSpeed) {
        lastSpeed = speed;
        this.collector.noteSpeed(speed);
      }
    });
    let lastPaused = this.gameStore.paused();
    effect(() => {
      const paused = this.gameStore.paused();
      if (paused !== lastPaused) {
        lastPaused = paused;
        this.collector.notePause(paused);
      }
    });
  }

  readonly collector = new RunLogCollector();
  readonly store = new RunLogStore();

  private readonly subs = new SubscriptionBag();
  /** Every player's run wave by wave, for the game-over charts (TODO E46) */
  readonly waveSeries = signal<readonly WaveSeriesPoint[]>([]);
  private readonly series = new WaveSeriesRecorder();

  /** The last run that ended and was kept; coop offers it to the relay (TODO E38) */
  readonly closedRun = signal<RunLog | null>(null);
  /** Wired to the game (initialize): a run opens only then */
  private wired = false;

  /**
   * Who is playing, asked when a run opens.
   *
   * Handed in rather than injected: the bot client belongs to the game
   * component's injector, and this service is a root one. A root service that
   * reaches into a component's injector is the NG0201 this threw on the first
   * real start.
   */
  private whoPlays: () => { player: RunPlayer; botSkill?: string } = () => ({ player: 'human' });

  /** Which wave source plays, asked when a run opens. Handed in for the same reason: the WaveDirector is component-scoped too. */
  private waveSource: () => WaveSourceId | undefined = () => undefined;

  /** The room's players while a coop game runs, null alone (see setCoopHead) */
  private coopHead: () => { players: string[]; you: string } | null = () => null;

  /**
   * Coop (CoopService): every run that opens while the room plays is a coop
   * run (head.coop, which the relay's collection asks for, TODO E38). Asked
   * when the run opens, so it does not matter who hears game:reset first.
   */
  setCoopHead(head: () => { players: string[]; you: string } | null): void {
    this.coopHead = head;
  }

  /**
   * Wire the log to the running game: the simulation's events on
   * SimClient.bus, its numbers from the mirror. A second call replaces the
   * subscriptions rather than doubling them.
   */
  initialize(
    whoPlays?: () => { player: RunPlayer; botSkill?: string },
    waveSource?: () => WaveSourceId,
  ): void {
    this.wired = true;
    if (whoPlays) this.whoPlays = whoPlays;
    if (waveSource) this.waveSource = waveSource;
    const bus = this.sim.bus;
    const mirror = this.mirror;
    this.subs.disposeAll();
    this.collector.attach(bus, this.subs);
    this.series.attach(bus, this.subs, {
      players: () => mirror.players,
      killCredit: (killedBy) => mirror.killCreditPlayer(killedBy),
      towersOf: (playerId) => mirror.towersOf(playerId).length,
      hqHealth: () => mirror.scalars.baseHealth,
    });
    for (const type of ['wave:completed', 'game:over', 'game:reset'] as const) {
      this.subs.add(bus.onLive(type, () => this.waveSeries.set(this.series.points)));
    }

    // The head wants the commit, and the file arrives a moment after the
    // first run opened: stamp it into the head that is already standing.
    void loadBuildCommit().then((commit) => this.collector.setCommit(commit));

    // A wave is done: keep what there is, so a closed tab loses at most the
    // wave that is running.
    this.subs.add(bus.onLive('wave:completed', () => void this.persist()));
    this.subs.add(bus.onLive('game:over', () => this.close('defeat')));
    // The hero is hired once per run; his state event is the only signal
    let heroHired = false;
    this.subs.add(bus.onLive('hero:state-changed', (e) => {
      if (!e.local || e.hero.hired === heroHired) return;
      heroHired = e.hero.hired;
      if (heroHired) this.collector.noteHeroHired(HERO.cost);
    }));
    this.subs.add(bus.onLive('enemy:spawned', (e) => {
      if (e.viaPortal && e.enemy.typeConfig.isBoss) {
        this.collector.noteBossSpawned(e.enemy.typeConfig.id);
      }
    }));
    // The reset comes on restart, location change and DevWorld rebuild; the
    // run that was open ends there and the next one opens right after.
    this.subs.add(bus.onLive('game:reset', () => {
      this.close('restart');
      this.open();
    }));

    this.open();
  }

  /** Per frame, from the game loop: writes the one-second samples. */
  tick(): void {
    this.collector.tick();
  }

  /** The run that is open, or null. */
  current(): RunLog | null {
    return this.collector.current();
  }

  /** Hand the open run to the player as a file. */
  export(): boolean {
    const run = this.current();
    return run ? downloadRun(run) : false;
  }

  /**
   * End the run as a defeat, unless it is already ended.
   *
   * For the bot session, which sends the log to the server and must not
   * depend on whether this service heard `game:over` first.
   */
  endRun(): void {
    this.close('defeat');
  }

  dispose(): void {
    this.close('abandoned');
    this.subs.disposeAll();
  }

  private open(): void {
    if (!this.wired) return;
    const mirror = this.mirror;

    // The run log is this player's run (TODO E34): in coop the partner's
    // towers, their damage and their kills are theirs. The numbers are the
    // mirror's, as the last packet left them.
    const mine = (tower: Tower): boolean => tower.ownerId === mirror.localPlayerId;
    const world: RunLogWorld = {
      step: () => mirror.subStep,
      timeMs: () => mirror.gameTimeMs,
      credits: () => mirror.creditsOf(mirror.localPlayerId),
      baseHealth: () => mirror.scalars.baseHealth,
      // The living ones: an enemy in its death animation already counted as
      // a kill, so the wave booked it twice and its bodies came out one too many.
      enemiesAlive: () => mirror.scalars.enemiesAlive,
      dps: () => calculateTotalDPS(mirror.towers().filter(mine)),
      towers: () => mirror.towers(),
      ownsTower: mine,
      ownsKill: killOwnership(mirror),
      abilityDamage: () => mirror.abilityDamageOf(mirror.localPlayerId),
    };

    const home = this.locations.editableHqLocation();
    const who = this.whoPlays();
    this.collector.open(
      {
        seed: mirror.scalars.seed,
        map: this.devWorld.isActive ? 'devworld' : 'world',
        player: who.player,
        directorParams: directorParamsName(),
        waveSource: this.waveSource(),
        ...(who.botSkill ? { botSkill: who.botSkill } : {}),
        ...(home ? { location: { name: home.name, lat: home.lat, lon: home.lon } } : {}),
      },
      world,
    );
    const coop = this.coopHead();
    if (coop) this.collector.markCoop(coop.players, coop.you);
  }

  private close(reason: RunEndReason): void {
    const waveReached = this.collector.waveReached;
    const run = this.collector.close(reason);
    // A run nobody played (opened and reset right away) is not worth keeping.
    if (!run || waveReached <= 0) return;
    void this.store.save(run, waveReached);
    this.closedRun.set(run);
    // The desktop app keeps its runs as files as well, next to its logs, so a
    // batch of them can be read without opening the game.
    void readDesktopBridge()?.saveRun(runFileName(run.head.runId), toJsonl(run.records));
  }

  private async persist(): Promise<void> {
    const run = this.current();
    if (!run) return;
    await this.store.save(run, this.collector.waveReached);
  }
}
