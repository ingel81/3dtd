/**
 * The frame packet from the simulation's state after update()
 * (docs/SIM_WORKER.md, sim/protocol/packet.ts): the tables written into the
 * TableStore's memory, the scalars, the heroes, the tower states that
 * changed and the towers that went. Ops and events come from their
 * collectors (SimOps, event-export.ts) and are handed in.
 */
import type { GameStateManager } from '../../managers/game-state.manager';
import type { TowerCombatService } from '../../services/combat/tower-combat.service';
import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';
import type { GeoPosition } from '../../models/game.types';
import type { LosMask } from '../../utils/los-mask';
import { losMaskToJson } from '../../utils/los-mask';
import type { PresentationOp } from '../protocol/ops';
import type { ExportedEvent } from '../protocol/events';
import { TableStore } from '../protocol/table-store';
import { wormGroupNum } from './event-export';
import {
  E_ANIM_SPEED, E_DIST, E_EFF_SPEED, E_FLAGS, E_HOFF, E_HP, E_ID, E_LAT, E_LON, E_MAXHP, E_PROGRESS, E_ROT, E_ROUTE,
  E_TERRAIN, E_TYPE, EF_ACTIVE, EF_ALIVE, EF_ANY_STATUS, EF_BODY, EF_BURNING, EF_FROZEN, EF_MOVING, EF_POISONED,
  EF_CAMO, EF_ELITE, EF_ENRAGED, EF_REVEALED, EF_RUNNING, EF_RUSH, EF_SLOWED, EF_STUNNED, ENEMY_STRIDE, ENEMY_TYPE_IDS, O_FLAGS, O_HP, O_ID, O_TAIL, O_TIP,
  OF_BURNING, OF_FROZEN, OF_POISONED, OF_SLOWED, OF_STUNNED, OOZE_STRIDE, P_DX, P_DY, P_DZ, P_FLAGS, P_HEIGHT, P_ID,
  P_LAT, P_LON, P_TYPE, PF_ROTATES, PROJECTILE_STRIDE, PROJECTILE_TYPE_IDS, T_AIM, T_COOLDOWN, T_DAMAGE, T_FLAGS,
  T_ID, T_KILLS, T_PITCH, TF_HOLD_FIRE, TF_LOS_READY, TF_MANNED, TF_ON_TARGET, TF_SLEEPING, TF_TRIGGER, TOWER_STRIDE,
  W_CHAIN, W_GROUP, W_HEAD, W_HP, W_MAXHP, W_REMAINING, W_SEQ, W_SIZE, WORM_STRIDE, entityNum,
  type HeroFrame, type SimFramePacket, type SimScalars, type TowerStateDto,
} from '../protocol/packet';

/** What the tick knows beyond the simulation's state */
export interface PacketFrame {
  stepsRun: number;
  presented: boolean;
  paused: boolean;
  gameSpeed: number;
  replay: SimScalars['replay'];
}

/** What was sent of a tower last: the object (ids come back after a restart), its change key, its mask */
interface SentTower {
  tower: Tower;
  key: string;
  mask: LosMask | null;
}

const ENEMY_TYPE_INDEX = new Map(ENEMY_TYPE_IDS.map((id, i) => [id, i]));
const PROJECTILE_TYPE_INDEX = new Map(PROJECTILE_TYPE_IDS.map((id, i) => [id, i]));

export class PacketWriter {
  private frame = 0;
  private readonly sent = new Map<string, SentTower>();
  /** Route arrays by index in the world's spawn order, rebuilt when the spawn points change */
  private routeIndexCache: { spawns: readonly unknown[]; index: Map<readonly GeoPosition[], number> } | null = null;

  constructor(
    private readonly gsm: GameStateManager,
    private readonly combat: TowerCombatService,
    readonly store: TableStore = new TableStore(),
  ) {}

  /** Where `enemy`'s route stands in the world's spawn list, -1 for none (E_ROUTE, EnemyRef.route) */
  readonly routeIndex = (enemy: Enemy): number => {
    const spawns = this.gsm.getSpawnPoints();
    let cache = this.routeIndexCache;
    if (!cache || cache.spawns !== spawns) {
      const index = new Map<readonly GeoPosition[], number>();
      spawns.forEach((spawn, i) => {
        const path = this.gsm.waveManager.pathOf(spawn.id);
        if (path) index.set(path, i);
      });
      cache = this.routeIndexCache = { spawns, index };
    }
    return cache.index.get(enemy.movement.path) ?? -1;
  };

