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
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three';
import { TowerShadowMapper, type LosVertexPatch } from './tower-shadow-mapper';
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

  it('draws a blocker that moves its vertices with its patch in the distance material, one material per patch', () => {
    const scene = new Scene();
    const blockers = new Group();
    const patch: LosVertexPatch = { key: 'ground', pars: 'uniform float uLift;', vertex: 'localPos.y += uLift;', uniforms: { uLift: { value: 3 } } };
    const plain = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const ground = [0, 1].map(() => {
      const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
      m.userData['losVertex'] = patch;
      return m;
    });
    blockers.add(plain, ...ground);
    scene.add(blockers);
    const seen: ShaderMaterial[][] = [];
    const renderer = fakeRenderer(() => seen.push([plain, ...ground].map((m) => m.material as unknown as ShaderMaterial)));
    const mapper = new TowerShadowMapper(renderer, scene);
    mapper.update(new Vector3(0, 5, 0), 30, blockers);
    const [base, a, b] = seen[0];
    expect(a).toBe(b);
    expect(a).not.toBe(base);
    expect(a.vertexShader).toContain('localPos.y += uLift;');
    expect(a.vertexShader).toContain('uniform float uLift;');
    expect(base.vertexShader).not.toContain('uLift');
    // The tip and far of the update reach the patched material too
    expect(a.uniforms['uReferencePosition']).toBe(base.uniforms['uReferencePosition']);
    expect(a.uniforms['uLift']).toBe(patch.uniforms['uLift']);
    for (const m of [plain, ...ground]) expect(m.material).toBeInstanceOf(MeshBasicMaterial);
    mapper.dispose();
  });

  it('draws the fixed stage of the blockers instead of what the camera chose, filled for each tip (Regel 14)', () => {
    const scene = new Scene();
    const blockers = new Group();
    scene.add(blockers);
    const chosen = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    chosen.userData['losTransparent'] = true;
    const stage = new Group();
    stage.visible = false;
    stage.userData['losOnly'] = true;
    const fixed = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    stage.add(fixed);
    const prepared: [number, number, boolean][] = [];
    stage.userData['losPrepare'] = (tip: Vector3, far: number, warmUp: boolean) => prepared.push([tip.y, far, warmUp]);
    blockers.add(chosen, stage);
    let faces = 0;
    const renderer = fakeRenderer(() => {
      faces++;
      expect(drawn(fixed)).toBe(true);
      expect(drawn(chosen)).toBe(false);
    });
    const mapper = new TowerShadowMapper(renderer, scene);
    mapper.update(new Vector3(0, 5, 0), 30, blockers);
    expect(faces).toBe(6);
    expect(prepared).toHaveLength(1);
    expect(prepared[0][0]).toBe(5);
    expect(prepared[0][1]).toBeGreaterThan(30);
    expect(prepared[0][2]).toBe(false);
    // Hidden again from the frame; the warm-up's cube asks for one of each kind
    expect(stage.visible).toBe(false);
    expect(chosen.visible).toBe(true);
    mapper.warmUp(new Vector3(0, 5, 0), blockers);
    expect(prepared[1][2]).toBe(true);
    mapper.dispose();
  });
});
