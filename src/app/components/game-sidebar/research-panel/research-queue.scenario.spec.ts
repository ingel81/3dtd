// MatTooltipModule is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Three.js is a transitive dependency via the game-engine imports
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { DestroyRef, Injector, computed, runInInjectionContext, signal } from '@angular/core';
import { GameEventBus } from '../../../game-engine';
import { ResearchManager } from '../../../managers/research.manager';
import { CreditsLedger } from '../../../managers/game-state/credits-ledger';
import { GameCommandsHandler } from '../../../managers/game-commands.handler';
import type { GameStateManager } from '../../../managers/game-state.manager';
import { SidebarResearchPanelComponent } from './research-panel.component';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { ResearchStore } from '../../../store/research.store';
import { SellConfirmService } from '../../../services/sell-confirm.service';
import { UpgradeHintService } from '../../../services/upgrade-hint.service';
import { getResearch } from '../../../configs/research/research-tree.config';
import type { ActiveResearch, ResearchId } from '../../../configs/research/research.types';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { GAME_BALANCE } from '../../../configs/game-balance.config';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;

/**
 * Playtest 508 and 509 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: the
 * research panel decides between start and queue, its outputs go to the
 * bus as commands, GameCommandsHandler and ResearchManager do the rest,
 * sub-step by sub-step as GameStateManager.runSubStep runs them.
 */
