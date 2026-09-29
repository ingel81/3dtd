import { Injectable } from '@angular/core';
import {
  E_ANIM_SPEED, E_DIST, E_EFF_SPEED, E_FLAGS, E_HOFF, E_HP, E_ID, E_LAT, E_LON, E_MAXHP, E_PROGRESS, E_ROT,
  E_ROUTE, E_TERRAIN, E_TYPE, EF_ACTIVE, EF_ALIVE, EF_BODY, ENEMY_STRIDE, ENEMY_TYPE_IDS,
  T_AIM, T_COOLDOWN, T_DAMAGE, T_FLAGS, T_ID, T_KILLS, T_PITCH, TF_HOLD_FIRE, TF_LOS_READY, TF_MANNED,
  TF_ON_TARGET, TF_SLEEPING, TF_TRIGGER, TOWER_STRIDE,
  W_GROUP, W_HEAD, W_HP, W_MAXHP, W_REMAINING, W_SEQ, W_SIZE, WORM_STRIDE,
  type HeroFrame, type SimFramePacket, type SimScalars, type TowerStateDto,
} from '../../protocol/packet';
import {
  isEnemyRef, isProjectileRef, isTowerRef, isWormGroupRef,
  type EnemyRef, type ExportedEvent, type ProjectileRef, type WormGroupRef,
} from '../../protocol/events';
import type { SimMirrorApi } from '../contracts';
import type { ViewEvent } from '../view-events';
import { EnemyView, ProjectileView, WormGroupView } from '../views';
import { Tower, type TowerSimState } from '../../../entities/tower.entity';
import type { TowerTypeId, UpgradeId } from '../../../configs/tower-types.config';
import { ENEMY_TYPES, type EnemyTypeConfig } from '../../../configs/enemy-types.config';
import { getProjectileType, type ProjectileTypeId } from '../../../configs/projectile-types.config';
import { ABILITIES, type AbilityId, type AbilityRejectReason, type AbilityStatus } from '../../../configs/abilities.config';
import {
  HERO_SOURCE_ID, heroDefenseProfile, heroSourceIdFor, initialHeroStatus,
  type HeroDefenseProfile, type HeroStatus,
} from '../../../configs/hero.config';
import { OWNER_ONLY, type TowerPolicy } from '../../../coop/tower-policy';
import type { KilledBy } from '../../../game-engine/events/event-types';
import type { GeoPosition } from '../../../models/game.types';
import { LOCAL_PLAYER_ID } from '../../../managers/game-state/command-log';
import { GameRng } from '../../../utils/game-rng';
import { MirrorResearch } from './mirror-research';

/** Scalars before the first packet: a single player game in setup */
export function initialScalars(): SimScalars {
  return {
    subStep: 0,
    gameTimeMs: 0,
    phase: 'setup',
    waveNumber: 0,
    baseHealth: 0,
    players: [LOCAL_PLAYER_ID],
    localPlayerId: LOCAL_PLAYER_ID,
    credits: [0],
    enemiesAlive: 0,
    enemiesToSpawn: 0,
    pendingSpawns: 0,
    isReplaying: false,
    snapshotRefusal: null,
    waveSnapshotRefusal: null,
    lockstepActive: false,
    paused: false,
    gameSpeed: 1,
    mannedTowers: [null],
    ready: [false],
    laneSpawns: [],
    replayableWaves: [],
    towerCount: 0,
    abilityDamage: [0],
    replay: null,
    seed: 0,
  };
}

/** Whether the player can get into `tower`: a projectile tower (docs/TOWER_CONTROL.md, as TowerLifecycle.canMan) */
export function canManTower(tower: Tower): boolean {
  const attack = tower.typeConfig.attackType;
  return attack === undefined || attack === 'projectile';
}

/** What changed of a shadow tower, for SimMirror.onTowerChange */
export type TowerChange =
  /** Placed, or its state changed (upgrade, settings, line of sight); `tower` may be a new object for the same id */
  | { kind: 'state'; tower: Tower }
  | { kind: 'removed'; tower: Tower };

