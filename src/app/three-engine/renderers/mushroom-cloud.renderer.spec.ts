import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AdditiveBlending,
  NormalBlending,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector3,
  type InstancedBufferGeometry,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  type PlaneGeometry,
  type SphereGeometry,
  type Sprite,
} from 'three';
import { MushroomCloudRenderer, screenFlashAt } from './mushroom-cloud.renderer';
import { fireballHeat } from './mushroom-cloud-fireball';
import { CloudShape, capHeightAt, type Cloud } from './mushroom-cloud-shape';
import { MUSHROOM_CLOUD_LOOK } from '../../configs/visual-effects.config';
import { seededRandom } from '../../../test/vfx-renderer-fixture';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

const GROUND = new Vector3(100, 20, -50);
const RADIUS = 25;
const LOOK = MUSHROOM_CLOUD_LOOK;
const { smokeSprites, glowSprites, embers, shockwave, shockDome, fireball, groundFire, groundGlow, bloomKick, flash } = LOOK;
const sum = (counts: Readonly<Record<string, number>>) => Object.values(counts).reduce((n, count) => n + count, 0);
const SMOKE_PER_CLOUD = sum(smokeSprites.full);
const GLOW_PER_CLOUD = sum(glowSprites.full) + glowSprites.full.embers * (embers.trail - 1);
const LOW_SMOKE = sum(smokeSprites.low);
const LOW_GLOW = sum(glowSprites.low) + glowSprites.low.embers * (embers.trail - 1);
/** The last ember streak sprite is gone after this many game seconds (mushroom-cloud-glow.ts) */
const EMBERS_END = 0.12 + embers.life[1] + (embers.trail - 1) * embers.trailStep;

type Sprites = Mesh<InstancedBufferGeometry, ShaderMaterial>;

function setup() {
  const scene = new Scene();
  const clouds = new MushroomCloudRenderer(scene);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(100, 320, 450);
  camera.lookAt(GROUND);
  camera.updateMatrixWorld();

  const named = <T extends Object3D>(name: string) => scene.getObjectByName(name) as T;
  const both = <T extends Object3D>(name: string) => [0, 1].map((i) => named<T>(`${name}-${i}`));
  const back = named<Sprites>('mushroom-smoke-back');
  const front = named<Sprites>('mushroom-smoke-front');
  const glow = named<Sprites>('mushroom-glow');
  const fireballs = both<Mesh<SphereGeometry, ShaderMaterial>>('mushroom-fireball');
  const rings = both<Mesh<PlaneGeometry, MeshBasicMaterial>>('mushroom-ring');
  const grounds = both<Mesh<PlaneGeometry, MeshBasicMaterial>>('mushroom-ground-glow');
  const domes = both<Mesh<SphereGeometry, ShaderMaterial>>('mushroom-dome');
  const flashes = both<Sprite>('mushroom-flash');
  const screen = named<Mesh<PlaneGeometry, ShaderMaterial>>('mushroom-screen');

  /** `ms` of game time in frames of `step` ms, as the engine hands them over */
  const run = (ms: number, step = ms) => {
    for (let done = 0; done < ms - 1e-6; done += step) {
      clouds.update(Math.min(step, ms - done), camera);
    }
  };
  return { scene, clouds, camera, back, front, glow, fireballs, rings, grounds, domes, flashes, screen, run };
}

const drawn = (sprites: Sprites) => (sprites.visible ? sprites.geometry.instanceCount : 0);

/** Four floats per sprite of `name` for the drawn sprites, first three of them. */
function attribute(sprites: Sprites, name: string): number[][] {
  const { array, itemSize } = sprites.geometry.getAttribute(name);
  const out: number[][] = [];
  for (let i = 0; i < drawn(sprites); i++) out.push(Array.from(array.slice(i * itemSize, i * itemSize + itemSize)));
  return out;
}

