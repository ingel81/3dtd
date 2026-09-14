import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { mergeBakedMeshes, type BakedMeshPart } from './vat-surface';
import { emptyBounds } from './vat-encoding';

/** A mesh of `positions` (xyz per vertex), with normals, UVs and an index where given. */
function mesh(material: Material, positions: number[], opts: { normals?: number[]; uvs?: number[]; index?: number[] } = {}): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (opts.normals) geometry.setAttribute('normal', new BufferAttribute(new Float32Array(opts.normals), 3));
  if (opts.uvs) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(opts.uvs), 2));
  if (opts.index) geometry.setIndex(opts.index);
  return new Mesh(geometry, material);
}

/** The meshes as parts one after another, into root space by `meshToRoot`. */
function bake(meshes: Mesh[], meshToRoot = new Matrix4()): { parts: BakedMeshPart[]; total: number } {
  let vertexOffset = 0;
  const parts = meshes.map((m) => {
    const vertexCount = m.geometry.getAttribute('position').count;
    const part = { mesh: m, vertexCount, vertexOffset, meshToRoot, normalMatrix: new Matrix3().getNormalMatrix(meshToRoot) };
    vertexOffset += vertexCount;
    return part;
  });
  return { parts, total: vertexOffset };
}

/** A texture one texel high, RGBA bytes per texel from left to right. */
function texture(...texels: [number, number, number, number][]): DataTexture {
  return new DataTexture(new Uint8Array(texels.flat()), texels.length, 1);
}

function xyz(attribute: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number): number[] {
  return [attribute.getX(i), attribute.getY(i), attribute.getZ(i)];
}

/**
 * mergeBakedMeshes on its own, with fixed expectations. The bake paths had
 * fingerprints over their output until 2fc131c5; these pin the merge they
 * all share.
 */
describe('mergeBakedMeshes', () => {
  it('puts positions and normals into root space, offsets the indices and grows the bounds', () => {
    const material = new MeshStandardMaterial();
    const indexed = mesh(material, [0, 0, 0, 1, 0, 0, 0, 1, 0], { normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], index: [0, 2, 1] });
    // No normal, no UV, no index
    const loose = mesh(material, [0, 0, 0, 0, 0, 2, 0, 3, 0]);
    // A quarter turn about Y, then 10 m along X
    const toRoot = new Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 0);
    const { parts, total } = bake([indexed, loose], toRoot);
    const bounds = emptyBounds();

    const merged = mergeBakedMeshes(parts, total, bounds);
    const geometry = merged.geometry;

    const position = geometry.getAttribute('position');
    expect(merged.positions).toBe(position.array);
    // (1, 0, 0) turns to (0, 0, -1), (0, 0, 2) of the second mesh to (2, 0, 0)
    xyz(position, 1).forEach((v, i) => expect(v).toBeCloseTo([10, 0, -1][i]));
    xyz(position, 4).forEach((v, i) => expect(v).toBeCloseTo([12, 0, 0][i]));
    // The normal turns with it; a mesh without normals points up
    const normal = geometry.getAttribute('normal');
    xyz(normal, 0).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i]));
    expect(xyz(normal, 3)).toEqual([0, 1, 0]);
    expect(Array.from(geometry.getIndex()!.array)).toEqual([0, 2, 1, 3, 4, 5]);
    expect(Array.from(geometry.getAttribute('aVertexIndex').array)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(new Array(12).fill(0));
    bounds.min.forEach((v, i) => expect(v).toBeCloseTo([10, 0, -1][i]));
    bounds.max.forEach((v, i) => expect(v).toBeCloseTo([12, 3, 0][i]));
  });

  it('samples a shared map at runtime, bakes an own texture into the vertex colours, keeps the colour without one', () => {
    const atlas = texture([255, 255, 255, 255]);
    // The most vertices with a map: its map is the type's diffuse map
    const main = mesh(new MeshStandardMaterial({ map: atlas }), [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    // The atlas's image through a clone of it, as glTF gives a shared atlas
    const shared = mesh(new MeshStandardMaterial({ map: atlas.clone(), opacity: 0.5 }), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    // Own texture: red on the left, half transparent green on the right
    const decal = texture([255, 0, 0, 255], [0, 255, 0, 128]);
    const own = mesh(new MeshStandardMaterial({ map: decal }), [0, 0, 0, 1, 0, 0], { uvs: [0.25, 0.5, 0.75, 0.5] });
    const plainMaterial = new MeshStandardMaterial({ color: 0x336699, opacity: 0.8 });
    const plain = mesh(plainMaterial, [0, 0, 0]);
    // An own texture without UVs cannot be sampled: the material colour
    const noUvMaterial = new MeshStandardMaterial({ map: texture([0, 0, 255, 255]), color: 0xff8800 });
    const noUv = mesh(noUvMaterial, [0, 0, 0]);
    const { parts, total } = bake([main, shared, own, plain, noUv]);

    const merged = mergeBakedMeshes(parts, total);
    const geometry = merged.geometry;
    const color = geometry.getAttribute('aVertexColor');
    const alpha = geometry.getAttribute('aVertexAlpha');

    expect(merged.diffuseMap).toBe(atlas);
    expect(Array.from(geometry.getAttribute('aUseMap').array)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(xyz(color, 4)).toEqual([1, 1, 1]);
    expect(alpha.getX(4)).toBe(0.5);
    expect(xyz(color, 7)).toEqual([1, 0, 0]);
    expect(alpha.getX(7)).toBe(1);
    expect(xyz(color, 8)).toEqual([0, 1, 0]);
    expect(alpha.getX(8)).toBeCloseTo(128 / 255);
    const { r, g, b } = plainMaterial.color;
    xyz(color, 9).forEach((v, i) => expect(v).toBeCloseTo([r, g, b][i]));
    expect(alpha.getX(9)).toBeCloseTo(0.8);
    const orange = noUvMaterial.color;
    xyz(color, 10).forEach((v, i) => expect(v).toBeCloseTo([orange.r, orange.g, orange.b][i]));
    // Only the own texture that was sampled is read
    expect(merged.pixelCache.has(decal)).toBe(true);
    expect(merged.pixelCache.has(noUvMaterial.map!)).toBe(false);
    expect(merged.baseColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(merged.isUnlit).toBe(false);
  });

  it('takes the colour of the largest mesh without a map and reads a basic material as unlit', () => {
    const small = mesh(new MeshStandardMaterial({ color: 0xff0000 }), [0, 0, 0]);
    const bigMaterial = new MeshBasicMaterial({ color: 0x00ff00 });
    const big = mesh(bigMaterial, [0, 0, 0, 1, 0, 0]);
    const { parts, total } = bake([small, big]);

    const merged = mergeBakedMeshes(parts, total);

    const { r, g, b } = bigMaterial.color;
    expect(merged.baseColor).toEqual({ r, g, b });
    expect(merged.diffuseMap).toBeNull();
    expect(merged.isUnlit).toBe(true);
  });
});