/**
 * The main thread's picture of the simulation (docs/SIM_WORKER.md): shadow
 * towers, enemy, projectile and worm views, the scalars and the per player
 * statuses the events carry. Applied from every packet by the SimClient (in
 * the order of SimMirrorApi); read by the UI, the input, the bot and the
 * wave source. Nothing here is simulated: a shadow tower only holds the
 * numbers the simulation sent.
 */
@Injectable({ providedIn: 'root' })
export class SimMirror implements SimMirrorApi {
  scalars: SimScalars = initialScalars();

  /**
   * The run's random source on the main thread, reset to the run's seed
   * (scalars.seed): the wave source draws stream 'director', the bot 'bot',
   * the same sequences as when they drew from the simulation's.
   */
  readonly rng = new GameRng(0);

  /** What a player may do with a tower (D7), the rule the simulation's commands check */
  towerPolicy: TowerPolicy = OWNER_ONLY;

  private readonly towerMap = new Map<string, Tower>();
  private towerList: Tower[] | null = null;
  /** Towers removed by this packet, until afterFrame: its events still name them */
  private readonly goneTowers = new Map<string, Tower>();
  /** Manned crosshair on target (TF_ON_TARGET) by tower id */
  private readonly onTarget = new Set<string>();

  private readonly enemyMap = new Map<number, EnemyView>();
  private enemyList: EnemyView[] = [];
  private aliveList: EnemyView[] | null = null;
  /** Enemies gone with this packet, until afterFrame: its events still name them */
  private readonly goneEnemies = new Map<number, EnemyView>();
  private frameStamp = 0;
  private readonly seen = new Map<number, number>();

  private readonly wormMap = new Map<number, WormGroupView>();
  private readonly projectileMap = new Map<number, ProjectileView>();

  private spawnIds: readonly string[] = [];
  private paths: ReadonlyMap<string, readonly GeoPosition[]> = new Map();

  private readonly research = new Map<string, MirrorResearch>();
  private readonly abilities = new Map<string, Map<AbilityId, AbilityStatus>>();
  private readonly heroStatuses = new Map<string, HeroStatus>();
  private heroFrames: HeroFrame[] = [];

  private readonly towerListeners = new Set<(change: TowerChange) => void>();
  /** Time and sub-step of the event being handed on, null outside one (see gameTimeMs) */
  private eventTime: { t: number; step: number } | null = null;

  // ── World ─────────────────────────────────────────────────────

  /**
   * The spawns in SimWorld order (what E_ROUTE and EnemyRef.route index) and
   * their routes as the main thread has them; set with every world the
   * simulation gets.
   */
  setWorld(spawnIds: readonly string[], paths: ReadonlyMap<string, readonly GeoPosition[]>): void {
    this.spawnIds = spawnIds;
    this.paths = paths;
    for (const view of this.enemyMap.values()) this.setRoute(view, this.routeIndexOf(view));
  }

  /** Spawn ids in SimWorld order */
  get spawnIdList(): readonly string[] {
    return this.spawnIds;
  }

  // ── Packet ────────────────────────────────────────────────────

  applyState(packet: SimFramePacket): void {
    this.frameStamp++;
    const scalars = packet.scalars;
    this.scalars = scalars;
    if (scalars.seed !== this.rng.seed) this.rng.reset(scalars.seed);
    this.heroFrames = packet.heroes;

    for (const id of packet.removedTowers) this.removeTower(id);
    for (const dto of packet.towerStates) this.applyTowerState(dto);
    this.applyTowerTable(packet);
    this.applyEnemyTable(packet);
    this.applyWormTable(packet);
    // Worm groups the events name before any row of them (spawned idle)
    for (const event of packet.events) this.prescan(event.payload);
  }

