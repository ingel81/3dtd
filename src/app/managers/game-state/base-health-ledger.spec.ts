import { describe, it, expect, vi } from 'vitest';
import { BaseHealthLedger } from './base-health-ledger';
import { GameEventBus } from '../../game-engine';
import { GAME_BALANCE } from '../../configs/game-balance.config';

const START = GAME_BALANCE.player.startHealth;
const CAP = GAME_BALANCE.combat.maxLeakDamagePerWave;

describe('BaseHealthLedger', () => {
  it('takes a leak and announces it', () => {
    const bus = new GameEventBus();
    const changed = vi.fn();
    bus.on('health:changed', changed);
    const ledger = new BaseHealthLedger(bus);

    ledger.applyLeak(10);

    expect(ledger.baseHealth()).toBe(START - 10);
    expect(changed).toHaveBeenCalledWith({ type: 'health:changed', health: START - 10, delta: -10 });
  });

  it('caps the leak damage per wave until the budget is refilled', () => {
    const bus = new GameEventBus();
    const changed = vi.fn();
    bus.on('health:changed', changed);
    const ledger = new BaseHealthLedger(bus);

    ledger.applyLeak(9999);
    ledger.applyLeak(5); // budget spent: no damage, no event
    expect(ledger.baseHealth()).toBe(START - CAP);
    expect(changed).toHaveBeenCalledTimes(1);

    ledger.refillLeakBudget();
    ledger.applyLeak(5);
    expect(ledger.baseHealth()).toBe(START - CAP - 5);
  });

  it('adjusts outside the budget and above the start value', () => {
    const ledger = new BaseHealthLedger(new GameEventBus());
    ledger.adjust(1000);
    expect(ledger.baseHealth()).toBe(START + 1000);
    ledger.adjust(-99_999);
    expect(ledger.baseHealth()).toBe(0);
  });

  it('resets to full health silently', () => {
    const bus = new GameEventBus();
    const ledger = new BaseHealthLedger(bus);
    ledger.applyLeak(10);
    const changed = vi.fn();
    bus.on('health:changed', changed);

    ledger.resetToStart();

    expect(ledger.baseHealth()).toBe(START);
    expect(changed).not.toHaveBeenCalled();
  });
});
