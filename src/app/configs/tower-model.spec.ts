import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TOWER_TYPES, type TowerTypeConfig } from './tower-types.config';

/**
 * What the simulation takes from the tower configs instead of the loaded
 * model (docs/SIMULATOR_PLAN.md, P2), checked against each tower's GLB:
 * whether a turret part turns (turnsTurret), where it points in the file
 * (turretRestY) and how high the placed model reaches (modelTop).
 */

/** A tower GLB as the game serves it, without its textures. */
async function loadModel(config: TowerTypeConfig): Promise<Object3D> {
  // A copy made here: GLTFLoader checks `instanceof ArrayBuffer`, and a Node Buffer's is another realm's under jsdom
  const data = new Uint8Array(readFileSync(resolve('public', config.modelUrl))).buffer;
  // Textures never load under jsdom and would stall the parse; nothing here needs them
  const loader = new GLTFLoader().register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }) as never);
  const gltf = await new Promise<{ scene: Object3D }>((done, fail) => loader.parse(data, '', done as never, fail));
  return gltf.scene;
}

/** The turret part as ThreeTowerRenderer.create finds it. */
function turretPart(config: TowerTypeConfig, model: Object3D): Object3D | null {
  let found: Object3D | null = null;
  model.traverse((node) => {
    const isTurret = config.turretNode
      ? node.name === config.turretNode
      : node.name === 'turret_top' || node.name === 'tower_top' || node.name === 'top';
    if (isTurret && !found) found = node;
  });
  return found;
}

describe('tower configs against their models', () => {
  for (const config of Object.values(TOWER_TYPES)) {
    it(`${config.id}: turret part, its rest pose and the model top`, async () => {
      const model = await loadModel(config);
      const turret = turretPart(config, model);

      expect(config.turnsTurret, 'turnsTurret').toBe(turret !== null);
      expect(config.turretRestY ?? 0, 'turretRestY').toBeCloseTo(turret?.rotation.y ?? 0, 3);
      if (config.pitchNodes) {
        const names: string[] = [];
        turret?.traverse((node) => names.push(node.name));
        expect(names, 'pitchNodes under the turret part').toEqual(expect.arrayContaining(config.pitchNodes));
      }

      // Placed as ThreeTowerRenderer.create places it, its foot at y = 0
      model.scale.setScalar(config.scale);
      model.rotation.y = config.rotationY ?? 0;
      model.position.set(0, config.heightOffset, 0);
      model.updateMatrixWorld(true);
      const top = new Box3().setFromObject(model).max.y;
      expect(config.modelTop, 'modelTop').toBeCloseTo(top, 1);
    });
  }
});
