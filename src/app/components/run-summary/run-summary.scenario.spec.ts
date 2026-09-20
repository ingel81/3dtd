/**
 * Playtest 144 of night 1 (docs/archive/REVIEW_SPRINT_2026-09-13.md) replayed: the
 * game-over screen shows Wave, Kills, Time, Earned, Spent, a leak bar per
 * wave and the top three towers; a restart clears everything.
 *
 * A run goes over a real GameEventBus into the real run log; its summary is
 * folded out of the log (run-summary.ts) and rendered by RunSummaryComponent
 * with its real template (read from disk, the vitest build has no templateUrl
 * loader).
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
import { RunLogCollector, type RunLogWorld } from '../../run-log/run-log.service';
import { runSummary, type RunSummary } from '../../run-log/run-summary';
import { formatCompact } from '../../utils/format-compact';
import { RunSummaryComponent } from './run-summary.component';

const template = readFileSync(resolve('src/app/components/run-summary/run-summary.component.html'), 'utf8');

// The @Input annotation the Angular compiler's JIT transform adds for input()
// (see world-map.scenario.spec.ts); plain vitest runs without it
Input({ alias: 'summary', required: true, isSignal: true } as Input)(RunSummaryComponent.prototype, 'summary');

/** A tower as the run log reads it */
function tower(id: string, type: string, damageDealt: number, kills: number) {
  return {
    id,
    typeConfig: { id: type, name: type, upgrades: [] as { id: string }[] },
    combat: { damageDealt, kills },
    getUpgradeLevel: () => 0,
  };
}

describe('Game-over numbers, playtest 144 (night 1) replayed', () => {
  let bus: GameEventBus;
  let log: RunLogCollector;
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

  /** The world the log reads at a record: gold, HQ, towers. */
  let gold = 0;
  let health = 100;
  let standing: ReturnType<typeof tower>[] = [];
  const world = (): RunLogWorld => ({
    step: () => 0,
    timeMs: () => 0,
    credits: () => gold,
    baseHealth: () => health,
    enemiesAlive: () => 0,
    dps: () => 0,
    towers: () => standing as never,
  });

  /** Credits in or out, as the credits ledger announces them */
  const credits = (delta: number, source = 'kill') => {
    gold += delta;
    bus.emit({ type: 'credits:changed', credits: gold, delta, source } as never);
  };
  const kill = (id: string, towerId = 't1') =>
    bus.emit({ type: 'enemy:died', enemy: { id } as never, credits: 5, killedBy: { kind: 'tower', towerId } });
  const leak = (id: string, damage: number) => {
    bus.emit({ type: 'enemy:reached-base', enemy: { id } as never, damage });
    health -= damage;
    bus.emit({ type: 'health:changed', health, delta: -damage });
  };
  const startWave = (wave: number, enemyCount: number) =>
    bus.emit({ type: 'wave:started', wave, enemyCount });
  const endWave = (wave: number) =>
    bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: false, closeCall: false, hpLost: 0 });

  it('shows the run after the fall and nothing of it after a restart', () => {
    // Real template, no styles; the override lives as long as the testing module
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(RunSummaryComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [] },
    });
    fixture = TestBed.createComponent(RunSummaryComponent);
    bus = new GameEventBus();
    gold = 0;
    health = 100;
    log = new RunLogCollector();
    log.attach(bus, new SubscriptionBag());
    log.open({ seed: 1, map: 'devworld', player: 'human' }, world());

    // Build: four towers. Their damage and kills are read off the towers at
    // the end of every wave, so a tower that never shot stays out.
    const archer = tower('t1', 'Archer Tower', 0, 0);
    const cannon = tower('t2', 'Cannon Tower', 0, 0);
    const magic = tower('t3', 'Magic Tower', 0, 0);
    const ice = tower('t4', 'Ice Tower', 0, 0);
    standing = [archer, cannon, magic, ice];
    for (const t of standing) {
      bus.emit({ type: 'tower:placed', tower: t, position: { lat: 0, lon: 0 }, cost: 0 } as never);
    }
    credits(-100, 'build');
    credits(-60, 'build');
    credits(-80, 'upgrade');

    // W1: five kills, their gold and the wave bonus, no leak
    startWave(1, 5);
    for (let i = 0; i < 5; i++) kill(`w1-${i}`);
    archer.combat.damageDealt = 1200;
    archer.combat.kills = 6;
    magic.combat.damageDealt = 1500;
    ice.combat.damageDealt = 100;
    credits(50, 'kill');
    credits(30, 'wave-bonus');
    endWave(1);

    // W2: three kills, two leaks of 10
    startWave(2, 5);
    for (let i = 0; i < 3; i++) kill(`w2-${i}`);
    leak('w2-3', 10);
    leak('w2-4', 10);
    credits(40, 'kill');
    endWave(2);

    // W3: the cannon shot, then was sold (a refund, not earned), the credits
    // cheat (not earned either), one leak of 15
    startWave(3, 3);
    cannon.combat.damageDealt = 800;
    cannon.combat.kills = 2;
    standing = [archer, magic, ice];
    bus.emit({ type: 'tower:sold', tower: cannon, refund: 30 } as never);
    credits(30, 'sell');
    bus.emit({ type: 'debug:add-credits', amount: 1000 } as never);
    credits(1000, 'cheat');
    leak('w3-0', 15);

    // game:over: the fatal wave gets its block, then the summary is folded
    // out of the log with the game clock (GameStateSyncService)
    log.flushOpenWave();
    show(runSummary(log.current(), 125_000, (type) => type));

    expect(figures()).toEqual({ Wave: '3', Kills: '8', Time: '2:05', Earned: '120', Spent: '240' });

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

    // Restart: a new run, and the next fall shows nothing of this one
    log.close('restart');
    log.open({ seed: 2, map: 'devworld', player: 'human' }, world());
    show(runSummary(log.current(), 0, (type) => type));

    expect(figures()).toEqual({ Wave: '0', Kills: '0', Time: '0:00', Earned: '0', Spent: '0' });
    expect(bars()).toHaveLength(0);
    expect(host().querySelector('.run-leaks')).toBeNull();
    expect(host().querySelector('.run-towers')).toBeNull();
  });
});
