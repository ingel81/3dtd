import { Injectable, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import type { ThreeTilesEngine } from '../../three-engine';
import {
  QUALITY_LEVELS, knobsWith, levelAfterMeasure, levelForGpu, levelValue, mixedOverrides, overrideWorld, qualityFromSearch,
  readStoredQuality, resolveLevel, writeStoredQuality, type PlantMotion, type QualityKnobs, type QualityLevel, type QualityOverride,
  type QualityOverrides, type QualitySetting, type QualityWorld, type StoredQuality,
} from '../../three-engine/render-quality';
import type { WorldRef } from '../../world/world-ref';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';

/**
 * Auto's first measurement: how long it waits after the world stood, GPU
 * frames it takes at most, how long at most from the first frame on, ms
 */
const MEASURE_SETTLE_MS = 2000;
const MEASURE_FRAMES = 120;
const MEASURE_MAX_MS = 8000;

/** The quality level's world kind of a world */
export function qualityWorldOf(ref: WorldRef): QualityWorld {
  return ref.kind === 'custom-map' ? 'custom-map' : 'tiles';
}

/** The GPU's name as WebGL gives it, from a throwaway context (no engine needed) */
function probeGpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/**
 * The picture's quality level (render-quality.ts, docs/RENDER_QUALITY.md):
 * the player's setting (Auto or a level, localStorage), what Auto made of
 * this machine, and the engine drawing at the level of its world. A change
 * of the setting reaches the running engine at once; only the canvas' own
 * MSAA waits for the next load (the composer stands in until then).
 *
 * Auto: a guess from the GPU's name, checked once by a short measurement of
 * the GPU time after the first world stood; custom maps play a level lower.
 * `&quality=<level>` in the URL plays that level for one load without
 * storing it (the graphics benchmark per level).
 *
 * On top of the level: the player's overrides per world (E156), kept until
 * a level is picked again, and the plant motion on custom maps, which no
 * level changes.
 */
@Injectable({ providedIn: 'root' })
export class RenderQualityService {
  private readonly stored = signal<StoredQuality>(readStoredQuality());
  /** This load's level from the URL, not stored */
  private readonly override = typeof location === 'undefined' ? null : qualityFromSearch(location.search);
  private gpuName: string | null = null;
  private engine: { engine: ThreeTilesEngine; world: QualityWorld } | null = null;
  private measuring = false;
  /** The intro flight, looked up when Auto stores its result (it holds the camera services) */
  private readonly injector = inject(Injector);

  /** What the player chose, Auto by default */
  readonly setting = computed<QualitySetting>(() => this.override ?? this.stored().setting);
  /** The URL sets the level for this load (the menu says so) */
  readonly fromUrl = this.override !== null;

  /** Auto's level for this machine (tiles; custom maps one lower) */
  readonly autoLevel = computed<QualityLevel>(() => {
    const gpu = this.gpu();
    const auto = this.stored().auto;
    return auto && auto.gpu === gpu ? auto.level : levelForGpu(gpu);
  });
  /** Auto checked its guess with a measurement on this machine */
  readonly autoMeasured = computed(() => {
    const auto = this.stored().auto;
    return !!auto && auto.gpu === this.gpu() && auto.measured;
  });

  /** The player's parts on top of the level (E156) */
  readonly overrides = computed<QualityOverrides>(() => this.stored().overrides);
  /** How grass, trees and plants move in a custom map's wind */
  readonly plantMotion = computed<PlantMotion>(() => this.stored().plantMotion);

  constructor() {
    // A changed setting, override or plant motion draws at once
    effect(() => {
      this.stored();
      this.setting();
      this.autoLevel();
      untracked(() => this.applyNow());
    });
  }

  /** The level that plays on `world` */
  levelFor(world: QualityWorld): QualityLevel {
    return resolveLevel(this.setting(), this.autoLevel(), world);
  }

  /** The knobs that play on `world`: its level with the player's overrides and plant motion on top */
  knobsFor(world: QualityWorld): QualityKnobs {
    const stored = this.stored();
    return knobsWith(this.levelFor(world), stored.overrides, stored.plantMotion);
  }

  /** What `key` plays now: the override, else what the level of its world sets */
  overrideValue(key: QualityOverride): QualityLevel | boolean {
    return this.stored().overrides[key] ?? levelValue(this.levelFor(overrideWorld(key)), key);
  }

  /** The overrides that make `world` the player's own mix rather than its level */
  mixed(world: QualityWorld): QualityOverride[] {
    return mixedOverrides(this.levelFor(world), this.stored().overrides, world);
  }

  /** Whether a new engine's canvas gets MSAA (fixed for its context's life) */
  canvasMsaa(world: QualityWorld): boolean {
    return this.knobsFor(world).general.antialias === 'msaa';
  }

  /** Pick a level: like an effect preset it sets every part again, the player's overrides go */
  set(setting: QualitySetting): void {
    this.store({ ...this.stored(), setting, overrides: {} });
  }

  /** Set one part on top of the level; what the level sets anyway is no override */
  setOverride<K extends QualityOverride>(key: K, value: NonNullable<QualityOverrides[K]>): void {
    const overrides = { ...this.stored().overrides };
    if (value === levelValue(this.levelFor(overrideWorld(key)), key)) delete overrides[key];
    else overrides[key] = value;
    this.store({ ...this.stored(), overrides });
  }

  /** `world` back to its level: its overrides go */
  resetOverrides(world: QualityWorld): void {
    const overrides = Object.fromEntries(Object.entries(this.stored().overrides)
      .filter(([key]) => overrideWorld(key as QualityOverride) !== world)) as QualityOverrides;
    this.store({ ...this.stored(), overrides });
  }

  setPlantMotion(plantMotion: PlantMotion): void {
    this.store({ ...this.stored(), plantMotion });
  }

  private store(next: StoredQuality): void {
    this.stored.set(next);
    writeStoredQuality(next);
  }

  /**
   * The engine of the world now loading: it draws at its level from here
   * on (Auto measures once the world stands, worldStood)
   */
  attach(engine: ThreeTilesEngine, ref: WorldRef): void {
    const world = qualityWorldOf(ref);
    this.engine = { engine, world };
    engine.applyQuality(this.knobsFor(world), world);
  }

  /**
   * The attached engine's world stands (its loading screen went): Auto
   * measures, once per machine, the frames of the world itself, not those
   * of its load
   */
  worldStood(engine: ThreeTilesEngine): void {
    const at = this.engine;
    if (at?.engine !== engine) return;
    if (this.setting() === 'auto' && !this.autoMeasured() && !this.fromUrl) void this.measureAuto(engine, at.world);
  }

  detach(engine: ThreeTilesEngine): void {
    if (this.engine?.engine === engine) this.engine = null;
  }

  private gpu(): string {
    this.gpuName ??= probeGpuName();
    return this.gpuName;
  }

  private applyNow(): void {
    const at = this.engine;
    if (!at) return;
    at.engine.applyQuality(this.knobsFor(at.world), at.world);
  }

  /**
   * Auto's check: once frames are drawn (the menu's globe may still cover
   * the game), the GPU time of up to MEASURE_FRAMES frames at this world's
   * level; too costly a level lower, very cheap a level higher
   * (levelAfterMeasure), stored with the GPU's name. Too few frames (the
   * page left, the tab hidden) store nothing: a later world measures again.
   * Without a timer the guess stays and counts as checked.
   */
  private async measureAuto(engine: ThreeTilesEngine, world: QualityWorld): Promise<void> {
    if (this.measuring) return;
    this.measuring = true;
    const gpu = this.gpu();
    const base = this.autoLevel();
    try {
      await wait(MEASURE_SETTLE_MS);
      const reader = engine.gpuMeter.open();
      const times: number[] = [];
      if (reader) {
        let until = Infinity;
        try {
          while (times.length < MEASURE_FRAMES && performance.now() < until && this.engine?.engine === engine && this.setting() === 'auto') {
            await wait(250);
            times.push(...reader.take());
            // The window opens with the first frame drawn
            if (times.length && until === Infinity) until = performance.now() + MEASURE_MAX_MS;
          }
        } finally {
          reader.close();
        }
      }
      if (this.engine?.engine !== engine || this.setting() !== 'auto') return;
      let level = base;
      if (reader) {
        if (times.length < MEASURE_FRAMES / 2) return;
        const sorted = times.sort((a, b) => a - b);
        const p90 = sorted[Math.floor(sorted.length * 0.9)];
        const measured = resolveLevel('auto', base, world);
        const step = QUALITY_LEVELS.indexOf(levelAfterMeasure(measured, p90)) - QUALITY_LEVELS.indexOf(measured);
        level = QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, QUALITY_LEVELS.indexOf(base) + step))];
      }
      // A new level switches the picture (its programs compile, the resolution changes): after the intro
      // flight, not in its middle, where the frames stood still for seconds on a first start
      const intro = this.injector.get(IntroCameraFlightService);
      while (intro.isRunning() && this.engine?.engine === engine && this.setting() === 'auto') await wait(250);
      if (this.engine?.engine !== engine || this.setting() !== 'auto') return;
      this.store({ ...this.stored(), auto: { gpu, level, measured: true } });
    } finally {
      this.measuring = false;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
