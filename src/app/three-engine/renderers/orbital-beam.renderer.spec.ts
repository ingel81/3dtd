import { describe, it, expect, vi } from 'vitest';
import {
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sprite,
  Vector3,
  type IUniform,
  type Object3D,
} from 'three';
import { OrbitalBeamRenderer } from './orbital-beam.renderer';
import { ORBITAL_BEAM_LOOK } from '../../configs/visual-effects.config';
import { drawn, positions } from '../../../test/vfx-renderer-fixture';

/** 60 m straight along -z at ground height 10, a point every 5 m */
const PATH = Array.from({ length: 13 }, (_, i) => new Vector3(20, 10, -i * 5));
/** 72 m, as far as the beam reaches (18 m/s for 4 s) */
const LONG_PATH = Array.from({ length: 16 }, (_, i) => new Vector3(-40, 10, -i * 4.8));
const RADIUS = 5;
const SPEED = 18;
const BURN_S = 4;

function setup(tint?: IUniform<Vector3>) {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  const beams = new OrbitalBeamRenderer(scene, materials, tint);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(20, 250, 300);
  camera.lookAt(new Vector3(20, 10, -30));

  const named = <T extends Object3D>(name: string) => scene.getObjectByName(name) as T;
  const sparks = named<Points>('orbital-beam-sparks');
  const smoke = named<Points>('orbital-beam-smoke');
  const embers = named<InstancedMesh>('orbital-beam-embers');
  const column = named<Mesh>('orbital-beam-column-0');
  const ring = named<Mesh>('orbital-beam-ring-0');
  const groundGlow = named<Mesh>('orbital-beam-ground-glow-0');
  const sprites = scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const columnMaterial = column.material as ShaderMaterial;
  const emberMaterial = embers.material as ShaderMaterial;
  const base = () => columnMaterial.uniforms['uBase'].value as Vector3;
  const emberBirths = () => Array.from(embers.geometry.getAttribute('aBorn').array).slice(0, embers.count);
  const embersShown = () => (embers.visible ? embers.count : 0);

  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      beams.update(Math.min(step, ms - done), camera, 1080);
    }
  };
  return {
    scene, beams, sparks, smoke, embers, column, ring, groundGlow, sprites,
    columnMaterial, emberMaterial, base, emberBirths, embersShown, run,
  };
}

