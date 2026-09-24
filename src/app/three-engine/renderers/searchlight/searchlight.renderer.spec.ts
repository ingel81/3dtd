import { describe, it, expect } from 'vitest';
import {
  AdditiveBlending,
  Group,
  Object3D,
  Scene,
  Vector3,
  type BufferAttribute,
  type InstancedBufferGeometry,
  type Mesh,
  type ShaderMaterial,
} from 'three';
import {
  SearchlightRenderer,
  createSearchlightConeGeometry,
  headingToSearchlightYaw,
  searchlightLampHeight,
} from './searchlight.renderer';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';
import { TOWER_TYPES, type TowerTypeId } from '../../../configs/tower-types.config';
import type { CoordinateSync } from '../index';
import { ThreeTowerRenderer } from '../three-tower.renderer';
import { aimAt, createTowerAim, stepTowerAim } from '../../../entities/tower-aim';
import { EllipsoidSync } from '../../ellipsoid-sync';
import { geoHeading } from '../../../utils/geo-utils';

const LOOK = BLOOD_MOON_LOOK.searchlights;

/** lat → x, lon → z, height → y, so positions are easy to read back */
const sync: CoordinateSync = {
  geoToLocal: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimple: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimpleInto: (lat, lon, height, target) => target.set(lat, height, lon),
};

function setup() {
  const scene = new Scene();
  /** Where each tower aims; a tower missing here has no model yet */
  const headings = new Map<string, number>();
  const renderer = new SearchlightRenderer(scene, sync, { aimHeading: (id) => headings.get(id) ?? null });
  const mesh = scene.children.find((child) => child.name === 'searchlights') as Mesh;
  const geometry = mesh.geometry as InstancedBufferGeometry;
  const material = mesh.material as ShaderMaterial;
  const beam = geometry.getAttribute('aBeam') as BufferAttribute;
  return { scene, headings, renderer, mesh, geometry, material, beam };
}

describe('searchlightLampHeight', () => {
  it('puts the lamp just over the shoot height', () => {
    const archer = TOWER_TYPES.archer;
    expect(searchlightLampHeight(archer)).toBeCloseTo(
      Math.max(archer.heightOffset + archer.shootHeight, LOOK.minLampHeight) + LOOK.lampLift,
    );
  });

  it('keeps it off the ground for a model that shoots from low down', () => {
    expect(searchlightLampHeight({ attackType: 'projectile', heightOffset: 2, shootHeight: -2 }))
      .toBeCloseTo(LOOK.minLampHeight + LOOK.lampLift);
  });

  it('gives the Research Center none', () => {
    expect(searchlightLampHeight(TOWER_TYPES['research-center'])).toBeNull();
  });
});

describe('headingToSearchlightYaw', () => {
  it('points the +Z cone along the heading: north is +Z, east is -X', () => {
    const along = (heading: number) => {
      const yaw = headingToSearchlightYaw(heading);
      return [Math.sin(yaw), Math.cos(yaw)];
    };
    const [nx, nz] = along(0);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(1);
    const [ex, ez] = along(Math.PI / 2);
    expect(ex).toBeCloseTo(-1);
    expect(ez).toBeCloseTo(0);
  });
});

describe('createSearchlightConeGeometry', () => {
  it('opens from the apex at the origin to a ring of radius tan(half angle) at z = 1', () => {
    const half = 7 * Math.PI / 180;
    const geometry = createSearchlightConeGeometry(half, 8);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < 8; i++) {
      expect([position.getX(i), position.getY(i), position.getZ(i)]).toEqual([0, 0, 0]);
      const r = Math.hypot(position.getX(8 + i), position.getY(8 + i));
      expect(r).toBeCloseTo(Math.tan(half));
      expect(position.getZ(8 + i)).toBe(1);
    }
    for (let i = 0; i < normal.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1);
      // Outward and tilted back against the opening
      expect(normal.getZ(i)).toBeLessThan(0);
    }
    expect(geometry.getIndex()!.count).toBe(8 * 3);
  });
});

