import { describe, it, expect, vi } from 'vitest';
import { BufferAttribute, Scene, Vector3, type Mesh, type ShaderMaterial } from 'three';
import { OOZE_LOOK } from '../../../configs/visual-effects.config';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';
import { METERS_PER_DEGREE_LAT } from '../../../utils/geo-utils';
import { ROUTE_BODY_COVER, RouteBodyStations } from '../../../utils/route-body';
import { buildOozeBandGeometry, refreshOozeBandHeights } from './ooze-band-geometry';
import { createOozeBandMaterial } from './ooze-band-material';
import { OozeBandRenderer } from './ooze-band.renderer';

const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
};
/** 100 m north, 3 m left and 5 m right of the centre line */
const stations = new RouteBodyStations(
  [
    { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 5 },
    { lat: 100 / METERS_PER_DEGREE_LAT, lon: 0, corridorLeft: 3, corridorRight: 5 },
  ],
  flatSync,
  0,
);
const ACROSS = OOZE_LOOK.across;

describe('ooze band geometry', () => {
  it('has a row across the covered corridor per station, the ground under each vertex', () => {
    const geometry = buildOozeBandGeometry(stations, ACROSS, ROUTE_BODY_COVER, (x) => x * 0.1);
    const position = geometry.getAttribute('position') as BufferAttribute;
    const side = geometry.getAttribute('aSide') as BufferAttribute;
    const s = geometry.getAttribute('aS') as BufferAttribute;
    expect(position.count).toBe(stations.count * ACROSS);
    expect(geometry.index!.count).toBe((stations.count - 1) * (ACROSS - 1) * 6);

    const row = 10 * ACROSS;
    // Left edge: 3 m * cover to the left (west), right edge 5 m * cover to the east
    expect(side.getZ(row)).toBe(-1);
    expect(side.getZ(row + ACROSS - 1)).toBe(1);
    expect(side.getX(row) * side.getZ(row)).toBeCloseTo(-3 * ROUTE_BODY_COVER, 5);
    expect(side.getX(row + ACROSS - 1)).toBeCloseTo(5 * ROUTE_BODY_COVER, 5);
    expect(s.getX(row)).toBe(20);
    // Centre x, ground of the rest position (x / 10)
    expect(position.getX(row)).toBeCloseTo(0, 5);
    expect(position.getY(row)).toBeCloseTo(-0.3 * ROUTE_BODY_COVER, 5);
    expect(position.getY(row + ACROSS - 1)).toBeCloseTo(0.5 * ROUTE_BODY_COVER, 5);
  });

  it('refreshes the ground of a stretch only, and keeps a height where none is known', () => {
    const geometry = buildOozeBandGeometry(stations, ACROSS, ROUTE_BODY_COVER, () => 1);
    const position = geometry.getAttribute('position') as BufferAttribute;
    expect(refreshOozeBandHeights(geometry, stations, ACROSS, () => 2, 5, 6)).toBe(true);
    expect(position.getY(4 * ACROSS)).toBe(1);
    expect(position.getY(5 * ACROSS)).toBe(2);
    expect(position.getY(6 * ACROSS + ACROSS - 1)).toBe(2);
    expect(position.getY(7 * ACROSS)).toBe(1);
    expect(position.updateRanges).toEqual([{ start: 5 * ACROSS * 3, count: 2 * ACROSS * 3 }]);

    expect(refreshOozeBandHeights(geometry, stations, ACROSS, () => null, 0, 10)).toBe(false);
    expect(position.getY(0)).toBe(1);
  });
});

