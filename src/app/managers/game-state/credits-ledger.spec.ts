import { describe, it, expect, vi } from 'vitest';
import { CreditsLedger } from './credits-ledger';
import { GameEventBus } from '../../game-engine';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { LOCAL_PLAYER_ID } from './command-log';

const START = GAME_BALANCE.player.startCredits;

describe('CreditsLedger', () => {
  it('books a delta and announces the new total', () => {
    const bus = new GameEventBus();
    const changed = vi.fn();
    bus.on('credits:changed', changed);
    const ledger = new CreditsLedger(bus);

    ledger.add(25, 'kill', LOCAL_PLAYER_ID);

    expect(ledger.credits()).toBe(START + 25);
    expect(changed).toHaveBeenCalledWith({ type: 'credits:changed', credits: START + 25, delta: 25, source: 'kill', playerId: LOCAL_PLAYER_ID, local: true });
  });

  it('spends only what is there, and books nothing otherwise', () => {
    const bus = new GameEventBus();
    const changed = vi.fn();
    bus.on('credits:changed', changed);
    const ledger = new CreditsLedger(bus);

    expect(ledger.spend(START + 1, 'build', LOCAL_PLAYER_ID)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(ledger.spend(START, 'build', LOCAL_PLAYER_ID)).toBe(true);
    expect(ledger.credits()).toBe(0);
  });

  it('resets to the start credits as one delta', () => {
    const bus = new GameEventBus();
    const ledger = new CreditsLedger(bus);
    ledger.add(-40, 'build', LOCAL_PLAYER_ID);
    const changed = vi.fn();
    bus.on('credits:changed', changed);

    ledger.reset();

    expect(ledger.credits()).toBe(START);
    expect(changed).toHaveBeenCalledWith({ type: 'credits:changed', credits: START, delta: 40, source: 'reset', playerId: LOCAL_PLAYER_ID, local: true });
  });

  it('starts each account with its start credits, one share per lane, and follows them until told otherwise', () => {
    const ledger = new CreditsLedger(new GameEventBus());
    const lanes = new Map([['a', 2], ['b', 1]]);
    ledger.setStartCredits((id) => START * (lanes.get(id) ?? 1));
    ledger.setPlayers(['a', 'b'], 'a');
    expect(ledger.balances()).toEqual([2 * START, START]);

    // Before the first wave: a lane more for b, one less for a who spent most already
    ledger.spend(2 * START - 30, 'build', 'a');
    lanes.set('a', 1);
    lanes.set('b', 3);
    ledger.followStart();
    expect(ledger.balances()).toEqual([0, 3 * START]);
    // Nothing changed: nothing booked
    ledger.followStart();
    expect(ledger.balances()).toEqual([0, 3 * START]);

    ledger.reset();
    expect(ledger.balances()).toEqual([START, 3 * START]);
  });
});