describe('SearchlightRenderer', () => {
  it('draws every beam in one additive, depth-tested pass without writing depth', () => {
    const { mesh, material } = setup();
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.forceSinglePass).toBe(true);
    expect(mesh.frustumCulled).toBe(false);
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.fragmentShader).toContain('linearToOutputTexel');
  });

  it('puts the lamp on the foot of the tower, a plinth under it included', () => {
    const { renderer, geometry } = setup();
    // The foot is position.height, the top of the plinth
    renderer.add('t1', 10, 20, 7.5, TOWER_TYPES.archer);
    expect(renderer.count).toBe(1);
    expect(geometry.instanceCount).toBe(1);
    const lamp = geometry.getAttribute('aLamp');
    expect([lamp.getX(0), lamp.getY(0), lamp.getZ(0)]).toEqual([
      10, expect.closeTo(7.5 + searchlightLampHeight(TOWER_TYPES.archer)!), 20,
    ]);
  });

  it('points the beam where the tower aims and turns it with the tower', () => {
    const { renderer, headings, beam } = setup();
    headings.set('t1', Math.PI / 2);
    renderer.add('t1', 0, 0, 0, TOWER_TYPES.cannon);
    expect(beam.getX(0)).toBeCloseTo(headingToSearchlightYaw(Math.PI / 2));
    expect(beam.getY(0)).toBe(LOOK.length);

    // The turret turns onto a target
    headings.set('t1', -1);
    renderer.aim();
    expect(beam.getX(0)).toBeCloseTo(headingToSearchlightYaw(-1));
    expect(beam.getY(0)).toBe(LOOK.length);
  });

  it('uploads the beams only in a frame in which a tower turned', () => {
    const { renderer, headings, beam } = setup();
    headings.set('a', 0);
    headings.set('b', 1);
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer);
    renderer.add('b', 1, 0, 0, TOWER_TYPES.archer);
    const version = beam.version;
    renderer.aim();
    expect(beam.version).toBe(version);

    headings.set('b', 1.5);
    renderer.aim();
    expect(beam.version).toBe(version + 1);
    // One range over the drawn slots, not one per slot
    expect(beam.updateRanges).toEqual([{ start: 0, count: 2 * 2 }]);
  });

  it('keeps the beam dark until the tower\'s model is there to aim', () => {
    const { renderer, headings, beam } = setup();
    renderer.add('t1', 0, 0, 0, TOWER_TYPES.archer);
    expect(renderer.count).toBe(1);
    expect(beam.getY(0)).toBe(0);
    renderer.aim();
    expect(beam.getY(0)).toBe(0);

    headings.set('t1', 0.5);
    renderer.aim();
    expect(beam.getX(0)).toBeCloseTo(headingToSearchlightYaw(0.5));
    expect(beam.getY(0)).toBe(LOOK.length);
  });

  it('gives the Research Center no light', () => {
    const { renderer, geometry } = setup();
    renderer.add('lab', 0, 0, 0, TOWER_TYPES['research-center']);
    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
  });

  it('frees the slot of a removed tower and hands it out again', () => {
    const { renderer, headings, geometry, beam } = setup();
    for (const id of ['a', 'b', 'c']) headings.set(id, 0);
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer);
    renderer.add('b', 1, 0, 0, TOWER_TYPES.archer);
    renderer.remove('a');
    expect(renderer.count).toBe(1);
    expect(beam.getY(0)).toBe(0);
    renderer.add('c', 2, 0, 0, TOWER_TYPES.archer);
    expect(geometry.getAttribute('aLamp').getX(0)).toBe(2);
    expect(geometry.instanceCount).toBe(2);

    renderer.clear();
    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
  });


  it('shows only while the blood moon is up and there are towers', () => {
    const { renderer, mesh, material } = setup();
    renderer.setAmount(1);
    expect(mesh.visible).toBe(false);
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer);
    expect(mesh.visible).toBe(true);
    expect(material.uniforms['uIntensity'].value).toBeCloseTo(LOOK.intensity);
    renderer.setAmount(0.5);
    expect(material.uniforms['uIntensity'].value).toBeCloseTo(LOOK.intensity / 2);
    renderer.setAmount(0);
    expect(mesh.visible).toBe(false);
  });

  it('is never hit by a raycast and leaves the scene on dispose', () => {
    const { scene, renderer, mesh } = setup();
    const hits: unknown[] = [];
    mesh.raycast({} as never, hits as never);
    expect(hits).toEqual([]);
    renderer.dispose();
    expect(scene.children).not.toContain(mesh);
  });
});

/**
 * The beam against the world, not against the turret maths: the tower turns
 * onto a target in the real ThreeTowerRenderer, the beam's axis comes out of
 * the vertex shader's aim(), and it is compared with the way from the lamp to
 * the target, both placed by EllipsoidSync.geoToLocalSimple as the engine
 * places towers, enemies and lamps. Until 2026-09-14 the beam pointed 180°
 * away from the target (playtest 501).
 */
