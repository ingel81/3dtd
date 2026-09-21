// MatTooltipModule is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Three.js is a transitive dependency via the game-engine imports
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
import { ResearchManager } from '../../managers/research.manager';
import { CreditsLedger } from '../../managers/game-state/credits-ledger';
import { GameCommandsHandler } from '../../managers/game-commands.handler';
import type { GameStateManager } from '../../managers/game-state.manager';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ActiveResearch, ResearchId } from '../../configs/research/research.types';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { buildResearchNodes, researchClickAction, type ResearchTreeState } from './research-tree-view';
import { researchStatus } from '../game-sidebar/research-panel/research-status';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;

/**
 * Playtest 508 and 509 (docs/archive/REVIEW_FIX_2026-09-14.md) replayed: a
 * click in the research tree decides between start and queue
 * (researchClickAction), the dialog sends that as a command on the bus, and
 * GameCommandsHandler and ResearchManager do the rest, sub-step by sub-step as
 * GameStateManager.runSubStep runs them.
 *
 * The dialog itself is not built here, only the rule it follows and the
 * command path behind it; what it draws is covered by tech-tree.component.spec
 * and research-tree-view.spec.
 */
describe('Research queue, playtest 508 and 509 replayed', () => {
  let bus: GameEventBus;
  let research: ResearchManager;
  let ledger: CreditsLedger;
  let treeState: () => ResearchTreeState;
  let click: (id: ResearchId) => void;

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
    const credits = () => ledger.credits();
    const availableSlots = () =>
      Math.max(0, researchStore.researchSlots() - researchStore.activeResearches().length);

    /** What the dialog hands researchClickAction, from the same signals. */
    treeState = () => ({
      completed: researchStore.completedResearches(),
      active: researchStore.activeResearches(),
      queued: researchStore.queuedResearches(),
      elapsed: researchStore.researchElapsed(),
      credits: credits(),
      availableSlots: availableSlots(),
    });

    // The command the dialog emits for a click, and the one the X emits
    click = (id: ResearchId) => {
      const action = researchClickAction(id, treeState());
      if (action === 'start') bus.emit({ type: 'command:start-research', researchId: id });
      if (action === 'queue') bus.emit({ type: 'command:queue-research', researchId: id });
      if (action === 'unqueue') bus.emit({ type: 'command:unqueue-research', researchId: id });
    };

    const gsm = {
      researchManager: research,
      credits: () => ledger.credits(),
      spendCredits: (amount: number) => ledger.spend(amount, 'research'),
      addCredits: (amount: number) => ledger.add(amount, 'research-refund'),
    };
    new GameCommandsHandler(gsm as unknown as GameStateManager, bus);
  });

  /** One gameplay sub-step, research part (game-state.manager.ts runSubStep) */
  const subStep = () => {
    research.update(STEP_MS);
    research.startQueued(() => ledger.credits(), (cost) => ledger.spend(cost, 'research'));
  };
  const status = (id: ResearchId) =>
    researchStatus(id, treeState().completed, treeState().active, treeState().queued);

  /** New game, cheat Credits, Research Center built (TowerLifecycle charges it and opens the slot) */
  const newGameWithCenter = () => {
    bus.emit({ type: 'debug:add-credits', amount: 1000 });
    expect(ledger.spend(TOWER_TYPES['research-center'].cost, 'build')).toBe(true);
    research.onCenterPlaced();
  };

  it('508: a locked node queues nothing; Gatling starts, Ice Magic waits unpaid in the queue', () => {
    newGameWithCenter();
    click('siege-engineering');
    expect(status('siege-engineering')).toBe('locked');
    const locked = buildResearchNodes(treeState()).find((n) => n.id === 'siege-engineering')!;
    expect(locked.hint).toBe('Requires: Gatling Technology');
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
    bus.emit({ type: 'command:unqueue-research', researchId: 'tentacle-biology' });
    expect(research.getQueuedResearches()).toEqual(['toxic-compounds']);

    // X on the running research: half the cost back, 425 in this flow
    bus.emit({ type: 'command:cancel-research', researchId: 'ice-magic' });
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

  it('a moved entry is what the next free slot takes, and nothing is charged for the move', () => {
    newGameWithCenter();
    click('gatling-tech');            // takes the only slot
    click('ice-magic');               // queued
    click('toxic-compounds');         // queued behind it
    expect(research.getQueuedResearches()).toEqual(['ice-magic', 'toxic-compounds']);

    const before = ledger.credits();
    bus.emit({ type: 'command:move-queued-research', researchId: 'toxic-compounds', toIndex: 0 });
    expect(research.getQueuedResearches()).toEqual(['toxic-compounds', 'ice-magic']);
    expect(ledger.credits()).toBe(before);

    // Gatling done, the slot opens: the entry that was moved to the front starts.
    for (let i = 0; i < Math.ceil((getResearch('gatling-tech')!.duration * 1000) / STEP_MS) + 1; i++) subStep();
    expect(research.isActive('toxic-compounds')).toBe(true);
    expect(research.isActive('ice-magic')).toBe(false);
    expect(research.getQueuedResearches()).toEqual(['ice-magic']);
  });
});
