/**
 * Packets by hand for the specs of the mirror and its readers: what the
 * simulation would send, without a simulation.
 */
import {
  E_ANIM_SPEED, E_DIST, E_EFF_SPEED, E_FLAGS, E_HOFF, E_HP, E_ID, E_LAT, E_LON, E_MAXHP, E_PROGRESS, E_ROT,
  E_ROUTE, E_TERRAIN, E_TYPE, EF_ACTIVE, EF_ALIVE, ENEMY_STRIDE, ENEMY_TYPE_IDS,
  T_AIM, T_COOLDOWN, T_DAMAGE, T_FLAGS, T_ID, T_KILLS, T_PITCH, TOWER_STRIDE,
  W_CHAIN, W_GROUP, W_HEAD, W_HP, W_MAXHP, W_REMAINING, W_SEQ, W_SIZE, WORM_STRIDE,
  entityNum,
  type SimFramePacket, type SimScalars, type SimTable, type TowerStateDto,
} from '../../../protocol/packet';
import type { ExportedEvent } from '../../../protocol/events';
import type { Tower } from '../../../../entities/tower.entity';
import { initialScalars } from '../sim-mirror';

export interface EnemyRow {
  num: number;
  type: string;
  lat?: number;
  lon?: number;
  hp?: number;
  maxHp?: number;
  flags?: number;
  route?: number;
  progress?: number;
  dist?: number;
}

export interface TowerRow {
  id: string;
  aim?: number;
  pitch?: number;
  kills?: number;
  damage?: number;
  cooldown?: number;
  flags?: number;
}

export interface WormRow {
  group: number;
  chain?: number;
  head?: number;
  remaining: number;
  seq?: number;
  size: number;
  hp: number;
  maxHp: number;
}

function table(stride: number, rows: number, fill: (data: Float64Array, o: number, i: number) => void): SimTable {
  const data = new Float64Array(Math.max(1, rows) * stride);
  for (let i = 0; i < rows; i++) fill(data, i * stride, i);
  return { data, count: rows };
}

export function enemyTable(rows: readonly EnemyRow[]): SimTable {
  return table(ENEMY_STRIDE, rows.length, (d, o, i) => {
    const r = rows[i];
    d[o + E_ID] = r.num;
    d[o + E_TYPE] = ENEMY_TYPE_IDS.indexOf(r.type);
    d[o + E_LAT] = r.lat ?? 0;
    d[o + E_LON] = r.lon ?? 0;
    d[o + E_TERRAIN] = 0;
    d[o + E_HOFF] = 0;
    d[o + E_ROT] = 0;
    d[o + E_HP] = r.hp ?? 100;
    d[o + E_MAXHP] = r.maxHp ?? 100;
    d[o + E_ANIM_SPEED] = 0;
    d[o + E_FLAGS] = r.flags ?? EF_ALIVE | EF_ACTIVE;
    d[o + E_PROGRESS] = r.progress ?? 0;
    d[o + E_DIST] = r.dist ?? 0;
    d[o + E_EFF_SPEED] = 0;
    d[o + E_ROUTE] = r.route ?? -1;
  });
}

export function towerTable(rows: readonly TowerRow[]): SimTable {
  return table(TOWER_STRIDE, rows.length, (d, o, i) => {
    const r = rows[i];
    d[o + T_ID] = entityNum(r.id);
    d[o + T_AIM] = r.aim ?? 0;
    d[o + T_PITCH] = r.pitch ?? 0;
    d[o + T_KILLS] = r.kills ?? 0;
    d[o + T_DAMAGE] = r.damage ?? 0;
    d[o + T_COOLDOWN] = r.cooldown ?? 0;
    d[o + T_FLAGS] = r.flags ?? 0;
  });
}

export function wormTable(rows: readonly WormRow[]): SimTable {
  return table(WORM_STRIDE, rows.length, (d, o, i) => {
    const r = rows[i];
    d[o + W_GROUP] = r.group;
    d[o + W_CHAIN] = r.chain ?? 0;
    d[o + W_HEAD] = r.head ?? -1;
    d[o + W_REMAINING] = r.remaining;
    d[o + W_SEQ] = r.seq ?? 0;
    d[o + W_SIZE] = r.size;
    d[o + W_HP] = r.hp;
    d[o + W_MAXHP] = r.maxHp;
  });
}

/** The DTO the simulation sends for `tower` (a real one, built by the spec) */
export function towerDto(tower: Tower): TowerStateDto {
  return {
    id: tower.id,
    typeId: tower.typeConfig.id,
    ownerId: tower.ownerId,
    position: { lat: tower.position.lat, lon: tower.position.lon, height: tower.position.height ?? 0 },
    customRotation: tower.customRotation,
    plinthHeight: tower.plinthHeight,
    plinthOverhang: tower.plinthOverhang,
    upgrades: tower.getUpgradeLevels(),
    sim: tower.getSimState() as unknown as Record<string, unknown>,
    combat: { range: tower.combat.range, damage: tower.combat.damage, fireRate: tower.combat.fireRate },
    losReady: tower.losReady,
  };
}

export interface PacketParts {
  scalars?: Partial<SimScalars>;
  enemies?: readonly EnemyRow[];
  towers?: readonly TowerRow[];
  worms?: readonly WormRow[];
  towerStates?: TowerStateDto[];
  removedTowers?: string[];
  events?: { type: string; payload?: Record<string, unknown> }[];
  stepsRun?: number;
}

let frame = 0;

export function packet(parts: PacketParts = {}): SimFramePacket {
  const events: ExportedEvent[] = (parts.events ?? []).map((e) => ({
    type: e.type,
    payload: e.payload ?? {},
    live: true,
    show: true,
  }));
  return {
    frame: ++frame,
    stepsRun: parts.stepsRun ?? 1,
    presented: true,
    scalars: { ...initialScalars(), ...parts.scalars },
    enemies: enemyTable(parts.enemies ?? []),
    projectiles: { data: new Float64Array(0), count: 0 },
    towers: towerTable(parts.towers ?? []),
    oozes: { data: new Float64Array(0), count: 0 },
    worms: wormTable(parts.worms ?? []),
    heroes: [],
    towerStates: parts.towerStates ?? [],
    removedTowers: parts.removedTowers ?? [],
    ops: [],
    events,
  };
}

/**
 * A packet through the mirror and onto the bus in SimClient's order
 * (sim/client/contracts.ts), without the presenter.
 */
export function feed(
  mirror: { applyState(p: SimFramePacket): void; importEvent(e: ExportedEvent): unknown; afterFrame(p: SimFramePacket): void },
  bus: { emit(event: never): void } | null,
  p: SimFramePacket,
): void {
  mirror.applyState(p);
  for (const event of p.events) {
    const view = mirror.importEvent(event);
    bus?.emit(view as never);
  }
  mirror.afterFrame(p);
}
