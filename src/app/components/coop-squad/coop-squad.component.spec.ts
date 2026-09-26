import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

vi.mock('../research-dialog/open-research-dialog', () => ({ openResearchDialog: vi.fn(() => Promise.resolve()) }));

import { openResearchDialog } from '../research-dialog/open-research-dialog';
import { CoopSquadComponent } from './coop-squad.component';
import { CoopService } from '../../services/coop.service';
import { GameStore } from '../../store/game.store';

/** A partner row: the gold menu's own amount (TODO E36), their research (TODO E35) */
describe('CoopSquadComponent: a partner row', () => {
  const dialog = {} as MatDialog;
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
        { provide: MatDialog, useValue: dialog },
      ],
    });
    const squad = runInInjectionContext(injector, () => new CoopSquadComponent());
    return { squad, giveGold, injector };
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

  it("a partner's research button opens the research window on that partner (TODO E35)", () => {
    const { squad, injector } = build(0);
    squad.openResearch('p2');
    expect(openResearchDialog).toHaveBeenCalledWith(dialog, injector, 'p2');
    expect(squad.researchTip('Bravo')).toBe("Bravo's research");
  });
});
