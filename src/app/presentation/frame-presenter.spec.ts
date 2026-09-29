import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { FramePresenter, TRAIL_SPAWN_DISTANCE_M, type PresenterEngine, type PresenterSource } from './frame-presenter';
import {
  EF_ALIVE,
  EF_ANY_STATUS,
  EF_MOVING,
  EF_RUNNING,
  EF_RUSH,
  EF_SLOWED,
  EF_STUNNED,
  ENEMY_STRIDE,
  OOZE_STRIDE,
  OF_POISONED,
  PF_ROTATES,
  PROJECTILE_STRIDE,
  PROJECTILE_TYPE_IDS,
  TOWER_STRIDE,
  WORM_STRIDE,
  type HeroFrame,
  type SimFramePacket,
  type SimTable,
} from '../sim/protocol/packet';
import { getEnemyType, type EnemyTypeId } from '../configs/enemy-types.config';
import { STUN_SPARKS } from '../configs/visual-effects.config';
import { WORM_SOUNDS } from '../configs/audio.config';
import { veteranLevel } from '../configs/veteran-ranks.config';
import type { EnemyView } from '../sim/client/views';

const ORIGIN_HEIGHT = 100;

function table(stride: number, rows: number[][]): SimTable {
  const data = new Float64Array(Math.max(1, rows.length) * stride);
  rows.forEach((row, r) => data.set(row, r * stride));
  return { data, count: rows.length };
}

/** An enemy row: id, lat, lon, terrain, height offset, rotation, hp, max hp, anim speed, flags */
function enemyRow(id: number, flags: number, at: { lat?: number; lon?: number; terrain?: number; hp?: number } = {}): number[] {
  const row = new Array<number>(ENEMY_STRIDE).fill(0);
  row.splice(0, 10, id, at.lat ?? 0, at.lon ?? 0, at.terrain ?? 110, 2, 0.5, at.hp ?? 50, 100, 3, flags);
  return row;
}

interface PacketParts {
  presented?: boolean;
  gameTimeMs?: number;
  enemies?: number[][];
  projectiles?: number[][];
  towers?: number[][];
  oozes?: number[][];
  worms?: number[][];
  heroes?: HeroFrame[];
}

function packet(parts: PacketParts = {}): SimFramePacket {
  return {
    frame: 0,
    stepsRun: 1,
    presented: parts.presented ?? true,
    scalars: { gameTimeMs: parts.gameTimeMs ?? 0, gameSpeed: 1, localPlayerId: 'p1' } as SimFramePacket['scalars'],
    enemies: table(ENEMY_STRIDE, parts.enemies ?? []),
    projectiles: table(PROJECTILE_STRIDE, parts.projectiles ?? []),
    towers: table(TOWER_STRIDE, parts.towers ?? []),
    oozes: table(OOZE_STRIDE, parts.oozes ?? []),
    worms: table(WORM_STRIDE, parts.worms ?? []),
    heroes: parts.heroes ?? [],
    towerStates: [],
    removedTowers: [],
    ops: [],
    events: [],
  };
}

function makeEngine() {
  const slots = new Map<string, { isWalking: boolean; released: boolean }>();
  let handles = 0;
  const partner = { present: vi.fn(), setGround: vi.fn(), setOwnerColor: vi.fn() };
  const engine = {
    sync: {
      getOrigin: () => ({ lat: 0, lon: 0, height: ORIGIN_HEIGHT }),
      // A flat stand-in: lat to z, lon to x, the height as it is
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon * 10, height, lat * 10),
    },
    enemies: {
      resolveSlot: vi.fn((id: string) => {
        let slot = slots.get(id);
        if (!slot || slot.released) {
          slot = { isWalking: true, released: false };
          slots.set(id, slot);
        }
        return slot;
      }),
      updateSlot: vi.fn(),
      startRunAnimation: vi.fn((id: string) => { slots.get(id)!.isWalking = false; }),
      startWalkAnimation: vi.fn((id: string) => { slots.get(id)!.isWalking = true; }),
      setFreezeVisual: vi.fn(),
      setIcedVisual: vi.fn(),
      setStunVisual: vi.fn(),
      setPoisonVisual: vi.fn(),
      setBurnVisual: vi.fn(),
    },
    effects: {
      spawnFrostAura: vi.fn(),
      updateFrostAuraPosition: vi.fn(),
      stopFrostAura: vi.fn(),
      spawnIceCrystals: vi.fn(),
      updateIceCrystalsPosition: vi.fn(),
      stopIceCrystals: vi.fn(),
      spawnPoisonAura: vi.fn(),
      updatePoisonAuraPosition: vi.fn(),
      stopPoisonAura: vi.fn(),
      spawnBurstAtGeo: vi.fn(),
      spawnConfigurableTrail: vi.fn(),
    },
    oozes: { add: vi.fn(), setFrame: vi.fn() },
    projectiles: { update: vi.fn(), updateWithRotation: vi.fn() },
    trailStreaks: { pushPosition: vi.fn() },
    towerBadges: { setRank: vi.fn() },
    hero: { present: vi.fn() },
    createPartnerHero: vi.fn(() => partner),
    disposePartnerHero: vi.fn(),
    spatialAudio: {
      registerSound: vi.fn(),
      createLoop: vi.fn(() => Promise.resolve(++handles)),
      updateLoopPosition: vi.fn(() => true),
      stopLoop: vi.fn(),
      stopOneShot: vi.fn(),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      playAt: vi.fn(() => Promise.resolve(null)),
      rebalanceEnemyLoops: vi.fn(),
      getListener: () => ({ getWorldPosition: (v: Vector3) => v.set(0, 0, 0) }),
    },
  };
  return { engine, slots, partner };
}

