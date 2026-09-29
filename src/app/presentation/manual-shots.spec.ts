import { describe, it, expect, vi } from 'vitest';
import { ManualShots } from './manual-shots';
import { createMainEventBus } from '../sim/client/view-events';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { SimScalars } from '../sim/protocol/packet';
import type { Tower } from '../entities/tower.entity';
import type { ViewEvent } from '../sim/client/view-events';

function setup(manned: (string | null)[] = ['tower-1', null]) {
  const bus = createMainEventBus();
  const tower = { id: 'tower-1', typeConfig: TOWER_TYPES['dual-gatling'], position: { lat: 1, lon: 2, height: 10 } } as unknown as Tower;
  const source = {
    tower: (id: string) => (id === 'tower-1' ? tower : null),
    scalars: { players: ['p1', 'p2'], localPlayerId: 'p1', mannedTowers: manned } as unknown as SimScalars,
  };
  const shots = new ManualShots(bus, source);
  const seen: ViewEvent[] = [];
  bus.on('vfx:muzzle-flash', (e) => seen.push(e));
  bus.on('audio:play', (e) => seen.push(e));
  const fire = (towerId = 'tower-1') => bus.emit({ type: 'tower:manual-shot', towerId, target: null });
  return { bus, shots, seen, fire };
}

describe('ManualShots', () => {
  it('flashes and sounds the shot of the own seat at the listener', () => {
    const { seen, fire } = setup();
    fire();
    const type = TOWER_TYPES['dual-gatling'];
    expect(seen).toEqual([
      { type: 'vfx:muzzle-flash', towerId: 'tower-1', towerTypeId: 'dual-gatling' },
      {
        type: 'audio:play',
        sound: type.projectileType,
        lat: 1,
        lon: 2,
        height: 10 + type.heightOffset,
        atListener: true,
      },
    ]);
  });

  it('sounds a partner\'s manned tower where it stands', () => {
    const { seen, fire } = setup([null, 'tower-1']);
    fire();
    expect((seen[1] as { atListener: boolean }).atListener).toBe(false);
  });

  it('keeps a shot shown at the click quiet, taking the prediction once per shot', () => {
    const { shots, seen, fire } = setup();
    const predicted = new Set(['tower-1']);
    const take = vi.fn((id: string) => predicted.delete(id));
    shots.setPrediction(take);
    fire();
    expect(seen).toEqual([]);
    fire();
    expect(seen).toHaveLength(2);
    expect(take).toHaveBeenCalledTimes(2);
  });

  it('shows nothing for a tower the mirror does not hold, and nothing in a seek', () => {
    const { bus, seen, fire, shots } = setup();
    fire('tower-9');
    bus.setShowMuted(true);
    fire();
    bus.setShowMuted(false);
    expect(seen).toEqual([]);
    shots.destroy();
    fire();
    expect(seen).toEqual([]);
  });
});
