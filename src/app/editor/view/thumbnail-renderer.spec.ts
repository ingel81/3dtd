import { DataTexture, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { texturesOf } from './thumbnail-renderer';

describe('thumbnail renderer', () => {
  it('finds every texture of a picture once, for uploading one per idle moment', () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const normal = new DataTexture(new Uint8Array(4), 1, 1);
    const a = new MeshStandardMaterial({ map, normalMap: normal });
    const b = new MeshStandardMaterial({ map });
    const group = new Group();
    const inner = new Group();
    group.add(new Mesh(new PlaneGeometry(), a), inner);
    inner.add(new Mesh(new PlaneGeometry(), [a, b]));
    expect([...texturesOf(group)]).toEqual([map, normal]);
  });
});
