// The panel's imports include partially compiled Angular packages, which need the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { WaveDebuggerComponent } from './wave-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { WaveDebugService } from '../../services/debug/wave-debug.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameEventBus } from '../../game-engine/game-event-bus';

/**
 * Playtest 378 and 380 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed on the
 * "Jump to wave" section of the Wave Debug window: the real component, the
 * store's wave and phase as signals, its event on a real bus. The event goes
 * to GameStateManager.jumpToWave through GameCommandsHandler
 * (game-state.manager.spec.ts, 'runs through the command pipeline as
 * debug:jump-to-wave').
 */
describe('Jump to wave section, playtest 378 and 380 replayed', () => {
  let bus: GameEventBus;
  let jumps: { wave: number; grantGold: boolean }[];
  let debuggerPanel: WaveDebuggerComponent;
  const waveNumber = signal(0);
  const phase = signal<'setup' | 'wave' | 'gameover'>('setup');

  beforeEach(() => {
    bus = new GameEventBus();
    jumps = [];
    bus.on('debug:jump-to-wave', (e) => jumps.push({ wave: e.wave, grantGold: e.grantGold }));
    waveNumber.set(0);
    phase.set('setup');
    const injector = Injector.create({
      providers: [
        { provide: DebugWindowService, useValue: {} },
        { provide: WaveDebugService, useValue: {} },
        { provide: TowerDefenseStore, useValue: { waveNumber, phase, aiExplanation: signal(null) } },
      ],
    });
    debuggerPanel = runInInjectionContext(injector, () => new WaveDebuggerComponent());
    // The debug window's [eventBus] binding
    (debuggerPanel as unknown as { eventBus: () => GameEventBus }).eventBus = () => bus;
  });

  /** The number field's change event */
  const enter = (value: string) =>
    debuggerPanel.onJumpWaveChange({ target: { value } } as unknown as Event);

  it('378: before W1 the field holds 35, named "Boss: Skarnax", gold on, "Jump: next start Wave 35"', () => {
    expect(debuggerPanel.jumpWave()).toBe(35);
    expect(debuggerPanel.jumpWaveName()).toBe('Boss: Skarnax');
    expect(debuggerPanel.jumpGrantGold()).toBe(true);
    expect(debuggerPanel.jumpLabel()).toBe('Jump: next start Wave 35');
    expect(debuggerPanel.canJump()).toBe(true);

    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([{ wave: 35, grantGold: true }]);
  });

  it('380: 45 is "Boss: Ooze"; a number that skips no wave greys the button, "Wave N or later"', () => {
    // W35 played
    waveNumber.set(35);
    enter('45');
    expect(debuggerPanel.jumpWaveName()).toBe('Boss: Ooze');
    expect(debuggerPanel.jumpLabel()).toBe('Jump: next start Wave 45');

    enter('36');
    expect(debuggerPanel.canJump()).toBe(false);
    expect(debuggerPanel.jumpLabel()).toBe('Wave 37 or later');
    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([]);

    enter('37');
    expect(debuggerPanel.canJump()).toBe(true);
  });

  it('380: in a wave the button says "Between waves only" and sends nothing', () => {
    phase.set('wave');
    expect(debuggerPanel.jumpLabel()).toBe('Between waves only');
    expect(debuggerPanel.canJump()).toBe(false);
    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([]);
  });

  it('380: the gold switch off sends the jump without the gold', () => {
    debuggerPanel.onJumpGrantGoldChange({ target: { checked: false } } as unknown as Event);
    enter('14');
    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([{ wave: 14, grantGold: false }]);
  });

  it('names a wave between the bosses past the curriculum as the director\'s, W40 as a boss wave', () => {
    enter('40');
    expect(debuggerPanel.jumpWaveName()).toBe('Boss wave');
    enter('41');
    expect(debuggerPanel.jumpWaveName()).toBe('Director wave');
    // A curriculum wave by its template
    enter('7');
    expect(debuggerPanel.jumpWaveName()).toBe('Bat Swarm');
  });
});
