import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { EnemyInstanceState } from '../three-engine/renderers/instanced-enemy/enemy-instance.manager';
import type { HeroRenderer } from '../three-engine/renderers/hero.renderer';
import type { EnemyTypeConfig } from '../configs/enemy-types.config';
import { PROJECTILE_TYPES, type ProjectileTypeConfig } from '../configs/projectile-types.config';
import { WORM_SOUNDS } from '../configs/audio.config';
import { veteranLevel } from '../configs/veteran-ranks.config';
import {
  E_ANIM_SPEED,
  E_FLAGS,
  E_HOFF,
  E_HP,
  E_ID,
  E_LAT,
  E_LON,
  E_MAXHP,
  E_ROT,
  E_TERRAIN,
  EF_ALIVE,
  EF_BODY,
  EF_MOVING,
  EF_RUNNING,
  EF_RUSH,
  ENEMY_STRIDE,
  P_DX,
  P_DY,
  P_DZ,
  P_FLAGS,
  P_HEIGHT,
  P_ID,
  P_LAT,
  P_LON,
  P_TYPE,
  PF_ROTATES,
  PROJECTILE_STRIDE,
  PROJECTILE_TYPE_IDS,
  T_ID,
  T_KILLS,
  TOWER_STRIDE,
  type HeroFrame,
  type SimFramePacket,
} from '../sim/protocol/packet';
import type { EnemyView } from '../sim/client/views';
import { EnemyStatusVisuals } from './enemy-status-visuals';
import { EnemySounds } from './enemy-sounds';
import { OozePresenter, type PresentationGround } from './ooze-presenter';
import { WormSounds } from './worm-sounds';

/**
 * Spawn one trail-particle burst per this many meters travelled.
 * Distance-based gating gives uniform trails at any framerate / speed.
 */
export const TRAIL_SPAWN_DISTANCE_M = 0.5;

/** The engine members the presenter drives */
export type PresenterEngine = Pick<
  ThreeTilesEngine,
  | 'sync'
  | 'enemies'
  | 'effects'
  | 'oozes'
  | 'projectiles'
  | 'trailStreaks'
  | 'towerBadges'
  | 'hero'
  | 'spatialAudio'
  | 'createPartnerHero'
  | 'disposePartnerHero'
>;

/** What the presenter reads of the mirror: an enemy's type (sim/client/mirror) */
export interface PresenterSource {
  enemy(id: string): EnemyView | null;
}

/** An enemy the presenter has seen, by its number */
interface EnemyRecord {
  readonly id: string;
  /** Its type, from the mirror's view; null when the mirror had none (no sounds then) */
  readonly type: EnemyTypeConfig | null;
  /** Its render slot, resolved once; a released slot is resolved again */
  slot: EnemyInstanceState | null;
  /** The frame that last had it in the table */
  seen: number;
}

/** A projectile the presenter has seen: its trail's distance */
interface ProjectileRecord {
  readonly id: string;
  readonly type: ProjectileTypeConfig;
  /** Local position of the last frame, before the tail offset */
  readonly last: Vector3;
  /** Metres flown since the last trail burst */
  trailAcc: number;
  seen: number;
}

/**
 * The tables of a frame packet to the renderers (SimPresenterApi.present):
 * enemies to their instance slots with the walk or run clip, status looks
 * and their own sounds; oozes to their bands and loops; worms' voices;
 * projectiles to their instances, trail bursts and streaks; heroes, the
 * local player's on engine.hero and each partner's on a renderer of its
 * own; veteran badges from the kills. What is created and removed comes as
 * ops (OpPlayer); here only the frame's state, in presented frames. What
 * the presenter keeps per entity goes when the entity is no longer in the
 * table of a presented frame.
 */
export class FramePresenter {
  readonly statusVisuals = new EnemyStatusVisuals();
  readonly enemySounds = new EnemySounds();
  readonly oozes: OozePresenter;
  readonly wormSounds = new WormSounds();

