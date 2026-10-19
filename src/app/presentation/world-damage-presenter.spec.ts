import { Vector3 } from 'three';
import { createMainEventBus } from '../sim/client/view-events';
import { WorldDamagePresenter } from './world-damage-presenter';
import { StampField, craterStampOf, rubbleStampOf, type ToLocal } from '../utils/stamp-field';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import type { RunStructure } from '../sim/protocol/run-rules';

const BARN: RunStructure = { id: 'barn', lat: 10 / M, lon: -20 / M, radius: 5, height: 6, hp: 100 };

function setup(destructible: boolean) {
  const destruction = { structures: vi.fn(() => []), setStages: vi.fn(), setStage: vi.fn() };
  const toLocal = (lat: number, lon: number, _h: number, out: Vector3) => out.set(-lon * M, 0, lat * M);
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
    presenter.setStages(new Uint8Array([1]));
    expect(destruction.setStages).toHaveBeenCalledWith(new Uint8Array([1]));
    presenter.setStage(0, 2);
    expect(destruction.setStage).toHaveBeenCalledWith(0, 2);
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
    const drawn = { crater: vi.fn(), rubble: vi.fn(), clear: vi.fn(), holdTower: vi.fn(), releaseTower: vi.fn() };
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
