import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { OnboardingService } from './onboarding.service';
import { ONBOARDING_KEY } from './onboarding';

const tower = (id: string) => ({ id: 't1', typeConfig: { id } }) as never;

describe('OnboardingService', () => {
  let bus: GameEventBus;
  let service: OnboardingService;

  beforeEach(() => {
    localStorage.clear();
    bus = new GameEventBus();
    service = new OnboardingService();
    service.connect(bus);
  });

  it('shows the first tip with its place in the sequence', () => {
    expect(service.tip()).toMatchObject({ title: 'Place the research center', index: 1, total: 4 });
  });

  it('moves on when the game reports the action, and stores it', () => {
    bus.emit({ type: 'tower:placed', tower: tower('research-center'), position: { lat: 0, lon: 0 }, cost: 0 });
    expect(service.tip()).toMatchObject({ title: 'Build a tower', index: 2 });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!)).toEqual({ done: false, completed: ['research-center'] });
  });

  it('hide ends the tips, restart brings them back', () => {
    service.hide();
    expect(service.tip()).toBeNull();
    service.restart();
    expect(service.tip()?.index).toBe(1);
  });

  it('a new service picks up the stored state', () => {
    service.skip();
    service.skip();
    expect(new OnboardingService().tip()?.title).toBe('Start the first wave');
  });

  it('stops listening after disconnect', () => {
    service.disconnect();
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
    expect(service.state().completed).toEqual([]);
  });
});
