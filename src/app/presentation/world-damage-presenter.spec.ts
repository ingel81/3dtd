import { createMainEventBus } from '../sim/client/view-events';
import type { WorldStructure } from '../world/world-provider';
import { IMPACT_DAMAGE, IMPACT_REACH_M, WorldDamagePresenter } from './world-damage-presenter';

const BARN: WorldStructure = { id: 'barn', lat: 0.001, lon: 0.002, radius: 5, height: 6, maxHp: 100, hp: 0 };

function setup(destructible: boolean) {
  const destruction = { structures: vi.fn(() => []), damage: vi.fn(() => [BARN]), reset: vi.fn() };
  const engine = {
    world: { capabilities: { destructible }, destruction },
    effects: { spawnExplosion: vi.fn() },
    sync: { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon * 1000, y: height, z: -lat * 1000 }) },
    getTerrainHeightAtGeo: vi.fn(() => 12),
  };
  const bus = createMainEventBus();
  const presenter = new WorldDamagePresenter(engine as never, bus);
  const send = (event: Parameters<typeof bus.emit>[0]) => {
    bus.emit(event);
    bus.processQueue();
  };
  return { destruction, engine, presenter, send };
}

const IMPACT = { type: 'vfx:projectile-impact', lat: 0.001, lon: 0.002, height: 0, projectileType: 'cannonball', targetLost: true } as const;

describe('WorldDamagePresenter', () => {
  it('takes every impact off the structures in reach and blows up the ones that fall', () => {
    const { destruction, engine, send } = setup(true);
    send(IMPACT);
    expect(destruction.damage).toHaveBeenCalledWith({ lat: 0.001, lon: 0.002 }, IMPACT_REACH_M, IMPACT_DAMAGE);
    // At the barn's middle, half its height over the ground, as wide as the barn
    expect(engine.effects.spawnExplosion).toHaveBeenCalledWith(2, 15, -1, 25, 5, 5);
    send({ type: 'game:reset' });
    expect(destruction.reset).toHaveBeenCalledOnce();
  });

  it('stays out of a world where nothing falls', () => {
    const { destruction, engine, send } = setup(false);
    send(IMPACT);
    send({ type: 'game:reset' });
    expect(destruction.damage).not.toHaveBeenCalled();
    expect(destruction.reset).not.toHaveBeenCalled();
    expect(engine.effects.spawnExplosion).not.toHaveBeenCalled();
  });
});
