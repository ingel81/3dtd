/**
 * The header's three stat plates in the real template: the HQ plate's
 * segments and states, the rising credit change and the refused buy, the
 * wave plate's bar and its brass edge at a wave start. What the screen
 * reader gets stays the exact figure.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Input, ViewChild, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameHeaderComponent } from './game-header.component';
import { TdIconComponent } from '../icon/icon.component';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { DevWorldService } from '../../devworld/devworld.service';
import { refuseForCredits } from '../../services/credits-refusal';
import { GAME_BALANCE } from '../../configs/game-balance.config';

const template = readFileSync(resolve('src/app/components/game-header/game-header.component.html'), 'utf8');
const MAX = GAME_BALANCE.player.startHealth;
const INPUTS = [
  'locationName', 'baseHealth', 'credits', 'waveNumber', 'enemiesAlive', 'waveActive', 'waveEnemyTotal',
  'waveEnemiesLeft', 'isDialog', 'favorites', 'favoriteNames', 'placementMode', 'canPlace', 'locationLocked',
  'spawnCount', 'coopChip', 'stateJumps',
];
const REQUIRED = new Set(['locationName', 'baseHealth', 'credits', 'waveNumber', 'enemiesAlive', 'waveActive']);
// The @Input annotation the JIT transform adds for input()
for (const name of INPUTS) {
  Input({ alias: name, required: REQUIRED.has(name), isSignal: true } as Input)(GameHeaderComponent.prototype, name);
}
// and the @ViewChild one it adds for viewChild()
for (const name of ['hqPlate', 'creditsPlate']) {
  ViewChild(name, { isSignal: true } as unknown as { read?: unknown; static?: boolean })(GameHeaderComponent.prototype, name);
}
for (const name of ['name', 'size', 'strokeWidth', 'ariaLabel']) {
  Input({ alias: name, isSignal: true } as Input)(TdIconComponent.prototype, name);
}

describe('Header stat plates', () => {
  let fixture: ComponentFixture<GameHeaderComponent>;
  let animate: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    TestBed.configureTestingModule({
      providers: [
        { provide: TowerDefenseStore, useValue: { renderingEnabled: signal(true) } },
        { provide: DevWorldService, useValue: { isActive: false } },
      ],
    });
    TestBed.overrideComponent(GameHeaderComponent, {
      set: {
        template,
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [CommonModule, MatTooltipModule, TdIconComponent],
      },
    });
    fixture = TestBed.createComponent(GameHeaderComponent);
    set({
      locationName: 'Heilbronn', baseHealth: MAX, credits: 1000, waveNumber: 3,
      enemiesAlive: 0, waveActive: false, waveEnemyTotal: 0, waveEnemiesLeft: 0,
    });
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  function set(values: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(values)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const plate = (kind: string) => el().querySelector(`.stat-plate.${kind}`) as HTMLElement;
  const lit = () => el().querySelectorAll('.stat-bar i.is-on').length;

  it('lights ten segments at full health, warms below 30 % and stripes below 10 %', () => {
    expect(plate('hp').dataset['level']).toBe('ok');
    expect(lit()).toBe(10);
    expect(el().querySelector('.hazard')).toBeNull();

    set({ baseHealth: MAX * 0.28 });
    expect(plate('hp').dataset['level']).toBe('low');
    expect(lit()).toBe(3);
    expect(el().querySelector('.hazard')).toBeNull();

    set({ baseHealth: MAX * 0.07 });
    expect(plate('hp').dataset['level']).toBe('critical');
    expect(lit()).toBe(1);
    expect(el().querySelector('.hazard')).not.toBeNull();
    expect(plate('hp').querySelector('.td-sr-only')!.textContent).toContain(`/ ${MAX}`);
  });

  it('flashes the HQ plate on a loss, not on a reset back up', () => {
    set({ baseHealth: MAX - 10 });
    expect(animate).toHaveBeenCalled();
    animate.mockClear();
    vi.advanceTimersByTime(1000);
    set({ baseHealth: MAX });
    expect(animate).not.toHaveBeenCalled();
  });

  it('raises the change over the credits plate, adds up a burst and lets it go', () => {
    set({ credits: 1025 });
    const delta = () => el().querySelector('.credits-delta');
    expect(delta()!.textContent).toBe('+25');
    vi.advanceTimersByTime(100);
    set({ credits: 1050 });
    expect(delta()!.textContent).toBe('+50');
    expect(plate('credits').querySelector('.td-sr-only')!.textContent).toBe('1,050');
    vi.advanceTimersByTime(1000);
    fixture.detectChanges();
    expect(delta()).toBeNull();

    set({ credits: 900 });
    expect(delta()!.textContent).toBe('−150');
    expect(delta()!.classList.contains('loss')).toBe(true);
  });

  it('shows credits and HQ set without play at once: no rising change, no counting, no flash', () => {
    set({ baseHealth: MAX - 10, credits: 1025 });
    expect(el().querySelector('.credits-delta')).not.toBeNull();
    animate.mockClear();
    vi.advanceTimersByTime(100);

    // A load: lower HQ and other credits arrive with a new jump count
    set({ stateJumps: 1, baseHealth: MAX - 200, credits: 4000 });
    expect(animate).not.toHaveBeenCalled();
    expect(el().querySelector('.credits-delta')).toBeNull();
    expect(plate('credits').querySelector('.stat-num')!.textContent).toBe('4000');

    // Play after the jump: the next change rises on its own, not added to the old sum
    set({ credits: 4010 });
    expect(el().querySelector('.credits-delta')!.textContent).toBe('+10');
  });

  it('flashes the credits figure when a buy is refused for too few credits', () => {
    refuseForCredits();
    fixture.detectChanges();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(plate('credits').querySelector('.stat-num'));
  });

  it('fills the wave bar with the share of the wave that is gone and edges the plate in brass at the start', () => {
    const fill = () => (el().querySelector('.wave-bar-fill') as HTMLElement).style.width;
    expect(fill()).toBe('0%');
    set({ waveActive: true, waveEnemyTotal: 50, waveEnemiesLeft: 50 });
    expect(plate('wave').classList.contains('starting')).toBe(true);
    set({ waveEnemiesLeft: 18 });
    expect(fill()).toBe('64%');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();
    expect(plate('wave').classList.contains('starting')).toBe(false);
  });
});
