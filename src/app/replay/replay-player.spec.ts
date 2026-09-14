import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from '../game-engine/game-event-bus';
import { TIMING } from '../configs/timing.config';
import { OOZE_LOOK, STUN_SPARKS } from '../configs/visual-effects.config';
import { GameClock } from '../managers/game-state/game-clock';
import { ABILITY_IMPACT_SOUNDS } from '../configs/audio.config';
import type { HeroPresentation } from '../managers/hero.manager';
import type { RouteBodyStations } from '../utils/route-body';
import { ENEMY_END, ENEMY_FLAG, ReplayRecording, TOWER_FLAG, heroPoseCode } from './replay-recording';
import { ReplayPlayer, lerpAngle } from './replay-player';

type Spy = ReturnType<typeof vi.fn>;

/** Wall time the player advances at most per frame, see ReplayPlayer.update */
const FRAME_MS = GameClock.MAX_CATCHUP_MS;

/** Play `ms` of wall time in frames of at most FRAME_MS, as the render loop hands them. */
function advance(p: ReplayPlayer, ms: number): void {
  for (let left = ms; left > 0; left -= FRAME_MS) p.update(Math.min(FRAME_MS, left));
}

function towerData(rotation: number) {
  return {
    currentLocalRotation: rotation,
    targetLocalRotation: 0.3,
    hasTarget: false,
    scanPhase: 2,
    scanStartRotation: 0.1,
    scanDelayRemaining: 5,
    turretPart: { rotation: { y: rotation } },
    mesh: { visible: true },
  };
}

/** Renderers that remember what they were told; unknown methods are spies. */
function fakeEngine() {
  const auto = () => new Proxy({} as Record<string, Spy>, { get: (target, prop: string) => (target[prop] ??= vi.fn()) });
  const slots = new Map<string, { released: boolean }>();
  // The player hands its scratch vectors to the renderers, which copy them; so do these
  const lastX = new Map<object, number>();
  const strikes: [string, Vector3][] = [];
  const beams: [string, Vector3, number][] = [];
  const tentacles = auto();
  tentacles['startStrike'] = vi.fn((id: string, target: Vector3) => strikes.push([id, target.clone()]));
  const flameBeams = auto();
  flameBeams['startBeam'] = vi.fn((id: string, _source: Vector3, target: Vector3, _length: number, width: number) =>
    beams.push([id, target.clone(), width]));
  const towers = new Map<string, ReturnType<typeof towerData>>([
    ['archer-1', towerData(0.2)],
    ['late-1', towerData(0.2)],
    ['fire-1', towerData(0.2)],
    // Built after the wave ended, before the replay
    ['after-1', towerData(0.2)],
  ]);
  const engine = {
    sync: {
      getOrigin: () => ({ lat: 48, lon: 9, height: 200 }),
      geoToLocalSimple: (_lat: number, _lon: number, height: number) => new Vector3(0, height - 200, 0),
      geoToLocalSimpleInto: (_lat: number, _lon: number, height: number, target: Vector3) => target.set(0, height - 200, 0),
    },
    enemies: {
      create: vi.fn(async (id: string) => {
        slots.set(id, { released: false });
        return null;
      }),
      resolveSlot: vi.fn((id: string) => slots.get(id) ?? null),
      updateSlot: vi.fn((slot: object, pos: Vector3) => lastX.set(slot, pos.x)),
      remove: vi.fn((id: string) => {
        const slot = slots.get(id);
        if (slot) slot.released = true;
        slots.delete(id);
      }),
      startWalkAnimation: vi.fn(),
      startRunAnimation: vi.fn(),
      playDeathAnimation: vi.fn(),
      setFreezeVisual: vi.fn(),
      setPoisonVisual: vi.fn(),
      setBurnVisual: vi.fn(),
      setIcedVisual: vi.fn(),
      setStunVisual: vi.fn(),
    },
    towers: {
      get: (id: string) => towers.get(id),
      create: vi.fn(async (id: string) => {
        towers.set(id, towerData(0));
        return null;
      }),
      remove: vi.fn((id: string) => towers.delete(id)),
      getAllMeshes: () => [...towers].map(([id, data]) => ({ id, mesh: data.mesh })),
    },
    effects: auto(),
    projectiles: auto(),
    trailStreaks: auto(),
    plinths: auto(),
    searchlights: auto(),
    tentacles,
    flameBeams,
    abilityMarkers: auto(),
    mushroomClouds: auto(),
    frostBursts: auto(),
    empPulses: auto(),
    orbitalBeams: auto(),
    oozes: auto(),
    hero: auto(),
    bloodMoon: { isActive: false, setActive: vi.fn() },
    spatialAudio: auto(),
    lightningBolts: auto(),
    setTimescale: vi.fn(),
    getCamera: () => ({ position: new Vector3() }),
    triggerScreenShake: vi.fn(),
  };
  return { engine, slots, towers, lastX, strikes, beams };
}

