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
import { SubscriptionBag, type GameEventBus } from '../game-engine/game-event-bus';
import type { Tower } from '../entities/tower.entity';
import type { GameStateManager } from '../managers/game-state.manager';
import { LocationManagementService } from '../services/location/location-management.service';
import { DevWorldService } from '../devworld/devworld.service';
import { GameStore } from '../store/game.store';
import { HERO } from '../configs/hero.config';
import { calculateTotalDPS } from '../director/defense-analyzer';
import { directorParamsName } from '../director/director-params';
import type { WaveSourceId } from '../director/wave-source';
import { RunLogCollector, type RunLogWorld } from './run-log.service';
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
  /** The last run that ended and was kept; coop offers it to the relay (TODO E38) */
  readonly closedRun = signal<RunLog | null>(null);
  private gameState: GameStateManager | null = null;

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

  /**
   * Wire the log to a running game. Called once the event bus exists; a
   * second call replaces the subscriptions rather than doubling them.
   */
  initialize(
    gameState: GameStateManager,
    bus: GameEventBus,
    whoPlays?: () => { player: RunPlayer; botSkill?: string },
    waveSource?: () => WaveSourceId,
  ): void {
    this.gameState = gameState;
    if (whoPlays) this.whoPlays = whoPlays;
    if (waveSource) this.waveSource = waveSource;
    this.subs.disposeAll();
    this.collector.attach(bus, this.subs);

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
    const gameState = this.gameState;
    if (!gameState) return;

    // The run log is this player's run (TODO E34): in coop the partner's
    // towers, their damage and their kills are theirs
    const mine = (tower: Tower): boolean => tower.ownerId === gameState.localPlayerId;
    const world: RunLogWorld = {
      step: () => gameState.subStep,
      timeMs: () => gameState.gameTimeMs,
      credits: () => gameState.credits(),
      baseHealth: () => gameState.baseHealth(),
      // Not `getAll().length`: an enemy in its death animation is still in
      // that list although it already counted as a kill, so the wave booked
      // it twice and its bodies came out one too many.
      enemiesAlive: () => gameState.enemyManager.getAliveCount(),
      dps: () => calculateTotalDPS(gameState.towerManager.getAll().filter(mine)),
      towers: () => gameState.towerManager.getAll(),
      ownsTower: mine,
      ownsKill: (killedBy) => {
        const me = gameState.localPlayerId;
        switch (killedBy?.kind) {
          case 'tower': {
            const tower = gameState.towerManager.getById(killedBy.towerId);
            return !tower || tower.ownerId === me;
          }
          case 'hero': return killedBy.heroId === undefined || killedBy.heroId === gameState.heroOf(me).heroId;
          case 'ability': return (killedBy.ownerId ?? gameState.players[0]) === me;
          default: return true;
        }
      },
    };

    const home = this.locations.editableHqLocation();
    const who = this.whoPlays();
    this.collector.open(
      {
        seed: gameState.rng.seed,
        map: this.devWorld.isActive ? 'devworld' : 'world',
        player: who.player,
        directorParams: directorParamsName(),
        waveSource: this.waveSource(),
        ...(who.botSkill ? { botSkill: who.botSkill } : {}),
        ...(home ? { location: { name: home.name, lat: home.lat, lon: home.lon } } : {}),
      },
      world,
    );
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