  private readonly enemies = new Map<number, EnemyRecord>();
  /** Row offset of each alive enemy in this frame's table, for the worms' heads */
  private readonly enemyRow = new Map<number, number>();
  private readonly projectiles = new Map<number, ProjectileRecord>();
  /** Kills per tower as last shown by its badge */
  private readonly towerKills = new Map<number, number>();
  private readonly partnerHeroes = new Map<string, HeroRenderer>();
  private readonly partnerColors = new Map<string, number | null>();
  private frame = 0;
  private lastGameTimeMs: number | null = null;
  private enemyTable: Float64Array | null = null;

  private readonly local = new Vector3();
  private readonly trailPos = new Vector3();
  private readonly direction = { dx: 0, dy: 0, dz: 0 };
  private readonly headAt = (num: number, out: Vector3): boolean => this.wormHead(num, out);

  constructor(
    private readonly engine: PresenterEngine,
    private readonly source: PresenterSource,
    private readonly ground: PresentationGround,
  ) {
    this.oozes = new OozePresenter(ground);
  }

  present(packet: SimFramePacket): void {
    if (packet.presented) {
      const frame = ++this.frame;
      const gameTimeMs = packet.scalars.gameTimeMs;
      const deltaMs = this.lastGameTimeMs === null ? 0 : Math.max(0, gameTimeMs - this.lastGameTimeMs);
      this.lastGameTimeMs = gameTimeMs;
      this.presentEnemies(packet, frame, gameTimeMs, deltaMs);
      this.oozes.present(packet.oozes, this.engine);
      this.wormSounds.present(packet.worms, this.headAt, this.engine.spatialAudio ?? null, gameTimeMs);
      this.presentProjectiles(packet, frame);
      this.presentHeroes(packet.heroes, packet.scalars.localPlayerId);
      this.presentBadges(packet);
      this.engine.spatialAudio?.rebalanceEnemyLoops();
    }
    this.oozes.endFrame();
  }

  /** A coop partner's hero in his lane colour; null takes the ring off. Kept for a hero not shown yet. */
  setPartnerHeroColor(playerId: string, color: number | null): void {
    this.partnerColors.set(playerId, color);
    this.partnerHeroes.get(playerId)?.setOwnerColor(color);
  }

  /** The enemy view of `id`, for the footstep listener. */
  enemyView(id: string): EnemyView | null {
    return this.source.enemy(id);
  }

  /**
   * Forget every enemy the presenter keeps (a snapshot restore, a new
   * run): their loops end, the status looks are forgotten without being
   * stopped (effects.clear took them), slots are resolved again.
   */
  forgetEnemies(): void {
    const audio = this.engine.spatialAudio ?? null;
    this.enemySounds.clear(audio);
    this.statusVisuals.reset();
    this.enemies.clear();
  }

  /** Every enemy gone at once (op `enemies.clear`): auras and crystals stop, loops end. */
  clearEnemies(): void {
    this.enemySounds.clear(this.engine.spatialAudio ?? null);
    this.statusVisuals.clear(this.engine);
    this.enemies.clear();
  }

  /** Enemy `num` was spawned anew (its id may have come back after a restore): its record is built on its next frame. */
  forgetEnemy(num: number): void {
    const record = this.enemies.get(num);
    if (record === undefined) return;
    this.enemies.delete(num);
    this.enemySounds.forget(num, this.engine.spatialAudio ?? null);
    this.statusVisuals.forget(record.id, this.engine);
  }

  /** Everything forgotten and stopped (SimPresenterApi.clear). */
  clear(): void {
    const audio = this.engine.spatialAudio ?? null;
    this.enemySounds.clear(audio);
    this.statusVisuals.clear(this.engine);
    this.oozes.clear(this.engine);
    this.wormSounds.clear(audio);
    this.enemies.clear();
    this.enemyRow.clear();
    this.projectiles.clear();
    this.towerKills.clear();
    for (const view of this.partnerHeroes.values()) this.engine.disposePartnerHero(view);
    this.partnerHeroes.clear();
    this.lastGameTimeMs = null;
    this.enemyTable = null;
  }

