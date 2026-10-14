import { BoxGeometry, DataTexture, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial, ShaderMaterial, Vector2, Vector3, Vector4, type Camera, type Scene, type WebGLRenderer } from 'three';
import { attachBlobShadow, setBlobGround } from './blob-shadow';

describe('attachBlobShadow', () => {
  it('sits beside the pool and follows its count, matrices and slide offsets', () => {
    const scene = new Group();
    const pool = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 8);
    pool.geometry.setAttribute('aPrevOffset', new InstancedBufferAttribute(new Float32Array(24), 3));
    scene.add(pool);
    const blob = attachBlobShadow(pool, 0.5, { value: 1 });
    expect(blob.parent).toBe(scene);
    pool.count = 5;
    const render = () => blob.onBeforeRender(null as unknown as WebGLRenderer, null as unknown as Scene, null as unknown as Camera, blob.geometry, blob.material as MeshBasicMaterial, null as unknown as Group);
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

describe('blob shadows on the ground', () => {
  it('read the ground the world gives each frame they draw, and lie flat without one', () => {
    const scene = new Group();
    const pool = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
    scene.add(pool);
    const blob = attachBlobShadow(pool, 0.5, { value: 1 });
    const u = (blob.material as ShaderMaterial).uniforms;
    const render = () => blob.onBeforeRender(null as unknown as WebGLRenderer, null as unknown as Scene, null as unknown as Camera, blob.geometry, blob.material as ShaderMaterial, null as unknown as Group);
    const heights = new DataTexture(new Float32Array(4), 2, 2);
    const ground = { heights, grid: new Vector4(-10, -10, 20, 0), gridSize: new Vector2(2, 2), origin: new Vector3(5, 0, 7) };
    setBlobGround(() => ground);
    render();
    expect(u['uBlobOnGround'].value).toBe(1);
    expect(u['uBlobHeights'].value).toBe(heights);
    expect(u['uBlobOrigin'].value.toArray()).toEqual([5, 0, 7]);
    // The map moved (a new origin): the next frame follows
    ground.origin.set(1, 2, 3);
    render();
    expect(u['uBlobOrigin'].value.toArray()).toEqual([1, 2, 3]);
    setBlobGround(null);
    render();
    expect(u['uBlobOnGround'].value).toBe(0);
    // Each of the blob's vertices goes on the ground, a 4 x 4 grid so it follows a slope
    expect((blob.material as ShaderMaterial).vertexShader).toContain('blobOnGround(');
    expect(blob.geometry.getAttribute('position').count).toBe(25);
  });
});
