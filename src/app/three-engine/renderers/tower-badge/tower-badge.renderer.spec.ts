import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  type InstancedBufferGeometry,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { TowerBadgeRenderer, badgeStyle } from './tower-badge.renderer';
import { VETERAN_RANKS } from '../../../configs/veteran-ranks.config';

/** A tower model: a box `height` tall standing on (x, footY, z). */
function towerModel(x: number, footY: number, z: number, height: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(2, height, 2).translate(0, height / 2, 0), new MeshBasicMaterial());
  mesh.position.set(x, footY, z);
  return mesh;
}

function setup() {
  const scene = new Scene();
  const models: Record<string, Object3D> = {};
  const renderer = new TowerBadgeRenderer(scene, (id) => models[id] ?? null);
  const mesh = scene.children[0] as Mesh;
  const geometry = mesh.geometry as InstancedBufferGeometry;
  const items = (name: string, slot: number) => {
    const attribute = geometry.getAttribute(name);
    const size = attribute.itemSize;
    return Array.from(attribute.array.slice(slot * size, slot * size + size));
  };
  return {
    scene,
    models,
    renderer,
    mesh,
    geometry,
    material: mesh.material as ShaderMaterial,
    anchorOf: (slot: number) => items('aAnchor', slot),
    styleOf: (slot: number) => items('aStyle', slot),
  };
}

describe('badgeStyle', () => {
  it('draws nothing without a rank', () => {
    expect(badgeStyle(0)).toEqual([0, 0, 0]);
  });

  it('gives each rank its chevrons or its star, and its metal', () => {
    expect(VETERAN_RANKS.map((rank) => badgeStyle(rank.level))).toEqual([
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [0, 1, 1],
    ]);
  });
});

