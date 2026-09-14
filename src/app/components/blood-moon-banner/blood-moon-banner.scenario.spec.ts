// LiveAnnouncer pulls in partially compiled @angular/cdk, which needs the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Playtest 554 and 556 (fix session 2026-09-14): "BLOOD MOON / Wave 35"
 * against the worm's boss intro. The component as it runs: the wave start
 * comes over the real event bus, the intro's `active` is a signal. Angular
 * would schedule the component's effect on its own; here it runs where that
 * would happen, right after `active` changed. The banner's Web Animation is a
 * fake whose clock the test sets.
 */
const angular = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  chip: null as unknown,
}));
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return {
    ...actual,
    effect: (fn: () => void) => {
      angular.effects.push(fn);
      fn();
      return { destroy: () => undefined };
    },
    viewChild: () => () => angular.chip,
  };
});

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { BloodMoonBannerComponent } from './blood-moon-banner.component';
import { GameStateManager } from '../../managers/game-state.manager';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { BossIntroService } from '../../services/boss-intro.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { isBloodMoonWave } from '../../configs/blood-moon.config';

interface FakeRun {
  currentTime: number | null;
  cancel: ReturnType<typeof vi.fn>;
}

describe('Blood moon banner around the boss intro (playtest 554, 556)', () => {
  let bus: GameEventBus;
  let introActive: ReturnType<typeof signal<boolean>>;
  let runs: FakeRun[];
  let animate: ReturnType<typeof vi.fn>;

  /** The boss intro starts or ends; the component's effect follows. */
  const setIntro = (active: boolean) => {
    introActive.set(active);
    for (const run of angular.effects) run();
  };
  const waveStarts = (wave: number) => bus.emit({ type: 'wave:started', wave } as never);

  beforeEach(() => {
    angular.effects.length = 0;
    runs = [];
    animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => {
      const run: FakeRun = {
        currentTime: 0,
        cancel: vi.fn(() => {
          run.currentTime = null;
        }),
      };
      runs.push(run);
      return run;
    });
    angular.chip = { nativeElement: { animate } };
    bus = new GameEventBus();
    introActive = signal(false);
    const injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => bus } },
        { provide: DebugFacadeService, useValue: { vfx: signal({ bloodMoon: true }) } },
        { provide: LiveAnnouncer, useValue: { announce: vi.fn(async () => undefined) } },
        { provide: BossIntroService, useValue: { active: introActive } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    runInInjectionContext(injector, () => new BloodMoonBannerComponent());
  });

  it('W35 is a blood moon wave', () => {
    expect(isBloodMoonWave(35)).toBe(true);
  });

  it('556: without an intro the banner plays once, 3.6 s, at the wave start', () => {
    waveStarts(35);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 3600 });

    // The wave runs on, the intro stays off
    runs[0].currentTime = 3600;
    for (const run of angular.effects) run();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(runs[0].cancel).not.toHaveBeenCalled();
  });

  it('554: the worm steps out while the banner stands: it goes with the veil and plays once more in full', () => {
    waveStarts(35);
    runs[0].currentTime = 1500;

    setIntro(true);
    expect(runs[0].cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);

    setIntro(false);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(runs[1].currentTime).toBe(0);
    expect(animate.mock.calls[1][1]).toMatchObject({ duration: 3600 });
  });

  it('554: a banner already fading out (from 72 %, 2592 ms) does not come back', () => {
    waveStarts(35);
    runs[0].currentTime = 2600;

    setIntro(true);
    setIntro(false);
    expect(runs[0].cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('554: Esc skips the intro: the banner comes as soon as the intro is over', () => {
    waveStarts(35);
    runs[0].currentTime = 400;
    setIntro(true);
    // Skipped at once: BossIntroService.active goes false with the veil
    setIntro(false);
    expect(animate).toHaveBeenCalledTimes(2);
  });
});
