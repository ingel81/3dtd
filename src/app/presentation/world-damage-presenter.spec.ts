import { Vector3 } from 'three';
import { createMainEventBus } from '../sim/client/view-events';
import { WorldDamagePresenter, collapseClass } from './world-damage-presenter';
import { StampField, craterStampOf, rubbleStampOf, type ToLocal } from '../utils/stamp-field';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import type { RunStructure } from '../sim/protocol/run-rules';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';

const BARN: RunStructure = { id: 'barn', lat: 10 / M, lon: -20 / M, radius: 5, height: 6, hp: 100 };

function setup(destructible: boolean) {
  const destruction = { structures: vi.fn(() => []), setStages: vi.fn(), setStage: vi.fn() };
  const toLocal = (lat: number, lon: number, h: number, out: Vector3) => out.set(-lon * M, h, lat * M);
  const engine = {
    world: { capabilities: { destructible }, destruction, runRules: () => ({ structures: [BARN] }) },
    effects: { spawnExplosion: vi.fn(), spawnGroundDust: vi.fn(), spawnBurstAtGeo: vi.fn() },
    sync: {
      geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon * 1000, y: height, z: -lat * 1000 }),
      geoToLocalSimpleInto: toLocal,
    },
    getTerrainHeightAtGeo: vi.fn(() => 12),
  };
  const span = { minIx: -20, minIz: -20, maxIx: 20, maxIz: 20 };
  const ground = {
    field: null as StampField | null,
    cellSpan: () => span,
    setStampField: vi.fn((f: StampField | null) => (ground.field = f)),
    stampsChanged: vi.fn(),
    onCellsChanged: () => () => undefined,
  };
  const bus = createMainEventBus();
  const presenter = new WorldDamagePresenter(engine as never, bus, ground);
  const local: ToLocal = (lat, lon, out) => {
    out.x = -lon * M;
    out.z = lat * M;
  };
  return { destruction, engine, presenter, bus, ground, local, span };
}