/**
 * Wave 5, 2.4 s: a zombie walks and dies at 250 ms, a rat leaks at 150, an
 * arrow flies until it hits at 150. The archer stood before the wave and
 * turns, late-1 is placed at 150, the tentacle tower sold-1 strikes and is
 * sold at 200, the fire tower burns in frame 1.
 */
function waveRecording(): ReplayRecording {
  const rec = new ReplayRecording();
  rec.reset(5, 0, 100, 0, null);
  const zombie = rec.addEnemy('zombie', 0);
  const rat = rec.addEnemy('rat', 0);
  rec.endEnemy(zombie, 250, ENEMY_END.DIED);
  rec.endEnemy(rat, 150, ENEMY_END.LEAKED);
  const arrow = rec.addProjectile('arrow');
  rec.endProjectile(arrow, 150, 30, 0, 0);
  const tower = { lat: 48, lon: 9, height: 200, customRotation: 0, plinthHeight: 0, placedMs: -1, soldMs: Infinity };
  rec.addTower({ ...tower, id: 'archer-1', typeId: 'archer' });
  rec.addTower({ ...tower, id: 'late-1', typeId: 'archer', placedMs: 150 });
  rec.addTower({ ...tower, id: 'sold-1', typeId: 'tentacle', plinthHeight: 2, soldMs: 200 });
  rec.addTower({ ...tower, id: 'fire-1', typeId: 'fire' });

  // Frame 0
  rec.beginFrame(0);
  rec.pushEnemy(zombie, 0, 0, 0, 0, 1, 1, 0);
  rec.pushEnemy(rat, 0, 0, 0, 0, 1, 1, 0);
  rec.pushProjectile(arrow, 0, 0, 0);
  rec.pushTower(0, 0, 0, 0, 0, 0, 0);
  rec.endFrame();
  // Frame 1
  rec.beginFrame(100);
  rec.pushEnemy(zombie, 10, 0, 0, 0, 1, 0.5, ENEMY_FLAG.SLOWED);
  rec.pushEnemy(rat, 20, 0, 0, 0, 1, 1, 0);
  rec.pushProjectile(arrow, 20, 0, 0);
  rec.pushTower(0, 1, 0, 0, 0, 0, 0);
  rec.pushTower(2, 0, TOWER_FLAG.STRIKE, 1, 2, 3, 0);
  rec.pushTower(3, 0, TOWER_FLAG.BEAM, 4, 5, 6, 8);
  rec.endFrame();
  // Frame 2
  rec.beginFrame(200);
  rec.pushEnemy(zombie, 20, 0, 0, 0, 1, 0.25, ENEMY_FLAG.SLOWED);
  rec.pushTower(0, 2, 0, 0, 0, 0, 0);
  rec.pushTower(1, 0.5, 0, 0, 0, 0, 0);
  rec.endFrame();
  // Frames 3 and 4, the dead zombie lies until its death animation is over
  rec.beginFrame(300);
  rec.pushTower(0, 2, 0, 0, 0, 0, 0);
  rec.endFrame();
  rec.beginFrame(2400);
  rec.endFrame();

  rec.pushEvent(50, { type: 'vfx:muzzle-flash', towerId: 'sold-1', towerTypeId: 'tentacle' });
  rec.pushEvent(60, { type: 'audio:play', sound: 'arrow', lat: 48, lon: 9, height: 200 });
  rec.pushEvent(120, { type: 'audio:play', sound: 'arrow', lat: 48, lon: 9, height: 200 });
  rec.finish(2400, 'completed');
  return rec;
}