describe('TowerBadgeRenderer', () => {
  it('draws nothing while no tower has a rank', () => {
    const { models, renderer, mesh, geometry } = setup();
    models['t1'] = towerModel(0, 0, 0, 10);
    renderer.setRank('t1', 0);

    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('stands the badge on top of the tower model, whatever the model stands on', () => {
    const { models, renderer, mesh, geometry, anchorOf, styleOf } = setup();
    // Foot 3 m up on a plinth, the model 10 m tall
    models['t1'] = towerModel(5, 3, 7, 10);
    renderer.setRank('t1', 1);

    expect(anchorOf(0)).toEqual([5, 13, 7]);
    expect(styleOf(0)).toEqual([1, 0, 0, 0]);
    expect(geometry.instanceCount).toBe(1);
    expect(mesh.visible).toBe(true);
  });

  it('changes the insignia with the rank and keeps the anchor', () => {
    const { models, renderer, anchorOf, styleOf } = setup();
    models['t1'] = towerModel(5, 3, 7, 10);
    renderer.setRank('t1', 1);
    // Not measured again on a new rank
    models['t1'].position.y = 100;
    renderer.setRank('t1', 4);

    expect(styleOf(0)).toEqual([3, 0, 1, 0]);
    expect(anchorOf(0)).toEqual([5, 13, 7]);
  });

  it('waits for a model still loading and anchors it on a later frame', () => {
    const { models, renderer, anchorOf, styleOf } = setup();
    renderer.setRank('t1', 2);
    expect(renderer.count).toBe(1);
    expect(styleOf(0)).toEqual([0, 0, 0, 0]);

    models['t1'] = towerModel(1, 2, 3, 4);
    renderer.update(new PerspectiveCamera(), 800);

    expect(anchorOf(0)).toEqual([1, 6, 3]);
    expect(styleOf(0)).toEqual([2, 0, 0, 0]);
  });

  it('takes the badge down with its tower and hands the slot to the next one', () => {
    const { models, renderer, geometry, styleOf } = setup();
    for (const id of ['t1', 't2', 't3']) models[id] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 1);
    renderer.setRank('t2', 2);

    renderer.remove('t1');
    renderer.remove('never-had-one');
    expect(styleOf(0)).toEqual([0, 0, 0, 0]);
    expect(renderer.count).toBe(1);
    // Slot 1 is still in use
    expect(geometry.instanceCount).toBe(2);

    renderer.setRank('t3', 5);
    expect(styleOf(0)).toEqual([0, 1, 1, 0]);
    expect(renderer.count).toBe(2);
  });

  it('takes the badge down when the rank drops to none', () => {
    const { models, renderer, mesh } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 1);
    renderer.setRank('t1', 0);

    expect(renderer.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('puts the pause sign over a tower holding fire, in place of its rank', () => {
    const { models, renderer, mesh, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 2);

    renderer.setHoldFire('t1', true);
    expect(styleOf(0)).toEqual([0, 0, 0, 1]);
    expect(mesh.visible).toBe(true);

    renderer.setHoldFire('t1', false);
    expect(styleOf(0)).toEqual([2, 0, 0, 0]);
  });

  it('gives a tower without a rank a badge while it holds fire, and takes it down after', () => {
    const { models, renderer, mesh, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);

    renderer.setHoldFire('t1', true);
    expect(renderer.count).toBe(1);
    expect(styleOf(0)).toEqual([0, 0, 0, 1]);

    renderer.setHoldFire('t1', false);
    expect(renderer.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('keeps the badge of a tower holding fire while its rank stays none', () => {
    const { models, renderer, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setHoldFire('t1', true);

    // The tower manager hands it every rank each frame
    renderer.setRank('t1', 0);
    expect(renderer.count).toBe(1);
    expect(styleOf(0)).toEqual([0, 0, 0, 1]);

    renderer.setRank('t1', 3);
    expect(styleOf(0)).toEqual([0, 0, 0, 1]);
    renderer.setHoldFire('t1', false);
    expect(styleOf(0)).toEqual([3, 0, 0, 0]);
  });

  it('clears every badge', () => {
    const { models, renderer, mesh, geometry, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 3);
    renderer.clear();

    expect(renderer.count).toBe(0);
    expect(geometry.instanceCount).toBe(0);
    expect(styleOf(0)).toEqual([0, 0, 0, 0]);
    expect(mesh.visible).toBe(false);
  });

  it('hides all badges for photo mode and keeps their ranks current meanwhile', () => {
    const { models, renderer, mesh, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 1);
    renderer.setVisible(false);
    renderer.setRank('t1', 2);

    expect(mesh.visible).toBe(false);
    expect(styleOf(0)).toEqual([2, 0, 0, 0]);

    renderer.setVisible(true);
    expect(mesh.visible).toBe(true);
  });

  it('hides the badge of the manned tower only, keeps its rank and hold fire current and shows it again', () => {
    const { models, renderer, styleOf } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    models['t2'] = towerModel(9, 0, 0, 5);
    renderer.setRank('t1', 1);
    renderer.setRank('t2', 2);

    renderer.hideFor('t1');
    expect(styleOf(0)).toEqual([0, 0, 0, 0]);
    expect(styleOf(1)).toEqual([2, 0, 0, 0]);
    renderer.setRank('t1', 3);
    renderer.setHoldFire('t1', true);
    expect(styleOf(0)).toEqual([0, 0, 0, 0]);

    renderer.hideFor(null);
    expect(styleOf(0)).toEqual([0, 0, 0, 1]);
    renderer.setHoldFire('t1', false);
    expect(styleOf(0)).toEqual([3, 0, 0, 0]);
  });

  it('turns the badges to the camera and sizes a CSS pixel from the field of view', () => {
    const { models, renderer, material } = setup();
    models['t1'] = towerModel(0, 0, 0, 5);
    renderer.setRank('t1', 1);
    const camera = new PerspectiveCamera(60, 1, 1, 1000);
    camera.rotation.y = Math.PI / 2;
    camera.updateMatrixWorld();

    renderer.update(camera, 900);

    const right = material.uniforms['uCameraRight'].value;
    expect(right.x).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(-1, 6);
    expect(material.uniforms['uWorldPerPixel'].value).toBeCloseTo((2 * Math.tan(Math.PI / 6)) / 900, 9);
  });

  it('draws with log depth, hides behind buildings and encodes its output', () => {
    const { mesh, material } = setup();
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
  });

  it('frees its mesh on dispose', () => {
    const { scene, renderer, material } = setup();
    const dispose = vi.spyOn(material, 'dispose');
    renderer.dispose();

    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });
});