  private presentEnemies(packet: SimFramePacket, frame: number, gameTimeMs: number, deltaMs: number): void {
    const engine = this.engine;
    const audio = engine.spatialAudio ?? null;
    const originHeight = engine.sync.getOrigin().height;
    const table = packet.enemies;
    const d = table.data;
    const pos = this.local;
    this.enemyTable = d;
    this.enemyRow.clear();
    this.statusVisuals.beginFrame();

    for (let r = 0; r < table.count; r++) {
      const o = r * ENEMY_STRIDE;
      const num = d[o + E_ID];
      let record = this.enemies.get(num);
      if (record === undefined) {
        const id = `enemy-${num}`;
        record = { id, type: this.source.enemy(id)?.typeConfig ?? null, slot: null, seen: frame };
        this.enemies.set(num, record);
      }
      record.seen = frame;
      const flags = d[o + E_FLAGS];
      if ((flags & EF_ALIVE) === 0) {
        // Dying: its loop ended with its walk
        if (this.enemySounds.has(num)) this.enemySounds.forget(num, audio);
        continue;
      }
      this.enemyRow.set(num, o);

      const lat = d[o + E_LAT];
      const lon = d[o + E_LON];
      const bodyHeight = d[o + E_TERRAIN] + d[o + E_HOFF];
      engine.sync.geoToLocalSimpleInto(lat, lon, 0, pos);
      pos.y = bodyHeight - originHeight;

      if (record.type !== null && audio !== null) {
        this.enemySounds.present(num, record.type, (flags & EF_MOVING) !== 0, pos, lat, lon, bodyHeight, deltaMs, audio);
      }

      // An ooze has no instance: its body goes to the ooze renderer
      if ((flags & EF_BODY) !== 0) {
        this.oozes.noteTerrain(num, d[o + E_TERRAIN]);
        continue;
      }

      let slot = record.slot;
      if (slot === null || slot.released) slot = record.slot = engine.enemies.resolveSlot(record.id);
      if (slot !== null) {
        // Show the walk/run state the simulation decided. Mismatch only
        // right after a switch, so the id-based call runs once per switch.
        if ((flags & EF_RUSH) !== 0) {
          const running = (flags & EF_RUNNING) !== 0;
          if (slot.isWalking === running) {
            if (running) engine.enemies.startRunAnimation(record.id);
            else engine.enemies.startWalkAnimation(record.id);
          }
        }
        const maxHp = d[o + E_MAXHP];
        engine.enemies.updateSlot(slot, pos, d[o + E_ROT], maxHp > 0 ? d[o + E_HP] / maxHp : 0, d[o + E_ANIM_SPEED]);
      }

      this.statusVisuals.present(record.id, flags, lat, lon, bodyHeight, engine, pos, gameTimeMs);
    }

    for (const [num, record] of this.enemies) {
      if (record.seen === frame) continue;
      this.enemies.delete(num);
      this.enemySounds.forget(num, audio);
      this.statusVisuals.forget(record.id, engine);
    }
  }

  /** The head of a worm chain: local position of enemy `num` lifted to where its voice sits. */
  private wormHead(num: number, out: Vector3): boolean {
    const o = this.enemyRow.get(num);
    const d = this.enemyTable;
    if (o === undefined || d === null) return false;
    const sync = this.engine.sync;
    sync.geoToLocalSimpleInto(d[o + E_LAT], d[o + E_LON], 0, out);
    out.y = d[o + E_TERRAIN] + d[o + E_HOFF] + WORM_SOUNDS.voice.liftM - sync.getOrigin().height;
    return true;
  }