/**
 * Wave 14, a blood moon, 1.1 s: an ooze stretches from 0-10 m to 10-30 m
 * along its route and dies at 150, a zombie is frozen and stunned from 100
 * to 1000, the hero is on the map in frames 1 and 2, a frost bomb lands at 120.
 */
function newcomersRecording(): ReplayRecording {
  const rec = new ReplayRecording();
  rec.reset(14, 0, 100, 0, null);
  rec.bloodMoon = true;
  const ooze = rec.addEnemy('ooze', 0);
  const zombie = rec.addEnemy('zombie', 0);
  rec.endEnemy(ooze, 150, ENEMY_END.DIED);
  const stations = {} as RouteBodyStations;
  const halted = ENEMY_FLAG.FROZEN | ENEMY_FLAG.STUNNED;

  rec.beginFrame(0);
  rec.pushEnemy(ooze, 10, 0, 0, 0, 1, 1, 0);
  rec.pushBody(ooze, stations, 0, 10);
  rec.pushEnemy(zombie, 0, 0, 0, 0, 1, 1, 0);
  rec.endFrame();
  rec.beginFrame(100);
  rec.pushEnemy(ooze, 30, 0, 0, 0, 1, 0.5, ENEMY_FLAG.FROZEN);
  rec.pushBody(ooze, stations, 10, 30);
  rec.pushEnemy(zombie, 0, 0, 0, 0, 1, 1, halted);
  rec.pushHero(10, 0, 1, heroPoseCode('run'));
  rec.endFrame();
  rec.beginFrame(200);
  rec.pushEnemy(zombie, 0, 0, 0, 0, 1, 1, halted);
  rec.pushHero(20, 0, 2, heroPoseCode('shoot'));
  rec.endFrame();
  rec.beginFrame(1000);
  rec.pushEnemy(zombie, 0, 0, 0, 0, 1, 1, 0);
  rec.endFrame();
  rec.beginFrame(1100);
  rec.endFrame();

  rec.pushEvent(120, { type: 'ability:impact', abilityId: 'frost-bomb', strikeId: 1, target: { lat: 48, lon: 9 }, radiusM: 10 });
  rec.finish(1100, 'completed');
  return rec;
}