/** The drawn sprites' centres, one [x, y, z] each */
const centres = (...all: Sprites[]) => all.flatMap((sprites) => attribute(sprites, 'aCenter').map(([x, y, z]) => [x, y, z]));
const highest = (...all: Sprites[]) => Math.max(...centres(...all).map(([, y]) => y - GROUND.y));
const lowest = (...all: Sprites[]) => Math.min(...centres(...all).map(([, y]) => y - GROUND.y));
const out = ([x, , z]: number[]) => Math.hypot(x - GROUND.x, z - GROUND.z);
const widest = (...all: Sprites[]) => Math.max(0, ...centres(...all).map(out));

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

  it('draws its sprites from buffers and materials of its own, every shader with the log-depth chunks', () => {
    const { back, front, glow, fireballs, domes, screen } = setup();
    expect(SMOKE_PER_CLOUD).toBe(740);
    expect(GLOW_PER_CLOUD).toBe(402);
    expect(LOW_SMOKE).toBe(294);
    expect(LOW_GLOW).toBe(88);
    for (const smoke of [back, front]) {
      expect(smoke.geometry.getAttribute('aCenter').count).toBe(LOOK.clouds * SMOKE_PER_CLOUD);
    }
    expect(glow.geometry.getAttribute('aCenter').count).toBe(LOOK.clouds * GLOW_PER_CLOUD);
    // One smoke material for the smoke behind the fireball and in front of it
    expect(front.material).toBe(back.material);
    expect(back.material.blending).toBe(NormalBlending);
    expect(glow.material.blending).toBe(AdditiveBlending);

    for (const material of [back.material, glow.material, fireballs[0].material, domes[0].material, screen.material]) {
      expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
      expect(material.depthWrite).toBe(false);
    }
    // Linear colours, encoded for the canvas like the built-in materials
    for (const material of [back.material, glow.material, fireballs[0].material]) {
      expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    }
  });

  it('blinds the screen white at the impact, then fades it out warming, and lights the sky', () => {
    const { clouds, screen, flashes, run } = setup();
    expect(screenFlashAt(0)).toBe(flash.screenPeak);
    expect(screenFlashAt(flash.screenHold)).toBe(flash.screenPeak);
    expect(screenFlashAt(flash.screenDuration)).toBe(0);

    clouds.detonate(GROUND, RADIUS);
    run(20);
    const uniforms = screen.material.uniforms;
    expect(screen.visible).toBe(true);
    expect(uniforms['uOpacity'].value).toBe(flash.screenPeak);
    const white = (uniforms['uColor'].value as Vector3).clone();
    expect(white.z).toBeGreaterThan(0.9);
    expect(flashes.filter((f) => f.visible)).toHaveLength(1);

    run(580, 20);
    expect(uniforms['uOpacity'].value).toBeLessThan(flash.screenPeak / 2);
    expect(uniforms['uOpacity'].value).toBeGreaterThan(0);
    expect((uniforms['uColor'].value as Vector3).z).toBeLessThan(white.z);
    // The sprite over the impact lights the sky, several hundred metres wide
    expect(flashes.find((f) => f.visible)!.scale.x).toBeGreaterThan(400);

    run(flash.screenDuration * 1000 - 600, 20);
    expect(screen.visible).toBe(false);
    run(flash.duration * 1000 - flash.screenDuration * 1000, 20);
    expect(flashes.some((f) => f.visible)).toBe(false);
  });

  it('kicks the bloom with the flash, in game time', () => {
    const { clouds, run } = setup();
    expect(clouds.bloomKick).toBe(0);
    clouds.detonate(GROUND, RADIUS);
    run(16);
    expect(clouds.bloomKick).toBeGreaterThan(0.9);

    run(300, 16);
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

  it('swells a white-hot fireball that turns yellow, orange and dark red, in game time', () => {
    // The shader's ramp: white from 0.75 on, yellow about 0.75, orange about 0.5, dark red under 0.3
    expect(fireballHeat(0.05)).toBeGreaterThan(0.85);
    expect(fireballHeat(0.35)).toBeGreaterThan(0.6);
    expect(fireballHeat(0.35)).toBeLessThan(0.85);
    expect(fireballHeat(1)).toBeGreaterThan(0.4);
    expect(fireballHeat(1)).toBeLessThan(0.6);
    expect(fireballHeat(3)).toBeLessThan(0.3);

    const { clouds, fireballs, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(50, 10);
    const ball = fireballs.find((b) => b.visible)!;
    const heat = () => ball.material.uniforms['uHeat'].value as number;
    expect(heat()).toBeCloseTo(fireballHeat(0.05), 6);
    expect(ball.material.uniforms['uIntensity'].value).toBeGreaterThan(2.5);
    expect(ball.material.uniforms['uDetail'].value).toBe(1);
    // Grown to most of its radius within 0.4 s
    run(350, 10);
    expect(ball.scale.x).toBeGreaterThan(0.9 * fireball.radius);
    run(600, 10);
    expect(heat()).toBeCloseTo(fireballHeat(1), 6);
    run(2000, 10);
    expect(heat()).toBeCloseTo(fireballHeat(3), 6);
    run((fireball.fadeEnd - 3) * 1000 + 50, 50);
    expect(fireballs.some((b) => b.visible)).toBe(false);
  });

  it('carries the fireball up as the head of the column and flattens it into the core of the cap', () => {
    const { clouds, fireballs, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(100, 10);
    const ball = fireballs.find((b) => b.visible)!;
    expect(ball.position.y - GROUND.y).toBeLessThan(20);

    run(fireball.riseEnd * 1000 - 100, 10);
    expect(ball.position.y - GROUND.y).toBeCloseTo(capHeightAt(fireball.riseEnd), 0);
    expect(ball.scale.x / ball.scale.y).toBeLessThan(1.3);

    run((fireball.flattenEnd - fireball.riseEnd) * 1000, 10);
    expect(ball.scale.x / ball.scale.y).toBeGreaterThan(2);
  });

  it('runs the shockwave ring out to its radius; dome, ground glow and ring go in that order', () => {
    const { clouds, rings, domes, grounds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(50);
    expect(rings.filter((r) => r.visible)).toHaveLength(1);
    expect(domes.filter((d) => d.visible)).toHaveLength(1);
    expect(grounds.filter((g) => g.visible)).toHaveLength(1);

    run(950, 50);
    const ring = rings.find((r) => r.visible)!;
    expect(ring.scale.x).toBeGreaterThan(shockwave.radius * 0.8);
    expect(ring.scale.x).toBeLessThanOrEqual(shockwave.radius);
    expect(domes.some((d) => d.visible)).toBe(false);

    run(shockwave.duration * 1000 - 1000, 50);
    expect(rings.some((r) => r.visible)).toBe(false);
    expect(grounds.some((g) => g.visible)).toBe(true);
    run(groundGlow.fadeEnd * 1000 - shockwave.duration * 1000, 50);
    expect(grounds.some((g) => g.visible)).toBe(false);
  });

  it('draws the shock dome additive, with the log-depth chunks, hidden by what stands in front', () => {
    const { clouds, domes, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(200);
    const dome = domes.find((d) => d.visible)!;
    expect(dome.material.blending).toBe(AdditiveBlending);
    expect(dome.material.depthTest).toBe(true);
    expect(dome.position.toArray()).toEqual(GROUND.toArray());
    expect(dome.scale.x).toBeGreaterThan(shockDome.radius * 0.5);
    expect(dome.scale.x).toBeLessThan(shockDome.radius);
  });

  it('lights the ground with an additive disc over the impact, bright first, dimming with the fireball', () => {
    const { clouds, grounds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(100, 20);
    const disc = grounds.find((g) => g.visible)!;
    expect(disc.material.blending).toBe(AdditiveBlending);
    expect(disc.material.depthTest).toBe(false);
    expect(disc.position.x).toBe(GROUND.x);
    expect(disc.position.z).toBe(GROUND.z);
    const early = disc.material.opacity;
    run(2900, 20);
    expect(disc.material.opacity).toBeLessThan(early / 2);
  });

  it('throws embers out farther than the rest of the glow, none below the ground, gone after their life', () => {
    seededRandom();
    const { clouds, glow, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    let thrown = 0;
    for (let t = 0; t < 2000; t += 100) {
      run(100, 20);
      expect(lowest(glow)).toBeGreaterThanOrEqual(0);
      if (t >= 500) thrown = Math.max(thrown, widest(glow));
    }
    run(EMBERS_END * 1000 - 2000 + 100, 20);
    let rest = 0;
    for (let t = 0; t < 3000; t += 100) {
      run(100, 20);
      rest = Math.max(rest, widest(glow));
    }
    expect(thrown).toBeGreaterThan(rest + 5);
  });

  it('leaves the ground burning for a few seconds, then out', () => {
    const { clouds, glow, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(6000, 50);
    // The glow under the cap is far up by now
    const onGround = centres(glow).filter(([, y]) => y - GROUND.y < groundFire.size[1]);
    expect(onGround).toHaveLength(glowSprites.full.groundFire);
    for (const centre of onGround) expect(out(centre)).toBeLessThanOrEqual(groundFire.radius[1]);

    run((groundFire.fadeEnd - 6) * 1000 + 50, 50);
    expect(centres(glow).filter(([, y]) => y - GROUND.y < groundFire.size[1])).toEqual([]);
  });

  it('punches the cap up fast, then climbs slowly past 150 m, far bigger than the cloud before playtest 2', () => {
    const { clouds, back, front, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(1500, 20);
    const punched = highest(back, front);
    // Before: about 55 m after one second, 100 m at five
    expect(punched).toBeGreaterThan(90);

    run(3500, 20);
    const five = highest(back, front);
    expect(five).toBeGreaterThan(140);
    // Less in the 3.5 s after the punch than in the punch
    expect(five - punched).toBeLessThan(punched);

    run(5000, 50);
    expect(highest(back, front)).toBeGreaterThan(150);
    expect(highest(back, front)).toBeLessThan(220);
  });

  it('keeps the stem far narrower than the cap', () => {
    seededRandom();
    const { clouds, back, front, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(5000, 20);
    const top = highest(back, front);
    const all = centres(back, front);
    const stem = all.filter(([, y]) => y - GROUND.y > 0.3 * top && y - GROUND.y < 0.6 * top).map(out);
    const cap = all.filter(([, y]) => y - GROUND.y > 0.8 * top).map(out);
    expect(stem.length).toBeGreaterThan(20);
    expect(Math.max(...cap)).toBeGreaterThan(2.5 * Math.max(...stem));
  });

  it('rolls the cap out over the top and back in underneath, half a turn and more', () => {
    /** Where on the tube a point that started at `theta` sits after the roll: cos of its angle, outward positive, 0 on top and at the bottom */
    class Tube extends CloudShape {
      outward(cloud: Cloud, theta: number): number {
        this.shape(cloud);
        this.torusPoint(0, theta - this.roll, 1);
        return (this.px - this.ringR) / this.tubeR;
      }
      rolled(cloud: Cloud): number {
        this.shape(cloud);
        return this.roll;
      }
    }
    const tube = new Tube();
    const cloud: Cloud = { active: true, t: 1, x: 0, y: 0, z: 0, scale: 1, full: true, windX: 1, windZ: 0, born: 1 };
    // The points on top of the tube and at its bottom at 1 s, a tenth of a second later
    const roll = tube.rolled(cloud);
    expect(tube.outward(cloud, Math.PI / 2 + roll)).toBeCloseTo(0, 9);
    cloud.t = 1.1;
    expect(tube.outward(cloud, Math.PI / 2 + roll)).toBeGreaterThan(0.05);
    expect(tube.outward(cloud, -Math.PI / 2 + roll)).toBeLessThan(-0.05);
    cloud.t = 6;
    expect(tube.rolled(cloud)).toBeGreaterThan(Math.PI);
  });

  it('stands a white condensation ring around the stem only early on', () => {
    const { clouds, back, front, run } = setup();
    const whites = () =>
      [back, front].flatMap((sprites) => {
        const colour = attribute(sprites, 'aColor');
        return attribute(sprites, 'aCenter').filter((_, i) => colour[i].every((c) => c > 0.8));
      });
    clouds.detonate(GROUND, RADIUS);
    run(400, 20);
    expect(whites()).toEqual([]);
    run(1600, 20);
    const ring = whites();
    expect(ring.length).toBeGreaterThan(smokeSprites.full.condensation / 2);
    const capY = capHeightAt(2);
    for (const centre of ring) {
      expect(centre[1] - GROUND.y).toBeGreaterThan(0.3 * capY);
      expect(centre[1] - GROUND.y).toBeLessThan(0.55 * capY);
    }
    run(LOOK.condensation.end * 1000 - 2000 + 100, 20);
    expect(whites()).toEqual([]);
  });

  it('rolls the base surge out along the ground to about 115 m', () => {
    const { clouds, back, front, run } = setup();
    const lowWidest = () => Math.max(0, ...centres(back, front).filter(([, y]) => y - GROUND.y < 25).map(out));
    clouds.detonate(GROUND, RADIUS);
    run(8000, 50);
    expect(lowWidest()).toBeGreaterThan(100);
    expect(lowWidest()).toBeLessThan(140);
  });

  it('gives every sprite its cloud\'s ground as the floor it fades out towards', () => {
    const { clouds, back, front, glow, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(2000, 20);
    for (const sprites of [back, front, glow]) {
      const floors = attribute(sprites, 'aCenter').map((c) => c[3]);
      expect(floors.length).toBeGreaterThan(0);
      expect(new Set(floors)).toEqual(new Set([GROUND.y]));
    }
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
    expect(highest(big.back, big.front) / highest(small.back, small.front)).toBeCloseTo(2, 1);
  });

  it('holds still while the game time does (pause)', () => {
    const { clouds, back, front, glow, fireballs, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(1500, 16);
    const before = [centres(back), centres(front), centres(glow), fireballs[0].position.toArray()];

    for (let i = 0; i < 60; i++) run(0);
    expect(clouds.activeClouds).toBe(1);
    expect([centres(back), centres(front), centres(glow), fireballs[0].position.toArray()]).toEqual(before);
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
    expect(drawn(short.back) + drawn(short.front)).toBe(drawn(long.back) + drawn(long.front));
    const a = centres(long.glow).flat();
    const b = centres(short.glow).flat();
    expect(Math.max(...a.map((value, i) => Math.abs(value - b[i])))).toBeLessThan(1e-3);
    expect(highest(short.back, short.front)).toBeCloseTo(highest(long.back, long.front), 3);
    expect(short.fireballs[0].position.y).toBeCloseTo(long.fireballs[0].position.y, 6);
  });

  it('writes the smoke back to front, split at the fireball: the puffs behind it draw before it, the others after it and the glow', () => {
    const { clouds, camera, back, front, glow, fireballs, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(2000, 16);
    const distance = ([x, y, z]: number[]) => camera.position.distanceTo(new Vector3(x, y, z));
    const behind = centres(back).map(distance);
    const before = centres(front).map(distance);
    expect(behind.length).toBeGreaterThan(50);
    expect(before.length).toBeGreaterThan(50);
    for (const list of [behind, before]) {
      for (let i = 1; i < list.length; i++) expect(list[i]).toBeLessThanOrEqual(list[i - 1] + 1e-3);
    }
    const ball = fireballs.find((b) => b.visible)!;
    const split = camera.position.distanceTo(ball.position);
    expect(Math.min(...behind)).toBeGreaterThanOrEqual(split - 1e-3);
    expect(Math.max(...before)).toBeLessThan(split);
    expect(back.renderOrder).toBeLessThan(ball.renderOrder);
    expect(ball.renderOrder).toBeLessThan(glow.renderOrder);
    expect(glow.renderOrder).toBeLessThan(front.renderOrder);

    // Once the fireball is gone all smoke draws in one buffer
    run(fireball.fadeEnd * 1000 - 2000 + 100, 50);
    expect(drawn(front)).toBe(0);
    expect(drawn(back)).toBeGreaterThan(0);
  });

  it('keeps the silhouette with impact effects off (Low preset): fewer, larger sprites, unlit smoke, coarser fireball', () => {
    seededRandom();
    const full = setup();
    full.clouds.detonate(GROUND, RADIUS);
    full.run(5000, 50);
    seededRandom();
    const low = setup();
    low.clouds.setFullCloud(false);
    low.clouds.detonate(GROUND, RADIUS);
    for (let t = 0; t < 5000; t += 50) {
      low.run(50);
      expect(drawn(low.back) + drawn(low.front)).toBeLessThanOrEqual(LOW_SMOKE);
      expect(drawn(low.glow)).toBeLessThanOrEqual(LOW_GLOW);
    }
    expect(low.back.material.uniforms['uLit'].value).toBe(0);
    expect(low.fireballs[0].material.uniforms['uDetail'].value).toBe(0);
    expect(highest(low.back, low.front) / highest(full.back, full.front)).toBeCloseTo(1, 1);
    expect(widest(low.back, low.front) / widest(full.back, full.front)).toBeGreaterThan(0.85);

    // The next strike after switching back is whole again
    low.clouds.setFullCloud(true);
    expect(low.back.material.uniforms['uLit'].value).toBe(1);
    low.clouds.detonate(GROUND, RADIUS);
    low.run(1500, 16);
    expect(drawn(low.back) + drawn(low.front)).toBeGreaterThan(LOW_SMOKE);
  });

  it('peak moment: at most the budget of sprites and nine draws, the same buffers every frame', () => {
    const { scene, clouds, back, front, glow, run } = setup();
    const arrays = () => [back, front, glow].flatMap((sprites) => Object.values(sprites.geometry.attributes).map((a) => a.array));
    const before = arrays();
    clouds.detonate(GROUND, RADIUS);
    let sprites = 0;
    let draws = 0;
    for (let t = 0; t < LOOK.duration * 1000; t += 50) {
      run(50);
      sprites = Math.max(sprites, drawn(back) + drawn(front) + drawn(glow));
      draws = Math.max(draws, scene.children.filter((c) => c.visible).length);
    }
    expect(sprites).toBeLessThanOrEqual(SMOKE_PER_CLOUD + GLOW_PER_CLOUD);
    expect(sprites).toBeGreaterThan(0.8 * (SMOKE_PER_CLOUD + GLOW_PER_CLOUD));
    expect(draws).toBeLessThanOrEqual(9);
    // Written in place: no new buffer in any frame
    arrays().forEach((array, i) => expect(array).toBe(before[i]));
  });

  it('fades out and leaves nothing drawn after its duration', () => {
    const { scene, clouds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(LOOK.duration * 1000 + 100, 100);
    expect(clouds.activeClouds).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('leaves nothing a ray can hit, while it runs and after it', () => {
    // three's raycast skips no hidden object; the camera controls pick
    // for zoom, pan and ground clearance with such rays
    const { scene, clouds, camera, run } = setup();
    const ray = new Raycaster(new Vector3(GROUND.x + 5, GROUND.y + 300, GROUND.z + 5), new Vector3(0, -1, 0));
    ray.camera = camera;
    clouds.detonate(GROUND, RADIUS);
    run(1500, 50);
    expect(ray.intersectObject(scene)).toEqual([]);

    run(LOOK.duration * 1000, 100);
    expect(clouds.activeClouds).toBe(0);
    expect(ray.intersectObject(scene)).toEqual([]);
  });

  it('puts a strike in the oldest cloud\'s place once all are up', () => {
    const { clouds, run } = setup();
    for (let i = 0; i < LOOK.clouds + 1; i++) {
      clouds.detonate(GROUND, RADIUS);
      run(500, 50);
    }
    expect(clouds.activeClouds).toBe(LOOK.clouds);
  });

  it('drops every cloud on clear', () => {
    const { scene, clouds, run } = setup();
    clouds.detonate(GROUND, RADIUS);
    run(1500, 50);
    clouds.clear();
    expect(clouds.activeClouds).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('draws the screen flash with the log-depth chunks, over everything, adding light', () => {
    const { screen } = setup();
    expect(screen.material.depthTest).toBe(false);
    expect(screen.material.blending).toBe(AdditiveBlending);
    expect(screen.frustumCulled).toBe(false);
  });

  it('clamps the base of the dome\'s outline pow, which rounding can push below 0', () => {
    const { domes } = setup();
    expect(domes[0].material.fragmentShader).toContain('pow(max(1.0 - facing, 0.0), 2.5)');
  });

  it('adds the shock dome and the screen flash as display light, written for the target', () => {
    const { domes, screen } = setup();
    for (const material of [domes[0].material, screen.material]) {
      expect(material.fragmentShader).toContain(DISPLAY_OUTPUT_GLSL);
      expect(material.fragmentShader).toContain('gl_FragColor = displayLight(vec4(uColor, uOpacity');
    }
  });

  it('frees its materials on dispose and leaves the scene empty', () => {
    const dispose = vi.spyOn(ShaderMaterial.prototype, 'dispose');
    const { scene, clouds } = setup();
    clouds.dispose();
    // Smoke, glow, two fireballs, two domes and the screen quad
    expect(dispose).toHaveBeenCalledTimes(7);
    expect(scene.children).toEqual([]);
  });
});
