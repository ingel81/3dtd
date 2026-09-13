import { describe, it, expect, vi } from 'vitest';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Points, Raycaster, Scene, ShaderMaterial, Sprite, Vector3 } from 'three';
import { OrbitalBeamRenderer } from './orbital-beam.renderer';
import { ORBITAL_BEAM_LOOK } from '../../configs/visual-effects.config';

/** 60 m straight along -z at ground height 10, a point every 5 m */
const PATH = Array.from({ length: 13 }, (_, i) => new Vector3(20, 10, -i * 5));
const RADIUS = 5;
const SPEED = 18;
const BURN_S = 4;

function setup() {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  const beams = new OrbitalBeamRenderer(scene, materials);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(20, 250, 300);
  camera.lookAt(new Vector3(20, 10, -30));

  const sparks = scene.children.find((c): c is Points => c instanceof Points)!;
  const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const columns = meshes.filter((m) => m.material instanceof ShaderMaterial);
  const rings = meshes.filter((m) => m.material instanceof MeshBasicMaterial);
  const sprites = scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const column = columns[0];
  const base = () => (column.material as ShaderMaterial).uniforms['uBase'].value as Vector3;

  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      beams.update(Math.min(step, ms - done), camera, 1080);
    }
  };
  return { scene, beams, sparks, columns, rings, sprites, column, base, run };
}

const drawn = (points: Points) => (points.visible ? points.geometry.drawRange.count : 0);

describe('OrbitalBeamRenderer', () => {
  it('runs the foot along the path at the beam speed, in game time', () => {
    const { beams, column, base, rings, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(1000, 16);
    expect(column.visible).toBe(true);
    expect(base().z).toBeCloseTo(-SPEED, 1);
    expect(base().x).toBeCloseTo(20);
    expect(rings[0].scale.x).toBe(RADIUS);

    const z = base().z;
    for (let i = 0; i < 20; i++) run(0); // paused
    expect(base().z).toBe(z);
  });

  it('stops where the path ends, before its time is up, then fades out', () => {
    const { beams, column, base, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null); // 60 m take 3.33 s
    run(3500, 20);
    expect(base().z).toBeCloseTo(-60, 3);
    run(ORBITAL_BEAM_LOOK.fadeOut * 1000 + 300, 20);
    expect(column.visible).toBe(false);
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

  it('throws sparks from the foot while it burns, none with impact effects off', () => {
    const on = setup();
    on.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    on.run(800, 16);
    expect(drawn(on.sparks)).toBeGreaterThan(50);

    const off = setup();
    off.beams.setFull(false);
    off.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    off.run(800, 16);
    expect(drawn(off.sparks)).toBe(0);
    expect(off.column.visible).toBe(true);
  });

  it('draws the same sparks from one long frame or many short ones', () => {
    const a = setup();
    a.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    a.run(900, 900);
    const b = setup();
    b.beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    b.run(900, 9);
    const positions = (points: Points) => Array.from(points.geometry.getAttribute('position').array).slice(0, drawn(points) * 3);
    const pa = positions(a.sparks);
    const pb = positions(b.sparks);
    expect(pb.length).toBe(pa.length);
    pa.forEach((v, i) => expect(pb[i]).toBeCloseTo(v, 4));
  });

  it('writes its column encoded, with log depth and the depth test, and nothing of it catches a ray', () => {
    const { scene, beams, column, run } = setup();
    const material = column.material as ShaderMaterial;
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.depthTest).toBe(true);
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(300);
    const ray = new Raycaster(new Vector3(20, 200, -5), new Vector3(0, -1, 0));
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it('drops everything on clear', () => {
    const { beams, sparks, columns, rings, sprites, run } = setup();
    beams.fire(PATH, RADIUS, SPEED, BURN_S, null);
    run(500, 16);
    beams.clear();
    expect(beams.activeBeams).toBe(0);
    expect(drawn(sparks)).toBe(0);
    for (const object of [...columns, ...rings, ...sprites]) expect(object.visible).toBe(false);
  });
});