describe('WorldDamagePresenter (docs/DESTRUCTION_PLAN.md)', () => {
  it("shows the simulation's stages and blows up a structure as it falls", () => {
    const { destruction, engine, presenter } = setup(true);
    presenter.setStages(new Uint8Array([1]), new Int16Array([40]));
    expect(destruction.setStages).toHaveBeenCalledWith(new Uint8Array([1]), new Int16Array([40]));
    // With the heading of the hit that brought the stage
    presenter.setStage(0, 2, 64);
    expect(destruction.setStage).toHaveBeenCalledWith(0, 2, 64);
    presenter.fell(0, 0.001, 0.002, 5, 6);
    // At the barn's middle: a small break where it breaks, a dust wall wider than the barn over the ground,
    // a column of dust up its height, grit of its class thrown up
    expect(engine.effects.spawnExplosion).toHaveBeenCalledWith(2, 12 + 6 * 0.4, -1, 9, 3.5, 8);
    expect(engine.effects.spawnGroundDust).toHaveBeenCalledWith(2, 12.3, -1, 43, 8, 6);
    expect(engine.effects.spawnGroundDust).toHaveBeenCalledTimes(4);
    expect(engine.effects.spawnBurstAtGeo).toHaveBeenCalledTimes(1);
    presenter.destroy();
  });

  it('keeps the field of rubble and craters the simulation keeps, for the sight probes, and none while the ground lies as built', () => {
    const { presenter, ground, local, span } = setup(true);
    presenter.setStages(new Uint8Array([0]));
    expect(ground.field).toBeNull();
    // The barn falls: its heap, as the simulation's StampField has it
    presenter.setStage(0, 3);
    const expected = new StampField(span);
    expected.rubbleHeap(rubbleStampOf(BARN, local), 1);
    expect(ground.field!.heightAt(20, 10)).toBe(expected.heightAt(20, 10));
    expect(ground.field!.heightAt(20, 10)).toBeGreaterThan(1);
    // A crater dug, then deepened: the field of the last one alone, not of both
    presenter.dig(0, 100, 100, 25, 30);
    presenter.dig(0, 100, 100, 25, 60);
    expected.crater(craterStampOf(100, 100, 25, 60, local), 1);
    for (const [x, z] of [[-10, 10], [-11, 11], [-12, 9], [20, 10]]) expect(ground.field!.heightAt(x, z)).toBe(expected.heightAt(x, z));
    expect(Array.from(presenter.craterList())).toEqual([100, 100, 25, 60]);
    // A restore to before: flat again
    presenter.setCraters(new Int32Array(0));
    presenter.setStages(new Uint8Array([0]));
    expect(ground.field).toBeNull();
    presenter.destroy();
  });

  it("hands every stamp to the world's drawn ground, and the towers that hold it", () => {
    const drawn = { crater: vi.fn(), rubble: vi.fn(), clear: vi.fn(), holdTower: vi.fn(), releaseTower: vi.fn(), debris: vi.fn() };
    const tower = { id: 't1', position: { lat: 2 / M, lon: 3 / M } };
    let listener: ((change: { kind: 'state' | 'removed'; tower: typeof tower }) => void) | null = null;
    const towers = { towers: () => [tower], onTowerChange: (l: typeof listener) => ((listener = l), () => undefined) };
    const engine = {
      world: { capabilities: { destructible: true }, destruction: { structures: () => [], setStages: vi.fn(), setStage: vi.fn(), ground: drawn }, runRules: () => ({ structures: [BARN] }) },
      effects: { spawnExplosion: vi.fn() },
      sync: { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }), geoToLocalSimpleInto: (_a: number, _b: number, _h: number, out: Vector3) => out.set(0, 0, 0) },
      getTerrainHeightAtGeo: () => 0,
    };
    const presenter = new WorldDamagePresenter(engine as never, createMainEventBus(), null, towers as never);
    presenter.setStages(new Uint8Array([0]));
    expect(drawn.clear).toHaveBeenCalledTimes(1);
    expect(drawn.holdTower).toHaveBeenCalledWith('t1', expect.closeTo(3, 6), expect.closeTo(2, 6));
    presenter.setStage(0, 3);
    expect(drawn.rubble).toHaveBeenCalledWith(BARN, 1);
    presenter.dig(0, 10, 20, 15, 21);
    presenter.dig(0, 10, 20, 15, 42);
    expect(drawn.crater.mock.calls).toEqual([[10, 20, 15, 21, 1], [10, 20, 15, 21, -1], [10, 20, 15, 42, 1]]);
    listener!({ kind: 'removed', tower });
    expect(drawn.releaseTower).toHaveBeenCalledWith('t1');
    presenter.destroy();
  });

  it('stays out of a world where nothing falls', () => {
    const { destruction, engine, presenter } = setup(false);
    presenter.setStages(new Uint8Array([3]));
    presenter.fell(0, 0.001, 0.002, 5, 6);
    expect(destruction.setStages).not.toHaveBeenCalled();
    expect(engine.effects.spawnExplosion).not.toHaveBeenCalled();
  });

  it('sounds a fall by its class and size with the rubble settling, and a crater as it is dug', () => {
    const { bus, destruction, presenter } = setup(true);
    destruction.structures.mockReturnValue([{ material: 'brick' }, { material: 'metal' }] as never);
    const played: unknown[] = [];
    bus.on('audio:play', (e) => played.push(e.sound));
    presenter.fell(0, 0.001, 0.002, 5, 6);
    presenter.fell(1, 0.001, 0.002, 4, 12);
    presenter.dig(0, 100, 100, 25, 30);
    expect(played).toEqual([
      'destroy_collapse_masonry_small', 'destroy_rubble_settle',
      'destroy_collapse_metal_large', 'destroy_rubble_settle',
      'destroy_crater_impact',
    ]);
    expect(collapseClass('plaster')).toBe('masonry');
    expect(collapseClass('wood')).toBe('wood');
    presenter.destroy();
  });

  it('sounds a crater at its middle, which comes in decimetres', () => {
    const { bus, presenter } = setup(true);
    const at: { lat: number; lon: number }[] = [];
    bus.on('audio:play', (e) => at.push({ lat: e.lat, lon: e.lon }));
    presenter.dig(0, 100, 200, 25, 30);
    expect(at[0].lon).toBeCloseTo(10 / MAP_METERS_PER_DEGREE, 12);
    expect(at[0].lat).toBeCloseTo(20 / MAP_METERS_PER_DEGREE, 12);
    presenter.destroy();
  });

  it('throws water up where a crater is dug into it, steam over the crater of a nuclear strike, sparks out of lava; a crater dug now is told so (E283)', () => {
    const { engine, presenter } = setup(true);
    const ground = { crater: vi.fn(), dug: vi.fn(), waterAt: vi.fn((x: number) => (x < 0 ? 'lava' : x > 500 ? 'water' : null)) };
    Object.assign(engine.world.destruction, { ground });
    Object.assign(engine.effects, { spawnWaterSpray: vi.fn(), spawnSteam: vi.fn() });
    const fresh = new WorldDamagePresenter(engine as never, createMainEventBus(), null);
    const fx = engine.effects as typeof engine.effects & { spawnWaterSpray: ReturnType<typeof vi.fn>; spawnSteam: ReturnType<typeof vi.fn> };
    // Dry ground: nothing thrown up; the crater is stamped and told as dug now
    fresh.dig(0, 100, 100, 25, 30);
    expect(ground.dug).toHaveBeenCalledWith(100, 100);
    expect(fx.spawnWaterSpray).not.toHaveBeenCalled();
    // A rocket's crater (2.5 m) in water: spray, no steam
    fresh.dig(1, 1000, 100, 25, 30);
    expect(fx.spawnWaterSpray).toHaveBeenCalledTimes(1);
    expect(fx.spawnWaterSpray.mock.calls[0][3]).toBeCloseTo(2.5);
    expect(fx.spawnSteam).not.toHaveBeenCalled();
    // A nuclear strike's (25 m): steam too
    fresh.dig(2, 2000, 100, 250, 400);
    expect(fx.spawnSteam).toHaveBeenCalledTimes(1);
    // Into lava: glowing sparks, no water
    fresh.dig(3, -1000, 100, 25, 30);
    expect(fx.spawnWaterSpray).toHaveBeenCalledTimes(2);
    expect(engine.effects.spawnBurstAtGeo).toHaveBeenCalledTimes(1);
    fresh.destroy();
    presenter.destroy();
  });

  it('keeps a bar over each damaged structure that stands: none while full, none once fallen, set as the HP change (E262)', () => {
    const shed: RunStructure = { id: 'shed', lat: 50 / M, lon: 0, radius: 3, height: 4, hp: 60, box: [0, 50, 4, 2, 0] };
    const { engine, presenter } = setup(true);
    const bars = { set: vi.fn(), clear: vi.fn() };
    Object.assign(engine, { structureBars: bars });
    engine.world.runRules = () => ({ structures: [BARN, shed] });
    const heard = vi.fn();
    presenter.onHpChanged(heard);
    // The barn at 40 of 100 HP, the shed full: one bar, filled to 40 %, over the barn's roof, as wide as the barn
    presenter.setStages(new Uint8Array([1, 0]), new Int16Array([-1, -1]), new Int32Array([40, 60]));
    expect(bars.clear).toHaveBeenCalledTimes(1);
    expect(bars.set).toHaveBeenCalledWith(0, expect.closeTo(20, 6), 12 + 6 + 1.5, expect.closeTo(10, 6), 6, 0.4);
    // Full: no bar (a set to nothing)
    expect(bars.set).toHaveBeenCalledWith(1, 0, 0, 0, 0, 0);
    expect(presenter.hpOf(0)).toEqual({ id: 'barn', hp: 40, max: 100, stage: 1 });
    expect(heard).toHaveBeenCalledTimes(1);
    // A packet's HP: the shed hit, the barn fallen; only these two are set again
    bars.set.mockClear();
    presenter.setStage(0, 3);
    presenter.setHp(new Int32Array([1, 30, 0, 0]));
    expect(bars.set.mock.calls).toEqual([[1, expect.closeTo(0, 6), 12 + 4 + 1.5, expect.closeTo(50, 6), 6, 0.5], [0, 0, 0, 0, 0, 0]]);
    expect(presenter.hpOf(0)).toEqual({ id: 'barn', hp: 0, max: 100, stage: 3 });
    expect(heard).toHaveBeenCalledTimes(3);
    // A click finds the structure under it: in the shed's box, in the barn's circle, beside both nothing
    expect(presenter.structureAt(51 / M, 3.5 / M)).toBe(1);
    expect(presenter.structureAt(51 / M, 5 / M)).toBe(-1);
    expect(presenter.structureAt(12 / M, -18 / M)).toBe(0);
    expect(presenter.structureAt(200 / M, 0)).toBe(-1);
    presenter.destroy();
    expect(bars.clear).toHaveBeenCalledTimes(2);
  });

  it("sends the destruction tool's blasts and stages from DevTools through the simulation (E261)", () => {
    const { bus, presenter } = setup(true);
    const sent: unknown[] = [];
    bus.on('debug:blast', (e) => sent.push(e));
    bus.on('debug:set-structure-stage', (e) => sent.push(e));
    const api = (globalThis as unknown as { __worldDamage: { blast(lat: number, lon: number, blast?: string): void; setStage(index: number, stage: number): void } }).__worldDamage;
    api.blast(0.001, 0.002, 'nuclear-strike');
    api.setStage(0, 3);
    api.setStage(7, 3);
    expect(sent).toEqual([
      { type: 'debug:blast', lat: 0.001, lon: 0.002, height: 12, blast: 'nuclear-strike' },
      { type: 'debug:set-structure-stage', index: 0, stage: 3, lat: BARN.lat, lon: BARN.lon },
    ]);
    presenter.destroy();
  });

  it('hits a point through the simulation from DevTools', () => {
    const { bus, presenter } = setup(true);
    const sent: unknown[] = [];
    bus.on('debug:hit-structures', (e) => sent.push(e));
    (globalThis as unknown as { __worldDamage: { hit(lat: number, lon: number): void } }).__worldDamage.hit(0.001, 0.002);
    expect(sent).toEqual([{ type: 'debug:hit-structures', lat: 0.001, lon: 0.002, reach: 4, amount: 45 }]);
    presenter.destroy();
    expect((globalThis as { __worldDamage?: unknown }).__worldDamage).toBeUndefined();
  });
});