describe('Research queue, playtest 508 and 509 replayed', () => {
  let bus: GameEventBus;
  let research: ResearchManager;
  let ledger: CreditsLedger;
  let panel: SidebarResearchPanelComponent;

  beforeEach(() => {
    bus = new GameEventBus();
    research = new ResearchManager(bus);
    ledger = new CreditsLedger(bus);

    // What ResearchStore takes from research:state-changed
    const researchStore = {
      completedResearches: signal(new Set<ResearchId>()),
      activeResearches: signal<ActiveResearch[]>([]),
      queuedResearches: signal<ResearchId[]>([]),
      researchElapsed: signal(new Map<ResearchId, number>()),
      centerLevel: signal(0),
      researchSlots: signal(1),
    };
    bus.on('research:state-changed', (event) => {
      researchStore.completedResearches.set(new Set(event.completedResearches));
      researchStore.activeResearches.set(event.activeResearches);
      researchStore.queuedResearches.set(event.queuedResearches);
      researchStore.centerLevel.set(event.centerLevel);
      researchStore.researchSlots.set(event.maxSlots);
    });
    const store = {
      credits: ledger.credits,
      activeResearches: researchStore.activeResearches,
      availableResearchSlots: computed(() =>
        Math.max(0, researchStore.researchSlots() - researchStore.activeResearches().length)),
      selectedTowerRevision: signal(0),
    };

    const injector = Injector.create({
      providers: [
        { provide: TowerDefenseStore, useValue: store },
        { provide: ResearchStore, useValue: researchStore },
        { provide: SellConfirmService, useValue: new SellConfirmService() },
        { provide: UpgradeHintService, useValue: new UpgradeHintService() },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    panel = runInInjectionContext(injector, () => new SidebarResearchPanelComponent());

    // The panel's outputs as the sidebar, the game component and the facade pass them on
    panel.startResearch.subscribe((researchId) => bus.emit({ type: 'command:start-research', researchId }));
    panel.queueResearch.subscribe((researchId) => bus.emit({ type: 'command:queue-research', researchId }));
    panel.unqueueResearch.subscribe((researchId) => bus.emit({ type: 'command:unqueue-research', researchId }));
    panel.cancelResearch.subscribe((researchId) => bus.emit({ type: 'command:cancel-research', researchId }));

    const gsm = {
      researchManager: research,
      credits: () => ledger.credits(),
      spendCredits: (amount: number) => ledger.spend(amount),
      addCredits: (amount: number) => ledger.add(amount),
    };
    new GameCommandsHandler(gsm as unknown as GameStateManager, bus);
  });

  /** One gameplay sub-step, research part (game-state.manager.ts runSubStep) */
  const subStep = () => {
    research.update(STEP_MS);
    research.startQueued(() => ledger.credits(), (cost) => ledger.spend(cost));
  };
  const click = (id: ResearchId) => panel.onResearchClick(getResearch(id)!);
  const status = (id: ResearchId) => panel.getResearchStatus(id);

  /** New game, cheat Credits, Research Center built (TowerLifecycle charges it and opens the slot) */
  const newGameWithCenter = () => {
    bus.emit({ type: 'debug:add-credits', amount: 1000 });
    expect(ledger.spend(TOWER_TYPES['research-center'].cost)).toBe(true);
    research.onCenterPlaced();
  };

  it('508: a locked node queues nothing; Gatling starts, Ice Magic waits unpaid in the queue', () => {
    newGameWithCenter();
    click('siege-engineering');
    expect(status('siege-engineering')).toBe('locked');
    expect(panel.nodeTooltip(getResearch('siege-engineering')!)).toBe('Requires: Gatling Technology');
    expect(research.getQueuedResearches()).toEqual([]);

    click('gatling-tech');
    click('ice-magic');
    expect(research.isActive('gatling-tech')).toBe(true);
    expect(research.getQueuedResearches()).toEqual(['ice-magic']);
    expect(status('siege-engineering')).toBe('locked');
  });

  it('509: Ice Magic starts and is paid once Gatling is done, X takes one entry, a cancel leaves the queue waiting for 450', () => {
    newGameWithCenter();
    click('gatling-tech');
    click('ice-magic');
    const afterGatling = GAME_BALANCE.player.startCredits + 1000 - TOWER_TYPES['research-center'].cost
      - getResearch('gatling-tech')!.cost;
    expect(ledger.credits()).toBe(afterGatling);

    // 15 s of game time: one sub-step short of it nothing has started or been paid
    const steps = Math.ceil((getResearch('gatling-tech')!.duration * 1000) / STEP_MS);
    for (let i = 0; i < steps - 1; i++) subStep();
    expect(research.isActive('ice-magic')).toBe(false);
    expect(ledger.credits()).toBe(afterGatling);

    subStep();
    expect(research.isCompleted('gatling-tech')).toBe(true);
    expect(research.isActive('ice-magic')).toBe(true);
    expect(research.getQueuedResearches()).toEqual([]);
    expect(ledger.credits()).toBe(afterGatling - getResearch('ice-magic')!.cost);
    // The node is enabled again ([disabled] is status !== 'available')
    expect(status('siege-engineering')).toBe('available');

    // Slot taken: both clicks queue, nothing is charged
    const beforeQueue = ledger.credits();
    click('tentacle-biology');
    click('toxic-compounds');
    expect(research.getQueuedResearches()).toEqual(['tentacle-biology', 'toxic-compounds']);
    expect(ledger.credits()).toBe(beforeQueue);

    // X on Tentacle Biology in the queue
    panel.unqueueResearch.emit('tentacle-biology');
    expect(research.getQueuedResearches()).toEqual(['toxic-compounds']);

    // X on the running research: half the cost back, 425 in this flow
    panel.cancelResearch.emit('ice-magic');
    expect(ledger.credits()).toBe(425);
    expect(getResearch('toxic-compounds')!.cost).toBe(450);
    for (let i = 0; i < 60; i++) subStep();
    expect(research.getActiveResearches()).toEqual([]);
    expect(research.getQueuedResearches()).toEqual(['toxic-compounds']);
    expect(ledger.credits()).toBe(425);

    // With 450 the head takes the free slot in the next sub-step
    bus.emit({ type: 'debug:add-credits', amount: 25 });
    subStep();
    expect(research.isActive('toxic-compounds')).toBe(true);
    expect(research.getQueuedResearches()).toEqual([]);
    expect(ledger.credits()).toBe(0);
  });
});
