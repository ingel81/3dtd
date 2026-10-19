import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Mesh, type BufferGeometry, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { loadGlb } from '../../../../../../tools/model-budget/glb-node.mjs';
import { isRotor, rotorHub } from './rotor';

const ROOT = resolve('public/maps/assets');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'catalog.json'), 'utf8')) as { objects: { id: string; file?: string; lod?: { file: string }[] }[] };

/** The rotor parts of a model in its own frame, their names as the layer reads them (`rotor-…`, `-lod` too) */
async function rotorParts(file: string): Promise<BufferGeometry[]> {
  const { root } = (await loadGlb(resolve(ROOT, file))) as { root: Object3D };
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && isRotor(o.material)) parts.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  return parts;
}

describe('distance copies of models with a rotor', () => {
  it('turn round the same hub and axle as the model, so a far windmill does not wobble', async () => {
    let checked = 0;
    for (const o of catalog.objects) {
      if (!o.file || !o.lod) continue;
      const full = await rotorParts(o.file);
      if (!full.length) continue;
      const hub = rotorHub(full);
      for (const l of o.lod) {
        const parts = await rotorParts(l.file);
        expect(parts.length, `${l.file} keeps its rotor parts`).toBeGreaterThan(0);
        const far = rotorHub(parts);
        expect(far.axle, l.file).toBe(hub.axle);
        // Within 5 cm in the plane the rotor turns in
        const d = hub.hub.map((v, k) => (k === hub.axle ? 0 : v - far.hub[k]));
        expect(Math.hypot(...d), l.file).toBeLessThan(0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);
});
