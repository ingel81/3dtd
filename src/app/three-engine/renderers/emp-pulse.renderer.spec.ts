import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mesh, PerspectiveCamera, PlaneGeometry, Points, Raycaster, Scene, ShaderMaterial, SphereGeometry, Sprite, Vector3 } from 'three';
import { EmpPulseRenderer } from './emp-pulse.renderer';
import { EMP_PULSE_LOOK } from '../../configs/visual-effects.config';
import { seededRandom, drawn, positions } from '../../../test/vfx-renderer-fixture';

const GROUND = new Vector3(-20, 8, 60);
const RADIUS = 30;

function setup() {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  const pulses = new EmpPulseRenderer(scene, materials);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(-20, 220, 300);
  camera.lookAt(GROUND);

  const sparks = scene.children.find((c): c is Points => c instanceof Points)!;
  const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const rings = meshes.filter((m) => m.geometry instanceof PlaneGeometry);
  const domes = meshes.filter((m) => m.geometry instanceof SphereGeometry);
  const flashes = scene.children.filter((c): c is Sprite => c instanceof Sprite);

  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      pulses.update(Math.min(step, ms - done), camera, 1080);
    }
  };
  return { scene, materials, pulses, sparks, rings, domes, flashes, run };
}

describe('EmpPulseRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs two electric fronts out over the radius, the second behind the first', () => {
    const { pulses, rings, run } = setup();
    pulses.pulse(GROUND, RADIUS);
    run(100);
    expect(rings[0].visible).toBe(true);
    expect(rings[1].visible).toBe(false); // not started yet

    run(400, 20);
    expect(rings[1].visible).toBe(true);
    expect(rings[0].scale.x).toBeGreaterThan(rings[1].scale.x);
    expect(rings[0].scale.x).toBeLessThanOrEqual(RADIUS * EMP_PULSE_LOOK.rings[0].radius + 1e-6);

    run(EmpPulseRenderer.DURATION * 1000);
    expect(rings.every((ring) => !ring.visible)).toBe(true);
    expect(pulses.activePulses).toBe(0);
  });

  it('keeps each front band the same width in metres as it grows', () => {
    const { pulses, rings, run } = setup();
    pulses.pulse(GROUND, RADIUS);
    const bandMetres = () => (rings[0].material as ShaderMaterial).uniforms['uWidth'].value * rings[0].scale.x;
    run(150);
    const early = bandMetres();
    run(300, 30);
    expect(bandMetres()).toBeCloseTo(early, 6);
    expect(early).toBeCloseTo(EMP_PULSE_LOOK.rings[0].width * RADIUS, 6);
  });

  it('crackles sparks along the first front and holds them while the game is paused', () => {
    seededRandom();
    const { pulses, sparks, rings, run } = setup();
    pulses.pulse(GROUND, RADIUS);
    run(300, 16);
    expect(drawn(sparks)).toBeGreaterThan(0);
    for (const [x, , z] of positions(sparks)) {
      expect(Math.hypot(x - GROUND.x, z - GROUND.z)).toBeLessThanOrEqual(rings[0].scale.x + 1.01);
    }
    const before = positions(sparks);
    const time = (rings[0].material as ShaderMaterial).uniforms['uTime'].value;
    for (let i = 0; i < 30; i++) run(0);
    expect(positions(sparks)).toEqual(before);
    expect((rings[0].material as ShaderMaterial).uniforms['uTime'].value).toBe(time);
  });

  it('draws the same sparks from one long frame or many short ones', () => {
    seededRandom();
    const a = setup();
    a.pulses.pulse(GROUND, RADIUS);
    a.run(400, 400);
    seededRandom();
    const b = setup();
    b.pulses.pulse(GROUND, RADIUS);
    b.run(400, 4);
    expect(positions(b.sparks)).toEqual(positions(a.sparks));
  });

  it('shows no sparks while impact effects are off, the fronts and the shell still', () => {
    const { pulses, sparks, rings, domes, flashes, run } = setup();
    pulses.setFull(false);
    pulses.pulse(GROUND, RADIUS);
    run(100);
    expect(drawn(sparks)).toBe(0);
    expect(rings[0].visible).toBe(true);
    expect(domes[0].visible).toBe(true);
    expect(flashes[0].visible).toBe(true);
  });

  it('writes its output encoded and with log depth, and nothing of it catches a ray', () => {
    const { scene, pulses, rings, domes, run } = setup();
    for (const mesh of [...rings, ...domes]) {
      const material = mesh.material as ShaderMaterial;
      expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
      expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    }
    pulses.pulse(GROUND, RADIUS);
    run(200);
    const ray = new Raycaster(new Vector3(GROUND.x, GROUND.y + 100, GROUND.z), new Vector3(0, -1, 0));
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it('drops everything on clear', () => {
    const { pulses, sparks, rings, domes, flashes, run } = setup();
    pulses.pulse(GROUND, RADIUS);
    run(200);
    pulses.clear();
    expect(pulses.activePulses).toBe(0);
    expect(drawn(sparks)).toBe(0);
    for (const object of [...rings, ...domes, ...flashes]) expect(object.visible).toBe(false);
  });
});
