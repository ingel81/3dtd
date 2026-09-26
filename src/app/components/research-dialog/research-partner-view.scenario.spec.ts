/**
 * Coop: a partner's research, looked at only (TODO E35). The real MatDialog
 * in a TestBed with animations off, the real opener with the partner's id,
 * the real ResearchDialogComponent with its template read from disk. Two
 * players' ResearchManagers on one bus, as GameStateManager holds them; the
 * facade stub hands out what the real facade does (researchSnapshotOf,
 * watchResearchOf). The tree itself is a stub here: what it draws from the
 * nodes is covered by research-tree-view.spec and tech-tree.component.spec.
 */
// Material's dialog is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Three.js is a transitive dependency via the facade's imports
vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Directive, EventEmitter, Injector, Input, Output, input, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { ResearchManager } from '../../managers/research.manager';
import { researchSnapshotOf, watchResearchOf } from '../../managers/research-snapshot';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { COOP } from '../../services/coop.token';
import { ResearchDialogComponent } from './research-dialog.component';
import { openResearchDialog } from './open-research-dialog';

const template = readFileSync(resolve('src/app/components/research-dialog/research-dialog.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
// The @Input annotation the JIT transform adds for input() (see world-map.scenario.spec.ts)
for (const name of ['name', 'size']) {
  Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
}

/** The stubs built, the last is the dialog's tree */
const trees: TreeStub[] = [];
@Component({ selector: 'td-tech-tree', standalone: true, template: '' })
class TreeStub {
  nodes: unknown;
  edges: unknown;
  orientation: unknown;
  selectedId: unknown;
  label: unknown;
  nodeActivated = new EventEmitter<string>();
  nodeFocused = new EventEmitter<string | null>();
  constructor() {
    trees.push(this);
  }
}
for (const name of ['nodes', 'edges', 'orientation', 'selectedId', 'label']) Input(name)(TreeStub.prototype, name);
for (const name of ['nodeActivated', 'nodeFocused']) Output(name)(TreeStub.prototype, name);

@Directive({ selector: '[tdDragScroll]', standalone: true })
class DragScrollStub {}

describe('Coop research view of a partner (TODO E35)', () => {
  let dialog: MatDialog;
  let bus: GameEventBus;
  let theirs: ResearchManager;
  let emitCommand: ReturnType<typeof vi.fn>;
  const inGame = signal(true);

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    bus = new GameEventBus();
    const mine = new ResearchManager(bus, { playerId: 'p1', local: () => true });
    theirs = new ResearchManager(bus, { playerId: 'p2', local: () => false });
    const byId: Record<string, ResearchManager> = { p1: mine, p2: theirs };
    theirs.onCenterPlaced();
    theirs.completeResearch('biology');
    theirs.startResearch('gatling-tech');
    theirs.queueResearch('ice-magic');
    emitCommand = vi.fn();
    inGame.set(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: TowerDefenseStore, useValue: { credits: signal(750) } },
        {
          provide: TowerDefenseFacadeService,
          useValue: {
            researchSnapshotOf: (id: string) => researchSnapshotOf(byId[id]),
            watchResearchOf: (id: string, changed: () => void) => watchResearchOf(bus, id, changed),
            emitCommand,
          },
        },
        {
          provide: COOP,
          useValue: {
            inGame,
            playerId: signal('p1'),
            roster: signal([
              { id: 'p1', name: 'Alpha', spawnId: null },
              { id: 'p2', name: 'Bravo', spawnId: null },
            ]),
            nameOf: (id: string) => (id === 'p2' ? 'Bravo' : 'Alpha'),
          },
        },
      ],
    });
    TestBed.overrideComponent(ResearchDialogComponent, {
      set: {
        template,
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [MatDialogModule, IconStub, TreeStub, DragScrollStub],
      },
    });
    dialog = TestBed.inject(MatDialog);
  });

  afterEach(() => {
    dialog.closeAll();
    trees.length = 0;
    TestBed.resetTestingModule();
  });

  const overlay = () => document.querySelector('.cdk-overlay-container') as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((done) => setTimeout(done, 0));
      TestBed.tick();
    }
  };
  const tabs = () => [...overlay().querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selectedTab = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent?.trim();
  const readouts = () => [...overlay().querySelectorAll('.td-rd-readout')]
    .map((r) => [...r.children].map((c) => c.textContent!.trim()).filter(Boolean).join(' '));
  const researched = () => overlay().querySelector('.td-rd-prog b')!.textContent!.trim();
  const tree = () => trees[trees.length - 1];
  const nodeState = (id: string) => (tree().nodes as { id: string; state: string }[]).find((n) => n.id === id)!.state;

  it('opens on the partner picked in the squad: their tree, their center, nothing to click', async () => {
    await openResearchDialog(dialog, TestBed.inject(Injector), 'p2');
    await settle();

    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['You', 'Bravo']);
    expect(selectedTab()).toBe('Bravo');
    expect(overlay().querySelector('.td-rd-viewonly')?.textContent?.trim()).toBe('View only');
    expect(readouts()).toEqual(['Slots 1/1', 'Center Lv 1']);
    expect(nodeState('biology')).toBe('completed');
    expect(nodeState('gatling-tech')).toBe('active');
    expect(nodeState('ice-magic')).toBe('queued');

    // Their queue without the buttons to move or remove
    const queued = overlay().querySelectorAll('.td-rd-queue li');
    expect(queued).toHaveLength(1);
    expect(queued[0].querySelectorAll('button')).toHaveLength(0);

    // A click on a node selects it and sends nothing
    tree().nodeActivated.emit('ice-magic');
    tree().nodeActivated.emit('fire-alchemy');
    await settle();
    expect(emitCommand).not.toHaveBeenCalled();
    expect(overlay().querySelector('.td-rd-act button')).toBeNull();
    expect(overlay().querySelector('.td-rd-act')!.textContent).toContain("Bravo picks their own research");
  });

  it('moves on as their research does', async () => {
    await openResearchDialog(dialog, TestBed.inject(Injector), 'p2');
    await settle();
    const before = researched();

    theirs.update(20_000);
    await settle();
    expect(nodeState('gatling-tech')).toBe('completed');
    expect(researched()).not.toBe(before);
    expect(researched().startsWith('2/')).toBe(true);
  });

  it('the "You" tab goes back to this player\'s own tree with the credits', async () => {
    await openResearchDialog(dialog, TestBed.inject(Injector), 'p2');
    await settle();

    tabs()[0].click();
    await settle();
    expect(selectedTab()).toBe('You');
    expect(overlay().querySelector('.td-rd-viewonly')).toBeNull();
    expect(readouts()).toEqual(['Slots 0/1', 'Credits 750']);
    expect(nodeState('biology')).not.toBe('completed');
  });

  it('alone: no tabs, the own tree', async () => {
    inGame.set(false);
    await openResearchDialog(dialog, TestBed.inject(Injector));
    await settle();
    expect(tabs()).toHaveLength(0);
    expect(overlay().querySelector('[role="tablist"]')).toBeNull();
    expect(readouts()).toEqual(['Slots 0/1', 'Credits 750']);
  });
});
