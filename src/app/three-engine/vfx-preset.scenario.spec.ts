/**
 * Playtest 400 (night 2, docs/archive/REVIEW_SPRINT_2026-09-14.md), the preset part:
 * Display, preset Low: frost without shards and mist, EMP and laser without
 * sparks.
 *
 * The chain: the preset's settings (withVfxPreset), ThreeTilesEngine.
 * applyVfxSettings handing impactEffects to the ability renderers (setFull),
 * the renderers leaving their particles out. debug-facade.service.spec.ts
 * covers the display menu handing the settings to the engine, the renderer
 * specs cover setFull on its own. Here the engine's real applyVfxSettings
 * runs on the real frost, EMP and beam renderers; the other members it talks
 * to are stubs, since the engine itself needs WebGL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mesh, PerspectiveCamera, Points, Scene, ShaderMaterial, Sprite, Vector3 } from 'three';
import { ThreeTilesEngine } from './three-tiles-engine';
import { FrostBurstRenderer } from './renderers/frost-burst.renderer';
import { EmpPulseRenderer } from './renderers/emp-pulse.renderer';
import { OrbitalBeamRenderer } from './renderers/orbital-beam.renderer';
import { DEFAULT_VFX_SETTINGS, withVfxPreset, type VfxPreset } from './vfx-settings';
import { FROST_BURST_LOOK } from '../configs/visual-effects.config';

const GROUND = new Vector3(20, 10, -30);
/** 60 m straight along -z at ground height 10, a point every 5 m */
const PATH = Array.from({ length: 13 }, (_, i) => new Vector3(20, 10, -i * 5));

const drawn = (points: Points) => (points.visible ? points.geometry.drawRange.count : 0);

/** Math.random with a fixed sequence, as the renderer specs draw their particles */
function seededRandom(seed = 1): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  });
}

/** A renderer of its own scene and materials, as the engine creates it */
function inScene<T>(create: (scene: Scene, materials: { additive: ShaderMaterial; normal: ShaderMaterial }) => T) {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  return { scene, materials, renderer: create(scene, materials) };
}

/** The ability renderers behind the engine's real applyVfxSettings, set to `preset` */
function withPreset(preset: VfxPreset) {
  const frost = inScene((scene, materials) => new FrostBurstRenderer(scene, materials));
  const emp = inScene((scene, materials) => new EmpPulseRenderer(scene, materials));
  const beam = inScene((scene, materials) => new OrbitalBeamRenderer(scene, materials));
  const engine = {
    effects: { setVfxSettings: vi.fn() },
    mushroomClouds: { setFullCloud: vi.fn() },
    missileLaunches: { setFull: vi.fn() },
    frostBursts: frost.renderer,
    empPulses: emp.renderer,
    orbitalBeams: beam.renderer,
    trailStreaks: { setEnabled: vi.fn() },
    towers: { setMuzzleFlashEnabled: vi.fn() },
    enemies: { setFreezeTintEnabled: vi.fn() },
    postProcessing: null,
    bloodMoon: { setEnabled: vi.fn() },
  };
  ThreeTilesEngine.prototype.applyVfxSettings.call(engine as unknown as ThreeTilesEngine, withVfxPreset(DEFAULT_VFX_SETTINGS, preset));

  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(20, 220, 300);
  camera.lookAt(GROUND);
  /** `ms` of game time in frames of 16 ms */
  const run = (update: (ms: number) => void, ms: number) => {
    for (let done = 0; done < ms - 1e-6; done += 16) update(Math.min(16, ms - done));
  };

  // F, E and L go off, as VFXService starts them on ability:impact
  frost.renderer.burst(GROUND, 20, 3);
  emp.renderer.pulse(GROUND, 30);
  beam.renderer.fire(PATH, 5, 18, 4, null);
  // Halfway through the frost flash, so all three of flash, ring and rime show
  run((ms) => frost.renderer.update(ms, camera, 1080), FROST_BURST_LOOK.flash.duration * 500);
  run((ms) => emp.renderer.update(ms, camera, 1080), 100);
  run((ms) => beam.renderer.update(ms, camera, 1080), 800);

  const points = (scene: Scene) => scene.children.filter((c): c is Points => c instanceof Points);
  const meshes = (scene: Scene) => scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const sprites = (scene: Scene) => scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const [frostRing, frostRime] = meshes(frost.scene); // per burst slot: ring, then rime
  return {
    engine,
    shards: points(frost.scene).find((p) => p.material === frost.materials.additive)!,
    mist: points(frost.scene).find((p) => p.material === frost.materials.normal)!,
    frostRing,
    frostRime,
    frostFlash: sprites(frost.scene)[0],
    empSparks: points(emp.scene)[0],
    empFronts: meshes(emp.scene),
    beamSparks: beam.scene.getObjectByName('orbital-beam-sparks') as Points,
    beamSmoke: beam.scene.getObjectByName('orbital-beam-smoke') as Points,
    beamEmbers: beam.scene.getObjectByName('orbital-beam-embers') as Mesh,
    beamGroundGlow: beam.scene.getObjectByName('orbital-beam-ground-glow-0') as Mesh,
    beamColumn: beam.scene.getObjectByName('orbital-beam-column-0') as Mesh,
  };
}

describe('Effect preset and the ability effects, playtest 400', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('400: preset Low: frost without shards and mist, EMP and laser without sparks; what is left still shows', () => {
    seededRandom();
    const low = withPreset('low');
    expect(drawn(low.shards)).toBe(0);
    expect(drawn(low.mist)).toBe(0);
    expect(drawn(low.empSparks)).toBe(0);
    expect(drawn(low.beamSparks)).toBe(0);
    // Playtest 636: the laser's smoke, embers and ground glow stay off in Low as well
    expect(drawn(low.beamSmoke)).toBe(0);
    expect(low.beamEmbers.visible).toBe(false);
    expect(low.beamGroundGlow.visible).toBe(false);
    // Flash, cold ring and rime; the EMP's fronts; the beam's column
    expect(low.frostRing.visible).toBe(true);
    expect(low.frostRime.visible).toBe(true);
    expect(low.frostFlash.visible).toBe(true);
    expect(low.empFronts.some((m) => m.visible)).toBe(true);
    expect(low.beamColumn.visible).toBe(true);
    // The nuke's cloud and missile are told the same
    expect(low.engine.mushroomClouds.setFullCloud).toHaveBeenCalledWith(false);
    expect(low.engine.missileLaunches.setFull).toHaveBeenCalledWith(false);
  });

  it('400 counter-check: preset Medium and High keep shards, mist and sparks', () => {
    seededRandom();
    for (const preset of ['medium', 'high'] as const) {
      const full = withPreset(preset);
      expect(drawn(full.shards), preset).toBeGreaterThan(0);
      expect(drawn(full.mist), preset).toBeGreaterThan(0);
      expect(drawn(full.empSparks), preset).toBeGreaterThan(0);
      expect(drawn(full.beamSparks), preset).toBeGreaterThan(0);
      expect(drawn(full.beamSmoke), preset).toBeGreaterThan(0);
      expect(full.beamEmbers.visible, preset).toBe(true);
      expect(full.beamGroundGlow.visible, preset).toBe(true);
      expect(full.engine.mushroomClouds.setFullCloud, preset).toHaveBeenCalledWith(true);
      expect(full.engine.missileLaunches.setFull, preset).toHaveBeenCalledWith(true);
    }
  });
});
