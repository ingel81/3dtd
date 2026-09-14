import { describe, it, expect } from 'vitest';
import { AdditiveBlending, Scene, Vector3, type InstancedBufferGeometry, type Mesh, type ShaderMaterial } from 'three';
import {
  SearchlightRenderer,
  createSearchlightConeGeometry,
  headingToSearchlightYaw,
  searchlightLampHeight,
} from './searchlight.renderer';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import type { CoordinateSync } from '../index';

const LOOK = BLOOD_MOON_LOOK.searchlights;

/** lat → x, lon → z, height → y, so positions are easy to read back */
const sync: CoordinateSync = {
  geoToLocal: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimple: (lat, lon, height) => new Vector3(lat, height, lon),
  geoToLocalSimpleInto: (lat, lon, height, target) => target.set(lat, height, lon),
};

function setup() {
  const scene = new Scene();
  const renderer = new SearchlightRenderer(scene, sync);
  const mesh = scene.children.find((child) => child.name === 'searchlights') as Mesh;
  const geometry = mesh.geometry as InstancedBufferGeometry;
  const material = mesh.material as ShaderMaterial;
  return { scene, renderer, mesh, geometry, material };
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
  it('points the +Z cone along the heading: north is -Z, east is +X', () => {
    const along = (heading: number) => {
      const yaw = headingToSearchlightYaw(heading);
      return [Math.sin(yaw), Math.cos(yaw)];
    };
    const [nx, nz] = along(0);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(-1);
    const [ex, ez] = along(Math.PI / 2);
    expect(ex).toBeCloseTo(1);
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
    renderer.add('t1', 10, 20, 7.5, TOWER_TYPES.archer, 0);
    expect(renderer.count).toBe(1);
    expect(geometry.instanceCount).toBe(1);
    const lamp = geometry.getAttribute('aLamp');
    expect([lamp.getX(0), lamp.getY(0), lamp.getZ(0)]).toEqual([
      10, expect.closeTo(7.5 + searchlightLampHeight(TOWER_TYPES.archer)!), 20,
    ]);
  });

  it('sweeps around the guard heading, with a period in the configured range', () => {
    const { renderer, geometry } = setup();
    renderer.add('t1', 0, 0, 0, TOWER_TYPES.cannon, Math.PI / 2);
    const sweep = geometry.getAttribute('aSweep');
    expect(sweep.getX(0)).toBeCloseTo(headingToSearchlightYaw(Math.PI / 2));
    const period = (Math.PI * 2) / sweep.getZ(0);
    expect(period).toBeGreaterThanOrEqual(LOOK.sweepPeriodS[0] - 1e-3);
    expect(period).toBeLessThanOrEqual(LOOK.sweepPeriodS[1] + 1e-3);
    expect(sweep.getW(0)).toBe(LOOK.length);
  });

  it('turns the sweep to a new guard heading and keeps its phase, speed and length', () => {
    const { renderer, geometry } = setup();
    renderer.add('t1', 0, 0, 0, TOWER_TYPES.cannon, 0);
    const sweep = geometry.getAttribute('aSweep');
    const [phase, speed, length] = [sweep.getY(0), sweep.getZ(0), sweep.getW(0)];

    renderer.setHeading('t1', Math.PI / 2);
    expect(sweep.getX(0)).toBeCloseTo(headingToSearchlightYaw(Math.PI / 2));
    expect([sweep.getY(0), sweep.getZ(0), sweep.getW(0)]).toEqual([phase, speed, length]);

    // No guard heading: the beam stays where it sweeps; no light: nothing happens
    renderer.setHeading('t1', null);
    renderer.setHeading('other', 0);
    expect(sweep.getX(0)).toBeCloseTo(headingToSearchlightYaw(Math.PI / 2));
    expect(renderer.count).toBe(1);
  });

  it('gives the Research Center no light', () => {
    const { renderer, geometry } = setup();
    renderer.add('lab', 0, 0, 0, TOWER_TYPES['research-center'], null);
    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
  });

  it('frees the slot of a removed tower and hands it out again', () => {
    const { renderer, geometry } = setup();
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer, 0);
    renderer.add('b', 1, 0, 0, TOWER_TYPES.archer, 0);
    renderer.remove('a');
    expect(renderer.count).toBe(1);
    expect(geometry.getAttribute('aSweep').getW(0)).toBe(0);
    renderer.add('c', 2, 0, 0, TOWER_TYPES.archer, 0);
    expect(geometry.getAttribute('aLamp').getX(0)).toBe(2);
    expect(geometry.instanceCount).toBe(2);

    renderer.clear();
    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
  });

  it('hides one tower\'s beam and shows it again, the slot kept (wave replay)', () => {
    const { renderer, geometry } = setup();
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer, 0);
    renderer.add('b', 1, 0, 0, TOWER_TYPES.archer, 0);
    const sweep = geometry.getAttribute('aSweep');
    renderer.setVisible('a', false);
    expect(sweep.getW(0)).toBe(0);
    expect(sweep.getW(1)).toBe(LOOK.length);
    expect(renderer.count).toBe(2);
    renderer.setVisible('a', true);
    expect(sweep.getW(0)).toBe(LOOK.length);
    // No light: nothing happens
    renderer.setVisible('none', false);
    expect(renderer.count).toBe(2);
  });

  it('shows only while the blood moon is up and there are towers', () => {
    const { renderer, mesh, material } = setup();
    renderer.setAmount(1);
    expect(mesh.visible).toBe(false);
    renderer.add('a', 0, 0, 0, TOWER_TYPES.archer, 0);
    expect(mesh.visible).toBe(true);
    expect(material.uniforms['uIntensity'].value).toBeCloseTo(LOOK.intensity);
    renderer.setAmount(0.5);
    expect(material.uniforms['uIntensity'].value).toBeCloseTo(LOOK.intensity / 2);
    renderer.setAmount(0);
    expect(mesh.visible).toBe(false);
  });

  it('runs the sweep clock on the time it is given, not on a step of zero', () => {
    const { renderer, material } = setup();
    renderer.advance(1500);
    renderer.advance(0);
    renderer.advance(-20);
    expect(material.uniforms['uTime'].value).toBeCloseTo(1.5);
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