describe('ReplayPlayer', () => {
  let fake: ReturnType<typeof fakeEngine>;
  let player: ReplayPlayer;
  let emitted: { type: string; towerId?: string }[];

  beforeEach(() => {
    fake = fakeEngine();
    emitted = [];
    // Everything the player puts on its own bus
    vi.spyOn(GameEventBus.prototype, 'emit').mockImplementation(function (this: GameEventBus, event) {
      emitted.push(event as { type: string });
    });
    player = new ReplayPlayer(waveRecording(), fake.engine as never);
    player.enter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Last position the renderer got for a replay enemy. */
  function enemyX(index: number): number {
    const slot = fake.slots.get(`replay-enemy-${index}`);
    return slot ? fake.lastX.get(slot) ?? NaN : NaN;
  }

  describe('enter', () => {
    it('holds the ground marks and plays from the start', () => {
      expect(fake.engine.effects['holdGroundMarks']).toHaveBeenCalledWith(true);
      expect(player.isPlaying).toBe(true);
      expect(player.currentMs).toBe(0);
      expect(player.durationMs).toBe(2400);
    });

    it('shows the enemies of the first frame under replay ids', () => {
      expect(fake.engine.enemies.create.mock.calls.map((c) => c.slice(0, 2))).toEqual([
        ['replay-enemy-0', 'zombie'],
        ['replay-enemy-1', 'rat'],
      ]);
      expect(fake.engine.enemies.startWalkAnimation).toHaveBeenCalledWith('replay-enemy-0');
      expect(player.enemiesAlive).toBe(2);
    });

    it('hides a tower built after the wave for the whole replay', () => {
      expect(fake.towers.get('after-1')!.mesh.visible).toBe(false);
      expect(fake.engine.plinths['setVisible']).toHaveBeenCalledWith('after-1', false);
      advance(player, 150);
      expect(fake.towers.get('after-1')!.mesh.visible).toBe(false);
    });

    it('hides a tower placed later and builds one sold during the wave', () => {
      expect(fake.towers.get('late-1')!.mesh.visible).toBe(false);
      expect(fake.engine.towers.create).toHaveBeenCalledWith('replay-tower-2', 'tentacle', 48, 9, 200, 0, null);
      expect(fake.engine.plinths['create']).toHaveBeenCalledWith('replay-tower-2', 48, 9, 200, 2, expect.any(Number));
      expect(fake.engine.tentacles['create']).toHaveBeenCalledWith('replay-tower-2', expect.any(Vector3));
    });
  });

  describe('playback', () => {
    it('interpolates between frames at the chosen speed', () => {
      player.update(50);
      expect(player.currentMs).toBe(50);
      expect(enemyX(0)).toBeCloseTo(5);
      player.setSpeed(0.5);
      advance(player, 100);
      expect(player.currentMs).toBe(100);
      expect(enemyX(0)).toBeCloseTo(10);
      expect(fake.engine.setTimescale).toHaveBeenLastCalledWith(0.5);
    });

    it('advances at most as much wall time per frame as the game clock does', () => {
      player.update(1000);
      expect(player.currentMs).toBe(FRAME_MS);
      player.setSpeed(4);
      player.update(1000);
      expect(player.currentMs).toBe(FRAME_MS * 5);
    });

    it('switches tints and auras where the status changes', () => {
      advance(player, 100);
      expect(fake.engine.enemies.setFreezeVisual).toHaveBeenCalledWith('replay-enemy-0', true);
      expect(fake.engine.effects['spawnFrostAura']).toHaveBeenCalledWith('replay-enemy-0', expect.any(Vector3));
      player.update(50);
      expect(fake.engine.effects['updateFrostAuraPosition']).toHaveBeenCalled();
    });

    it('takes a leaked enemy away when it reached the HQ', () => {
      advance(player, 140);
      expect(fake.engine.enemies.remove).not.toHaveBeenCalledWith('replay-enemy-1');
      player.update(20);
      expect(fake.engine.enemies.remove).toHaveBeenCalledWith('replay-enemy-1');
      expect(player.enemiesAlive).toBe(1);
    });

    it('plays the death animation where the enemy died and removes it after it', () => {
      advance(player, 150);
      player.seek(260);
      expect(fake.engine.enemies.playDeathAnimation).toHaveBeenCalledWith('replay-enemy-0');
      expect(fake.engine.effects['stopFrostAura']).toHaveBeenCalledWith('replay-enemy-0');
      expect(fake.slots.has('replay-enemy-0')).toBe(true);
      player.seek(250 + TIMING.deathAnimationDuration + 10);
      expect(fake.slots.has('replay-enemy-0')).toBe(false);
    });

    it('brings a dead enemy back alive when scrubbed to before its death', () => {
      player.seek(260);
      const created = fake.engine.enemies.create.mock.calls.length;
      player.seek(150);
      expect(fake.engine.enemies.remove).toHaveBeenCalledWith('replay-enemy-0');
      expect(fake.engine.enemies.create.mock.calls.length).toBe(created + 1);
      expect(fake.engine.enemies.playDeathAnimation).toHaveBeenCalledTimes(1);
      expect(enemyX(0)).toBeCloseTo(15);
    });

    it('stops at the end and plays again from the start', () => {
      advance(player, 5000);
      expect(player.currentMs).toBe(2400);
      expect(player.isPlaying).toBe(false);
      expect(fake.engine.setTimescale).toHaveBeenLastCalledWith(0);
      player.play();
      expect(player.currentMs).toBe(0);
      expect(player.isPlaying).toBe(true);
    });

    it('reads the HQ health of the moment', () => {
      const rec = waveRecording();
      rec.pushHealth(150, 90);
      const p = new ReplayPlayer(rec, fake.engine as never);
      p.enter();
      expect(p.baseHealth).toBe(100);
      p.seek(200);
      expect(p.baseHealth).toBe(90);
    });
  });

  describe('projectiles', () => {
    it('flies towards the next sample, then towards where it hit, and goes', () => {
      const projectiles = fake.engine.projectiles as Record<string, Spy>;
      expect(projectiles['create']).toHaveBeenCalledWith('replay-projectile-0', 'arrow', expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Object));
      advance(player, 125);
      const [, lat, lon] = projectiles['updateWithRotation'].mock.calls.at(-1)!;
      // Local x 25 m between the sample at 20 and the hit at 30; x points west
      const metersPerDegreeLon = 111_320 * Math.cos(48 * Math.PI / 180);
      expect(lat).toBeCloseTo(48, 6);
      expect((9 - (lon as number)) * metersPerDegreeLon).toBeCloseTo(25, 0);
      player.update(30);
      expect(projectiles['remove']).toHaveBeenCalledWith('replay-projectile-0');
      expect(fake.engine.trailStreaks['remove']).toHaveBeenCalledWith('replay-projectile-0');
    });

    it('lays trails while playing, not on a jump', () => {
      const push = fake.engine.trailStreaks['pushPosition'];
      expect(push).not.toHaveBeenCalled();
      player.update(20);
      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  describe('towers', () => {
    it('turns the turrets to the recorded rotation, interpolated', () => {
      advance(player, 150);
      expect(fake.towers.get('archer-1')!.currentLocalRotation).toBeCloseTo(1.5);
      expect(fake.towers.get('archer-1')!.turretPart.rotation.y).toBeCloseTo(1.5);
    });

    it('turns the aim of a tower without a turret part as well, for its searchlight', () => {
      const archer = fake.towers.get('archer-1')! as { turretPart: unknown; currentLocalRotation: number };
      archer.turretPart = null;
      advance(player, 150);
      expect(archer.currentLocalRotation).toBeCloseTo(1.5);
    });

    it('shows a tower from its placement and a sold one until it was sold', () => {
      advance(player, 150);
      expect(fake.towers.get('late-1')!.mesh.visible).toBe(true);
      expect(fake.towers.get('replay-tower-2')!.mesh.visible).toBe(true);
      advance(player, 60);
      expect(fake.towers.get('replay-tower-2')!.mesh.visible).toBe(false);
      expect(fake.engine.plinths['setVisible']).toHaveBeenCalledWith('replay-tower-2', false);
    });

    it('strikes once per strike and burns while the beam is on', () => {
      advance(player, 100);
      player.update(20);
      expect(fake.strikes).toEqual([['replay-tower-2', new Vector3(1, 2, 3)]]);
      expect(fake.beams[0]).toEqual(['fire-1', new Vector3(4, 5, 6), 8]);
      player.pause();
      expect(fake.engine.flameBeams['stopBeam']).toHaveBeenCalledWith('fire-1');
    });

    it('hides a tower\'s blood moon searchlight with the tower and gives it back on exit', () => {
      const lights = fake.engine.searchlights as Record<string, Spy>;
      expect(lights['setVisible']).toHaveBeenCalledWith('after-1', false);
      expect(lights['setVisible']).toHaveBeenCalledWith('late-1', false);
      // A tower sold during the wave gets a light of its own, turned with its recorded aim
      expect(lights['add']).toHaveBeenCalledWith('replay-tower-2', 48, 9, 200, expect.any(Object));
      advance(player, 150);
      expect(lights['setVisible']).toHaveBeenCalledWith('late-1', true);
      player.exit();
      expect(lights['setVisible']).toHaveBeenCalledWith('after-1', true);
      expect(lights['remove']).toHaveBeenCalledWith('replay-tower-2');
    });
  });

  describe('events', () => {
    it('plays the events it passes, a sold tower\'s flash on its replay model', () => {
      advance(player, 70);
      expect(emitted.map((e) => e.type)).toEqual(['vfx:muzzle-flash', 'audio:play']);
      expect(emitted[0].towerId).toBe('replay-tower-2');
    });

    it('plays nothing it jumps over and no sounds above 1x', () => {
      player.seek(100);
      expect(emitted).toEqual([]);
      player.setSpeed(2);
      player.update(20);
      expect(emitted).toEqual([]);
    });
  });

  describe('exit', () => {
    it('gives the live towers back as they were and removes everything of its own', () => {
      advance(player, 150);
      player.exit();
      const archer = fake.towers.get('archer-1')!;
      expect(archer.currentLocalRotation).toBe(0.2);
      expect(archer.turretPart.rotation.y).toBe(0.2);
      expect(archer.scanPhase).toBe(2);
      expect(archer.scanDelayRemaining).toBe(5);
      expect(fake.towers.get('late-1')!.mesh.visible).toBe(true);
      expect(fake.towers.get('after-1')!.mesh.visible).toBe(true);
      expect(fake.engine.towers.remove).toHaveBeenCalledWith('replay-tower-2');
      expect(fake.engine.plinths['remove']).toHaveBeenCalledWith('replay-tower-2');
      expect(fake.engine.tentacles['remove']).toHaveBeenCalledWith('replay-tower-2');
      expect(fake.slots.size).toBe(0);
      expect(fake.engine.effects['holdGroundMarks']).toHaveBeenLastCalledWith(false);
      expect(player.isPlaying).toBe(false);
    });

    it('puts a live tentacle back where its strike stood, and no other', () => {
      const f = fakeEngine();
      const strike = { state: 'striking', target: new Vector3(1, 1, 1), progress: 0.4 };
      f.engine.tentacles['captureStrike'].mockImplementation((id: string) => (id === 'archer-1' ? strike : null));
      const p = new ReplayPlayer(waveRecording(), f.engine as never);
      p.enter();
      advance(p, 150);
      p.exit();
      expect(f.engine.tentacles['restoreStrike'].mock.calls).toEqual([['archer-1', strike]]);
      expect(f.engine.tentacles['resetAllToIdle']).not.toHaveBeenCalled();
    });
  });

  describe('oozes, freeze and stun, the hero, the blood moon', () => {
    let p: ReplayPlayer;
    const ground = () => 0;

    beforeEach(() => {
      fake = fakeEngine();
      p = new ReplayPlayer(newcomersRecording(), fake.engine as never, { ground });
      p.enter();
    });

    it('lays an ooze\'s band along its route instead of an instance, stretched between frames', () => {
      const oozes = fake.engine.oozes as Record<string, Spy>;
      expect(oozes['add']).toHaveBeenCalledWith('replay-enemy-0', expect.any(Object), ground);
      expect(fake.engine.enemies.create.mock.calls.map((c) => c[0])).toEqual(['replay-enemy-1']);
      p.update(50);
      expect(oozes['setFrame']).toHaveBeenLastCalledWith('replay-enemy-0', 5, 20, 1, false, false, false, false, false);
      expect(p.enemiesAlive).toBe(2);
    });

    it('sinks the band of a killed ooze, then drops it; scrubbed back it lies again', () => {
      const oozes = fake.engine.oozes as Record<string, Spy>;
      advance(p, 160);
      expect(oozes['remove']).toHaveBeenCalledWith('replay-enemy-0');
      expect(oozes['discard']).not.toHaveBeenCalled();
      advance(p, OOZE_LOOK.dissolve * 1000);
      expect(oozes['discard']).toHaveBeenCalledWith('replay-enemy-0');
      p.seek(50);
      expect(oozes['add']).toHaveBeenCalledTimes(2);
    });

    it('lays no band without a ground', () => {
      const f = fakeEngine();
      new ReplayPlayer(newcomersRecording(), f.engine as never).enter();
      expect((f.engine.oozes as Record<string, Spy>)['add']).not.toHaveBeenCalled();
    });

    it('freezes and stuns: tint, ice crystals, sparks at the live pace', () => {
      const { enemies, effects } = fake.engine;
      advance(p, 100);
      expect(enemies.setIcedVisual).toHaveBeenCalledWith('replay-enemy-1', true);
      expect(effects['spawnIceCrystals']).toHaveBeenCalledWith('replay-enemy-1', expect.any(Vector3));
      expect(enemies.setStunVisual).toHaveBeenCalledWith('replay-enemy-1', true);
      expect(effects['spawnBurstAtGeo']).toHaveBeenCalledTimes(1);
      advance(p, 100);
      expect(effects['updateIceCrystalsPosition']).toHaveBeenCalled();
      expect(effects['spawnBurstAtGeo']).toHaveBeenCalledTimes(1);
      advance(p, STUN_SPARKS.intervalMs);
      expect(effects['spawnBurstAtGeo']).toHaveBeenCalledTimes(2);
      // Frame 3, at 1000: thawed and awake
      advance(p, 400);
      expect(enemies.setIcedVisual).toHaveBeenLastCalledWith('replay-enemy-1', false);
      expect(effects['stopIceCrystals']).toHaveBeenCalledWith('replay-enemy-1');
      expect(enemies.setStunVisual).toHaveBeenLastCalledWith('replay-enemy-1', false);
    });

    it('shows the recorded hero, and none where he was not on the map', () => {
      const hero = fake.engine.hero as Record<string, Spy>;
      // Frame 0 has no hero: the live one goes
      expect(hero['clear']).toHaveBeenCalledTimes(1);
      expect(hero['present']).not.toHaveBeenCalled();
      advance(p, 150);
      const shown = hero['present'].mock.calls.at(-1)![0] as HeroPresentation;
      expect(shown.pose).toBe('run');
      expect(shown.heading).toBeCloseTo(1.5);
      // Local x 15 m between 10 and 20; x points west
      const metersPerDegreeLon = 111_320 * Math.cos(48 * Math.PI / 180);
      expect((9 - shown.lon) * metersPerDegreeLon).toBeCloseTo(15, 0);
      p.exit();
      expect(hero['clear']).toHaveBeenCalledTimes(2);
    });

    it('wears the recorded wave\'s blood moon look and gives the live one back', () => {
      expect(fake.engine.bloodMoon.setActive).toHaveBeenCalledWith(true, true);
      p.exit();
      expect(fake.engine.bloodMoon.setActive).toHaveBeenLastCalledWith(false, true);
    });

    it('clears the ability effects on exit once one landed', () => {
      advance(p, 130);
      expect(emitted.map((e) => e.type)).toContain('ability:impact');
      p.exit();
      for (const renderer of ['mushroomClouds', 'frostBursts', 'empPulses', 'orbitalBeams'] as const) {
        expect(fake.engine[renderer]['clear']).toHaveBeenCalled();
      }
    });
  });

  describe('sound above 1x', () => {
    const nuke = ABILITY_IMPACT_SOUNDS['nuclear-strike']!;
    const tailMs = Math.max(0, ...nuke.tail.map((repeat) => repeat.delayMs));
    const endMs = 50 + tailMs + 500;
    let playAtGeo: Spy;

    /** A nuclear strike lands at 50 ms; the recording runs past the end of its rumbling tail */
    function impactRecording(): ReplayRecording {
      const rec = new ReplayRecording();
      rec.reset(5, 0, 100, 0, null);
      rec.beginFrame(0);
      rec.endFrame();
      rec.beginFrame(endMs);
      rec.endFrame();
      rec.pushEvent(50, { type: 'ability:impact', abilityId: 'nuclear-strike', strikeId: 1, target: { lat: 48, lon: 9 }, radiusM: 10 });
      rec.finish(endMs, 'completed');
      return rec;
    }

    function entered(): ReplayPlayer {
      const p = new ReplayPlayer(impactRecording(), fake.engine as never);
      p.enter();
      return p;
    }

    beforeEach(() => {
      // The player's own services hear its buses for real here
      (GameEventBus.prototype.emit as unknown as { mockRestore(): void }).mockRestore();
      fake = fakeEngine();
      playAtGeo = vi.fn(() => Promise.resolve());
      fake.engine.spatialAudio['playAtGeo'] = playAtGeo;
    });

    it('plays an ability\'s impact sound and its tail at 1x', () => {
      expect(nuke.tail.length).toBeGreaterThan(0);
      advance(entered(), endMs);
      expect(playAtGeo).toHaveBeenCalledTimes(1 + nuke.tail.length);
    });

    it('plays neither the impact nor its tail above 1x', () => {
      const p = entered();
      p.setSpeed(2);
      advance(p, endMs);
      expect(playAtGeo).not.toHaveBeenCalled();
    });

    it('drops a tail still to come when the speed goes above 1x, and on a jump', () => {
      const p = entered();
      advance(p, 60);
      expect(playAtGeo).toHaveBeenCalledTimes(1);
      p.setSpeed(2);
      p.update(FRAME_MS);
      p.setSpeed(1);
      advance(p, endMs);
      expect(playAtGeo).toHaveBeenCalledTimes(1);

      p.seek(0);
      p.play();
      advance(p, 60);
      expect(playAtGeo).toHaveBeenCalledTimes(2);
      p.seek(endMs / 2);
      advance(p, endMs);
      expect(playAtGeo).toHaveBeenCalledTimes(2);
    });
  });

  describe('ability strikes and jumps', () => {
    let p: ReplayPlayer;

    /** 1 s: a frost bomb is marked at 20 ms and lands at 120 */
    function strikeRecording(): ReplayRecording {
      const rec = new ReplayRecording();
      rec.reset(5, 0, 100, 0, null);
      rec.beginFrame(0);
      rec.endFrame();
      rec.beginFrame(1000);
      rec.endFrame();
      const target = { lat: 48, lon: 9 };
      rec.pushEvent(20, { type: 'ability:used', abilityId: 'frost-bomb', strikeId: 7, target, radiusM: 10, warningMs: 100 });
      rec.pushEvent(120, { type: 'ability:impact', abilityId: 'frost-bomb', strikeId: 7, target, radiusM: 10 });
      rec.finish(1000, 'completed');
      return rec;
    }

    beforeEach(() => {
      fake = fakeEngine();
      p = new ReplayPlayer(strikeRecording(), fake.engine as never);
      p.enter();
    });

    it('takes a strike marker down when the jump skips its impact', () => {
      advance(p, 50);
      expect(fake.engine.abilityMarkers['removeStrike']).not.toHaveBeenCalled();
      p.seek(500);
      expect(fake.engine.abilityMarkers['removeStrike']).toHaveBeenCalledWith(7);
    });

    it('clears a landed strike\'s effects on a jump, so played again it lands once', () => {
      advance(p, 150);
      p.seek(50);
      for (const renderer of ['mushroomClouds', 'frostBursts', 'empPulses', 'orbitalBeams'] as const) {
        expect(fake.engine[renderer]['clear']).toHaveBeenCalled();
      }
    });
  });
});

describe('lerpAngle', () => {
  it('goes the short way round', () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(Math.cos(lerpAngle(3.1, -3.1, 0.5))).toBeCloseTo(-1, 3);
  });
});
