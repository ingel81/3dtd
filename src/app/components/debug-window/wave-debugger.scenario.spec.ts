// The panel's imports include partially compiled Angular packages, which need the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { WaveDirector } from '../../director/wave-director';
import { waveDirectorStub } from '../../director/wave-director.stub';
import { WaveDebuggerComponent } from './wave-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { WaveDebugService } from '../../services/debug/wave-debug.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { planRowForWave } from '../../director/sources/budget/run-plan';

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
        { provide: TowerDefenseStore, useValue: { waveNumber, phase, waveExplanation: signal(null) } },
        { provide: WaveDirector, useValue: waveDirectorStub() },
      ],
    });
    debuggerPanel = runInInjectionContext(injector, () => new WaveDebuggerComponent());
    // The debug window's [eventBus] binding
    (debuggerPanel as unknown as { eventBus: () => GameEventBus }).eventBus = () => bus;
  });

  /** The number field's change event */
  const enter = (value: string) =>
    debuggerPanel.onJumpWaveChange({ target: { value } } as unknown as Event);

  it('378: before W1 the field holds 30, named "Boss: Skarnax", gold on, "Jump: next start Wave 30"', () => {
    expect(debuggerPanel.jumpWave()).toBe(30);
    expect(debuggerPanel.jumpWaveName()).toBe('Boss: Skarnax');
    expect(debuggerPanel.jumpGrantGold()).toBe(true);
    expect(debuggerPanel.jumpLabel()).toBe('Jump: next start Wave 30');
    expect(debuggerPanel.canJump()).toBe(true);

    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([{ wave: 30, grantGold: true }]);
  });

  it('380: 20 is "Boss: Ooze"; a number that skips no wave greys the button, "Wave N or later"', () => {
    // W10 played
    waveNumber.set(10);
    enter('20');
    expect(debuggerPanel.jumpWaveName()).toBe('Boss: Ooze');
    expect(debuggerPanel.jumpLabel()).toBe('Jump: next start Wave 20');

    enter('11');
    expect(debuggerPanel.canJump()).toBe(false);
    expect(debuggerPanel.jumpLabel()).toBe('Wave 12 or later');
    debuggerPanel.onJumpToWave();
    expect(jumps).toEqual([]);

    enter('12');
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

  it('names every wave by the run plan, past the campaign as well', () => {
    enter('40');
    expect(debuggerPanel.jumpWaveName()).toBe('Boss: Stone Golem');
    enter('41');
    expect(debuggerPanel.jumpWaveName()).toBe(planRowForWave(41)!.name);
    enter('7');
    expect(debuggerPanel.jumpWaveName()).toBe('Bat Swarm');
  });
});
