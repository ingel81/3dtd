import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import type { ThreeTilesEngine } from '../../three-engine';
import {
  QUALITY_LEVELS, QUALITY_TABLE, levelAfterMeasure, levelForGpu, qualityFromSearch, readStoredQuality, resolveLevel,
  writeStoredQuality, type QualityKnobs, type QualityLevel, type QualitySetting, type QualityWorld, type StoredQuality,
} from '../../three-engine/render-quality';
import type { WorldRef } from '../../world/world-ref';

/** Auto's first measurement: frames it waits for, GPU frames it takes at most, how long at most, ms */
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
 */
@Injectable({ providedIn: 'root' })
export class RenderQualityService {
  private readonly stored = signal<StoredQuality>(readStoredQuality());
  /** This load's level from the URL, not stored */
  private readonly override = typeof location === 'undefined' ? null : qualityFromSearch(location.search);
  private gpuName: string | null = null;
  private engine: { engine: ThreeTilesEngine; world: QualityWorld } | null = null;
  private measuring = false;

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

  constructor() {
    // A changed setting draws at once
    effect(() => {
      const setting = this.setting();
      const auto = this.autoLevel();
      untracked(() => this.applyNow(setting, auto));
    });
  }

  /** The level that plays on `world` */
  levelFor(world: QualityWorld): QualityLevel {
    return resolveLevel(this.setting(), this.autoLevel(), world);
  }

  knobsFor(world: QualityWorld): QualityKnobs {
    return QUALITY_TABLE[this.levelFor(world)];
  }

  /** Whether a new engine's canvas gets MSAA (fixed for its context's life) */
  canvasMsaa(world: QualityWorld): boolean {
    return this.knobsFor(world).general.antialias === 'msaa';
  }

  set(setting: QualitySetting): void {
    const next = { ...this.stored(), setting };
    this.stored.set(next);
    writeStoredQuality(next);
  }

  /**
   * The engine of the world now loading: it draws at its level from here
   * on; Auto measures once, the first time a world stands on this machine
   */
  attach(engine: ThreeTilesEngine, ref: WorldRef): void {
    const world = qualityWorldOf(ref);
    this.engine = { engine, world };
    engine.applyQuality(this.knobsFor(world), world);
    if (this.setting() === 'auto' && !this.autoMeasured() && !this.fromUrl) void this.measureAuto(engine, world);
  }

  detach(engine: ThreeTilesEngine): void {
    if (this.engine?.engine === engine) this.engine = null;
  }

  private gpu(): string {
    this.gpuName ??= probeGpuName();
    return this.gpuName;
  }

  private applyNow(setting: QualitySetting, auto: QualityLevel): void {
    const at = this.engine;
    if (!at) return;
    at.engine.applyQuality(QUALITY_TABLE[resolveLevel(setting, auto, at.world)], at.world);
  }

  /**
   * Auto's check: once frames are drawn, the GPU time of up to
   * MEASURE_FRAMES frames at this world's level; too costly a level lower,
   * very cheap a level higher (levelAfterMeasure), stored with the GPU's
   * name. Without a timer the guess stays and counts as checked.
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
        const until = performance.now() + MEASURE_MAX_MS;
        while (times.length < MEASURE_FRAMES && performance.now() < until && this.engine?.engine === engine) {
          await wait(250);
          times.push(...reader.take());
        }
        reader.close();
      }
      if (this.engine?.engine !== engine || this.setting() !== 'auto') return;
      let level = base;
      if (times.length >= MEASURE_FRAMES / 2) {
        const sorted = times.sort((a, b) => a - b);
        const p90 = sorted[Math.floor(sorted.length * 0.9)];
        const measured = resolveLevel('auto', base, world);
        const step = QUALITY_LEVELS.indexOf(levelAfterMeasure(measured, p90)) - QUALITY_LEVELS.indexOf(measured);
        level = QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, QUALITY_LEVELS.indexOf(base) + step))];
      }
      const next = { ...this.stored(), auto: { gpu, level, measured: true } };
      this.stored.set(next);
      writeStoredQuality(next);
    } finally {
      this.measuring = false;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
