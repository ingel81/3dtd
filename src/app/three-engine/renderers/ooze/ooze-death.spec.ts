import { describe, it, expect, vi } from 'vitest';
import { Matrix4, Scene, Texture, Vector3, type InstancedMesh } from 'three';
import { BURST_PALETTES, OOZE_DEATH_LOOK, OOZE_LOOK } from '../../../configs/visual-effects.config';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { METERS_PER_DEGREE_LAT } from '../../../utils/geo-utils';
import { RouteBodyStations } from '../../../utils/route-body';
import { SeededRandom } from '../../../utils/seeded-random';
import { DEFAULT_VFX_SETTINGS, withVfxPreset } from '../../vfx-settings';
import type { GooSplash, GroundDecals } from '../ground-decals';
import { ParticlePoolManager } from '../particle-pool-manager';
import { ParticleEffectsRenderer } from '../particle-effects-renderer';
import type { CoordinateSync } from '../index';
import { OozeBandRenderer, type OozeMessEffects } from './ooze-band.renderer';
import { OOZE_DEBRIS_DECK, OozeDebrisRenderer, type OozeDebrisKind } from './ooze-debris.renderer';
import { oozeMessCounts, planOozeDeath } from './ooze-death-plan';

// The atlases paint on a 2D canvas, which jsdom lacks
vi.mock('../sprite-atlas-generator', () => ({
  generateExplosionAtlas: () => new Texture(),
  generateSmokeAtlas: () => new Texture(),
}));

const M = METERS_PER_DEGREE_LAT;
const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * M, height, -lat * M),
};
/** 200 m north, 3 m left and 5 m right of the centre line, the ground at 0 */
const stations = new RouteBodyStations(
  [
    { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 5 },
    { lat: 200 / M, lon: 0, corridorLeft: 3, corridorRight: 5 },
  ],
  flatSync,
  0,
);

const FRAME_MS = 16;
const LOW = withVfxPreset(DEFAULT_VFX_SETTINGS, 'low');

interface LaidSplash extends GooSplash {
  lat: number;
  lon: number;
  height: number;
}

function effectsMock(impacts = true, groundMarks = true) {
  const splashes: LaidSplash[] = [];
  const effects = {
    impactEffectsEnabled: impacts,
    groundMarksEnabled: groundMarks,
    spawnBurstAtGeo: vi.fn(),
    spawnBloodSplatter: vi.fn(),
    // The band fills one splash anew for each; keep a copy
    spawnGooDecal: vi.fn((lat: number, lon: number, height: number, splash: Readonly<GooSplash>) => {
      splashes.push({ lat, lon, height, ...splash });
    }),
  } satisfies OozeMessEffects;
  return Object.assign(effects, { splashes });
}

/** The real effects and pools behind the mess, and a band killed on them. */
function realMess(ids: readonly string[] = ['ooze']) {
  const scene = new Scene();
  const pools = new ParticlePoolManager(scene);
  const sync = { geoToLocal: (lat: number, lon: number, h: number) => new Vector3(lon * M, h, -lat * M) };
  const effects = new ParticleEffectsRenderer(scene, sync as unknown as CoordinateSync, pools);
  effects.setVfxSettings(DEFAULT_VFX_SETTINGS);
  const debris = new OozeDebrisRenderer(scene);
  const renderer = new OozeBandRenderer(scene, { effects, debris });
  for (const id of ids) {
    renderer.add(id, stations, () => 0);
    renderer.setFrame(id, 20, 100, 0, false, false, false);
    renderer.collapse(id);
  }
  const goo = (effects as unknown as { decals: GroundDecals }).decals.goo;
  return { pools, effects, debris, renderer, goo };
}

/** A band from 20 m to 20 + `lengthM` m along the route, killed. */
function killedBand(effects: OozeMessEffects, lengthM = 80, id = 'ooze') {
  const scene = new Scene();
  const debris = new OozeDebrisRenderer(scene);
  const renderer = new OozeBandRenderer(scene, { effects, debris });
  renderer.add(id, stations, () => 0);
  renderer.setFrame(id, 20, 20 + lengthM, 0, false, false, false);
  renderer.collapse(id);
  return { scene, debris, renderer };
}

