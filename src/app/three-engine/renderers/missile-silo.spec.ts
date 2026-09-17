import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BoxGeometry, Group, Mesh, Quaternion, Vector3, type Object3D } from 'three';
import { createMissileStart, missileStartAt } from './missile-silo';
import type { TowerRenderData } from './three-tower.renderer';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { MISSILE_LAUNCH_LOOK } from '../../configs/visual-effects.config';

const SILO = TOWER_TYPES['missile-silo'];
const UP = new Vector3(0, 1, 0);

interface GltfJson {
  nodes: { name?: string; mesh?: number; translation?: number[]; children?: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { min: number[]; max: number[] }[];
}

/**
 * missile_silo.glb as its nodes stand in the file: each mesh node a box
 * over its vertices' bounds, at the node's translation. Read from the JSON
 * chunk; GLTFLoader would wait for its texture, which jsdom never decodes.
 */
function loadSilo(): Object3D {
  const glb = readFileSync(resolve('public', SILO.modelUrl));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as GltfJson;
  const build = (index: number): Object3D => {
    const node = json.nodes[index];
    let object: Object3D = new Group();
    if (node.mesh !== undefined) {
      const bounds = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
      const [minX, minY, minZ] = bounds.min;
      const [maxX, maxY, maxZ] = bounds.max;
      const box = new BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ)
        .translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      object = new Mesh(box);
    }
    object.name = node.name ?? '';
    if (node.translation) object.position.fromArray(node.translation);
    for (const child of node.children ?? []) object.add(build(child));
    return object;
  };
  const scene = new Group();
  const children = new Set(json.nodes.flatMap((node) => node.children ?? []));
  json.nodes.forEach((_, index) => {
    if (!children.has(index)) scene.add(build(index));
  });
  return scene;
}

/** The silo placed as ThreeTowerRenderer.create places a tower: scale, turn and position on the mesh */
function placed(model: Object3D, site: Vector3, customRotation: number): TowerRenderData {
  const mesh = model.clone();
  mesh.scale.setScalar(SILO.scale);
  mesh.rotation.y = (SILO.rotationY ?? 0) + customRotation;
  mesh.position.set(site.x, site.y + SILO.heightOffset, site.z);
  return { mesh, typeConfig: SILO } as unknown as TowerRenderData;
}

describe('missileStartAt', () => {
  const SITE = new Vector3(120, 34, -80);

  it('starts where the missile node stands in the placed silo model, turned with the silo and at its scale', () => {
    const model = loadSilo();
    const yaw = 0.9;
    const start = missileStartAt(placed(model, SITE, yaw), 'missile-silo', SITE, createMissileStart());

    const node = model.getObjectByName(MISSILE_LAUNCH_LOOK.missile.node)!;
    const expected = node.position.clone().multiplyScalar(SILO.scale).applyAxisAngle(UP, yaw).add(SITE);
    expect(start.nozzle.distanceTo(expected)).toBeLessThan(1e-4);
    // The asset's numbers: nozzle 2.30 m over the base, the building 10.4 m high
    expect(start.nozzle.y - SITE.y).toBeCloseTo(2.3, 2);
    expect(start.turn.angleTo(new Quaternion().setFromAxisAngle(UP, yaw))).toBeLessThan(1e-6);
    expect(start.scale).toBeCloseTo(SILO.scale, 6);
    expect(start.shaftTop).toBeCloseTo(10.38, 1);
    expect(start.site).toEqual(SITE);
  });

  it('falls back to the look values, which match the model, without the silo or without its missile node', () => {
    const model = loadSilo();
    const fromModel = missileStartAt(placed(model, SITE, 0), 'missile-silo', SITE, createMissileStart());

    for (const tower of [undefined, { mesh: new Group(), typeConfig: SILO } as unknown as TowerRenderData]) {
      const start = missileStartAt(tower, 'missile-silo', SITE, createMissileStart());
      expect(start.nozzle).toEqual(new Vector3(SITE.x, SITE.y + MISSILE_LAUNCH_LOOK.missile.baseHeight, SITE.z));
      expect(start.turn.angleTo(new Quaternion().setFromAxisAngle(UP, SILO.rotationY ?? 0))).toBeLessThan(1e-6);
      expect(start.scale).toBe(SILO.scale);
      expect(start.shaftTop).toBe(MISSILE_LAUNCH_LOOK.shaftTop);
      // Within 10 cm of where the model has them (the node stands a few centimetres off the middle)
      expect(start.nozzle.distanceTo(fromModel.nozzle)).toBeLessThan(0.1);
      expect(Math.abs(start.shaftTop - fromModel.shaftTop)).toBeLessThan(0.1);
    }
  });
});
