import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { CoopSquadComponent } from './coop-squad.component';
import { CoopService } from '../../services/coop.service';
import { GameStore } from '../../store/game.store';

/** The gold menu's own amount (TODO E36) */
describe('CoopSquadComponent: any amount of gold', () => {
  function build(myGold: number) {
    const giveGold = vi.fn();
    const coop = {
      playerId: signal('me'),
      gold: signal(new Map([['me', myGold]])),
      giveGold,
    };
    const injector = Injector.create({
      providers: [
        { provide: CoopService, useValue: coop },
        { provide: GameStore, useValue: { waveActive: signal(false) } },
      ],
    });
    const squad = runInInjectionContext(injector, () => new CoopSquadComponent());
    return { squad, giveGold };
  }

  it('sends the typed amount, and nothing that is empty, broken or more than this player has', () => {
    const { squad, giveGold } = build(300);

    squad.setAnyAmount('');
    squad.giveAny('you');
    squad.setAnyAmount('12.5');
    squad.giveAny('you');
    squad.setAnyAmount('301');
    squad.giveAny('you');
    squad.setAnyAmount('0');
    squad.giveAny('you');
    expect(giveGold).not.toHaveBeenCalled();

    squad.setAnyAmount('137');
    squad.giveAny('you');
    expect(giveGold).toHaveBeenCalledWith('you', 137);
  });
});
