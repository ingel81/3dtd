import type { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import { clearStrikeEffects } from '../three-engine/strike-effects';
import type { RouteWaypoint, GamePhase, GeoPosition } from '../models/game.types';
import type { Tower } from '../entities/tower.entity';
import type { TowerAim } from '../entities/tower-aim';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { VFXService } from '../game-engine/vfx.service';
import { AudioService } from '../game-engine/audio.service';
import { GameSoundsService } from '../game-engine/game-sounds.service';
import { ScreenShakeService } from '../game-engine/screen-shake.service';
import { BackgroundMusicService } from '../game-engine/background-music.service';
import { BloodMoonService } from '../game-engine/blood-moon.service';
import type { SimPresenterApi } from '../sim/client/contracts';
import type { MainEventBus } from '../sim/client/view-events';
import type { EnemyView } from '../sim/client/views';
import type { SimFramePacket } from '../sim/protocol/packet';
import type { PresentationOp } from '../sim/protocol/ops';
import { OpPlayer } from './op-player';
import { FramePresenter } from './frame-presenter';
import { FlameSounds } from './flame-sounds';
import { HqDamagePresenter } from './hq-damage-presenter';
import { registerCombatSounds } from './combat-sounds';
import { iceDecal, iceExplosion } from './ice-effects';
import { TOWER_TYPES, type TowerTypeId } from '../configs/tower-types.config';
import type { ScorchGround } from '../three-engine/renderers/scorch-marks';

/** What the presentation reads of the mirror (sim/client/mirror): enemy views and shadow towers */
export interface PresentationSource {
  enemy(id: string): EnemyView | null;
  tower(id: string): Tower | null;
}

export interface PresentationHostOptions {
  engine: ThreeTilesEngine;
  /** The main thread's bus (SimClient.bus) */
  bus: MainEventBus;
  source: PresentationSource;
  /** The main thread's route grid: ground of the oozes, the heroes, the scorch marks, the beam, the ability loops */
  ground: ScorchGround;
}

/**
 * Everything the player sees and hears of the simulation, on the main
 * thread (docs/SIM_WORKER.md): the SimClient hands it every packet's ops
 * (OpPlayer) and tables (FramePresenter); the presentation services (VFX,
 * audio, game sounds, screen shake, music, blood moon, HQ fire) hear the
 * main bus. No simulation object is touched.
 *
 * One per engine. The facades reach music, screen shake and the HQ through
 * the members and methods here.
 */
export class PresentationHost implements SimPresenterApi {
  readonly vfx: VFXService;
  readonly audio: AudioService;
  readonly gameSounds: GameSoundsService;
  readonly screenShake: ScreenShakeService;
  readonly backgroundMusic: BackgroundMusicService;
  readonly bloodMoon: BloodMoonService;
  readonly hq: HqDamagePresenter;
  readonly frame: FramePresenter;
  readonly ops: OpPlayer;
  readonly flames: FlameSounds;

  private readonly engine: ThreeTilesEngine;
  private readonly subs = new SubscriptionBag();
  private gameSpeed = 1;

  constructor(options: PresentationHostOptions) {
    const { engine, bus, source, ground } = options;
    this.engine = engine;

    if (engine.spatialAudio) registerCombatSounds(engine.spatialAudio);
    this.vfx = new VFXService(bus, engine);
    this.audio = new AudioService(bus, engine);
    // Its ability loops (the siren) stand on the route grid's ground
    this.audio.setGround(ground);
    this.gameSounds = new GameSoundsService(bus, engine);
    this.gameSounds.setGameSpeedSource(() => this.gameSpeed);
    this.screenShake = new ScreenShakeService(bus, engine);
    this.backgroundMusic = new BackgroundMusicService(bus, engine);
    this.backgroundMusic.setGameSpeedSource(() => this.gameSpeed);
    this.bloodMoon = new BloodMoonService(bus, engine.bloodMoon);
    this.hq = new HqDamagePresenter(engine, bus);

    // Scorch marks sit on route cells at the grid's ground height, the hero
    // and the foot of the orbital laser's beam stand on it like the enemies
    engine.effects.setScorchGround(ground);
    engine.hero.setGround(ground);
    engine.orbitalBeams.setGround(ground);

    this.frame = new FramePresenter(engine, source, ground);
    this.flames = new FlameSounds(() => engine.spatialAudio ?? null);
    this.ops = new OpPlayer(engine);
    this.installOverrides(source, bus);

    // Heavy steps as the walk clip lands a foot (EnemyTypeConfig.footstep):
    // for GameSoundsService and ScreenShakeService on the main bus
    engine.enemies.setFootstepListener((id) => {
      const enemy = source.enemy(id);
      if (enemy?.alive) bus.emit({ type: 'enemy:footstep', enemy });
    });
    // An id that comes back (a restore set the counter back) is a new enemy
    this.subs.add(bus.on('enemy:spawned', ({ enemy }) => this.frame.forgetEnemy(enemy.num)));
  }

  // ── SimPresenterApi ──

  applyOps(ops: readonly PresentationOp[]): void {
    this.ops.play(ops);
  }

  present(packet: SimFramePacket): void {
    this.gameSpeed = packet.scalars.gameSpeed;
    this.frame.present(packet);
  }

  advance(gameTimeDeltaMs: number): void {
    // The rumbling tail of a strike that already hit, a beam's burn, a missile's flight
    this.audio.update(gameTimeDeltaMs);
  }

  clear(): void {
    this.frame.clear();
    this.flames.clear();
    this.audio.clearAbilitySounds();
  }

  // ── What the facades call ──

  /**
   * Take the show off the field before a snapshot restore or after a
   * replay's seek: particles, marks, damage numbers, ability strikes and
   * their sounds, the one-shot sounds. Loops stay with the entities they
   * belong to. resync() then sets up what the state shows.
   */
  clearShow(): void {
    this.engine.effects.clear();
    clearStrikeEffects(this.engine);
    this.audio.clearAbilitySounds();
    this.engine.spatialAudio.stopOneShots();
  }

  /**
   * Show what the simulation holds now, after a snapshot restore or a
   * replay's seek, which change it without the events that normally bring
   * its look and sound: the HQ fire, the enemies' status looks and loops
   * (set again on the next frame), music and blood moon of the phase.
   */
  resync(phase: GamePhase, wave: number, baseHealth: number): void {
    this.hq.updateFireIntensity(baseHealth);
    this.frame.forgetEnemies();
    this.backgroundMusic.followPhase(phase, wave);
    this.bloodMoon.follow(phase, wave);
  }

  /** The HQ of the place (a new place: its ground is looked up anew). */
  setBase(position: GeoPosition | null): void {
    this.hq.setBase(position);
  }

  /** The tiles are in: the HQ keeps the ground under it. */
  onTilesLoaded(): void {
    this.hq.onTilesLoaded();
  }

  /** The base healed: the HQ fire goes out. */
  healBase(): void {
    this.hq.healBase();
  }

  /**
   * The game stands still: every loop (walk cycles, flames, the ooze's
   * bubbling) holds and the music goes down, except in the boss intro
   * (`keepLoops`).
   */
  setPaused(paused: boolean, keepLoops: boolean): void {
    const hold = paused && !keepLoops;
    this.engine.spatialAudio.holdLoops(hold);
    this.backgroundMusic.setDimmed(hold);
  }

  /** A coop partner's hero in his lane colour; null takes the ring off. */
  setPartnerHeroColor(playerId: string, color: number | null): void {
    this.frame.setPartnerHeroColor(playerId, color);
  }

  destroy(): void {
    this.subs.disposeAll();
    this.engine.enemies.setFootstepListener(null);
    this.clear();
    this.vfx.destroy();
    this.audio.destroy();
    this.gameSounds.destroy();
    this.screenShake.destroy();
    this.backgroundMusic.destroy();
    this.bloodMoon.destroy();
    this.hq.destroy();
  }

  /** Where the main thread supplies what an op cannot carry (sim/core/sim-sink.ts says which). */
  private installOverrides(source: PresentationSource, bus: MainEventBus): void {
    const ops = this.ops;
    const engine = this.engine;
    const oozes = this.frame.oozes;

    // A new instance starts on its walk clip once its model is there, unless it stands (a debug spawn)
    ops.override('enemies.create', (args, call) => {
      const [id, renderType, lat, lon, height, walking] = args as [string, string, number, number, number, boolean];
      const created = call(id, renderType, lat, lon, height) as Promise<unknown> | undefined;
      void created?.then((renderData) => {
        if (renderData && walking) engine.enemies.startWalkAnimation(id);
      });
    });

    // The tower renderer turns the turret by the shadow tower's aim, which the mirror sets every frame
    ops.override('towers.create', (args, call) => {
      const aim: TowerAim | undefined = source.tower(args[0] as string)?.aim;
      if (!aim) {
        console.error(`[PresentationHost] towers.create: no shadow tower ${String(args[0])}`);
        return;
      }
      call(...args.slice(0, 6), aim);
    });
    ops.override('searchlights.add', (args, call) => {
      const [id, lat, lon, footHeight, typeId] = args as [string, number, number, number, TowerTypeId];
      call(id, lat, lon, footHeight, TOWER_TYPES[typeId]);
    });
    ops.override('lightningBolts.registerIdleCrackle', (args, call) => call(args[0], args[1], performance.now() / 1000));

    // An ooze's body: stations from its path on this thread, the grid's ground
    ops.override('oozes.add', (args) => oozes.add(engine, args[0] as string, args[1] as RouteWaypoint[]));
    ops.override('oozes.collapse', (args) => oozes.collapse(engine, args[0] as string, args[1] as number, args[2] as number));
    ops.override('oozes.remove', (args, call) => {
      call(...args);
      oozes.forget(args[0] as string, engine);
    });
    ops.override('oozes.discard', (args, call) => {
      call(...args);
      oozes.forget(args[0] as string, engine);
    });
    ops.override('oozes.clear', (args, call) => {
      call(...args);
      oozes.clear(engine);
    });

    // Every enemy gone at once: their auras, crystals and loops with them
    ops.override('enemies.clear', (args, call) => {
      call(...args);
      this.frame.clearEnemies();
    });

    // The flame loop runs with the beam
    ops.override('flameBeams.startBeam', (args, call) => {
      call(...args);
      this.flames.burn(args[0] as string, args[1] as Vector3);
    });
    ops.override('flameBeams.stopBeam', (args, call) => {
      call(...args);
      this.flames.stop(args[0] as string);
    });
    ops.override('flameBeams.clear', (args, call) => {
      call(...args);
      this.flames.clear();
    });

    // The chain starts at the tip of the tower's model and sounds there
    ops.override('main.chainLightning', (args) => {
      const towerId = args[0] as string;
      const tower = engine.towers.get(towerId);
      if (!tower) return;
      const tip = engine.sync.geoToLocalSimple(tower.lat, tower.lon, tower.height);
      tip.y = tower.tipY;
      const hits = args[1] as Vector3[];
      bus.emit({ type: 'vfx:chain-lightning', points: [tip, ...hits], sourceTowerId: towerId });
      // Spatialised at the tip, so distant towers sound quieter
      engine.spatialAudio?.playAt('lightning-chain', tip).catch(() => undefined);
    });
    ops.override('main.iceExplosion', (args) => {
      const [lat, lon, explosionHeight, groundHeight, air] = args as [number, number, number, number, boolean];
      iceExplosion(engine, lat, lon, explosionHeight, groundHeight, air);
    });
    ops.override('main.iceDecal', (args) => iceDecal(engine, args[0] as number, args[1] as number, args[2] as number));
  }
}