function frames(renderer: OozeBandRenderer, ms: number): void {
  for (let t = 0; t < ms; t += FRAME_MS) renderer.animate(FRAME_MS);
}

function kinds(list: readonly (OozeDebrisKind | null)[]): Partial<Record<OozeDebrisKind, number>> {
  const out: Partial<Record<OozeDebrisKind, number>> = {};
  for (const kind of list) if (kind !== null) out[kind] = (out[kind] ?? 0) + 1;
  return out;
}

describe('planOozeDeath', () => {
  it('lets a full 80 m body go in 32 bubbles, 64 splashes and 60 pieces of debris, six of them skulls', () => {
    expect(oozeMessCounts(80, true, true)).toEqual({ pops: 32, splashes: 64, debris: 60 });
    const plan = planOozeDeath(80, true, true, 1);
    expect(plan).toHaveLength(32 + 64 + 60);
    expect(kinds(plan.map((e) => e.debris))).toEqual({
      bone: 18, rib: 12, skull: 6, teeth: 6, helmet: 3, scrap: 6, boot: 3, sign: 3, can: 3,
    });
  });

  it('spreads each kind over the whole body, inside the corridor and its window of the collapse', () => {
    const plan = planOozeDeath(80, true, true, 1);
    const { pops, splashes, debris } = OOZE_DEATH_LOOK;
    const windows = { pop: [0, pops.until], splash: [splashes.from, splashes.until], debris: [debris.from, debris.until] };
    for (const kind of ['pop', 'splash', 'debris'] as const) {
      const events = plan.filter((e) => e.kind === kind);
      const along = events.map((e) => e.alongM).sort((a, b) => a - b);
      // One in each of n equal stretches: the first near the tail, the last near the tip
      along.forEach((s, i) => {
        expect(s).toBeGreaterThanOrEqual((i / along.length) * 80);
        expect(s).toBeLessThanOrEqual(((i + 1) / along.length) * 80);
      });
      for (const e of events) {
        expect(e.t).toBeGreaterThanOrEqual(windows[kind][0]);
        expect(e.t).toBeLessThanOrEqual(windows[kind][1]);
        expect(Math.abs(e.across)).toBeLessThan(kind === 'splash' ? splashes.spread : 1);
      }
    }
    // The splashes reach past the covered width, as the collapsing band runs past its edges
    expect(Math.max(...plan.filter((e) => e.kind === 'splash').map((e) => Math.abs(e.across)))).toBeGreaterThan(1);
    for (let i = 1; i < plan.length; i++) expect(plan[i].t).toBeGreaterThanOrEqual(plan[i - 1].t);
  });

  it('keeps a short body messy, a skull included, and the Low preset cheap', () => {
    expect(oozeMessCounts(1.5, true, true)).toEqual({ pops: 4, splashes: 4, debris: 6 });
    expect(OOZE_DEBRIS_DECK.slice(0, 6)).toContain('skull');
    // Low: impact effects and ground marks off
    expect(LOW.impactEffects).toBe(false);
    expect(LOW.groundMarks).toBe(false);
    expect(oozeMessCounts(80, LOW.impactEffects, LOW.groundMarks)).toEqual({ pops: 0, splashes: 0, debris: 20 });
    expect(oozeMessCounts(1.5, LOW.impactEffects, LOW.groundMarks)).toEqual({ pops: 0, splashes: 0, debris: 3 });
    expect(OOZE_DEBRIS_DECK.slice(0, 3)).toEqual(['bone', 'rib', 'skull']);
  });

  it('splashes in the colour the ooze\'s clumps splash in', () => {
    expect(OOZE_DEATH_LOOK.goo).toBe(parseInt(ENEMY_TYPES['ooze'].bloodColor!.slice(1), 16));
  });

  it('plans the same mess from the same seed, another from another', () => {
    expect(planOozeDeath(80, true, true, 7)).toEqual(planOozeDeath(80, true, true, 7));
    expect(planOozeDeath(80, true, true, 8)).not.toEqual(planOozeDeath(80, true, true, 7));
  });
});

