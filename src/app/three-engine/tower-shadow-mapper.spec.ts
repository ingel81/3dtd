import { describe, it, expect, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
  WebGLCoordinateSystem,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { TowerShadowMapper } from './tower-shadow-mapper';
import { HeroRenderer } from './renderers/hero.renderer';

/** Whether `obj` gets drawn: it and every ancestor visible. */
function drawn(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/** The members CubeCamera.update and the mapper touch; `onRender` runs once per face. */
function fakeRenderer(onRender: () => void): WebGLRenderer {
  return {
    coordinateSystem: WebGLCoordinateSystem,
    xr: { enabled: false },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(),
    render: vi.fn(() => onRender()),
    getClearColor: (target: Color) => target.set(0x87ceeb),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
  } as unknown as WebGLRenderer;
}

describe('TowerShadowMapper', () => {
  it('draws the tiles alone into the cube: the hero, his rings, a partner’s ring and the move ring stay out (Regel 8)', () => {
    const scene = new Scene();
    const tiles = new Group();
    const tile = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    tiles.add(tile);
    scene.add(tiles);

    // The hero 3 m from the tip, selected, with his move ring shown
    const hero = new HeroRenderer(scene, { geoToLocalSimpleInto: (_lat, _lon, _h, target) => target.set(3, 0, 0) }, null);
    hero.present({ lat: 0, lon: 0, heading: 0, pose: 'shoot', anchor: { lat: 0, lon: 0 } });
    hero.setSelected(true);
    hero.showMoveTarget(new Vector3(3, 0, 0), true);
    // A coop partner's hero next to him, in his lane colour (R15)
    const partner = new HeroRenderer(scene, { geoToLocalSimpleInto: (_lat, _lon, _h, target) => target.set(4, 0, 0) }, null);
    partner.setOwnerColor(0x3366ff);
    partner.present({ lat: 0, lon: 0, heading: 0, pose: 'idle', anchor: { lat: 0, lon: 0 } });
    const heroObjects = scene.children.filter((child) => child !== tiles && child.visible);
    // His model root and three rings, the partner's root and his lane ring
    expect(heroObjects).toHaveLength(6);
    expect(heroObjects.every(drawn)).toBe(true);

    let faces = 0;
    const renderer = fakeRenderer(() => {
      faces++;
      expect(drawn(tile)).toBe(true);
      expect(tile.material).not.toBeInstanceOf(MeshBasicMaterial);
      for (const obj of heroObjects) expect(drawn(obj), obj.name || obj.type).toBe(false);
    });
    const mapper = new TowerShadowMapper(renderer, scene);

    expect(mapper.update(new Vector3(0, 5, 0), 30, tiles)).toBe(true);
    expect(faces).toBe(6);
    // Everything as it was
    expect(heroObjects.every(drawn)).toBe(true);
    expect(tile.material).toBeInstanceOf(MeshBasicMaterial);

    mapper.dispose();
    hero.dispose();
  });
});
