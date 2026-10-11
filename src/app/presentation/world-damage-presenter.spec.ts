import { createMainEventBus } from '../sim/client/view-events';
import { WorldDamagePresenter } from './world-damage-presenter';

function setup(destructible: boolean) {
  const destruction = { structures: vi.fn(() => []), setFallen: vi.fn(() => []) };
  const engine = {
    world: { capabilities: { destructible }, destruction },
    effects: { spawnExplosion: vi.fn() },
    sync: { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon * 1000, y: height, z: -lat * 1000 }) },
    getTerrainHeightAtGeo: vi.fn(() => 12),
  };
  const bus = createMainEventBus();
  const presenter = new WorldDamagePresenter(engine as never, bus);
  return { destruction, engine, presenter, bus };
}

describe('WorldDamagePresenter (TODO E131)', () => {
  it("shows the simulation's fallen set and blows up a structure as it falls", () => {
    const { destruction, engine, presenter } = setup(true);
    presenter.setFallen(['barn']);
    expect(destruction.setFallen).toHaveBeenCalledWith(['barn']);
    presenter.fell(0.001, 0.002, 5, 6);
    // At the barn's middle, half its height over the ground, as wide as the barn
    expect(engine.effects.spawnExplosion).toHaveBeenCalledWith(2, 15, -1, 25, 5, 5);
    presenter.destroy();
  });

  it('stays out of a world where nothing falls', () => {
    const { destruction, engine, presenter } = setup(false);
    presenter.setFallen(['barn']);
    presenter.fell(0.001, 0.002, 5, 6);
    expect(destruction.setFallen).not.toHaveBeenCalled();
    expect(engine.effects.spawnExplosion).not.toHaveBeenCalled();
  });

  it('hits a point through the simulation from DevTools', () => {
    const { bus, presenter } = setup(true);
    const sent: unknown[] = [];
    bus.on('debug:hit-structures', (e) => sent.push(e));
    (globalThis as unknown as { __worldDamage: { hit(lat: number, lon: number): void } }).__worldDamage.hit(0.001, 0.002);
    expect(sent).toEqual([{ type: 'debug:hit-structures', lat: 0.001, lon: 0.002, reach: 4, amount: 20 }]);
    presenter.destroy();
    expect((globalThis as { __worldDamage?: unknown }).__worldDamage).toBeUndefined();
  });
});
