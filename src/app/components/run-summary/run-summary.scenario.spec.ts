/**
 * Playtest 144 of night 1 (docs/REVIEW_SPRINT_2026-09-13.md) replayed: the
 * game-over screen shows Wave, Kills, Time, Earned, Spent, a leak bar per
 * wave and the top three towers; a restart clears everything.
 *
 * A run goes over a real GameEventBus into the real RunStatsTracker
 * (aadc9df2); its summary is rendered by RunSummaryComponent with its real
 * template (read from disk, the vitest build has no templateUrl loader).
 * That game:over hands the summary to the store and game:reset takes it
 * away again is game-state-sync.service.spec.ts. Not covered: layout and
 * styling of the panel.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Input } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { RunStatsTracker, type RunSummary } from '../../services/infrastructure/run-stats';
import { formatCompact } from '../../utils/format-compact';
import { RunSummaryComponent } from './run-summary.component';

const template = readFileSync(resolve('src/app/components/run-summary/run-summary.component.html'), 'utf8');

// The @Input annotation the Angular compiler's JIT transform adds for input()
// (see world-map.scenario.spec.ts); plain vitest runs without it
Input({ alias: 'summary', required: true, isSignal: true } as Input)(RunSummaryComponent.prototype, 'summary');

/** A tower as RunStatsTracker reads it */
function tower(id: string, name: string, damageDealt: number, kills: number) {
  return { id, typeConfig: { name }, combat: { damageDealt, kills } } as never;
}

describe('Game-over numbers, playtest 144 (night 1) replayed', () => {
  let bus: GameEventBus;
  let tracker: RunStatsTracker;
  let fixture: ComponentFixture<RunSummaryComponent>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  const show = (summary: RunSummary) => {
    fixture.componentRef.setInput('summary', summary);
    fixture.detectChanges();
  };
  const host = () => fixture.nativeElement as HTMLElement;
  /** The key figures as the screen shows them, label to value */
  const figures = () =>
    Object.fromEntries(
      Array.from(host().querySelectorAll('.run-figure'), (f) => [
        f.querySelector('dt')!.textContent!.trim(),
        f.querySelector('dd')!.textContent!.trim(),
      ]),
    );
  const bars = () => Array.from(host().querySelectorAll<HTMLElement>('.run-leak-bar'));
  const towerRows = () =>
    Array.from(host().querySelectorAll('.run-towers tbody tr'), (row) =>
      Array.from(row.querySelectorAll('td'), (td) => td.textContent!.replace(/\s+/g, ' ').trim()),
    );

  /** Credits in or out, as the credits ledger announces them */
  const credits = (delta: number) => bus.emit({ type: 'credits:changed', credits: 0, delta } as never);
  const kill = (id: string) => bus.emit({ type: 'enemy:died', enemy: { id } as never, credits: 5 });
  const leak = (id: string, damage: number) => {
    bus.emit({ type: 'enemy:reached-base', enemy: { id } as never, damage });
    bus.emit({ type: 'health:changed', health: 0, delta: -damage });
  };

  it('shows the run after the fall and nothing of it after a restart', () => {
    // Real template, no styles; the override lives as long as the testing module
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(RunSummaryComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    fixture = TestBed.createComponent(RunSummaryComponent);
    bus = new GameEventBus();
    tracker = new RunStatsTracker();
    tracker.attach(bus, new SubscriptionBag());

    // Build: an archer, a cannon, an upgrade
    const archer = tower('t1', 'Archer Tower', 1200, 6);
    const cannon = tower('t2', 'Cannon Tower', 800, 2);
    const magic = tower('t3', 'Magic Tower', 1500, 0);
    const ice = tower('t4', 'Ice Tower', 100, 0);
    for (const t of [archer, cannon, magic, ice]) bus.emit({ type: 'tower:placed', tower: t } as never);
    credits(-100);
    credits(-60);
    credits(-80);

    // W1: five kills, their gold and the wave bonus, no leak
    bus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
    for (let i = 0; i < 5; i++) kill(`w1-${i}`);
    credits(50);
    credits(30);
    // W2: three kills, two leaks of 10
    bus.emit({ type: 'wave:started', wave: 2, enemyCount: 5 });
    for (let i = 0; i < 3; i++) kill(`w2-${i}`);
    leak('w2-3', 10);
    leak('w2-4', 10);
    credits(40);
    // W3: the cannon sold (a refund, not earned), the credits cheat (not earned either), one leak of 15
    bus.emit({ type: 'wave:started', wave: 3, enemyCount: 3 });
    bus.emit({ type: 'tower:sold', tower: cannon, refund: 30 } as never);
    credits(30);
    bus.emit({ type: 'debug:add-credits', amount: 1000 } as never);
    credits(1000);
    leak('w3-0', 15);

    // game:over hands the summary over with the game clock (GameStateSyncService)
    show(tracker.summary(125_000));

    expect(figures()).toEqual({ Wave: '3', Kills: '8', Time: '2:05', Earned: '120', Spent: '210' });

    // A bar per wave, the worst one full height, a wave without leaks marked empty
    expect(bars().map((b) => b.title)).toEqual([
      'Wave 1: 0 leaked, 0 HQ damage',
      'Wave 2: 2 leaked, 20 HQ damage',
      'Wave 3: 1 leaked, 15 HQ damage',
    ]);
    expect(bars().map((b) => b.classList.contains('run-leak-none'))).toEqual([true, false, false]);
    expect(bars().map((b) => b.style.height)).toEqual(['', '100%', '50%']);
    expect(host().querySelector('.run-caption-total')!.textContent!.trim()).toBe('3 total');
    expect(host().querySelector('.run-leaks')!.getAttribute('aria-label')).toBe('Leaks per wave: 0, 2, 1');

    // Top three by damage: the sold cannon keeps its numbers, the ice tower is fourth
    expect(towerRows()).toEqual([
      ['1', 'Magic Tower', `${formatCompact(1500)} dmg`, '0 kills'],
      ['2', 'Archer Tower', `${formatCompact(1200)} dmg`, '6 kills'],
      ['3', 'Cannon Tower sold', `${formatCompact(800)} dmg`, '2 kills'],
    ]);

    // Restart: the tracker starts over, the next fall shows nothing of this run
    bus.emit({ type: 'game:reset' });
    show(tracker.summary(0));

    expect(figures()).toEqual({ Wave: '0', Kills: '0', Time: '0:00', Earned: '0', Spent: '0' });
    expect(bars()).toHaveLength(0);
    expect(host().querySelector('.run-leaks')).toBeNull();
    expect(host().querySelector('.run-towers')).toBeNull();
  });
});
