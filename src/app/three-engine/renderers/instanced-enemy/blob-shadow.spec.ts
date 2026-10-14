import { BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, type Camera, type Scene, type WebGLRenderer } from 'three';
import { attachBlobShadow } from './blob-shadow';

describe('attachBlobShadow', () => {
  it('sits beside the pool and follows its count, matrices and slide offsets', () => {
    const scene = new Group();
    const pool = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 8);
    pool.geometry.setAttribute('aPrevOffset', new InstancedBufferAttribute(new Float32Array(24), 3));
    scene.add(pool);
    const blob = attachBlobShadow(pool, 0.5, { value: 1 });
    expect(blob.parent).toBe(scene);
    pool.count = 5;
    const render = () => blob.onBeforeRender(null as unknown as WebGLRenderer, null as unknown as Scene, null as unknown as Camera, blob.geometry, blob.material, null);
    render();
    expect(blob.count).toBe(5);
    expect(blob.instanceMatrix).toBe(pool.instanceMatrix);
    expect(blob.geometry.getAttribute('aPrevOffset')).toBe(pool.geometry.getAttribute('aPrevOffset'));
    // A grown pool replaces its attributes: the blob takes the new ones
    pool.instanceMatrix = new InstancedBufferAttribute(new Float32Array(16 * 16), 16);
    pool.visible = false;
    render();
    expect(blob.instanceMatrix).toBe(pool.instanceMatrix);
    expect(blob.count).toBe(0);
  });
});