function setup(types: Record<string, EnemyTypeId> = {}) {
  const { engine, slots, partner } = makeEngine();
  const source: PresenterSource = {
    enemy: (id) => (types[id] ? ({ typeConfig: getEnemyType(types[id]) } as EnemyView) : null),
  };
  const ground = { getGroundLocalYAt: () => null };
  const presenter = new FramePresenter(engine as unknown as PresenterEngine, source, ground);
  return { presenter, engine, slots, partner };
}

/** Let the loops' createLoop promises settle */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('FramePresenter', () => {
  describe('enemies', () => {
    it('resolves a slot once, pushes the row to it and resolves again once the renderer released it', () => {
      const { presenter, engine, slots } = setup();
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE, { lat: 1, lon: 2, terrain: 110 })] }));
      expect(engine.enemies.resolveSlot).toHaveBeenCalledTimes(1);
      expect(engine.enemies.resolveSlot).toHaveBeenCalledWith('enemy-7');
      const [slot, pos, heading, health, speed] = engine.enemies.updateSlot.mock.calls[0] as unknown as [unknown, Vector3, number, number, number];
      expect(slot).toBe(slots.get('enemy-7'));
      // Ground 110 plus 2 m height offset, less the origin's 100
      expect(pos.toArray()).toEqual([20, 12, 10]);
      expect([heading, health, speed]).toEqual([0.5, 0.5, 3]);

      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE)] }));
      expect(engine.enemies.resolveSlot).toHaveBeenCalledTimes(1);

      slots.get('enemy-7')!.released = true;
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE)] }));
      expect(engine.enemies.resolveSlot).toHaveBeenCalledTimes(2);
    });

    it('does nothing for a frame that is not presented, and pushes no dying enemy', () => {
      const { presenter, engine } = setup();
      presenter.present(packet({ presented: false, enemies: [enemyRow(7, EF_ALIVE)] }));
      presenter.present(packet({ enemies: [enemyRow(8, 0)] }));
      expect(engine.enemies.resolveSlot).not.toHaveBeenCalled();
      expect(engine.enemies.updateSlot).not.toHaveBeenCalled();
    });

    it('switches the clip to run and back where a rush changed, once per switch', () => {
      const { presenter, engine } = setup();
      const running = EF_ALIVE | EF_RUSH | EF_RUNNING;
      presenter.present(packet({ enemies: [enemyRow(7, running)] }));
      presenter.present(packet({ enemies: [enemyRow(7, running)] }));
      expect(engine.enemies.startRunAnimation).toHaveBeenCalledTimes(1);
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE | EF_RUSH)] }));
      expect(engine.enemies.startWalkAnimation).toHaveBeenCalledTimes(1);
      // Without a rush the clip stays
      presenter.present(packet({ enemies: [enemyRow(8, EF_ALIVE | EF_RUNNING)] }));
      expect(engine.enemies.startRunAnimation).toHaveBeenCalledTimes(1);
    });

    it('turns a status look on at its edge, moves it along, turns it off, and stops it when the enemy leaves', () => {
      const { presenter, engine } = setup();
      const slowed = EF_ALIVE | EF_ANY_STATUS | EF_SLOWED;
      presenter.present(packet({ enemies: [enemyRow(7, slowed)] }));
      presenter.present(packet({ enemies: [enemyRow(7, slowed)] }));
      expect(engine.enemies.setFreezeVisual).toHaveBeenCalledWith('enemy-7', true);
      expect(engine.effects.spawnFrostAura).toHaveBeenCalledTimes(1);
      expect(engine.effects.updateFrostAuraPosition).toHaveBeenCalledTimes(1);

      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE)] }));
      expect(engine.enemies.setFreezeVisual).toHaveBeenLastCalledWith('enemy-7', false);
      expect(engine.effects.stopFrostAura).toHaveBeenCalledTimes(1);

      presenter.present(packet({ enemies: [enemyRow(7, slowed)] }));
      presenter.present(packet({ enemies: [] }));
      expect(engine.effects.stopFrostAura).toHaveBeenCalledTimes(2);
    });

    it('sparks a stunned enemy every interval of game time', () => {
      const { presenter, engine } = setup();
      const stunned = EF_ALIVE | EF_ANY_STATUS | EF_STUNNED;
      presenter.present(packet({ gameTimeMs: 0, enemies: [enemyRow(7, stunned)] }));
      presenter.present(packet({ gameTimeMs: STUN_SPARKS.intervalMs / 2, enemies: [enemyRow(7, stunned)] }));
      presenter.present(packet({ gameTimeMs: STUN_SPARKS.intervalMs, enemies: [enemyRow(7, stunned)] }));
      expect(engine.enemies.setStunVisual).toHaveBeenCalledTimes(1);
      expect(engine.effects.spawnBurstAtGeo).toHaveBeenCalledTimes(2);
      // Over the body: ground 110 plus the 2 m offset
      expect(engine.effects.spawnBurstAtGeo.mock.calls[0][2]).toBe(112 + STUN_SPARKS.height);
    });

    it('loops the moving sound of a type while the enemy walks and ends it when it stops or leaves', async () => {
      const { presenter, engine } = setup({ 'enemy-7': 'zombie', 'enemy-8': 'zombie' });
      const audio = engine.spatialAudio;
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE | EF_MOVING), enemyRow(8, EF_ALIVE | EF_MOVING)] }));
      await settle();
      expect(audio.createLoop).toHaveBeenCalledTimes(2);
      expect((audio.createLoop.mock.calls[0] as unknown[])[0]).toBe('enemy-zombie_moving');
      // One registration per type
      expect(audio.registerSound.mock.calls.filter((c) => (c as unknown[])[0] === 'enemy-zombie_moving')).toHaveLength(1);

      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE | EF_MOVING), enemyRow(8, EF_ALIVE)] }));
      expect(audio.updateLoopPosition).toHaveBeenCalledTimes(1);
      expect(audio.stopLoop).toHaveBeenCalledTimes(1);
      presenter.present(packet({ enemies: [] }));
      expect(audio.stopLoop).toHaveBeenCalledTimes(2);
      expect(audio.rebalanceEnemyLoops).toHaveBeenCalledTimes(3);
    });

    it('builds a record anew for an enemy spawned again under its id', () => {
      const { presenter, engine } = setup();
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE)] }));
      presenter.forgetEnemy(7);
      presenter.present(packet({ enemies: [enemyRow(7, EF_ALIVE)] }));
      expect(engine.enemies.resolveSlot).toHaveBeenCalledTimes(2);
    });
  });

  describe('projectiles', () => {
    const rocket = PROJECTILE_TYPE_IDS.indexOf('rocket');
    const row = (height: number) => [11, 0, 0, height, 0, 1, 0, PF_ROTATES, rocket];

    it('turns a rotating projectile and lays a trail burst every half metre it flew, back along its flight', () => {
      const { presenter, engine } = setup();
      presenter.present(packet({ projectiles: [row(0)] }));
      presenter.present(packet({ projectiles: [row(1.2)] }));
      presenter.present(packet({ projectiles: [row(2.4)] }));
      expect(engine.projectiles.updateWithRotation).toHaveBeenCalledTimes(3);
      expect(engine.projectiles.updateWithRotation.mock.calls[0][4]).toEqual({ dx: 0, dy: 1, dz: 0 });
      // 1.2 m: two bursts and 0.2 m kept, then 1.4 m: two more
      const trails = engine.effects.spawnConfigurableTrail.mock.calls as unknown as number[][];
      expect(trails).toHaveLength(4);
      // From the tail (rocket nozzle, 2.1 m back), one gate apart
      expect(trails[0][1]).toBeCloseTo(1.2 - 2.1);
      expect(trails[1][1]).toBeCloseTo(1.2 - 2.1 - TRAIL_SPAWN_DISTANCE_M);
      expect(engine.trailStreaks.pushPosition).toHaveBeenCalledTimes(3);
      expect(engine.trailStreaks.pushPosition.mock.calls[0][0]).toBe('projectile-11');
    });

    it('starts a projectile seen again after it left afresh', () => {
      const { presenter, engine } = setup();
      presenter.present(packet({ projectiles: [row(0)] }));
      presenter.present(packet({ projectiles: [] }));
      presenter.present(packet({ projectiles: [row(5)] }));
      expect(engine.effects.spawnConfigurableTrail).not.toHaveBeenCalled();
    });
  });

  it('sets a tower badge only when its kills changed', () => {
    const { presenter, engine } = setup();
    const tower = (kills: number) => [3, 0, 0, kills, 0, 0, 0];
    presenter.present(packet({ towers: [tower(0)] }));
    presenter.present(packet({ towers: [tower(0)] }));
    presenter.present(packet({ towers: [tower(50)] }));
    expect(engine.towerBadges.setRank.mock.calls).toEqual([
      ['tower-3', veteranLevel(0)],
      ['tower-3', veteranLevel(50)],
    ]);
  });

  it('shows the local hero on the engine hero and each partner on a renderer of its own, in its colour', () => {
    const { presenter, engine, partner } = setup();
    const present = { lat: 1, lon: 2, heading: 0, pose: 'idle' as const, anchor: { lat: 1, lon: 2, height: 3 } };
    presenter.setPartnerHeroColor('p2', 0xff0000);
    const heroes: HeroFrame[] = [
      { heroId: 'h', playerId: 'p1', present },
      { heroId: 'h', playerId: 'p2', present },
      { heroId: 'h', playerId: 'p3', present: null },
    ];
    presenter.present(packet({ heroes }));
    presenter.present(packet({ heroes }));
    expect(engine.hero.present).toHaveBeenCalledWith(present);
    expect(engine.createPartnerHero).toHaveBeenCalledTimes(1);
    expect(partner.setOwnerColor).toHaveBeenCalledWith(0xff0000);
    expect(partner.present).toHaveBeenCalledTimes(2);

    presenter.clear();
    expect(engine.disposePartnerHero).toHaveBeenCalledWith(partner);
  });

  it('hands an ooze its band frame from the table and ends its loop when an op removed it', async () => {
    const { presenter, engine } = setup();
    const path = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 10 },
    ];
    presenter.oozes.add(engine as unknown as PresenterEngine, 'enemy-9', path as never);
    expect(engine.oozes.add.mock.calls[0][0]).toBe('enemy-9');
    presenter.present(packet({ oozes: [[9, 10, 30, 0.5, OF_POISONED]] }));
    expect(engine.oozes.setFrame).toHaveBeenCalledWith('enemy-9', 10, 30, 0.5, false, true, false, false, false);
    await settle();
    expect(engine.spatialAudio.createLoop).toHaveBeenCalledTimes(1);

    presenter.oozes.forget('enemy-9', engine as unknown as PresenterEngine);
    expect(engine.spatialAudio.stopLoop).toHaveBeenCalledTimes(1);
    // Kept to the end of the frame
    expect(presenter.oozes.size).toBe(1);
    presenter.present(packet({ oozes: [] }));
    expect(presenter.oozes.size).toBe(0);
  });

  it('gives a worm a voice at its head nearest the listener and silences it once it is gone', async () => {
    const { presenter, engine } = setup();
    const audio = engine.spatialAudio;
    const worm = [[1, 0, 21, 3, 1, 5], [1, 1, 22, 2, 1, 5]];
    const enemies = [enemyRow(21, EF_ALIVE, { lat: 10 }), enemyRow(22, EF_ALIVE, { lat: 1 })];
    presenter.present(packet({ gameTimeMs: 0, enemies, worms: worm }));
    await settle();
    const [id, at] = audio.createLoop.mock.calls[0] as unknown as [string, Vector3];
    expect(id).toBe(WORM_SOUNDS.slither.id);
    // Head 22 is nearer the listener at the origin
    expect(at.z).toBe(10);
    expect(at.y).toBeCloseTo(112 + WORM_SOUNDS.voice.liftM - ORIGIN_HEIGHT);

    presenter.present(packet({ gameTimeMs: 100, enemies, worms: [] }));
    expect(audio.stopLoop).toHaveBeenCalledTimes(1);
    expect(presenter.wormSounds.size).toBe(0);
  });
});