  write(frame: PacketFrame, ops: PresentationOp[], events: ExportedEvent[]): SimFramePacket {
    const gsm = this.gsm;
    // Into a free set of tables: the main thread may still read an earlier packet's
    this.store.begin();
    this.writeEnemies();
    this.writeProjectiles();
    this.writeTowers();
    this.writeOozes();
    this.writeWorms();
    const { towerStates, removedTowers } = this.towerChanges();
    const tables = this.store.all();
    this.store.publish(++this.frame);
    return {
      frame: this.frame,
      stepsRun: frame.stepsRun,
      presented: frame.presented,
      scalars: this.scalars(frame),
      enemies: tables.enemies,
      projectiles: tables.projectiles,
      towers: tables.towers,
      oozes: tables.oozes,
      worms: tables.worms,
      heroes: gsm.heroes.map((seat) => this.heroFrame(seat.heroId, seat.owner.playerId, seat.getPresentation())),
      towerStates,
      removedTowers,
      ops,
      events,
    };
  }

  private scalars(frame: PacketFrame): SimScalars {
    const gsm = this.gsm;
    const players = [...gsm.players];
    return {
      subStep: gsm.subStep,
      gameTimeMs: gsm.gameTimeMs,
      phase: gsm.waveManager.phase(),
      waveNumber: gsm.waveManager.waveNumber(),
      baseHealth: gsm.baseHealth(),
      players,
      localPlayerId: gsm.localPlayerId,
      credits: players.map((id) => gsm.creditsOf(id)),
      enemiesAlive: gsm.enemyManager.getAliveCount(),
      snapshotRefusal: gsm.snapshotRefusal(),
      waveSnapshotRefusal: gsm.waveSnapshotRefusal(),
      losAwaiting: gsm.towerLos.awaitingCount,
      lockstepActive: gsm.lockstepActive,
      paused: frame.paused,
      gameSpeed: frame.gameSpeed,
      mannedTowers: players.map((id) => gsm.mannedTowerOf(id)?.id ?? null),
      ready: players.map((id) => gsm.isReady(id)),
      laneSpawns: gsm.lanes.map((lane) => lane.spawnId),
      laneOwners: gsm.lanes.map((lane) => lane.playerId),
      replayableWaves: gsm.simRecorder.replayableWaves(),
      towerCount: gsm.towerCount(),
      replay: frame.replay,
      seed: gsm.rng.seed,
      tickMs: 0,
      abilityDamage: players.map((id) => gsm.abilityDamageOf(id)),
    };
  }

  private heroFrame(heroId: string, playerId: string, p: ReturnType<GameStateManager['heroes'][number]['getPresentation']>): HeroFrame {
    return {
      heroId,
      playerId,
      present: p ? {
        lat: p.lat,
        lon: p.lon,
        heading: p.heading,
        pose: p.pose,
        anchor: { lat: p.anchor.lat, lon: p.anchor.lon, height: p.anchor.height ?? 0 },
      } : null,
    };
  }