  importEvent(event: ExportedEvent): ViewEvent {
    this.eventTime = event.t === undefined ? null : { t: event.t, step: event.step ?? this.scalars.subStep };
    const out: Record<string, unknown> = { type: event.type };
    for (const key of Object.keys(event.payload)) out[key] = this.toView(event.payload[key]);
    this.afterEvent(out as ViewEvent);
    return out as ViewEvent;
  }

  afterFrame(_packet: SimFramePacket): void {
    this.eventTime = null;
    this.goneTowers.clear();
    this.goneEnemies.clear();
    // A projectile view lives for the events of its packet
    this.projectileMap.clear();
  }

  clear(): void {
    this.eventTime = null;
    this.scalars = initialScalars();
    this.towerMap.clear();
    this.towerList = null;
    this.goneTowers.clear();
    this.onTarget.clear();
    this.enemyMap.clear();
    this.enemyList = [];
    this.aliveList = null;
    this.goneEnemies.clear();
    this.seen.clear();
    this.wormMap.clear();
    this.projectileMap.clear();
    this.research.clear();
    this.abilities.clear();
    this.heroStatuses.clear();
    this.heroFrames = [];
  }

  // ── Towers ────────────────────────────────────────────────────

  towers(): readonly Tower[] {
    return (this.towerList ??= [...this.towerMap.values()]);
  }

  tower(id: string): Tower | null {
    return this.towerMap.get(id) ?? this.goneTowers.get(id) ?? null;
  }

  /** The towers of `playerId` */
  towersOf(playerId: string): Tower[] {
    return this.towers().filter((t) => t.ownerId === playerId);
  }

  /**
   * Called for every shadow tower placed, changed (a DTO came) or removed,
   * after the mirror applied it. Returns the unsubscribe.
   */
  onTowerChange(listener: (change: TowerChange) => void): () => void {
    this.towerListeners.add(listener);
    return () => this.towerListeners.delete(listener);
  }

  /** The manned tower's crosshair is on an enemy it may shoot (TF_ON_TARGET) */
  onTargetOf(towerId: string): boolean {
    return this.onTarget.has(towerId);
  }

  /** The tower `playerId` sits in, null when none */
  mannedTower(playerId: string = this.localPlayerId): Tower | null {
    const i = this.scalars.players.indexOf(playerId);
    const id = i < 0 ? null : this.scalars.mannedTowers[i] ?? null;
    return id ? this.tower(id) : null;
  }

  /**
   * `towerId` if the player at this client may select that tower
   * (TowerPolicy), else null: the UI's gate, the rule the commands check.
   */
  selectableTower(towerId: string | null): string | null {
    if (!towerId) return null;
    const tower = this.towerMap.get(towerId);
    if (!tower || !this.towerPolicy.may(this.localPlayerId, tower, 'select')) return null;
    // A partner's research center or silo has no panel that reads their state
    if (!this.mayManage(tower) && tower.typeConfig.attackType === 'passive') return null;
    return towerId;
  }

  /** Whether the player at this client may act on `tower` (upgrade, sell, targeting, man it) */
  mayManage(tower: { readonly ownerId: string }): boolean {
    return this.towerPolicy.may(this.localPlayerId, tower, 'upgrade');
  }

  private applyTowerState(dto: TowerStateDto): void {
    const known = this.towerMap.get(dto.id);
    let tower = known;
    if (!tower || lowersAnUpgrade(tower, dto.upgrades)) {
      tower = Tower.shadow(
        dto.id,
        dto.position,
        dto.typeId as TowerTypeId,
        dto.customRotation,
        dto.plinthHeight,
        dto.plinthOverhang,
        known?.aim,
      );
      this.towerMap.set(dto.id, tower);
      this.towerList = null;
    }
    tower.ownerId = dto.ownerId;
    tower.restoreUpgradeLevels(dto.upgrades as [UpgradeId, number][]);
    tower.restoreSimState(dto.sim as unknown as TowerSimState);
    tower.combat.range = dto.combat.range;
    tower.combat.damage = dto.combat.damage;
    tower.combat.fireRate = dto.combat.fireRate;
    tower.losReady = dto.losReady;
    this.notify({ kind: 'state', tower });
  }

