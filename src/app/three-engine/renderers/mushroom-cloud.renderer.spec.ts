import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { MushroomCloudRenderer } from './mushroom-cloud.renderer';
import { MUSHROOM_CLOUD_LOOK } from '../../configs/visual-effects.config';

const GROUND = new Vector3(100, 20, -50);
const RADIUS = 25;
const { glowParticles, smokeParticles, embers, shockwave, shockDome, fireball, groundFire, bloomKick } =
  MUSHROOM_CLOUD_LOOK;
const GLOW_PER_CLOUD = Object.values(glowParticles).reduce((n, count) => n + count, 0)
  + glowParticles.embers * (embers.trail - 1);
const SMOKE_PER_CLOUD = Object.values(smokeParticles).reduce((n, count) => n + count, 0);
/** Glow particles of the detonation, drawn with impact effects off as well */
const DETONATION_GLOW = glowParticles.core + glowParticles.fireball + glowParticles.shell;

/** Math.random with a fixed sequence, so two clouds draw the same particles. */
function seededRandom(seed = 1): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  });
}

function setup() {
  const scene = new Scene();
  const materials = { additive: new ShaderMaterial(), normal: new ShaderMaterial() };
  const clouds = new MushroomCloudRenderer(scene, materials);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(100, 250, 350);
  camera.lookAt(GROUND);

  const points = scene.children.filter((c): c is Points => c instanceof Points);
  const glow = points.find((p) => p.material === materials.additive)!;
  const smoke = points.find((p) => p.material === materials.normal)!;
  const meshes = scene.children.filter((c): c is Mesh => c instanceof Mesh);
  const rings = meshes.filter((m) => m.material instanceof MeshBasicMaterial);
  const domes = meshes.filter((m) => m.geometry instanceof SphereGeometry);
  const flashes = scene.children.filter((c): c is Sprite => c instanceof Sprite);
  const screen = meshes.find((m) => m.material instanceof ShaderMaterial && m.geometry instanceof PlaneGeometry)!;

  /** `ms` of game time in frames of `step` ms, as the engine hands them over */
  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      clouds.update(Math.min(step, ms - done), camera, 1080);
    }
  };
  return { scene, materials, clouds, camera, glow, smoke, rings, domes, flashes, screen, run };
}

const drawn = (points: Points) => (points.visible ? points.geometry.drawRange.count : 0);

/** The drawn particles' positions, one [x, y, z] each. */
function positions(points: Points): number[][] {
  const array = points.geometry.getAttribute('position').array;
  const out: number[][] = [];
  for (let i = 0; i < drawn(points); i++) out.push([array[i * 3], array[i * 3 + 1], array[i * 3 + 2]]);
  return out;
}

const highest = (points: Points) => Math.max(...positions(points).map(([, y]) => y - GROUND.y));
const lowest = (points: Points) => Math.min(...positions(points).map(([, y]) => y - GROUND.y));
const widest = (points: Points) =>
  Math.max(...positions(points).map(([x, , z]) => Math.hypot(x - GROUND.x, z - GROUND.z)));

