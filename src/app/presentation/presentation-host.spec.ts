import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vector3 } from 'three';

// The services have specs of their own; here only what the host wires
vi.mock('../game-engine/vfx.service', () => ({
  VFXService: class {
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/audio.service', () => ({
  AudioService: class {
    setGround = vi.fn();
    update = vi.fn();
    clearAbilitySounds = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/game-sounds.service', () => ({
  GameSoundsService: class {
    setGameSpeedSource = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/screen-shake.service', () => ({ ScreenShakeService: class { destroy = vi.fn(); } }));
vi.mock('../game-engine/background-music.service', () => ({
  BackgroundMusicService: class {
    setGameSpeedSource = vi.fn();
    followPhase = vi.fn();
    setDimmed = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../game-engine/blood-moon.service', () => ({
  BloodMoonService: class {
    follow = vi.fn();
    destroy = vi.fn();
  },
}));

import { PresentationHost, type PresentationSource } from './presentation-host';
import { createMainEventBus, type MainEventBus } from '../sim/client/view-events';
import { EnemyView } from '../sim/client/views';
import { getEnemyType } from '../configs/enemy-types.config';
import type { Tower } from '../entities/tower.entity';
import type { SimScalars } from '../sim/protocol/packet';
import type { ThreeTilesEngine } from '../three-engine';
import { TOWER_TYPES } from '../configs/tower-types.config';

function makeEngine() {
  let handles = 0;
  let footstep: ((id: string) => void) | null = null;
  const engine = {
    sync: {
      getOrigin: () => ({ lat: 0, lon: 0, height: 0 }),
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat),
      geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon, height, lat),
    },
    effects: { setScorchGround: vi.fn(), clear: vi.fn(), stopAllFires: vi.fn(), spawnFloatingText: vi.fn(), stopAllTowerFires: vi.fn() },
    hero: { setGround: vi.fn(), present: vi.fn() },
    orbitalBeams: { setGround: vi.fn(), clear: vi.fn() },
    abilityMarkers: { clear: vi.fn() },
    missileLaunches: { clear: vi.fn() },
    mushroomClouds: { clear: vi.fn() },
    frostBursts: { clear: vi.fn() },
    empPulses: { clear: vi.fn() },
    bloodMoon: {},
    enemies: {
      setFootstepListener: vi.fn((listener: ((id: string) => void) | null) => { footstep = listener; }),
      clear: vi.fn(),
      create: vi.fn((id: string) => Promise.resolve(id === 'enemy-404' ? null : {})),
      startWalkAnimation: vi.fn(),
    },
    towers: { create: vi.fn(), clear: vi.fn(), get: vi.fn(() => ({ lat: 1, lon: 2, height: 3, tipY: 12 })) },
    projectiles: { clear: vi.fn() },
    trailStreaks: { clear: vi.fn() },
    tentacles: { clear: vi.fn() },
    plinths: { clear: vi.fn() },
    towerBadges: { clear: vi.fn() },
    searchlights: { add: vi.fn(), clear: vi.fn() },
    lightningBolts: { registerIdleCrackle: vi.fn() },
    oozes: { add: vi.fn(), remove: vi.fn(), discard: vi.fn(), clear: vi.fn(), setFrame: vi.fn(), collapse: vi.fn() },
    flameBeams: { startBeam: vi.fn(), stopBeam: vi.fn(), clear: vi.fn() },
    getTerrainHeightAtGeo: vi.fn(() => 0),
    spatialAudio: {
      registerSound: vi.fn(),
      createLoop: vi.fn(() => Promise.resolve(++handles)),
      updateLoopPosition: vi.fn(() => true),
      stopLoop: vi.fn(),
      stopOneShots: vi.fn(),
      holdLoops: vi.fn(),
      playAt: vi.fn(() => Promise.resolve(null)),
      playAtGeo: vi.fn(() => Promise.resolve(null)),
      getListener: () => ({ getWorldPosition: (v: Vector3) => v.set(0, 0, 0) }),
    },
  };
  return { engine, footstep: (id: string) => footstep?.(id) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PresentationHost', () => {
  let bus: MainEventBus;
  let enemies: Map<string, EnemyView>;
  let towers: Map<string, Tower>;
  let engine: ReturnType<typeof makeEngine>['engine'];
  let footstep: (id: string) => void;
  let host: PresentationHost;

  beforeEach(() => {
    bus = createMainEventBus();
    enemies = new Map();
    towers = new Map();
    ({ engine, footstep } = makeEngine());
    const source: PresentationSource = {
      enemy: (id) => enemies.get(id) ?? null,
      tower: (id) => towers.get(id) ?? null,
      scalars: { players: ['p1'], localPlayerId: 'p1', mannedTowers: [null] } as unknown as SimScalars,
    };
    const ground = { getGroundLocalYAt: () => 5, getCellAt: () => undefined };
    host = new PresentationHost({ engine: engine as unknown as ThreeTilesEngine, bus, source, ground });
  });

  it('puts the route grid under the scorch marks, the hero and the beam, and registers the combat sounds', () => {
    expect(engine.effects.setScorchGround).toHaveBeenCalled();
    expect(engine.hero.setGround).toHaveBeenCalled();
    expect(engine.orbitalBeams.setGround).toHaveBeenCalled();
    const ids = engine.spatialAudio.registerSound.mock.calls.map((c) => (c as unknown[])[0]);
    expect(ids).toEqual(expect.arrayContaining(['tower-placed', 'flame-loop', 'tentacle-grab', 'lightning-chain', 'rocket']));
  });

  it('hands the tower renderer the shadow tower\'s live aim', () => {
    const aim = { current: 1, pitch: 0.2 };
    towers.set('tower-4', { aim } as unknown as Tower);
    host.applyOps([['towers.create', 'tower-4', 'archer', 1, 2, 3, 0, { current: 0, pitch: 0 }]]);
    expect(engine.towers.create.mock.calls[0][6]).toBe(aim);
  });

  it('builds an ooze\'s stations from its path and adds it with the grid\'s ground', () => {
    host.applyOps([['oozes.add', 'enemy-9', [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }]]]);
    const [id, stations, groundAt] = engine.oozes.add.mock.calls[0] as unknown as [string, { count: number }, (x: number, z: number) => number];
    expect(id).toBe('enemy-9');
    expect(stations.count).toBeGreaterThan(1);
    expect(groundAt(0, 0)).toBe(5);
    host.applyOps([['oozes.remove', 'enemy-9']]);
    expect(engine.oozes.remove).toHaveBeenCalledWith('enemy-9');
  });

  it('runs the flame loop with the beam ops', async () => {
    host.applyOps([['flameBeams.startBeam', 'tower-2', { x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, 10, 2]]);
    await settle();
    host.applyOps([['flameBeams.startBeam', 'tower-2', { x: 1, y: 2, z: 4 }, { x: 4, y: 5, z: 6 }, 10, 2]]);
    expect(engine.flameBeams.startBeam).toHaveBeenCalledTimes(2);
    expect(engine.spatialAudio.createLoop).toHaveBeenCalledTimes(1);
    expect((engine.spatialAudio.createLoop.mock.calls[0] as unknown[])[0]).toBe('flame-loop');
    expect(engine.spatialAudio.updateLoopPosition).toHaveBeenCalledTimes(1);
    host.applyOps([['flameBeams.stopBeam', 'tower-2']]);
    expect(engine.spatialAudio.stopLoop).toHaveBeenCalledWith(1);
    expect(host.flames.size).toBe(0);
  });

  it('starts a new enemy instance on its walk clip once its model is there, unless it stands', async () => {
    host.applyOps([
      ['enemies.create', 'enemy-1', 'zombie', 1, 2, 3, true],
      ['enemies.create', 'enemy-2', 'zombie', 1, 2, 3, false],
      ['enemies.create', 'enemy-404', 'zombie', 1, 2, 3, true],
    ]);
    expect(engine.enemies.create.mock.calls[0]).toEqual(['enemy-1', 'zombie', 1, 2, 3]);
    await settle();
    expect(engine.enemies.startWalkAnimation.mock.calls).toEqual([['enemy-1']]);
  });

  it('gives the searchlight its tower config and the idle crackle the wall clock', () => {
    host.applyOps([
      ['searchlights.add', 'tower-6', 1, 2, 3, 'archer'],
      ['lightningBolts.registerIdleCrackle', 'tower-7', { x: 1, y: 2, z: 3 }],
    ]);
    expect(engine.searchlights.add.mock.calls[0][4]).toBe(TOWER_TYPES.archer);
    const [, tip, now] = engine.lightningBolts.registerIdleCrackle.mock.calls[0] as unknown as [string, Vector3, number];
    expect(tip).toBeInstanceOf(Vector3);
    expect(now).toBeGreaterThan(0);
  });

  it('starts a chain lightning at the tower model\'s tip and sounds it there', () => {
    const chains: { points: readonly { x: number; y: number; z: number }[]; sourceTowerId: string }[] = [];
    bus.on('vfx:chain-lightning', (event) => chains.push(event));
    host.applyOps([['main.chainLightning', 'tower-3', [{ x: 5, y: 6, z: 7 }]]]);
    expect(engine.towers.get).toHaveBeenCalledWith('tower-3');
    expect(chains[0].sourceTowerId).toBe('tower-3');
    expect(chains[0].points.map((p) => [p.x, p.y, p.z])).toEqual([[2, 12, 1], [5, 6, 7]]);
    const [id, at] = engine.spatialAudio.playAt.mock.calls[0] as unknown as [string, Vector3];
    expect(id).toBe('lightning-chain');
    expect(at.toArray()).toEqual([2, 12, 1]);
  });

  it('collapses a killed ooze with nothing left and splats it where it is heard', () => {
    host.applyOps([
      ['oozes.add', 'enemy-9', [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }]],
      ['oozes.collapse', 'enemy-9', 10, 30],
    ]);
    expect(engine.oozes.setFrame).toHaveBeenCalledWith('enemy-9', 10, 30, 0, false, false, false, false, false);
    expect(engine.oozes.collapse).toHaveBeenCalledWith('enemy-9');
    expect(engine.spatialAudio.playAtGeo).toHaveBeenCalledTimes(1);
  });

  it('turns the renderer\'s footsteps into enemy:footstep with the view on the main bus', () => {
    const view = new EnemyView('enemy-3', 3, getEnemyType('zombie'));
    enemies.set('enemy-3', view);
    const heard: EnemyView[] = [];
    bus.on('enemy:footstep', ({ enemy }) => heard.push(enemy));
    footstep('enemy-3');
    view.alive = false;
    footstep('enemy-3');
    footstep('enemy-404');
    expect(heard).toEqual([view]);
  });

  it('runs the ability sounds in the frame\'s game time and takes the show off the field', () => {
    host.advance(16);
    expect(host.audio.update).toHaveBeenCalledWith(16);
    host.clearShow();
    expect(engine.effects.clear).toHaveBeenCalled();
    expect(engine.abilityMarkers.clear).toHaveBeenCalled();
    expect(host.audio.clearAbilitySounds).toHaveBeenCalled();
    expect(engine.spatialAudio.stopOneShots).toHaveBeenCalled();
  });

  it('follows the phase with music and blood moon on resync, and holds the loops in a pause', () => {
    host.resync('wave', 14, 500);
    expect(host.backgroundMusic.followPhase).toHaveBeenCalledWith('wave', 14);
    expect(host.bloodMoon.follow).toHaveBeenCalledWith('wave', 14);
    host.setPaused(true, false);
    expect(engine.spatialAudio.holdLoops).toHaveBeenLastCalledWith(true);
    expect(host.backgroundMusic.setDimmed).toHaveBeenLastCalledWith(true);
    host.setPaused(true, true);
    expect(engine.spatialAudio.holdLoops).toHaveBeenLastCalledWith(false);
  });

  it('takes the whole run off the field on clear: renderers, loops and show', () => {
    host.clear();
    for (const renderer of ['enemies', 'oozes', 'projectiles', 'trailStreaks', 'flameBeams', 'tentacles', 'plinths', 'towerBadges', 'searchlights', 'towers'] as const) {
      expect((engine[renderer] as unknown as { clear: ReturnType<typeof vi.fn> }).clear).toHaveBeenCalled();
    }
    expect(engine.effects.stopAllTowerFires).toHaveBeenCalled();
    expect(engine.effects.clear).toHaveBeenCalled();
    expect(engine.spatialAudio.stopOneShots).toHaveBeenCalled();
  });

  it('lets go of the bus and the footsteps on destroy', () => {
    host.destroy();
    expect(bus.getListenerCount('enemy:died')).toBe(0);
    expect(engine.enemies.setFootstepListener).toHaveBeenLastCalledWith(null);
  });
});