  private writeEnemies(): void {
    const enemies = this.gsm.enemyManager.getAllActive();
    const table = this.store.table('enemies', enemies.length);
    const data = table.data;
    const now = this.gsm.gameTimeMs;
    let o = 0;
    for (const enemy of enemies) {
      const m = enemy.movement;
      const effects = m.hasStatusEffects;
      let flags = 0;
      if (enemy.alive) flags |= EF_ALIVE;
      if (enemy.active) flags |= EF_ACTIVE;
      if (enemy.body !== null) flags |= EF_BODY;
      if (enemy.rush !== null) {
        flags |= EF_RUSH;
        if (enemy.rush.running) flags |= EF_RUNNING;
      }
      if (enemy.moving) flags |= EF_MOVING;
      if (enemy.enraged) flags |= EF_ENRAGED;
      if (enemy.elite) flags |= EF_ELITE;
      if (enemy.camo) flags |= enemy.revealed ? EF_CAMO | EF_REVEALED : EF_CAMO;
      if (effects) {
        flags |= EF_ANY_STATUS;
        if (m.isSlowed(now)) flags |= EF_SLOWED;
        if (m.isFrozen(now)) flags |= EF_FROZEN;
        if (m.isStunned(now)) flags |= EF_STUNNED;
        if (m.isPoisoned(now)) flags |= EF_POISONED;
        if (m.isBurning(now)) flags |= EF_BURNING;
      }
      data[o + E_ID] = entityNum(enemy.id);
      data[o + E_LAT] = enemy.position.lat;
      data[o + E_LON] = enemy.position.lon;
      data[o + E_TERRAIN] = enemy.transform.terrainHeight;
      data[o + E_HOFF] = enemy.heightOffset;
      data[o + E_ROT] = enemy.transform.rotation;
      data[o + E_HP] = enemy.health.hp;
      data[o + E_MAXHP] = enemy.health.maxHp;
      data[o + E_ANIM_SPEED] = m.speedMps * m.speedMultiplier * m.getSlowMultiplier(now);
      data[o + E_FLAGS] = flags;
      data[o + E_PROGRESS] = m.getPathProgress();
      data[o + E_DIST] = m.getDistanceAlongPath();
      data[o + E_EFF_SPEED] = m.getEffectiveSpeed(now);
      data[o + E_ROUTE] = this.routeIndex(enemy);
      data[o + E_TYPE] = ENEMY_TYPE_INDEX.get(enemy.typeConfig.id) ?? -1;
      o += ENEMY_STRIDE;
    }
    table.count = enemies.length;
  }

  private writeProjectiles(): void {
    const projectiles = this.gsm.projectileManager.getAllActive();
    const table = this.store.table('projectiles', projectiles.length);
    const data = table.data;
    let o = 0;
    for (const p of projectiles) {
      const d = p.direction;
      data[o + P_ID] = entityNum(p.id);
      data[o + P_LAT] = p.position.lat;
      data[o + P_LON] = p.position.lon;
      data[o + P_HEIGHT] = p.flightHeight;
      data[o + P_DX] = d.dx;
      data[o + P_DY] = d.dy;
      data[o + P_DZ] = d.dz;
      data[o + P_FLAGS] = p.isHoming || p.hasArcTrajectory ? PF_ROTATES : 0;
      data[o + P_TYPE] = PROJECTILE_TYPE_INDEX.get(p.typeConfig.id) ?? -1;
      o += PROJECTILE_STRIDE;
    }
    table.count = projectiles.length;
  }

  private writeTowers(): void {
    const towers = this.gsm.towerManager.getAll();
    const table = this.store.table('towers', towers.length);
    const data = table.data;
    let o = 0;
    for (const tower of towers) {
      let flags = 0;
      if (tower.losReady) flags |= TF_LOS_READY;
      if (tower.holdFire) flags |= TF_HOLD_FIRE;
      if (tower.manned) {
        flags |= TF_MANNED;
        if (this.combat.mannedAimTargetOf(tower.id) !== null) flags |= TF_ON_TARGET;
      }
      if (tower.triggerHeld) flags |= TF_TRIGGER;
      if (tower.isSleeping) flags |= TF_SLEEPING;
      data[o + T_ID] = entityNum(tower.id);
      data[o + T_AIM] = tower.aim.current;
      data[o + T_PITCH] = tower.aim.pitch;
      data[o + T_KILLS] = tower.combat.kills;
      data[o + T_DAMAGE] = tower.combat.damageDealt;
      data[o + T_COOLDOWN] = tower.combat.cooldownRemaining;
      data[o + T_FLAGS] = flags;
      o += TOWER_STRIDE;
    }
    table.count = towers.length;
  }

  private writeOozes(): void {
    const entries = this.gsm.enemyManager.oozeBodies.entries;
    const table = this.store.table('oozes', entries.length);
    const data = table.data;
    const now = this.gsm.gameTimeMs;
    let rows = 0;
    for (const { enemy, body } of entries) {
      if (!enemy.alive) continue;
      const m = enemy.movement;
      let flags = 0;
      if (m.hasStatusEffects) {
        if (m.isSlowed(now)) flags |= OF_SLOWED;
        if (m.isPoisoned(now)) flags |= OF_POISONED;
        if (m.isBurning(now)) flags |= OF_BURNING;
        if (m.isFrozen(now)) flags |= OF_FROZEN;
        if (m.isStunned(now)) flags |= OF_STUNNED;
      }
      const o = rows++ * OOZE_STRIDE;
      data[o + O_ID] = entityNum(enemy.id);
      data[o + O_TAIL] = body.tailM;
      data[o + O_TIP] = body.tipM;
      data[o + O_HP] = enemy.health.healthPercent;
      data[o + O_FLAGS] = flags;
    }
    table.count = rows;
  }

