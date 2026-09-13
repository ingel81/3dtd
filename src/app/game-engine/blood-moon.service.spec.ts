import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from './game-event-bus';
import { BloodMoonService } from './blood-moon.service';

function setup() {
  const eventBus = new GameEventBus();
  const look = { setActive: vi.fn() };
  const service = new BloodMoonService(eventBus, look);
  return { eventBus, look, service };
}

describe('BloodMoonService', () => {
  it('turns the look on for a blood moon wave and off for any other', () => {
    const { eventBus, look, service } = setup();
    eventBus.emit({ type: 'wave:started', wave: 13, enemyCount: 20 });
    eventBus.emit({ type: 'wave:started', wave: 14, enemyCount: 20 });
    eventBus.emit({ type: 'wave:started', wave: 15, enemyCount: 20 });
    expect(look.setActive.mock.calls).toEqual([[false], [true], [false]]);
    service.destroy();
  });

  it('fades it out when the wave ends or the base falls', () => {
    const { eventBus, look, service } = setup();
    eventBus.emit({ type: 'wave:completed', wave: 14, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    eventBus.emit({ type: 'game:over', reason: 'base-destroyed' });
    expect(look.setActive.mock.calls).toEqual([[false], [false]]);
    service.destroy();
  });

  it('drops it without a fade on a reset', () => {
    const { eventBus, look, service } = setup();
    eventBus.emit({ type: 'game:reset' });
    expect(look.setActive).toHaveBeenCalledWith(false, true);
    service.destroy();
  });

  it('listens no more once destroyed', () => {
    const { eventBus, look, service } = setup();
    service.destroy();
    eventBus.emit({ type: 'wave:started', wave: 14, enemyCount: 20 });
    expect(look.setActive).not.toHaveBeenCalled();
  });
});