describe('OozeBandRenderer: the mess of a killed ooze', () => {
  it('lets it go over the collapse, a few parts a frame, all of it by the end', () => {
    const effects = effectsMock();
    const { debris, renderer } = killedBand(effects);
    const emitted = () => effects.spawnBurstAtGeo.mock.calls.length + effects.splashes.length + debris.count;

    let most = 0;
    let before = 0;
    let firstTenth = 0;
    for (let t = 0; t <= OOZE_LOOK.collapse * 1000; t += FRAME_MS) {
      renderer.animate(FRAME_MS);
      const now = emitted();
      most = Math.max(most, now - before);
      before = now;
      if (t < OOZE_LOOK.collapse * 100) firstTenth = now;
    }
    expect(before).toBe(32 + 64 + 60);
    expect(most).toBeLessThan(12);
    expect(firstTenth).toBeLessThan(before / 4);

    // Each bubble: sparks in the slime palette and a spray of drops in its colour
    expect(effects.spawnBurstAtGeo).toHaveBeenCalledTimes(32);
    expect(effects.spawnBloodSplatter).toHaveBeenCalledTimes(32);
    const sparks = effects.spawnBurstAtGeo.mock.calls.reduce((n, call) => n + call[3], 0);
    const drops = effects.spawnBloodSplatter.mock.calls.reduce((n, call) => n + (call[3] ?? 0), 0);
    expect(sparks + drops).toBe(704);
    expect(effects.spawnBurstAtGeo.mock.calls[0][4]).toBe(BURST_PALETTES.slime);
    expect(effects.spawnBloodSplatter.mock.calls[0][4]).toBe(OOZE_DEATH_LOOK.goo);
    // Splashes on the ground (0 here), 1.4 to 5.2 m across, up to twice as long, turned every way
    const { sizeMin, sizeMax, stretchMax } = OOZE_DEATH_LOOK.splashes;
    const splashes = effects.splashes;
    for (const s of splashes) {
      expect(s.height).toBe(0);
      expect(s.size).toBeGreaterThanOrEqual(sizeMin);
      expect(s.size).toBeLessThanOrEqual(sizeMax);
      expect(s.stretch).toBeGreaterThanOrEqual(1);
      expect(s.stretch).toBeLessThanOrEqual(stretchMax);
      expect(s.color).toBe(OOZE_DEATH_LOOK.goo);
    }
    // Most of them small, a few large, every one a pattern of its own
    const sizes = splashes.map((s) => s.size).sort((a, b) => a - b);
    expect(sizes[sizes.length >> 1]).toBeLessThan((sizeMin + sizeMax) / 2);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizeMin + 0.75 * (sizeMax - sizeMin));
    expect(new Set(splashes.map((s) => s.variation)).size).toBe(64);
    // Along the whole body, 20 to 100 m north
    const north = splashes.map((s) => s.lat * M);
    expect(Math.min(...north)).toBeLessThan(30);
    expect(Math.max(...north)).toBeGreaterThan(90);
  });

  it('on the Low preset: no bubbles, no spray, no splashes, a third of the debris', () => {
    const effects = effectsMock(LOW.impactEffects, LOW.groundMarks);
    const { debris, renderer } = killedBand(effects);
    frames(renderer, OOZE_LOOK.collapse * 1000 + FRAME_MS);
    expect(effects.spawnBurstAtGeo).not.toHaveBeenCalled();
    expect(effects.spawnBloodSplatter).not.toHaveBeenCalled();
    expect(effects.spawnGooDecal).not.toHaveBeenCalled();
    expect(debris.count).toBe(20);
  });

  it('throws the debris up, lets it land, lie and sink in; every kind drawn, then no draw call left', () => {
    const { scene, debris, renderer } = killedBand(effectsMock());
    const meshes = scene.children.filter((c) => c.name.startsWith('ooze-debris-')) as InstancedMesh[];
    expect(meshes).toHaveLength(9);
    expect(debris.drawCalls).toBe(0);

    frames(renderer, 700);
    const heights = () => meshes.flatMap((mesh) => {
      const m = new Matrix4();
      return Array.from({ length: mesh.count }, (_, i) => (mesh.getMatrixAt(i, m), m.elements[13]));
    });
    expect(Math.max(...heights())).toBeGreaterThan(2); // in the air

    frames(renderer, OOZE_LOOK.collapse * 1000 - 700 + FRAME_MS);
    expect(debris.count).toBe(60);
    expect(debris.drawCalls).toBe(9);

    // 4 s after the kill every piece is down (the last thrown at 1.2 s lands within 2 s)
    frames(renderer, 2000);
    expect(Math.max(...heights())).toBeLessThan(0.2);

    // All sunk in: the latest lands by 3.1 s, lies up to 3.5 s and sinks for 1 s
    frames(renderer, 4000);
    expect(debris.count).toBe(0);
    expect(debris.drawCalls).toBe(0);
    expect(meshes.every((mesh) => !mesh.visible && mesh.count === 0)).toBe(true);
  });

  it('looks the same at 4x as at 1x: the same splashes, bubbles in the same places, the debris on the same arcs', () => {
    // 3.2 s after the kill, 200 frames at 1x and 50 at 4x: every piece thrown, none sunk in yet
    const run = (frameMs: number) => {
      const effects = effectsMock();
      const { scene, renderer } = killedBand(effects);
      for (let t = 0; t < 3200; t += frameMs) renderer.animate(frameMs);
      const meshes = scene.children.filter((c) => c.name.startsWith('ooze-debris-')) as InstancedMesh[];
      return {
        splashes: effects.splashes,
        pops: effects.spawnBurstAtGeo.mock.calls.map((call) => call.slice(0, 3)),
        debris: meshes.map((mesh) => Array.from(mesh.instanceMatrix.array.subarray(0, mesh.count * 16))),
      };
    };
    const one = run(FRAME_MS);
    const four = run(FRAME_MS * 4);
    expect(four.splashes).toEqual(one.splashes);
    expect(four.pops).toEqual(one.pops);
    expect(one.debris.flat()).toHaveLength(oozeMessCounts(80, true, true).debris * 16);
    expect(four.debris.map((m) => m.length)).toEqual(one.debris.map((m) => m.length));
    four.debris.forEach((m, k) => m.forEach((v, i) => expect(v).toBeCloseTo(one.debris[k][i], 5)));
  });

  it('makes no mess for a band that sank after a leak, and takes the debris along on clear', () => {
    const effects = effectsMock();
    const scene = new Scene();
    const debris = new OozeDebrisRenderer(scene);
    const renderer = new OozeBandRenderer(scene, { effects, debris });
    renderer.add('leaked', stations, () => 0);
    renderer.setFrame('leaked', 20, 100, 1, false, false, false);
    renderer.remove('leaked');
    frames(renderer, 1000);
    expect(effects.spawnBurstAtGeo).not.toHaveBeenCalled();
    expect(debris.count).toBe(0);

    renderer.add('killed', stations, () => 0);
    renderer.setFrame('killed', 20, 100, 0, false, false, false);
    renderer.collapse('killed');
    frames(renderer, 1000);
    expect(debris.count).toBeGreaterThan(0);
    renderer.clear();
    expect(debris.count).toBe(0);
    expect(debris.drawCalls).toBe(0);
  });

  it('takes the splashes and the debris on a restart or location change', () => {
    const { effects, debris, renderer, goo } = realMess();
    frames(renderer, 3000);
    expect(goo.count).toBe(64);
    expect(debris.count).toBeGreaterThan(0);
    // GameStateManager.reset: tilesEngine.effects.clear(), then tilesEngine.oozes.clear()
    effects.clear();
    renderer.clear();
    expect(goo.count).toBe(0);
    expect(goo.instancedMesh.visible).toBe(false);
    expect(debris.count).toBe(0);
    expect(debris.drawCalls).toBe(0);
    renderer.dispose();
  });

  it('takes only the debris on clearDebris, the band collapses on', () => {
    const { debris, renderer } = killedBand(effectsMock());
    frames(renderer, 1000);
    expect(debris.count).toBeGreaterThan(0);
    renderer.clearDebris();
    expect(debris.count).toBe(0);
    expect(renderer.count).toBe(1);
  });
});