describe('MushroomCloudRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws nothing without a cloud', () => {
    const { scene, clouds, run } = setup();
    run(16);
    expect(clouds.activeClouds).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('draws its particles with the trail pools\' materials, in buffers of its own', () => {
    const { materials, glow, smoke } = setup();
    expect(glow.material).toBe(materials.additive);
    expect(smoke.material).toBe(materials.normal);
    expect(glow.geometry.getAttribute('position').count).toBe(MUSHROOM_CLOUD_LOOK.clouds * GLOW_PER_CLOUD);
    expect(smoke.geometry.getAttribute('position').count).toBe(MUSHROOM_CLOUD_LOOK.clouds * SMOKE_PER_CLOUD);
    expect(GLOW_PER_CLOUD).toBe(432);
    expect(SMOKE_PER_CLOUD).toBe(546);
  });

  it('opens with the flash, the fireball, the shock dome and the shockwave ring', () => {
    const { clouds, glow, rings, domes, flashes, screen, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(50);
    expect(flashes.filter((f) => f.visible)).toHaveLength(1);
    expect(screen.visible).toBe(true);
    expect(rings.filter((r) => r.visible)).toHaveLength(1);
    expect(domes.filter((d) => d.visible)).toHaveLength(1);
    expect(drawn(glow)).toBeGreaterThanOrEqual(glowParticles.core + glowParticles.fireball);

    run(950, 50);
    const ring = rings.find((r) => r.visible)!;
    expect(ring.scale.x).toBeGreaterThan(shockwave.radius * 0.8);
    expect(ring.scale.x).toBeLessThanOrEqual(shockwave.radius);
    expect(flashes.some((f) => f.visible)).toBe(false);
    expect(domes.some((d) => d.visible)).toBe(false);
    expect(screen.visible).toBe(false);

    run(shockwave.duration * 1000 - 900, 50);
    expect(rings.some((r) => r.visible)).toBe(false);
  });

  it('kicks the bloom with the flash, in game time', () => {
    const { clouds, run } = setup();
    expect(clouds.bloomKick).toBe(0);
    clouds.detonate(GROUND, RADIUS);
    run(16);
    expect(clouds.bloomKick).toBeGreaterThan(0.9);

    run(200, 16);
    const kick = clouds.bloomKick;
    expect(kick).toBeLessThan(0.9);
    for (let i = 0; i < 30; i++) run(0);
    expect(clouds.bloomKick).toBe(kick);

    run(bloomKick.duration * 1000, 16);
    expect(clouds.bloomKick).toBe(0);

    clouds.detonate(GROUND, RADIUS);
    run(16);
    clouds.clear();
    expect(clouds.bloomKick).toBe(0);
  });

  it('punches the fireball up within the first half second', () => {
    const { clouds, glow, run } = setup();
    clouds.setFullCloud(false);
    clouds.detonate(GROUND, RADIUS);
    run(50);
    const early = highest(glow);
    run(450, 50);
    expect(highest(glow)).toBeGreaterThan(early + fireball.punch * 0.8);
  });

  it('draws the shock dome additive, with the log-depth chunks, hidden by what stands in front', () => {
    const { clouds, domes, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(200);
    const dome = domes.find((d) => d.visible)!;
    const material = dome.material as ShaderMaterial;
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(dome.position.toArray()).toEqual(GROUND.toArray());
    expect(dome.scale.x).toBeGreaterThan(shockDome.radius * 0.5);
    expect(dome.scale.x).toBeLessThan(shockDome.radius);
  });

  it('throws embers out beyond the fire on the ground, none below the ground, gone after their life', () => {
    seededRandom();
    const { clouds, glow, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    for (let t = 0; t < 1600; t += 100) {
      run(100, 20);
      expect(lowest(glow)).toBeGreaterThanOrEqual(0);
    }
    // The rim glow under the cap reaches about 26 m at 1.6 s, 31 m at 3.1 s
    const thrownOut = 35;
    expect(widest(glow)).toBeGreaterThan(thrownOut);

    run((embers.life[1] + 0.5) * 1000 - 1600, 20);
    expect(widest(glow)).toBeLessThan(thrownOut);
  });

  it('leaves the ground burning for a few seconds', () => {
    const { clouds, glow, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(6000, 50);
    // The rim glow under the cap is still up there
    const onGround = positions(glow).filter(([, y]) => y - GROUND.y < groundFire.size[1]);
    expect(onGround).toHaveLength(glowParticles.groundFire);
    for (const [x, , z] of onGround) {
      expect(Math.hypot(x - GROUND.x, z - GROUND.z)).toBeLessThanOrEqual(groundFire.radius[1]);
    }

    run((groundFire.fadeEnd - 6) * 1000 + 50, 50);
    expect(drawn(glow)).toBe(0);
  });

  it('punches up fast, then climbs slowly to about 110 m, the dust surging out along the ground', () => {
    const { clouds, smoke, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(1000, 20);
    const punched = highest(smoke);
    expect(punched).toBeGreaterThan(50);

    run(2000, 20);
    expect(widest(smoke)).toBeGreaterThan(40);

    run(2000, 20);
    expect(highest(smoke)).toBeGreaterThan(90);
    expect(highest(smoke)).toBeLessThan(140);
    // Less in the four seconds after the first than in the first
    expect(highest(smoke) - punched).toBeLessThan(punched);
  });

  it('scales with the strike radius', () => {
    seededRandom();
    const small = setup();
    small.clouds.detonate(GROUND, RADIUS);
    small.run(5000);
    seededRandom();
    const big = setup();
    big.clouds.detonate(GROUND, RADIUS * 2);
    big.run(5000);
    expect(highest(big.smoke) / highest(small.smoke)).toBeCloseTo(2, 1);
  });

  it('holds still while the game time does (pause)', () => {
    const { clouds, glow, smoke, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(1500, 16);
    const glowBefore = positions(glow);
    const smokeBefore = positions(smoke);

    for (let i = 0; i < 60; i++) run(0);
    expect(clouds.activeClouds).toBe(1);
    expect(positions(glow)).toEqual(glowBefore);
    expect(positions(smoke)).toEqual(smokeBefore);
  });

  it('comes out the same from one long frame as from many short ones (timescale)', () => {
    seededRandom();
    const long = setup();
    long.clouds.detonate(GROUND, RADIUS);
    long.run(2400);
    seededRandom();
    const short = setup();
    short.clouds.detonate(GROUND, RADIUS);
    short.run(2400, 16);

    expect(drawn(short.glow)).toBe(drawn(long.glow));
    expect(drawn(short.smoke)).toBe(drawn(long.smoke));
    const a = positions(long.glow).flat();
    const b = positions(short.glow).flat();
    expect(Math.max(...a.map((value, i) => Math.abs(value - b[i])))).toBeLessThan(1e-3);
    expect(highest(short.smoke)).toBeCloseTo(highest(long.smoke), 3);
  });

  it('writes the smoke back to front', () => {
    const { clouds, camera, smoke, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(2000, 16);
    const distances = positions(smoke).map(([x, y, z]) => camera.position.distanceTo(new Vector3(x, y, z)));
    expect(distances.length).toBeGreaterThan(100);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1] + 1e-3);
    }
  });

  it('reduces to the detonation with impact effects off (Low preset)', () => {
    const { clouds, glow, smoke, rings, domes, flashes, run } = setup();
    clouds.setFullCloud(false);
    clouds.detonate(GROUND, RADIUS);
    run(100);
    expect(flashes.some((f) => f.visible)).toBe(true);
    expect(rings.some((r) => r.visible)).toBe(true);
    expect(domes.some((d) => d.visible)).toBe(true);
    expect(drawn(glow)).toBeGreaterThan(glowParticles.core);

    for (let t = 100; t < fireball.fadeEnd * 1000; t += 100) {
      run(100);
      expect(drawn(smoke)).toBe(0);
      expect(drawn(glow)).toBeLessThanOrEqual(DETONATION_GLOW);
    }
    run(100);
    expect(drawn(glow)).toBe(0);

    // The next strike after switching back is whole again
    clouds.setFullCloud(true);
    clouds.detonate(GROUND, RADIUS);
    run(1500, 16);
    expect(drawn(smoke)).toBeGreaterThan(0);
    expect(drawn(glow)).toBeGreaterThan(DETONATION_GLOW);
  });

  it('fades out and leaves nothing drawn after its duration', () => {
    const { scene, clouds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(MUSHROOM_CLOUD_LOOK.duration * 1000 + 100, 100);
    expect(clouds.activeClouds).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('leaves nothing a ray can hit, while it runs and after it', () => {
    // three's raycast skips no hidden object; the camera controls pick
    // for zoom, pan and ground clearance with such rays
    const { scene, clouds, camera, run } = setup();
    const ray = new Raycaster(new Vector3(GROUND.x + 5, GROUND.y + 200, GROUND.z + 5), new Vector3(0, -1, 0));
    ray.camera = camera;
    clouds.detonate(GROUND, RADIUS);
    run(300, 50);
    expect(ray.intersectObject(scene)).toEqual([]);

    run(MUSHROOM_CLOUD_LOOK.duration * 1000, 100);
    expect(clouds.activeClouds).toBe(0);
    expect(ray.intersectObject(scene)).toEqual([]);
  });

  it('puts a strike in the oldest cloud\'s place once all are up', () => {
    const { clouds, run } = setup();
    for (let i = 0; i < MUSHROOM_CLOUD_LOOK.clouds + 1; i++) {
      clouds.detonate(GROUND, RADIUS);
      run(500, 50);
    }
    expect(clouds.activeClouds).toBe(MUSHROOM_CLOUD_LOOK.clouds);
  });

  it('drops every cloud on clear', () => {
    const { scene, clouds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(500, 50);
    clouds.clear();
    expect(clouds.activeClouds).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('draws the screen flash with the log-depth chunks, over everything, adding light', () => {
    const { screen } = setup();
    const material = screen.material as ShaderMaterial;
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.depthTest).toBe(false);
    expect(screen.frustumCulled).toBe(false);
  });

  it('leaves the pools\' materials alone on dispose', () => {
    const { scene, materials, clouds } = setup();
    const dispose = vi.spyOn(materials.additive, 'dispose');
    clouds.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(scene.children).toEqual([]);
  });
});