  private writeWorms(): void {
    const groups = this.gsm.enemyManager.wormGroups;
    let chains = 0;
    for (const group of groups) chains += group.chains.length;
    const table = this.store.table('worms', chains);
    const data = table.data;
    let rows = 0;
    for (const group of groups) {
      if (group.remaining === 0) continue;
      const num = wormGroupNum(group);
      const hp = group.hp();
      group.chains.forEach((chain, i) => {
        const head = group.segments[chain.first];
        const o = rows++ * WORM_STRIDE;
        data[o + W_GROUP] = num;
        data[o + W_CHAIN] = i;
        data[o + W_HEAD] = head?.alive ? entityNum(head.id) : -1;
        data[o + W_REMAINING] = group.remaining;
        data[o + W_SEQ] = group.seq;
        data[o + W_SIZE] = group.size;
        data[o + W_HP] = hp;
        data[o + W_MAXHP] = group.maxHp;
      });
    }
    table.count = rows;
  }

  /**
   * Towers placed or changed since the last packet, and the ones gone. A
   * tower a snapshot restore built anew (a new object, the same id, type and
   * place) is a change, not a removal: its state goes with its mask, none
   * included, so the main thread's readers keep the tower and the request
   * it may have made in the same packet. Another tower under an id that
   * stood (a replay that parted from the record) goes as removed and new.
   */
  private towerChanges(): { towerStates: TowerStateDto[]; removedTowers: string[] } {
    const towerStates: TowerStateDto[] = [];
    const removedTowers: string[] = [];
    const standing = new Set<string>();
    for (const tower of this.gsm.towerManager.getAll()) {
      standing.add(tower.id);
      const key = changeKey(tower);
      const last = this.sent.get(tower.id);
      const rebuilt = last !== undefined && last.tower !== tower;
      if (rebuilt && !sameTower(last.tower, tower)) removedTowers.push(tower.id);
      if (last && !rebuilt && last.key === key && last.mask === tower.losMask) continue;
      const dto = towerState(tower);
      if (last ? rebuilt || last.mask !== tower.losMask : tower.losMask !== null) {
        dto.losMask = tower.losMask ? losMaskToJson(tower.losMask) : null;
      }
      towerStates.push(dto);
      this.sent.set(tower.id, { tower, key, mask: tower.losMask });
    }
    for (const id of [...this.sent.keys()]) {
      if (standing.has(id)) continue;
      this.sent.delete(id);
      removedTowers.push(id);
    }
    return { towerStates, removedTowers };
  }
}

/** What changes of a tower outside the per-frame numbers (T_*) */
function changeKey(tower: Tower): string {
  return JSON.stringify([
    tower.ownerId, tower.getUpgradeLevels(), tower.targetingStrategy, tower.airSubStrategy, tower.holdFire,
    tower.manned, tower.guardHeading, tower.rangeSquaredGeo, tower.combat.range, tower.combat.damage,
    tower.combat.fireRate, tower.losReady, tower.builtAtMs, tower.pathId,
  ]);
}

function towerState(tower: Tower): TowerStateDto {
  const p = tower.position;
  return {
    id: tower.id,
    typeId: tower.typeConfig.id,
    ownerId: tower.ownerId,
    position: { lat: p.lat, lon: p.lon, height: p.height ?? 0 },
    customRotation: tower.customRotation,
    plinthHeight: tower.plinthHeight,
    plinthOverhang: [...tower.plinthOverhang],
    upgrades: tower.getUpgradeLevels(),
    sim: tower.getSimState() as unknown as Record<string, unknown>,
    combat: { range: tower.combat.range, damage: tower.combat.damage, fireRate: tower.combat.fireRate },
    losReady: tower.losReady,
  };
}

/** The same tower built anew: its type on the same spot */
function sameTower(a: Tower, b: Tower): boolean {
  return a.typeConfig.id === b.typeConfig.id
    && a.position.lat === b.position.lat
    && a.position.lon === b.position.lon;
}