describe('OozeDebrisRenderer', () => {
  it('uploads a kind\'s instances while a piece flies or sinks, not while it lies', () => {
    const scene = new Scene();
    const debris = new OozeDebrisRenderer(scene);
    const mesh = scene.getObjectByName('ooze-debris-skull') as InstancedMesh;
    debris.launch('skull', 0, OOZE_DEATH_LOOK.debris.lift, 0, 0, new SeededRandom(3).next);
    const s = FRAME_MS / 1000;
    let version = mesh.instanceMatrix.version;
    const frame = (): boolean => {
      debris.update(s);
      const uploaded = mesh.instanceMatrix.version !== version;
      version = mesh.instanceMatrix.version;
      return uploaded;
    };
    /** Seconds of frames in a row that upload (or not), the first other one included */
    const run = (uploads: boolean): number => {
      let n = 1;
      while (n < 1000 && frame() === uploads) n++;
      return n * s;
    };
    const { restMin, restMax, sink } = OOZE_DEATH_LOOK.debris;
    const flying = run(true);
    expect(flying).toBeGreaterThan(0.5);
    expect(flying).toBeLessThan(2);
    const lying = run(false);
    expect(lying).toBeGreaterThanOrEqual(restMin - 2 * s);
    expect(lying).toBeLessThanOrEqual(restMax + 2 * s);
    expect(run(true)).toBeCloseTo(sink, 1);
    expect(debris.count).toBe(0);
    expect(debris.drawCalls).toBe(0);
  });
});