describe('SearchlightRenderer beam on the tower\'s target', () => {
  const STEP_MS = 1000 / 60;
  const TOWER = { lat: 48.137, lon: 11.575 };
  const TARGETS = [
    { lat: TOWER.lat + 0.0004, lon: TOWER.lon }, // north
    { lat: TOWER.lat, lon: TOWER.lon + 0.0006 }, // east
    { lat: TOWER.lat - 0.0003, lon: TOWER.lon - 0.0005 }, // south-west
  ];
  const ellipsoid = new EllipsoidSync(TOWER.lat, TOWER.lon, 0);
  // The adapter ThreeTilesEngine hands its renderers
  const coordinates: CoordinateSync = {
    geoToLocal: (lat, lon, height) => ellipsoid.geoToLocalSimple(lat, lon, height),
    geoToLocalSimple: (lat, lon, height) => ellipsoid.geoToLocalSimple(lat, lon, height),
    geoToLocalSimpleInto: (lat, lon, height, target) => ellipsoid.geoToLocalSimpleInto(lat, lon, height, target),
  };

  /** The vertex shader's aim(): tip the cone's +Z down by the pitch about X, then turn it by the yaw about Y */
  const shaderAim = (v: Vector3, pitch: number, yaw: number) => {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const x = v.x;
    const y = v.y * cp - v.z * sp;
    const z = v.y * sp + v.z * cp;
    return new Vector3(x * cy + z * sy, y, -x * sy + z * cy);
  };

  /** A tower of `typeId` at TOWER with its light; the fake model has a turret part or not */
  async function setup(typeId: TowerTypeId, withTurret: boolean) {
    const config = TOWER_TYPES[typeId];
    const assetManager = {
      loadModel: async () => ({ animations: [] }),
      cloneModel: () => {
        const model = new Group();
        if (withTurret) {
          const turret = new Object3D();
          turret.name = config.turretNode ?? 'turret_top';
          model.add(turret);
        }
        return model;
      },
    };
    const scene = new Scene();
    const towers = new ThreeTowerRenderer(scene, coordinates as never, assetManager as never);
    const aim = createTowerAim(config, 0.4);
    const data = (await towers.create('t1', typeId, TOWER.lat, TOWER.lon, 0, 0.4, aim))!;
    const searchlights = new SearchlightRenderer(scene, coordinates, towers);
    searchlights.add('t1', TOWER.lat, TOWER.lon, 0, config);
    const mesh = scene.children.find((child) => child.name === 'searchlights') as Mesh;
    const material = mesh.material as ShaderMaterial;
    const geometry = mesh.geometry as InstancedBufferGeometry;
    const beam = geometry.getAttribute('aBeam') as BufferAttribute;
    const lamp = geometry.getAttribute('aLamp') as BufferAttribute;

    /** Horizontal angle between the beam and the way from its lamp to `target`, radians */
    const offTarget = (target: { lat: number; lon: number }) => {
      const axis = shaderAim(new Vector3(0, 0, 1), material.uniforms['uPitch'].value, beam.getX(0));
      const to = coordinates.geoToLocalSimple(target.lat, target.lon, 0);
      const dx = to.x - lamp.getX(0);
      const dz = to.z - lamp.getZ(0);
      return Math.abs(Math.atan2(axis.x * dz - axis.z * dx, axis.x * dx + axis.z * dz));
    };
    // The sub-steps turn the aim (GameStateManager.runSubStep)
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += STEP_MS) stepTowerAim(aim, STEP_MS);
    };
    return { aim, searchlights, data, material, offTarget, advance };
  }

  it('mirrors the vertex shader\'s aim()', async () => {
    const { material } = await setup('cannon', true);
    expect(material.vertexShader).toContain('v = vec3(v.x, v.y * cp - v.z * sp, v.y * sp + v.z * cp);');
    expect(material.vertexShader).toContain('return vec3(v.x * cy + v.z * sy, v.y, -v.x * sy + v.z * cy);');
  });

  const lit = (Object.keys(TOWER_TYPES) as TowerTypeId[]).filter((id) => searchlightLampHeight(TOWER_TYPES[id]) !== null);
  for (const typeId of lit) {
    for (const withTurret of [true, false]) {
      it(`${typeId} ${withTurret ? 'with' : 'without'} a turret part: the beam points at the target`, async () => {
        const { aim, searchlights, offTarget, advance } = await setup(typeId, withTurret);
        for (const target of TARGETS) {
          // As TowerCombatService aims
          aimAt(aim, geoHeading(TOWER, target));
          advance(2000);
          searchlights.aim();
          expect(offTarget(target)).toBeLessThan(1e-6);
        }
      });
    }
  }

  it('follows the rotation the wave replay writes, the game paused', async () => {
    const { aim, searchlights, data, offTarget, advance } = await setup('cannon', true);
    aimAt(aim, geoHeading(TOWER, TARGETS[0]));
    advance(2000);
    const recorded = aim.current;
    aimAt(aim, geoHeading(TOWER, TARGETS[1]));
    advance(2000);
    searchlights.aim();
    expect(offTarget(TARGETS[1])).toBeLessThan(1e-6);

    // The aim set from outside a sub-step (a snapshot restore): the light follows it
    data.aim.current = recorded;
    searchlights.aim();
    expect(offTarget(TARGETS[0])).toBeLessThan(1e-6);
  });
});