describe('OrbitalBeamRenderer', () => {
  it('runs the foot along the path at the beam speed, in game time', () => {
    const { beams, column, base, ring, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(1000, 16);
    expect(column.visible).toBe(true);
    expect(base().z).toBeCloseTo(-SPEED, 1);
    expect(base().x).toBeCloseTo(20);
    expect(ring.scale.x).toBe(RADIUS);

    const z = base().z;
    for (let i = 0; i < 20; i++) run(0); // paused
    expect(base().z).toBe(z);
  });

  it('comes down from the sky within its descent', () => {
    const { beams, columnMaterial, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(16);
    expect(columnMaterial.uniforms['uReach'].value).toBeCloseTo(0.016 / ORBITAL_BEAM_LOOK.descend);
    run(ORBITAL_BEAM_LOOK.descend * 1000);
    expect(columnMaterial.uniforms['uReach'].value).toBe(1);
  });

  it('stops where the path ends, before its time is up, fades out, and its smoke drifts on a little longer', () => {
    const { beams, column, smoke, base, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null); // 60 m take 3.33 s
    run(3500, 20);
    expect(base().z).toBeCloseTo(-60, 3);
    run(ORBITAL_BEAM_LOOK.fadeOut * 1000 + 300, 20);
    expect(column.visible).toBe(false);
    expect(drawn(smoke)).toBeGreaterThan(0);
    expect(beams.activeBeams).toBe(1);
    run(ORBITAL_BEAM_LOOK.smoke.life[1] * 1000, 20);
    expect(drawn(smoke)).toBe(0);
    expect(beams.activeBeams).toBe(0);
  });

  it('leaves a scorch mark every few metres it has passed, and none while paused', () => {
    const { beams, run } = setup();
    const scorch = vi.fn();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, scorch);
    run(16);
    expect(scorch).toHaveBeenCalledTimes(1); // where it comes down
    expect(scorch).toHaveBeenLastCalledWith(20, 10, -0);
    run(1000, 16);
    const count = scorch.mock.calls.length;
    expect(count).toBe(Math.floor((SPEED * 1.016) / ORBITAL_BEAM_LOOK.scorchStep) + 1);
    run(0);
    expect(scorch).toHaveBeenCalledTimes(count);
  });

  it('stands its foot on the route grid where there is ground', () => {
    const { beams, base, run } = setup();
    beams.setGround({ getGroundLocalYAt: (_x, z) => (z < -10 ? 14 : null) });
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(200);
    expect(base().y).toBe(10); // no cell: the path's height
    run(800, 16);
    expect(base().y).toBe(14);
  });

  it('throws sparks and debris, kicks up smoke and glows on the ground; with impact effects off none of it', () => {
    const on = setup();
    on.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    on.run(800, 16);
    expect(drawn(on.sparks)).toBeGreaterThan(200);
    expect(drawn(on.smoke)).toBeGreaterThan(15);
    expect(on.groundGlow.visible).toBe(true);
    expect(on.embersShown()).toBeGreaterThan(0);
    expect(on.columnMaterial.uniforms['uDetail'].value).toBe(1);

    const off = setup();
    off.beams.setFull(false);
    off.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    off.run(800, 16);
    expect(drawn(off.sparks)).toBe(0);
    expect(drawn(off.smoke)).toBe(0);
    expect(off.groundGlow.visible).toBe(false);
    expect(off.embersShown()).toBe(0);
    // Column without streaks and shimmer, ring, foot and flash
    expect(off.column.visible).toBe(true);
    expect(off.columnMaterial.uniforms['uDetail'].value).toBe(0);
    expect(off.ring.visible).toBe(true);
    expect(off.sprites.some((s) => s.visible)).toBe(true);
    // Gone as soon as the column has faded, nothing lingers
    off.run(3400 + ORBITAL_BEAM_LOOK.fadeOut * 1000, 20);
    expect(off.beams.activeBeams).toBe(0);
  });

  it('leaves its molten debris glowing after the sparks are out, until it has cooled', () => {
    const { beams, sparks, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, 1, null);
    run(1000 + ORBITAL_BEAM_LOOK.sparks.life * 1000 + 50, 10);
    const left = drawn(sparks);
    expect(left).toBeGreaterThan(5); // debris only: every spark is out
    const color = sparks.geometry.getAttribute('color').array;
    for (let i = 0; i < left; i++) expect(color[i * 3 + 1]).toBeLessThan(color[i * 3]); // red to orange
    run(ORBITAL_BEAM_LOOK.debris.life[1] * 1000, 10);
    expect(drawn(sparks)).toBe(0);
  });

  it('draws the same particles and embers from one long frame or many short ones', () => {
    const a = setup();
    a.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    a.run(900, 900);
    const b = setup();
    b.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    b.run(900, 9);
    for (const [pa, pb] of [[positions(a.sparks), positions(b.sparks)], [positions(a.smoke), positions(b.smoke)]]) {
      expect(pb.length).toBe(pa.length);
      pa.forEach((p, i) => p.forEach((v, axis) => expect(pb[i][axis]).toBeCloseTo(v, 4)));
    }
    const ea = a.emberBirths();
    const eb = b.emberBirths();
    expect(eb.length).toBe(ea.length);
    ea.forEach((v, i) => expect(eb[i]).toBeCloseTo(v, 5));
  });

  it('leaves ember patches along its trail that cool within their time and are gone; a pause holds them', () => {
    const { beams, embers, emberMaterial, emberBirths, embersShown, run } = setup();
    const scorch = vi.fn();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, scorch);
    run(1000, 16);
    expect(embersShown()).toBe(scorch.mock.calls.length); // one patch per scorch mark
    const births = emberBirths();
    expect(births[0]).toBeCloseTo(0, 5); // born where the beam came down
    expect(births[1]).toBeCloseTo(ORBITAL_BEAM_LOOK.scorchStep / SPEED, 5); // when the foot got there
    // On the scorch mark, above it
    const matrix = embers.instanceMatrix.array;
    expect(matrix[13]).toBeGreaterThan(10);
    expect(matrix[13]).toBeLessThan(10.5);

    const clock = emberMaterial.uniforms['uClock'].value;
    for (let i = 0; i < 10; i++) run(0);
    expect(emberMaterial.uniforms['uClock'].value).toBe(clock);

    // The last patch at the end of the 60 m path (3.33 s), cooled 6 s later
    run(8000, 50);
    expect(embersShown()).toBeGreaterThan(0);
    run(600, 50);
    expect(embersShown()).toBe(0);
  });

  it('tints its embers with the ground marks for the blood moon', () => {
    const tint = { value: new Vector3(1, 0.4, 0.3) };
    const { emberMaterial } = setup(tint);
    expect(emberMaterial.uniforms['uBloodMoonTint']).toBe(tint);
  });

  it('writes column and embers for the target, with log depth and the depth test, and nothing of it catches a ray', () => {
    const { scene, beams, columnMaterial, emberMaterial, run } = setup();
    for (const material of [columnMaterial, emberMaterial]) {
      expect(material.fragmentShader).toContain('displayLight(');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
      expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
      expect(material.depthTest).toBe(true);
      for (const source of [material.vertexShader, material.fragmentShader]) {
        // WebGL2 compiles ShaderMaterials as GLSL ES 3.00, where these are reserved words
        expect(source).not.toMatch(/\b(flat|smooth|sample|centroid|layout|invariant|input|output|filter|half)\b/);
        // pow of a negative base is undefined: every base is clamped
        expect(source).not.toMatch(/pow\((?!max\()/);
      }
    }
    expect(emberMaterial.fragmentShader).toContain('uBloodMoonTint');
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(300);
    const ray = new Raycaster(new Vector3(20, 200, -5), new Vector3(0, -1, 0));
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it('drops everything on clear', () => {
    const { beams, sparks, smoke, column, ring, groundGlow, embers, sprites, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(500, 16);
    beams.clear();
    expect(beams.activeBeams).toBe(0);
    expect(drawn(sparks)).toBe(0);
    expect(drawn(smoke)).toBe(0);
    for (const object of [column, ring, groundGlow, embers, ...sprites]) expect(object.visible).toBe(false);
  });

  it('stays within its buffers at the peak, two beams at once (the numbers in PARTICLE_SYSTEM.md)', () => {
    const { scene, beams, sparks, smoke, embersShown, run } = setup();
    beams.fire(LONG_PATH, RADIUS, SPEED, BURN_S, null);
    run(500, 16);
    beams.fire(LONG_PATH.map((p) => p.clone().setX(60)), RADIUS, SPEED, BURN_S, null);
    const peak = { glow: 0, smoke: 0, embers: 0, objects: 0 };
    for (let ms = 0; ms < 12000; ms += 16) {
      run(16);
      peak.glow = Math.max(peak.glow, drawn(sparks));
      peak.smoke = Math.max(peak.smoke, drawn(smoke));
      peak.embers = Math.max(peak.embers, embersShown());
      peak.objects = Math.max(peak.objects, scene.children.filter((c) => c.visible).length);
    }
    expect(peak.glow).toBeLessThanOrEqual(sparks.geometry.getAttribute('position').count);
    expect(peak.smoke).toBeLessThanOrEqual(smoke.geometry.getAttribute('position').count);
    // Sparks and debris streaks, smoke puffs, ember patches (two 72 m trails at one every 2.5 m), draw calls:
    // per beam column, ring, ground glow and foot, one flash still up, and the three shared buffers
    expect(peak).toEqual({ glow: 783, smoke: 169, embers: 58, objects: 12 });
  });
});