  private removeTower(id: string): void {
    const tower = this.towerMap.get(id);
    if (!tower) return;
    this.towerMap.delete(id);
    this.towerList = null;
    this.onTarget.delete(id);
    this.goneTowers.set(id, tower);
    this.notify({ kind: 'removed', tower });
  }

  private notify(change: TowerChange): void {
    for (const listener of this.towerListeners) listener(change);
  }

  private applyTowerTable(packet: SimFramePacket): void {
    const { data, count } = packet.towers;
    for (let i = 0; i < count; i++) {
      const o = i * TOWER_STRIDE;
      const tower = this.towerMap.get(`tower-${data[o + T_ID]}`);
      if (!tower) continue;
      tower.aim.current = data[o + T_AIM];
      tower.aim.pitch = data[o + T_PITCH];
      tower.combat.kills = data[o + T_KILLS];
      tower.combat.damageDealt = data[o + T_DAMAGE];
      tower.combat.restoreCooldown(data[o + T_COOLDOWN]);
      const flags = data[o + T_FLAGS];
      tower.losReady = (flags & TF_LOS_READY) !== 0;
      tower.holdFire = (flags & TF_HOLD_FIRE) !== 0;
      tower.manned = (flags & TF_MANNED) !== 0;
      tower.triggerHeld = (flags & TF_TRIGGER) !== 0;
      tower.isSleeping = (flags & TF_SLEEPING) !== 0;
      if (flags & TF_ON_TARGET) this.onTarget.add(tower.id);
      else this.onTarget.delete(tower.id);
    }
  }

  // ── Enemies ───────────────────────────────────────────────────

  /** Every enemy of the last packet, dying ones included */
  enemies(): readonly EnemyView[] {
    return this.enemyList;
  }

  /** The living ones (EnemyManager.getAlive) */
  aliveEnemies(): readonly EnemyView[] {
    return (this.aliveList ??= this.enemyList.filter((e) => e.alive));
  }

  enemy(id: string): EnemyView | null {
    const num = Number(id.slice(id.lastIndexOf('-') + 1));
    return this.enemyMap.get(num) ?? this.goneEnemies.get(num) ?? null;
  }

  /** The worm groups on the route */
  wormGroups(): IterableIterator<WormGroupView> {
    return this.wormMap.values();
  }

  private applyEnemyTable(packet: SimFramePacket): void {
    const { data, count } = packet.enemies;
    const stamp = this.frameStamp;
    let changed = false;
    for (let i = 0; i < count; i++) {
      const o = i * ENEMY_STRIDE;
      const num = data[o + E_ID];
      let view = this.enemyMap.get(num);
      if (!view) {
        const type = ENEMY_TYPES[ENEMY_TYPE_IDS[data[o + E_TYPE]]];
        if (!type) continue;
        view = this.createEnemy(num, type);
        changed = true;
      }
      this.seen.set(num, stamp);
      const flags = data[o + E_FLAGS];
      view.flags = flags;
      view.alive = (flags & EF_ALIVE) !== 0;
      view.active = (flags & EF_ACTIVE) !== 0;
      view.hasBody = (flags & EF_BODY) !== 0;
      view.position.lat = data[o + E_LAT];
      view.position.lon = data[o + E_LON];
      view.transform.terrainHeight = data[o + E_TERRAIN];
      view.heightOffset = data[o + E_HOFF];
      view.position.height = view.transform.terrainHeight + view.heightOffset;
      view.transform.rotation = data[o + E_ROT];
      view.health.hp = data[o + E_HP];
      view.health.maxHp = data[o + E_MAXHP];
      view.animSpeed = data[o + E_ANIM_SPEED];
      view.movement.progress = data[o + E_PROGRESS];
      view.movement.distanceAlongPath = data[o + E_DIST];
      view.movement.effectiveSpeed = data[o + E_EFF_SPEED];
      const route = data[o + E_ROUTE];
      if (this.routeIndexOf(view) !== route) this.setRoute(view, route);
    }
    for (const [num, view] of this.enemyMap) {
      if (this.seen.get(num) === stamp) continue;
      view.alive = false;
      view.active = false;
      this.enemyMap.delete(num);
      this.seen.delete(num);
      this.goneEnemies.set(num, view);
      changed = true;
    }
    if (changed) this.enemyList = [...this.enemyMap.values()];
    this.aliveList = null;
  }

