import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AdditiveBlending,
  NormalBlending,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
  type InstancedBufferGeometry,
  type Mesh,
  type MeshBasicMaterial,
  type Object3D,
  type ShaderMaterial,
  type Sprite,
} from 'three';
import { MissileLaunchRenderer } from './missile-launch.renderer';
import { createCloudSpriteMaterials } from './mushroom-cloud-sprites';
import { MissileFlight, planMissileLaunch } from '../../utils/missile-flight';
import { MISSILE_LAUNCH_LOOK } from '../../configs/visual-effects.config';
import { seededRandom } from '../../../test/vfx-renderer-fixture';

const LOOK = MISSILE_LAUNCH_LOOK;
const SITE = new Vector3(0, 20, 0);
/** About 1000 m away, a little lower */
const TARGET = new Vector3(820, 12, -560);
const WARNING_S = 6.5;
const STRIKE = 7;

type Sprites = Mesh<InstancedBufferGeometry, ShaderMaterial>;

function setup() {
  const scene = new Scene();
  const materials = createCloudSpriteMaterials();
  const launches = new MissileLaunchRenderer(scene, materials);
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  camera.position.set(400, 380, 300);
  camera.lookAt(new Vector3(400, 0, -280));
  camera.updateMatrixWorld();

  const named = <T extends Object3D>(name: string) => scene.getObjectByName(name) as T;
  const smoke = named<Sprites>('missile-smoke');
  const glow = named<Sprites>('missile-glow');
  const body = named<Mesh>('missile-body-0');
  const flame = named<Mesh<InstancedBufferGeometry, ShaderMaterial>>('missile-flame-0');
  const nozzle = named<Sprite>('missile-nozzle-glow-0');
  const flash = named<Sprite>('missile-flash-0');
  const ground = named<Mesh<InstancedBufferGeometry, MeshBasicMaterial>>('missile-ground-glow-0');

  /** `ms` of game time in frames of `step` ms, as the engine hands them over; 0 is a paused frame */
  const run = (ms: number, step = ms) => {
    if (ms === 0) launches.update(0, camera);
    for (let done = 0; done < ms - 1e-6; done += step) launches.update(Math.min(step, ms - done), camera);
  };
  return { scene, materials, launches, camera, smoke, glow, body, flame, nozzle, flash, ground, run };
}

const drawn = (sprites: Sprites) => (sprites.visible ? sprites.geometry.instanceCount : 0);

/** The drawn sprites' centres, one [x, y, z] each */
function centres(sprites: Sprites): number[][] {
  const { array } = sprites.geometry.getAttribute('aCenter');
  const out: number[][] = [];
  for (let i = 0; i < drawn(sprites); i++) out.push([array[i * 4], array[i * 4 + 1], array[i * 4 + 2]]);
  return out;
}

/** Where the flight has the missile `t` game seconds after the command */
function flightAt(t: number): Vector3 {
  const flight = planMissileLaunch(new MissileFlight(), SITE, TARGET, WARNING_S);
  const position = new Vector3();
  flight.at(t / WARNING_S, position);
  return position;
}

