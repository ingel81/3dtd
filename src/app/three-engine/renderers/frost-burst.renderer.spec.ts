import { describe, it, expect, vi, afterEach } from 'vitest';
import { Mesh, PerspectiveCamera, Points, Raycaster, Scene, ShaderMaterial, Sprite, Vector3 } from 'three';
import { FrostBurstRenderer } from './frost-burst.renderer';
import { FROST_BURST_LOOK } from '../../configs/visual-effects.config';
import { seededRandom, drawn, positions } from '../../../test/vfx-renderer-fixture';

const GROUND = new Vector3(40, 12, -30);
const RADIUS = 20;
const HOLD_S = 3;

function setup() {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  const bursts = new FrostBurstRenderer(scene, materials);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(40, 200, 250);
  camera.lookAt(GROUND);

  const points = scene.children.filter((c): c is Points => c instanceof Points);
  const shards = points.find((p) => p.material === materials.additive)!;
  const mist = points.find((p) => p.material === materials.normal)!;
  const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const [ring, rime] = meshes; // per burst slot: ring, then rime
  const flashes = scene.children.filter((c): c is Sprite => c instanceof Sprite);

  /** `ms` of game time in frames of `step` ms, as the engine hands them over */
  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      bursts.update(Math.min(step, ms - done), camera, 1080);
    }
  };
  return { scene, bursts, camera, shards, mist, meshes, ring, rime, flashes, run };
}


describe('FrostBurstRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws shards and rolls out mist, and holds them still while the game is paused', () => {
    seededRandom();
    const { bursts, shards, mist, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(300, 16);
    expect(drawn(shards)).toBe(FROST_BURST_LOOK.shards.count);
    expect(drawn(mist)).toBeGreaterThan(0);

    const before = positions(shards);
    for (let i = 0; i < 50; i++) run(0); // paused frames: no game time
    expect(positions(shards)).toEqual(before);
  });

  it('draws the same picture from one long frame or many short ones', () => {
    seededRandom();
    const a = setup();
    a.bursts.burst(GROUND, RADIUS, HOLD_S);
    a.run(700, 700);
    seededRandom();
    const b = setup();
    b.bursts.burst(GROUND, RADIUS, HOLD_S);
    b.run(700, 7);
    const pa = positions(a.shards);
    const pb = positions(b.shards);
    expect(pb.length).toBe(pa.length);
    pa.forEach((p, i) => p.forEach((v, j) => expect(pb[i][j]).toBeCloseTo(v, 6)));
  });

  it('lets the shards come to rest on the ground, never under it', () => {
    seededRandom();
    const { bursts, shards, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    for (let t = 0; t < 1200; t += 50) {
      run(50);
      for (const [, y] of positions(shards)) expect(y).toBeGreaterThanOrEqual(GROUND.y + 0.2 - 1e-6);
    }
  });

  it('runs the ring out over the radius and takes it away', () => {
    const { bursts, ring, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(100);
    expect(ring.visible).toBe(true);
    run(FROST_BURST_LOOK.ring.duration * 1000 - 150);
    expect(ring.scale.x).toBeGreaterThan(RADIUS);
    expect(ring.scale.x).toBeLessThanOrEqual(RADIUS * FROST_BURST_LOOK.ring.radius + 1e-6);
    run(100);
    expect(ring.visible).toBe(false);
  });

  it('holds the rime over the radius as long as the freeze, then fades it out', () => {
    const { bursts, rime, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(HOLD_S * 1000 - 100, 50);
    expect(rime.visible).toBe(true);
    expect(rime.scale.x).toBe(RADIUS);
    expect((rime.material as { opacity: number }).opacity).toBeCloseTo(FROST_BURST_LOOK.rime.opacity);

    run(700, 50); // 0.6 s into the 1 s fade
    expect((rime.material as { opacity: number }).opacity).toBeCloseTo(FROST_BURST_LOOK.rime.opacity * 0.4);
    run(500, 50);
    expect(rime.visible).toBe(false);
    expect(bursts.activeBursts).toBe(0);
  });

  it('shows flash, ring and rime only while impact effects are off', () => {
    const { bursts, shards, mist, ring, rime, flashes, run } = setup();
    bursts.setFull(false);
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(100);
    expect(drawn(shards)).toBe(0);
    expect(drawn(mist)).toBe(0);
    expect(ring.visible).toBe(true);
    expect(rime.visible).toBe(true);
    expect(flashes[0].visible).toBe(true);
  });

  it('makes room for a third burst by dropping the oldest', () => {
    const { bursts, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(100);
    bursts.burst(GROUND, RADIUS, HOLD_S);
    bursts.burst(GROUND, RADIUS, HOLD_S);
    expect(bursts.activeBursts).toBe(FROST_BURST_LOOK.bursts);
  });

  it('drops everything on clear, and nothing of it catches a ray', () => {
    const { scene, bursts, shards, mist, meshes, flashes, run } = setup();
    bursts.burst(GROUND, RADIUS, HOLD_S);
    run(200);
    const ray = new Raycaster(new Vector3(GROUND.x, GROUND.y + 100, GROUND.z), new Vector3(0, -1, 0));
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);

    bursts.clear();
    expect(bursts.activeBursts).toBe(0);
    expect(drawn(shards)).toBe(0);
    expect(drawn(mist)).toBe(0);
    for (const object of [...meshes, ...flashes]) expect(object.visible).toBe(false);
  });
});
