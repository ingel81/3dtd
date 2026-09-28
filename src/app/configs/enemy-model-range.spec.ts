import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_TYPES, type EnemyTypeConfig } from './enemy-types.config';
import { bakeEnemyVAT } from '../three-engine/renderers/instanced-enemy/vat-baker';

/**
 * What the simulation takes from the enemy configs instead of the baked
 * model (TODO E28): the vertical extent it aims at (modelRangeY), checked
 * against each enemy's GLB as the renderer bakes it. The bake's last bits
 * follow the engine's trigonometry; a tenth of a millimetre is far above them.
 */

/** An enemy GLB as the game serves it, without its textures, and its clips */
async function loadModel(config: EnemyTypeConfig): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  // A copy made here: GLTFLoader checks `instanceof ArrayBuffer`, and a Node Buffer's is another realm's under jsdom
  const data = new Uint8Array(readFileSync(resolve('public', config.modelUrl))).buffer;
  // Textures never load under jsdom and would stall the parse; nothing here needs them
  const loader = new GLTFLoader().register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((done, fail) => loader.parse(data, '', done as never, fail));
}

describe('enemy configs against their models', () => {
  for (const config of Object.values(ENEMY_TYPES)) {
    if (config.ooze) {
      it(`${config.id}: no model range, its body lies along the route`, () => {
        expect(config.modelRangeY).toBeUndefined();
      });
      continue;
    }
    it(`${config.id}: the model range the simulation aims with`, async () => {
      const gltf = await loadModel(config);
      const model = clone(gltf.scene);
      model.updateMatrixWorld(true);
      const vat = bakeEnemyVAT(config, model, gltf.animations)!;
      expect(config.modelRangeY, 'modelRangeY').toBeDefined();
      expect(config.modelRangeY!.min, 'min').toBeCloseTo(vat.modelMinY, 3);
      expect(config.modelRangeY!.max, 'max').toBeCloseTo(vat.modelMaxY, 3);
    }, 60_000);
  }
});
