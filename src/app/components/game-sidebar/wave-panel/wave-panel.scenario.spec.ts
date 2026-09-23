// The timeline and the facade import partially compiled @angular/material, which needs the JIT compiler
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Effects are collected, not scheduled: a test runs them where Angular would,
 * right after the signal they read changed (as in blood-moon-banner.scenario).
 */
const angular = vi.hoisted(() => ({ effects: [] as (() => void)[] }));
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    effect: (fn: () => void) => {
      angular.effects.push(fn);
      return { destroy: () => undefined };
    },
  };
});
// Only their DI tokens are needed; the real modules pull in the game state manager
vi.mock('../../../services/boss-intro.service', () => ({ BossIntroService: class BossIntroService {} }));
vi.mock('../../../services/replay.service', () => ({ ReplayService: class ReplayService {} }));
vi.mock('../../../services/tower-control.service', () => ({ TowerControlService: class TowerControlService {} }));

import { Injector, NgZone, runInInjectionContext, signal } from '@angular/core';
import { BLOOD_MOON_NOTE, NEXT_WAVE_MARKS, peekUpcomingWaves, type WavePeek } from './upcoming-waves';
import { waveButtonView } from './wave-button';
import { WaveTimelineComponent } from './wave-timeline.component';
import { UIStore } from '../../../store/ui.store';
import { GameLoopFacadeService } from '../../../services/facade/game-loop-facade.service';
import { EngineStore } from '../../../store/engine.store';
import { CameraControlService } from '../../../services/camera-control.service';
import { TowerPlacementService } from '../../../services/tower-placement.service';
import { MapPlacementService } from '../../../services/world/map-placement.service';
import { KeyboardPanService } from '../../../services/keyboard-pan.service';
import { MarkerVisualizationService } from '../../../services/world/marker-visualization.service';
import { RouteAnimationService } from '../../../services/world/route-animation.service';
import { IntroCameraFlightService } from '../../../services/world/intro-camera-flight.service';
import { WaveDebugService } from '../../../services/debug/wave-debug.service';
import { SoundDebugService } from '../../../services/debug/sound-debug.service';
import { DebugWindowService } from '../../../services/debug/debug-window.service';
import { EnemyDebugService } from '../../../services/debug/enemy-debug.service';
import { WaveDirector } from '../../../director/wave-director';
import { waveDirectorStub } from '../../../director/wave-director.stub';
import { AdaptiveWaveSource } from '../../../director/sources/adaptive/adaptive-source';
import { StateSnapshotService } from '../../../director/state-snapshot.service';
import { BotClientService } from '../../../bots/bot-client.service';
import { TowerDefenseStore } from '../../../store/tower-defense.store';
import { PerformanceProfilerService } from '../../../services/debug/performance-profiler.service';
import { StreetRenderingService } from '../../../services/world/street-rendering.service';
import { BossIntroService } from '../../../services/boss-intro.service';
import { ReplayService } from '../../../services/replay.service';
import { TowerControlService } from '../../../services/tower-control.service';
import { GameEventBus } from '../../../game-engine/game-event-bus';
import { AUTO_WAVE_DELAY_MS } from '../../../utils/auto-wave-countdown';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import type { FacadeComponentBridge } from '../../../services/facade/tower-defense-facade.service';
import type { GameStateManager } from '../../../managers/game-state.manager';
import { RunLogFacade } from '../../../run-log/run-log.facade';

/** GameClock.FIXED_STEP_MS: the length of one gameplay sub-step. */
const STEP_MS = 16.667;
/** SidebarWavePanelComponent.autoStartSeconds */
const AUTO_SECONDS = AUTO_WAVE_DELAY_MS / 1000;

/**
 * Playtest 324 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed: the auto-start
 * switch under the wave button. The switch is UIStore.autoStartWaves
 * (SidebarWavePanelComponent.toggleAutoStart), the countdown runs in
 * GameLoopFacadeService on the game clock, the button text is waveButtonView
 * with the store's seconds, as the panel computes it.
 */
