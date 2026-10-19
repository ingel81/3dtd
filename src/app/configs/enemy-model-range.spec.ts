import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnimationClip, Object3D } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_TYPES, type EnemyTypeConfig } from './enemy-types.config';
import { bakeEnemyVAT } from '../three-engine/renderers/instanced-enemy/vat-baker';
import { parsePackedGlb } from '../../test/packed-glb';

/**
 * What the simulation takes from the enemy configs instead of the baked
 * model (TODO E28): the vertical extent it aims at (modelRangeY), checked
 * against each enemy's GLB as the renderer bakes it. The bake's last bits
 * follow the engine's trigonometry; a tenth of a millimetre is far above them.
 */

/** An enemy GLB as the game serves it, without its textures, and its clips */
async function loadModel(config: EnemyTypeConfig): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  return parsePackedGlb(readFileSync(resolve('public', config.modelUrl)));
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