  private createEnemy(num: number, type: EnemyTypeConfig): EnemyView {
    const view = new EnemyView(`enemy-${num}`, num, type);
    view.movement.speedMps = type.baseSpeed;
    this.enemyMap.set(num, view);
    this.seen.set(num, this.frameStamp);
    return view;
  }

  private routeIndexOf(view: EnemyView): number {
    return view.movement.routeId === '' ? -1 : this.spawnIds.indexOf(view.movement.routeId);
  }

  private setRoute(view: EnemyView, route: number): void {
    const id = route >= 0 ? this.spawnIds[route] ?? '' : '';
    view.movement.routeId = id;
    view.movement.path = (id && this.paths.get(id)) || [];
  }

  private applyWormTable(packet: SimFramePacket): void {
    const { data, count } = packet.worms;
    /** Rows (chains) per group this packet */
    const rows = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const o = i * WORM_STRIDE;
      const num = data[o + W_GROUP];
      let group = this.wormMap.get(num);
      if (!group) {
        group = new WormGroupView(num, data[o + W_SIZE]);
        this.wormMap.set(num, group);
      }
      rows.set(num, (rows.get(num) ?? 0) + 1);
      group.remaining = data[o + W_REMAINING];
      group.seq = data[o + W_SEQ];
      group.hpLeft = data[o + W_HP];
      group.maxHp = data[o + W_MAXHP];
      const head = data[o + W_HEAD];
      if (!group.type && head >= 0) group.type = this.enemyMap.get(head)?.typeConfig ?? null;
    }
    for (const [num, group] of this.wormMap) {
      const chains = rows.get(num);
      if (chains === undefined) {
        group.remaining = 0;
        group.chains = 0;
        this.wormMap.delete(num);
      } else {
        group.chains = chains;
      }
    }
  }

  // ── Events ────────────────────────────────────────────────────

  private prescan(value: unknown): void {
    if (isWormGroupRef(value)) {
      this.wormGroupOf(value);
      return;
    }
    if (Array.isArray(value)) for (const v of value) this.prescan(v);
    else if (isPlain(value)) for (const v of Object.values(value)) this.prescan(v);
  }

  /** A reference to its view, updated with the ref's numbers; other values as they are, containers walked. */
  private toView(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (isEnemyRef(value)) return this.enemyOf(value);
    if (isTowerRef(value)) return this.tower(value.$t);
    if (isProjectileRef(value)) return this.projectileOf(value);
    if (isWormGroupRef(value)) return this.wormGroupOf(value);
    if (Array.isArray(value)) return value.map((v) => this.toView(v));
    if (!isPlain(value)) return value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = this.toView((value as Record<string, unknown>)[key]);
    return out;
  }

  private enemyOf(ref: EnemyRef): EnemyView {
    let view = this.enemyMap.get(ref.$e) ?? this.goneEnemies.get(ref.$e);
    if (!view) {
      const type = ENEMY_TYPES[ref.type];
      view = this.createEnemy(ref.$e, type);
      this.enemyList = [...this.enemyMap.values()];
      this.aliveList = null;
    }
    view.position.lat = ref.lat;
    view.position.lon = ref.lon;
    view.transform.terrainHeight = ref.th;
    view.heightOffset = ref.ho;
    view.position.height = ref.th + ref.ho;
    view.health.hp = ref.hp;
    view.alive = ref.alive && view.active;
    if (ref.pr !== undefined) view.movement.progress = ref.pr;
    if (ref.body) view.hasBody = true;
    if (this.routeIndexOf(view) !== ref.route) this.setRoute(view, ref.route);
    if (ref.worm) {
      const group = this.wormMap.get(ref.worm.g) ?? this.wormGroupOf({ $w: ref.worm.g, size: 1, remaining: 1, type: ref.type });
      if (!group.type) group.type = view.typeConfig;
      if (view.worm?.group === group && view.worm.slot === ref.worm.slot) view.worm.head = ref.worm.head;
      else view.worm = { group, slot: ref.worm.slot, head: ref.worm.head };
    }
    this.aliveList = null;
    return view;
  }

  private wormGroupOf(ref: WormGroupRef): WormGroupView {
    let group = this.wormMap.get(ref.$w);
    if (!group) {
      group = new WormGroupView(ref.$w, ref.size);
      this.wormMap.set(ref.$w, group);
    }
    group.remaining = ref.remaining;
    group.type ??= ENEMY_TYPES[ref.type] ?? null;
    return group;
  }

  private projectileOf(ref: ProjectileRef): ProjectileView {
    let view = this.projectileMap.get(ref.$p);
    if (!view) {
      view = new ProjectileView(`projectile-${ref.$p}`, getProjectileType(ref.type as ProjectileTypeId), ref.sourceTowerId);
      this.projectileMap.set(ref.$p, view);
    }
    view.position.lat = ref.lat;
    view.position.lon = ref.lon;
    view.position.height = ref.height;
    return view;
  }

  /** The statuses events carry */
  private afterEvent(event: ViewEvent): void {
    switch (event.type) {
      case 'research:state-changed':
        this.researchOf(event.playerId).setState(
          event.activeResearches, event.completedResearches, event.queuedResearches, event.centerLevel, event.maxSlots,
        );
        break;
      case 'research:progress':
        this.researchOf(event.playerId).setElapsed(event.elapsed);
        break;
      case 'ability:state-changed': {
        let map = this.abilities.get(event.playerId);
        if (!map) this.abilities.set(event.playerId, (map = new Map()));
        for (const status of event.abilities) map.set(status.id, status);
        break;
      }
      case 'hero:state-changed':
        this.heroStatuses.set(event.playerId, event.hero);
        break;
      // A new run starts its streams over, also on the same seed
      case 'game:reset':
        this.rng.reset(this.scalars.seed);
        break;
    }
  }

  // ── Time ──────────────────────────────────────────────────────

  /**
   * Game time, ms: while an event is handed on, the time it was emitted at
   * (a packet may hold many sub-steps), else the packet's. What durations of
   * the run log and the wave source read.
   */
  get gameTimeMs(): number {
    return this.eventTime?.t ?? this.scalars.gameTimeMs;
  }

  /** Sub-step, as gameTimeMs: the event's while one is handed on */
  get subStep(): number {
    return this.eventTime?.step ?? this.scalars.subStep;
  }

  // ── Players ───────────────────────────────────────────────────

  /** The players of the run in roster order */
  get players(): readonly string[] {
    return this.scalars.players;
  }

  /** The player at this client */
  get localPlayerId(): string {
    return this.scalars.localPlayerId;
  }

  creditsOf(playerId: string): number {
    const i = this.scalars.players.indexOf(playerId);
    return i < 0 ? 0 : this.scalars.credits[i] ?? 0;
  }

  /** HP the abilities of `playerId` took from enemies so far (the run log) */
  abilityDamageOf(playerId: string): number {
    const i = this.scalars.players.indexOf(playerId);
    return i < 0 ? 0 : this.scalars.abilityDamage[i] ?? 0;
  }

  /** Coop: `playerId` said ready for the next wave */
  isReady(playerId: string): boolean {
    const i = this.scalars.players.indexOf(playerId);
    return i >= 0 && (this.scalars.ready[i] ?? false);
  }

  /** The spawn point ids of the lanes, roster order */
  get laneSpawns(): readonly string[] {
    return this.scalars.laneSpawns;
  }

  /** Coop: the spawn point id of `playerId`'s lane; null without one */
  laneSpawnOf(playerId: string): string | null {
    const i = this.scalars.players.indexOf(playerId);
    return i < 0 ? null : this.scalars.laneSpawns[i] ?? null;
  }

  /**
   * Who gets the gold of a kill (GameStateManager.killCreditPlayer): the
   * tower's owner, the hero's player, the ability's owner, else the first
   * player of the run.
   */
  killCreditPlayer(killedBy: KilledBy | null): string {
    const players = this.scalars.players;
    if (killedBy?.kind === 'tower') {
      const tower = this.tower(killedBy.towerId);
      if (tower) return tower.ownerId;
    } else if (killedBy?.kind === 'hero') {
      const heroId = killedBy.heroId ?? HERO_SOURCE_ID;
      const single = players.length === 1;
      for (const id of players) if (heroSourceIdFor(id, single) === heroId) return id;
    } else if (killedBy?.kind === 'ability' && killedBy.ownerId) {
      return killedBy.ownerId;
    }
    return players[0];
  }

  // ── Research, abilities, hero ─────────────────────────────────

  /** The research of `playerId` as the last research:state-changed told it */
  researchOf(playerId: string): MirrorResearch {
    let research = this.research.get(playerId);
    if (!research) this.research.set(playerId, (research = new MirrorResearch(playerId)));
    return research;
  }

  /** The status of ability `id` of `playerId`, null before any ability:state-changed named it */
  abilityStatus(id: AbilityId, playerId: string = this.localPlayerId): AbilityStatus | null {
    return this.abilities.get(playerId)?.get(id) ?? null;
  }

  /** Why a use of `id` would be refused now, null when it would go through (AbilityManager.checkUse) */
  checkUse(id: AbilityId, playerId: string = this.localPlayerId): AbilityRejectReason | null {
    if (!ABILITIES[id]) return 'unknown';
    const status = this.abilityStatus(id, playerId);
    if (!status?.unlocked) return 'locked';
    if (!status.launchSite) return 'no-launch-site';
    if (status.charges <= 0) return 'no-charge';
    if (this.scalars.phase !== 'wave') return 'no-wave';
    return null;
  }

  heroStatus(playerId: string = this.localPlayerId): HeroStatus {
    return this.heroStatuses.get(playerId) ?? initialHeroStatus();
  }

  /** The hero of `playerId` as the renderer shows him; null while not hired */
  heroFrame(playerId: string = this.localPlayerId): HeroFrame['present'] {
    return this.heroFrames.find((h) => h.playerId === playerId)?.present ?? null;
  }

  /** The spot he was sent to and holds, null until hired (HeroManager.getAnchor) */
  heroAnchor(playerId: string = this.localPlayerId): GeoPosition | null {
    const anchor = this.heroFrame(playerId)?.anchor;
    return anchor ? { lat: anchor.lat, lon: anchor.lon, height: anchor.height } : null;
  }

  /** The hero for the fairness gate (analyzeDefense), null until hired */
  heroDefenseProfile(playerId: string = this.localPlayerId): HeroDefenseProfile | null {
    const status = this.heroStatus(playerId);
    return status.hired ? heroDefenseProfile(status.kills) : null;
  }
}

/** A plain object or array literal (structured-clone data), not a Map, Set or typed array */
function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function lowersAnUpgrade(tower: Tower, levels: readonly (readonly [string, number])[]): boolean {
  const next = new Map(levels);
  for (const [id, level] of tower.getUpgradeLevels()) if ((next.get(id) ?? 0) < level) return true;
  return false;
}