describe('MissileLaunchRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws nothing without a launch', () => {
    const { scene, launches, run } = setup();
    run(16);
    expect(launches.activeLaunches).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('shares the mushroom clouds\' smoke and glow materials, and its flame shader has the log-depth chunks', () => {
    const { materials, smoke, glow, flame } = setup();
    expect(smoke.material).toBe(materials.smoke);
    expect(glow.material).toBe(materials.glow);
    expect(smoke.material.blending).toBe(NormalBlending);
    expect(glow.material.blending).toBe(AdditiveBlending);
    const material = flame.material;
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.fragmentShader).toContain('displayLight(');
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(AdditiveBlending);
    for (const source of [material.vertexShader, material.fragmentShader]) {
      // WebGL2 compiles ShaderMaterials as GLSL ES 3.00, where these are reserved words
      expect(source).not.toMatch(/\b(flat|smooth|sample|centroid|layout|invariant|input|output|filter|half)\b/);
      // pow of a negative base is undefined: every base is clamped
      expect(source).not.toMatch(/pow\((?!max\()/);
    }
  });

  it('stands the missile on its fire in the shaft, lifts it off and flies it along the flight, in game time', () => {
    const { launches, body, flame, nozzle, flash, ground, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(16);
    expect(body.visible).toBe(true);
    expect(body.position.distanceTo(new Vector3(0, SITE.y + LOOK.missile.baseHeight, 0))).toBeLessThan(1e-6);
    expect(flash.visible).toBe(true);
    expect(ground.visible).toBe(true);

    run(3000 - 16, 16);
    expect(body.position.distanceTo(flightAt(3))).toBeLessThan(0.5);
    expect(flame.visible).toBe(true);
    expect(nozzle.visible).toBe(true);
    expect(flash.visible).toBe(false);
    // Growing out of the shaft, to read from the overview camera
    expect(body.scale.x).toBeGreaterThan(1.2);
    expect(body.scale.x).toBeLessThan(LOOK.missile.flightScale);

    // Paused: nothing moves
    const held = body.position.clone();
    for (let i = 0; i < 30; i++) run(0);
    expect(body.position).toEqual(held);
  });

  it('turns the missile along its way and points the flame back along it', () => {
    const { launches, body, flame, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(5200, 20);
    expect(body.scale.x).toBeCloseTo(LOOK.missile.flightScale, 6);
    const nose = new Vector3(0, 1, 0).applyQuaternion(body.quaternion);
    const ahead = flightAt(5.21).sub(flightAt(5.2)).normalize();
    expect(nose.dot(ahead)).toBeGreaterThan(0.99);
    const axis = flame.material.uniforms['uAxis'].value as Vector3;
    expect(axis.dot(nose)).toBeCloseTo(-1, 5);
    expect(flame.material.uniforms['uBase'].value).toEqual(body.position);
  });

  it('arrives on the target at its time and is gone there; its trail stands on, then fades out', () => {
    const { launches, body, flame, smoke, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(WARNING_S * 1000 - 32, 16);
    expect(body.visible).toBe(true);
    expect(body.position.distanceTo(TARGET)).toBeLessThan(80);
    run(40, 20);
    expect(body.visible).toBe(false);
    expect(flame.visible).toBe(false);
    // The trail runs from over the silo to near the target
    const trail = centres(smoke);
    expect(trail.length).toBeGreaterThan(100);
    expect(Math.min(...trail.map(([x, , z]) => Math.hypot(x - TARGET.x, z - TARGET.z)))).toBeLessThan(15);
    expect(Math.max(...trail.map(([, y]) => y))).toBeGreaterThan(SITE.y + 300);

    run(LOOK.trail.life[1] * 1000 - 500, 50);
    expect(launches.activeLaunches).toBe(1);
    run(600, 50);
    expect(drawn(smoke)).toBe(0);
    expect(launches.activeLaunches).toBe(0);
  });

  it('lands the missile at the impact, even a frame before its own clock gets there', () => {
    const { launches, body, smoke, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(6000, 20);
    const before = drawn(smoke);
    launches.land(STRIKE + 1); // another strike's impact
    run(20);
    expect(body.visible).toBe(true);
    launches.land(STRIKE);
    run(0);
    expect(body.visible).toBe(false);
    // The rest of the trail down to the target is laid at once
    expect(drawn(smoke)).toBeGreaterThan(before);
  });

  it('wells a launch cloud out of the shaft that rolls out along the ground', () => {
    const { launches, smoke, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(400, 16);
    const early = centres(smoke).filter(([x, , z]) => Math.hypot(x, z) < 60);
    expect(early.length).toBeGreaterThan(0);
    expect(Math.max(...early.map(([, y]) => y))).toBeGreaterThan(SITE.y + LOOK.shaftTop);

    run(5000, 20);
    const low = centres(smoke).filter(([x, y, z]) => Math.hypot(x, z) < 60 && y < SITE.y + 15);
    expect(low.length).toBeGreaterThan(30);
    expect(Math.max(...low.map(([x, , z]) => Math.hypot(x, z)))).toBeGreaterThan(LOOK.cloud.radius[1] * 0.6);
  });

  it('draws the same smoke from one long frame or many short ones', () => {
    seededRandom(3);
    const a = setup();
    a.launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    a.run(4200, 4200);
    seededRandom(3);
    const b = setup();
    b.launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    b.run(4200, 7);
    const pa = centres(a.smoke).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const pb = centres(b.smoke).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    expect(pb.length).toBe(pa.length);
    pa.forEach((p, i) => p.forEach((v, axis) => expect(pb[i][axis]).toBeCloseTo(v, 1)));
    expect(b.body.position.distanceTo(a.body.position)).toBeLessThan(1e-3);
  });

  it('with impact effects off: fewer, larger smoke puffs, no fire, plume or ground light; missile, flame and flash still show', () => {
    seededRandom(5);
    const on = setup();
    on.launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    on.run(1500, 16);
    expect(drawn(on.glow)).toBeGreaterThan(0);
    on.run(5000, 20);
    const fullSmoke = drawn(on.smoke);

    seededRandom(5);
    const off = setup();
    off.launches.setFull(false);
    off.launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    off.run(16);
    expect(off.flash.visible).toBe(true);
    expect(off.ground.visible).toBe(false);
    off.run(1500 - 16, 16);
    expect(drawn(off.glow)).toBe(0);
    expect(off.body.visible).toBe(true);
    expect(off.flame.visible).toBe(true);
    expect(off.nozzle.visible).toBe(true);
    off.run(5000, 20);
    const lowSmoke = drawn(off.smoke);
    expect(lowSmoke).toBeGreaterThan(0);
    expect(lowSmoke).toBeLessThan(fullSmoke / 2);
  });

  it('takes the place of the oldest launch when a third one comes', () => {
    const { launches, run } = setup();
    launches.launch(1, SITE, TARGET, WARNING_S);
    run(100);
    launches.launch(2, SITE, TARGET.clone().setX(-400), WARNING_S);
    run(100);
    launches.launch(3, SITE, TARGET.clone().setZ(300), WARNING_S);
    run(100);
    expect(launches.activeLaunches).toBe(LOOK.launches);
  });

  it('drops everything on clear, and nothing of it catches a ray', () => {
    const { scene, launches, run } = setup();
    launches.launch(STRIKE, SITE, TARGET, WARNING_S);
    run(3000, 20);
    const ray = new Raycaster(flightAt(3).add(new Vector3(0, 40, 0)), new Vector3(0, -1, 0));
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
    launches.clear();
    expect(launches.activeLaunches).toBe(0);
    expect(scene.children.filter((c) => c.visible)).toEqual([]);
  });

  it('stays within its buffers at the peak, two launches at once (the numbers in PARTICLE_SYSTEM.md)', () => {
    seededRandom(9);
    const { scene, launches, smoke, glow, run } = setup();
    launches.launch(1, SITE, TARGET, WARNING_S);
    run(500, 16);
    launches.launch(2, SITE.clone().setX(-60), TARGET.clone().setZ(200), WARNING_S);
    const peak = { smoke: 0, glow: 0, objects: 0 };
    for (let ms = 0; ms < 24000; ms += 16) {
      run(16);
      peak.smoke = Math.max(peak.smoke, drawn(smoke));
      peak.glow = Math.max(peak.glow, drawn(glow));
      peak.objects = Math.max(peak.objects, scene.children.filter((c) => c.visible).length);
    }
    expect(smoke.geometry.getAttribute('aCenter').count).toBe(2 * (LOOK.smokeSprites.full.cloud + LOOK.smokeSprites.full.trail));
    expect(glow.geometry.getAttribute('aCenter').count).toBe(2 * (LOOK.glowSprites.full.fire + LOOK.glowSprites.full.plume));
    // Smoke: both launch clouds and both trails of some 1000 m at once, right after the second impact.
    // Draw calls: per launch body, flame, nozzle glow and ground light, one flash, and the two shared buffers
    expect(peak).toEqual({ smoke: 704, glow: 28, objects: 11 });
    expect(launches.activeLaunches).toBe(0);
  });
});