describe('Wave button and auto-start, playtest 324 replayed', () => {
  /** Injected by the facade but not touched by the auto-start */
  const UNUSED = [
    EngineStore, CameraControlService, TowerPlacementService, MapPlacementService, KeyboardPanService,
    MarkerVisualizationService, RouteAnimationService, IntroCameraFlightService,
    WaveDebugService, SoundDebugService, DebugWindowService, EnemyDebugService,
    StateSnapshotService, PerformanceProfilerService,
    StreetRenderingService, BossIntroService, ReplayService, TowerControlService,
  ];

  beforeEach(() => {
    localStorage.clear();
    angular.effects.length = 0;
  });

  it('a new game: "Wave 1" with the Space key cap, no countdown, the switch off', () => {
    const ui = new UIStore();
    expect(ui.autoStartWaves()).toBe(false);
    // wave-panel.component.html: the Space cap stands while there is no countdown
    expect(waveButtonView(0 + 1, false, 0, 0, null, AUTO_SECONDS)).toMatchObject({
      label: 'Wave 1',
      ariaLabel: 'Start wave 1',
      countdown: null,
    });
    expect(AUTO_SECONDS).toBe(10);
  });

  it('the switch is still on after a reload', () => {
    vi.useFakeTimers();
    try {
      const ui = new UIStore();
      const persist = angular.effects.slice();
      // SidebarWavePanelComponent.toggleAutoStart
      ui.autoStartWaves.update((on) => !on);
      for (const run of persist) run();
      vi.advanceTimersByTime(1000);

      expect(JSON.parse(localStorage.getItem('td-ui-state')!).autoStartWaves).toBe(true);
      expect(new UIStore().autoStartWaves()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a wave the button counts 10s down to 1s in game time, the bar runs out, then the next wave starts once', () => {
    const bus = new GameEventBus();
    const clock = { gameTimeMs: 120_000 };
    const store = {
      phase: signal<string>('setup'),
      waveNumber: signal(1),
      autoWaveSecondsLeft: signal<number | null>(null),
    };
    const injector = Injector.create({
      providers: [
        ...UNUSED.map((token) => ({ provide: token, useValue: {} })),
        { provide: WaveDirector, useValue: waveDirectorStub() },
        { provide: RunLogFacade, useValue: { tick: () => undefined, collector: { noteDirectorDecision: () => undefined } } },
        { provide: NgZone, useValue: { run: (fn: () => unknown) => fn() } },
        { provide: TowerDefenseStore, useValue: store },
        { provide: UIStore, useValue: { autoStartWaves: signal(true) } },
        { provide: BotClientService, useValue: { botEnabled: signal(false) } },
      ],
    });
    const facade = runInInjectionContext(injector, () => new GameLoopFacadeService());
    facade.initialize(
      { getEngine: () => ({}) } as unknown as FacadeComponentBridge,
      { getEventBus: () => bus, get gameTimeMs() { return clock.gameTimeMs; }, waveManager: { stopSpawning: vi.fn() } } as unknown as GameStateManager,
    );
    facade.subscribeToEventBus({ onGameOverExtra: () => undefined });
    const startWave = vi.spyOn(facade, 'startWave').mockImplementation(() => undefined);
    // SidebarWavePanelComponent.waveButton between waves: the upcoming wave
    const button = () => waveButtonView(store.waveNumber() + 1, false, 0, 0, store.autoWaveSecondsLeft(), AUTO_SECONDS);

    bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
    expect(button()).toMatchObject({
      label: 'Wave 2',
      countdown: '10s',
      barPercent: 100,
      ariaLabel: 'Start wave 2 now, starts by itself in 10s',
    });

    const shown: string[] = [];
    const bars: number[] = [];
    let steps = 0;
    while (startWave.mock.calls.length === 0 && steps < 2000) {
      clock.gameTimeMs += STEP_MS;
      steps++;
      facade.tickAutoWave();
      const view = button();
      if (view.countdown !== null && shown[shown.length - 1] !== view.countdown) shown.push(view.countdown);
      bars.push(view.barPercent);
    }

    expect(shown).toEqual(['10s', '9s', '8s', '7s', '6s', '5s', '4s', '3s', '2s', '1s']);
    expect(steps * STEP_MS).toBeGreaterThanOrEqual(AUTO_WAVE_DELAY_MS);
    expect((steps - 1) * STEP_MS).toBeLessThan(AUTO_WAVE_DELAY_MS);
    for (let i = 1; i < bars.length; i++) expect(bars[i]).toBeLessThanOrEqual(bars[i - 1]);
    // The start ends the countdown, the Space cap is back
    expect(button().countdown).toBeNull();

    for (let i = 0; i < 1000; i++) {
      clock.gameTimeMs += STEP_MS;
      facade.tickAutoWave();
    }
    expect(startWave).toHaveBeenCalledTimes(1);
  });
});

/**
 * Playtest 326, 327, 365 and 372 (docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed
 * on the NEXT timeline: the real WaveTimelineComponent with the marks the
 * WAVE panel hands it (peekUpcomingWaves with the store's wave, the tower DPS
 * and the blood moon switch). The pointer and focus handlers of the template
 * set `hovered`, a click sets `picked` (wave-timeline.component.html).
 */
/**
 * The facts of the coming waves, as the panel gets them from the source the
 * run plays, worded by `peekUpcomingWaves`.
 */
const nextSource = new AdaptiveWaveSource();
const peekWaves = (currentWave: number, towerDps: number, count: number, bloodMoon: boolean) =>
  peekUpcomingWaves(
    nextSource.peek({ fromWave: currentWave + 1, count, defense: { totalDps: towerDps } }),
    bloodMoon,
  );

describe('NEXT timeline, playtest 326, 327, 365 and 372 replayed', () => {
  const timeline = (peeks: WavePeek[]) => {
    const component = runInInjectionContext(Injector.create({ providers: [] }), () => new WaveTimelineComponent());
    // The panel's [peeks] binding
    (component as unknown as { peeks: () => WavePeek[] }).peeks = () => peeks;
    return component;
  };

  it('326: a new game shows W1 to W5, W1 in detail with the counters as flame, drop and target', () => {
    const peeks = peekWaves(0, 0, NEXT_WAVE_MARKS, true);
    const next = timeline(peeks);
    expect(peeks.map((p) => p.wave)).toEqual([1, 2, 3, 4, 5]);

    const w1 = next.shown()!;
    expect(w1).toMatchObject({ wave: 1, name: 'Zombie Horde', known: true, armorLabel: 'Unarmored' });
    expect(w1.count!.startsWith('20')).toBe(true);
    expect(w1.weakToTypes.map((type) => next.damageTypeIcon(type))).toEqual(['flame', 'splash', 'target']);
    expect(w1.tooltip).toContain('Weak to Fire, Poison, Pierce.');
    expect(next.markLabel(w1)).toBe('Wave 1, Zombie Horde');
  });

  it('326: the pointer on mark 3 shows W3, away springs back; a click on 4 stays, also after another hover', () => {
    const next = timeline(peekWaves(0, 0, NEXT_WAVE_MARKS, true));

    next.hovered.set(3); // mouseenter (focus alike)
    expect(next.shown()?.wave).toBe(3);
    next.hovered.set(null); // mouseleave (blur alike)
    expect(next.shown()?.wave).toBe(1);

    next.picked.set(4); // click
    expect(next.shown()?.wave).toBe(4);
    next.hovered.set(2);
    expect(next.shown()?.wave).toBe(2);
    next.hovered.set(null);
    expect(next.shown()?.wave).toBe(4);
  });

  it('327: after W5 the marks are 6 to 10, the plane over 7 (and 8), the skull only over 10', () => {
    const peeks = peekWaves(5, 0, NEXT_WAVE_MARKS, true);
    const next = timeline(peeks);
    expect(peeks.map((p) => p.wave)).toEqual([6, 7, 8, 9, 10]);
    // W7 Bat Swarm is the air debut, W8 Hornet Strike brings more air (campaign.config.ts)
    expect(peeks.filter((p) => p.air).map((p) => p.wave)).toEqual([7, 8]);
    expect(peeks.filter((p) => p.boss).map((p) => p.wave)).toEqual([10]);
    expect(peeks.some((p) => p.bloodMoon)).toBe(false);
    expect(next.markLabel(peeks[1])).toBe('Wave 7, Bat Swarm, air');
  });

  it('372: after W9 the moon stands over mark 14; its tooltip ends with the blood moon sentence, the rest as with the look off', () => {
    const on = peekWaves(9, 0, NEXT_WAVE_MARKS, true);
    const off = peekWaves(9, 0, NEXT_WAVE_MARKS, false);
    expect(on.map((p) => p.wave)).toEqual([10, 11, 12, 13, 14]);
    expect(on.filter((p) => p.bloodMoon).map((p) => p.wave)).toEqual([14]);

    const w14 = on[4];
    expect(BLOOD_MOON_NOTE.startsWith('Blood moon (every 7th wave): ')).toBe(true);
    expect(w14.tooltip.endsWith(BLOOD_MOON_NOTE)).toBe(true);
    expect(w14.tooltip).toBe(`${off[4].tooltip} ${BLOOD_MOON_NOTE}`);
    expect({ ...w14, bloodMoon: false, tooltip: off[4].tooltip }).toEqual(off[4]);
    // The other marks are the same with the look on or off
    expect(on.slice(0, 4)).toEqual(off.slice(0, 4));
    expect(timeline(on).markLabel(w14)).toContain('blood moon');
  });

  it('365: after a jump to 45 (counter 44) the first mark is W45 "Boss: Ooze" with the skull', () => {
    const [w45] = peekWaves(44, 0, NEXT_WAVE_MARKS, true);
    expect(w45).toMatchObject({ wave: 45, name: 'Boss: Ooze', boss: true, known: true, count: null });
    expect(w45.armors).toEqual([ARMOR_TYPE_UI[ENEMY_TYPES['ooze'].armorType].label]);
    expect(w45.tooltip).toContain('A mass of slime');
  });
});