  private presentProjectiles(packet: SimFramePacket, frame: number): void {
    const engine = this.engine;
    const table = packet.projectiles;
    const d = table.data;
    const pos = this.trailPos;
    for (let r = 0; r < table.count; r++) {
      const o = r * PROJECTILE_STRIDE;
      const num = d[o + P_ID];
      const lat = d[o + P_LAT];
      const lon = d[o + P_LON];
      const height = d[o + P_HEIGHT];
      engine.sync.geoToLocalSimpleInto(lat, lon, height, pos);

      let record = this.projectiles.get(num);
      if (record === undefined) {
        const type = PROJECTILE_TYPES[PROJECTILE_TYPE_IDS[d[o + P_TYPE]]];
        if (!type) continue;
        record = { id: `projectile-${num}`, type, last: pos.clone(), trailAcc: 0, seen: frame };
        this.projectiles.set(num, record);
      } else {
        record.trailAcc += record.last.distanceTo(pos);
        record.last.copy(pos);
      }
      record.seen = frame;

      const dir = this.direction;
      dir.dx = d[o + P_DX];
      dir.dy = d[o + P_DY];
      dir.dz = d[o + P_DZ];
      // Homing and arcing projectiles turn along their flight, the others keep their rotation
      if ((d[o + P_FLAGS] & PF_ROTATES) !== 0) engine.projectiles.updateWithRotation(record.id, lat, lon, height, dir);
      else engine.projectiles.update(record.id, lat, lon, height);

      const tailOffset = record.type.tailOffset ?? 0;
      if (tailOffset > 0) {
        // Trails start at the tail (rocket nozzle), not the mesh centre
        pos.x -= dir.dx * tailOffset;
        pos.y -= dir.dy * tailOffset;
        pos.z -= dir.dz * tailOffset;
      }

      // One trail burst per TRAIL_SPAWN_DISTANCE_M flown, laid back along
      // the flight one gate apart instead of stacked on the current position
      const trailConfig = record.type.trailParticles;
      if (trailConfig?.enabled) {
        let back = 0;
        while (record.trailAcc >= TRAIL_SPAWN_DISTANCE_M) {
          record.trailAcc -= TRAIL_SPAWN_DISTANCE_M;
          engine.effects.spawnConfigurableTrail(pos.x - dir.dx * back, pos.y - dir.dy * back, pos.z - dir.dz * back, trailConfig);
          back += TRAIL_SPAWN_DISTANCE_M;
        }
      } else {
        record.trailAcc = 0;
      }

      // pushPosition copies the vector into its ring buffer
      engine.trailStreaks?.pushPosition(record.id, pos);
    }
    for (const [num, record] of this.projectiles) {
      if (record.seen !== frame) this.projectiles.delete(num);
    }
  }

  private presentHeroes(heroes: readonly HeroFrame[], localPlayerId: string): void {
    for (const hero of heroes) {
      if (hero.present === null) continue;
      const view = hero.playerId === localPlayerId ? this.engine.hero : this.partnerHero(hero.playerId);
      view.present(hero.present);
    }
  }

  private partnerHero(playerId: string): HeroRenderer {
    let view = this.partnerHeroes.get(playerId);
    if (view === undefined) {
      view = this.engine.createPartnerHero();
      view.setGround(this.ground);
      const color = this.partnerColors.get(playerId);
      if (color !== undefined) view.setOwnerColor(color);
      this.partnerHeroes.set(playerId, view);
    }
    return view;
  }

  /** A tower's badge follows its kills; setRank only when they changed. */
  private presentBadges(packet: SimFramePacket): void {
    const table = packet.towers;
    const d = table.data;
    for (let r = 0; r < table.count; r++) {
      const o = r * TOWER_STRIDE;
      const num = d[o + T_ID];
      const kills = d[o + T_KILLS];
      if (this.towerKills.get(num) === kills) continue;
      this.towerKills.set(num, kills);
      this.engine.towerBadges.setRank(`tower-${num}`, veteranLevel(kills));
    }
    if (this.towerKills.size > table.count) {
      const standing = new Set<number>();
      for (let r = 0; r < table.count; r++) standing.add(d[r * TOWER_STRIDE + T_ID]);
      for (const num of this.towerKills.keys()) {
        if (!standing.has(num)) this.towerKills.delete(num);
      }
    }
  }
}