describe('ooze band material', () => {
  it('uses logarithmic depth and encodes its output', () => {
    const material = createOozeBandMaterial();
    expect(material.vertexShader).toContain('#include <logdepthbuf_pars_vertex>');
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_pars_fragment>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it('adds the blood moon glow and then the tint before its output encoding', () => {
    const shader = createOozeBandMaterial().fragmentShader;
    const glow = shader.indexOf('uBloodMoonGlow;\n', shader.indexOf('void main'));
    const tint = shader.indexOf('col *= uBloodMoonTint;');
    expect(glow).toBeGreaterThan(0);
    expect(tint).toBeGreaterThan(glow);
    expect(tint).toBeLessThan(shader.indexOf('#include <colorspace_fragment>'));
  });
});

describe('OozeBandRenderer', () => {
  const uniforms = (scene: Scene, i = 0) => ((scene.children[i] as Mesh).material as ShaderMaterial).uniforms;

  it('draws a band per ooze and sets its stretch, width and height from the frame', () => {
    const scene = new Scene();
    const renderer = new OozeBandRenderer(scene);
    renderer.add('ooze-1', stations, () => 0);
    expect(scene.children).toHaveLength(1);

    renderer.setFrame('ooze-1', 10, 50, 0.5, false, false, false);
    const u = uniforms(scene);
    expect(u['uTail'].value).toBe(10);
    expect(u['uTip'].value).toBe(50);
    expect(u['uWidth'].value).toBeCloseTo(OOZE_LOOK.minWidth + (1 - OOZE_LOOK.minWidth) * 0.5, 9);
    expect(u['uHeight'].value).toBeCloseTo(OOZE_LOOK.height * (OOZE_LOOK.minHeight + (1 - OOZE_LOOK.minHeight) * 0.5), 9);
  });

  it('tints a slowed body, a poisoned one less, and lets a burning one glow', () => {
    const scene = new Scene();
    const renderer = new OozeBandRenderer(scene);
    renderer.add('ooze-1', stations, () => 0);
    renderer.setFrame('ooze-1', 0, 20, 1, true, true, true);
    const u = uniforms(scene);
    expect(u['uTintAmount'].value).toBe(OOZE_LOOK.slowAmount);
    expect(u['uBurn'].value).toBe(1);
    renderer.setFrame('ooze-1', 0, 20, 1, false, true, false);
    expect(u['uTintAmount'].value).toBe(OOZE_LOOK.poisonAmount);
    expect(u['uBurn'].value).toBe(0);
  });

  it('shares the geometry of a path and lets a removed band sink away before it goes', () => {
    const scene = new Scene();
    const renderer = new OozeBandRenderer(scene);
    renderer.add('a', stations, () => 0);
    renderer.add('b', stations, () => 0);
    const geometry = (scene.children[0] as Mesh).geometry;
    expect((scene.children[1] as Mesh).geometry).toBe(geometry);
    const dispose = vi.spyOn(geometry, 'dispose');

    renderer.remove('a');
    renderer.animate(OOZE_LOOK.dissolve * 500);
    expect(scene.children).toHaveLength(2);
    expect(uniforms(scene)['uDissolve'].value).toBeCloseTo(0.5, 9);
    renderer.animate(OOZE_LOOK.dissolve * 500);
    expect(scene.children).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();

    renderer.clear();
    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('glows and tints every band through shared blood moon uniforms, bands added later included', () => {
    const scene = new Scene();
    const renderer = new OozeBandRenderer(scene);
    renderer.add('a', stations, () => 0);
    expect(uniforms(scene)['uBloodMoonGlow'].value).toBe(0);
    expect((uniforms(scene)['uBloodMoonTint'].value as Vector3).toArray()).toEqual([1, 1, 1]);

    renderer.setBloodMoon(1);
    renderer.add('b', stations, () => 0);
    for (const i of [0, 1]) {
      expect(uniforms(scene, i)['uBloodMoonGlow'].value).toBe(1);
      expect(uniforms(scene, i)['uBloodMoonTint']).toBe(uniforms(scene, 0)['uBloodMoonTint']);
    }
    // Linear tint: the band encodes its own output, so the mood's factor to the 2.2
    const tint = uniforms(scene)['uBloodMoonTint'].value as Vector3;
    expect(tint.y).toBeCloseTo(BLOOD_MOON_LOOK.mood.tint.g ** 2.2, 6);

    renderer.setBloodMoon(0);
    expect(uniforms(scene, 1)['uBloodMoonGlow'].value).toBe(0);
    expect(tint.toArray()).toEqual([1, 1, 1]);
  });

  it('reads the ground under the body again every refresh interval, only there', () => {
    const scene = new Scene();
    const renderer = new OozeBandRenderer(scene);
    const ground = vi.fn(() => 0);
    renderer.add('ooze-1', stations, ground);
    renderer.setFrame('ooze-1', 20, 40, 1, false, false, false);
    ground.mockClear();

    renderer.animate(OOZE_LOOK.groundRefresh * 500);
    expect(ground).not.toHaveBeenCalled();
    renderer.animate(OOZE_LOOK.groundRefresh * 500);
    // Stations 10 to 20 and three past each end, a centre sample and a row each
    expect(ground).toHaveBeenCalledTimes((20 - 10 + 1 + 6) * (ACROSS + 1));
  });
});
