import { describe, it, expect, vi } from 'vitest';
import { BaseHealthLedger } from './base-health-ledger';
import { GameEventBus } from '../../game-engine';
import { GAME_BALANCE } from '../../configs/game-balance.config';

const START = GAME_BALANCE.player.startHealth;

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

  it('lets a wave take everything it walks in for', () => {
    const bus = new GameEventBus();
    const changed = vi.fn();
    bus.on('health:changed', changed);
    const ledger = new BaseHealthLedger(bus);

    // 500 enemies through the gate used to cost the same 18 HP as two.
    // Aus den Start-HP gerechnet, damit die Zahl der Config folgt.
    const leaks = START / 10;
    for (let i = 0; i < leaks + 10; i++) ledger.applyLeak(10);

    expect(ledger.baseHealth()).toBe(0);
    expect(changed).toHaveBeenCalledTimes(leaks);   // the rest hits a base at zero
  });

  it('adjusts above the start value', () => {
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
