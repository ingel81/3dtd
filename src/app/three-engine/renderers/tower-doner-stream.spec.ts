import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3, type InstancedMesh } from 'three';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { DonerStream } from './tower-doner-stream';

/** The Shawarma Slicer's turret part with its spit, arm and the two loose pieces */
function turret(): Object3D {
  const part = new Group();
  for (const name of ['spit', 'arm']) {
    const node = new Object3D();
    node.name = name;
    part.add(node);
  }
  for (const name of ['slice_a', 'slice_b']) {
    const slice = new Mesh(new BoxGeometry(0.1, 0.02, 0.1).translate(2, 0, 0), new MeshBasicMaterial());
    slice.name = name;
    part.add(slice);
  }
  part.updateMatrixWorld(true);
  return part;
}

describe('DonerStream', () => {
  it('turns with the drive, flies pieces only with a target, hides the model pieces', () => {
    const part = turret();
    const stream = new DonerStream(TOWER_TYPES.shawarma, part, 1 / TOWER_TYPES.shawarma.scale);
    const spit = part.getObjectByName('spit')!;
    const pieces = () => ['slice_a_stream', 'slice_b_stream'].map((n) => (part.getObjectByName(n) as InstancedMesh).count);
    expect(part.getObjectByName('slice_a')!.visible).toBe(false);

    stream.setStream(null, 1);
    stream.update(0.1);
    expect(spit.quaternion.w).toBeLessThan(1);
    expect(pieces()).toEqual([0, 0]);

    stream.setStream(new Vector3(0, 0, 6), 1);
    stream.update(0.1);
    // 6 strokes x 12 pieces a second for a tenth: about 7, shared by the two kinds
    expect(pieces()[0] + pieces()[1]).toBeGreaterThanOrEqual(6);

    stream.setStream(null, 0);
    stream.update(2);
    expect(pieces()).toEqual([0, 0]);
    stream.dispose();
    expect(part.getObjectByName('slice_a_stream')).toBeUndefined();
  });
});