/**
 * Cost of the peak of an ooze death (coarse, see game-engine/performance.spec.ts
 * on why wall-clock bounds stay loose here): two full oozes killed in the
 * same frame, the real particle pools and decals behind the mess. Per frame
 * the bands and debris (OozeBandRenderer.animate), the particle effects and
 * the pools' buffers. Logs the measured numbers.
 */
describe('Ooze death cost', () => {
  const SANITY_CAP_MS = 50;

  it('stays cheap at the peak of two full oozes dying at once', () => {
    const { pools, effects, debris, renderer, goo: decals } = realMess(['a', 'b']);
    const alive = () =>
      [...pools.getPool('trailAdditive'), ...pools.getPool('trailNormal')].filter((p) => p.life > 0).length;

    const times: number[] = [];
    let peak = { particles: 0, debris: 0, decals: 0, ms: 0 };
    for (let f = 0; f < 3000 / FRAME_MS; f++) {
      const t0 = performance.now();
      renderer.animate(FRAME_MS);
      effects.update(FRAME_MS / 1000, performance.now());
      pools.updateBuffers();
      const ms = performance.now() - t0;
      times.push(ms);
      const particles = alive();
      if (particles > peak.particles) peak = { particles, debris: debris.count, decals: decals.count, ms };
    }
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    const secondWorst = sorted[sorted.length - 2];
    console.log(
      `[ooze death bench] two 80 m oozes: peak ${peak.particles} particles, ${peak.debris} pieces of debris, ` +
      `${peak.decals} splashes, ${peak.ms.toFixed(2)} ms that frame; per frame median ${median.toFixed(2)} ms, ` +
      `worst ${worst.toFixed(2)} ms (frame ${times.indexOf(worst)}), next ${secondWorst.toFixed(2)} ms (jsdom, without the GPU)`,
    );
    expect(debris.count).toBe(120);
    expect(decals.count).toBe(128);
    expect(peak.particles).toBeGreaterThan(0);
    expect(worst).toBeLessThan(SANITY_CAP_MS);
    renderer.dispose();
  });
});
