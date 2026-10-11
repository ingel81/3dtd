import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderTarget,
  LinearMipmapLinearFilter,
  LinearFilter,
  SRGBColorSpace,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ObjectModel } from '../map-asset-library';

/**
 * Impostors for far trees: the model drawn once from the side and once from
 * above into a small texture (albedo only, unlit), shown as two crossed
 * upright cards and one flat card at crown height. Four triangles instead
 * of hundreds; the scene lights them like any standard material, with
 * normals bent outwards and up.
 */

const SIDE = 256;

export interface Impostor {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  texture: Texture;
  dispose(): void;
}

export function bakeImpostor(renderer: WebGLRenderer, model: ObjectModel): Impostor | null {
  const parts = model.parts;
  if (!parts.length) return null;
  const scene = new Scene();
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const unlit: Material[] = [];
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox!;
    min.min(box.min);
    max.max(box.max);
    const src = part.material as MeshStandardMaterial;
    const m = new MeshBasicMaterial({
      map: src.map ?? null,
      color: src.color ?? new Color(1, 1, 1),
      alphaTest: src.alphaTest > 0 ? src.alphaTest : 0,
      transparent: false,
      side: DoubleSide,
    });
    unlit.push(m);
    scene.add(new Mesh(part.geometry, m));
  }
  const width = Math.max(max.x - min.x, max.z - min.z);
  const height = max.y - min.y;
  if (!(width > 0 && height > 0)) return null;
  const cx = (max.x + min.x) / 2;
  const cz = (max.z + min.z) / 2;

  const target = new WebGLRenderTarget(SIDE * 2, SIDE, { samples: 4 });
  target.texture.colorSpace = SRGBColorSpace;
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  target.texture.magFilter = LinearFilter;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(target);
  // A leaf-dark clear colour with no alpha: mipmaps blend towards it, not towards black
  renderer.setClearColor(0x2c3a22, 0);
  renderer.autoClear = false;
  renderer.clear();
  // A bound render target draws to its own viewport and scissor, not the canvas's
  target.scissorTest = true;

  // Side view on the left half
  const half = Math.max(width, height) / 2;
  const side = new OrthographicCamera(-half, half, min.y + 2 * half, min.y, 0.1, 1000);
  side.position.set(cx, 0, max.z + 50);
  side.lookAt(cx, 0, cz);
  side.top = min.y + 2 * half;
  side.bottom = min.y;
  side.updateProjectionMatrix();
  target.viewport.set(0, 0, SIDE, SIDE);
  target.scissor.set(0, 0, SIDE, SIDE);
  renderer.setRenderTarget(target);
  renderer.render(scene, side);
  // Top view on the right half
  const top = new OrthographicCamera(-half, half, half, -half, 0.1, 1000);
  top.position.set(cx, max.y + 50, cz);
  top.up.set(0, 0, -1);
  top.lookAt(cx, 0, cz);
  top.updateProjectionMatrix();
  target.viewport.set(SIDE, 0, SIDE, SIDE);
  target.scissor.set(SIDE, 0, SIDE, SIDE);
  renderer.setRenderTarget(target);
  renderer.render(scene, top);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  for (const m of unlit) m.dispose();

  const geometry = impostorGeometry(cx, cz, half, min.y, height);
  const material = new MeshStandardMaterial({
    map: target.texture,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  material.name = 'impostor';
  return {
    geometry,
    material,
    texture: target.texture,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      target.dispose();
    },
  };
}

/** Two crossed upright cards (left half of the texture) and a flat card at crown height (right half) */
function impostorGeometry(cx: number, cz: number, half: number, bottom: number, height: number): BufferGeometry {
  const y0 = bottom;
  const y1 = bottom + 2 * half;
  const yc = bottom + height * 0.62;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const quad = (p: number[][], t: number[][], n: number[][]): void => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...p[k]);
      uv.push(...t[k]);
      nor.push(...n[k]);
    }
  };
  const sideUv = [
    [0, 0],
    [0.5, 0],
    [0.5, 1],
    [0, 1],
  ];
  // Normals out of the card's side and up, like the crown's
  const up = 0.6;
  quad(
    [
      [cx - half, y0, cz],
      [cx + half, y0, cz],
      [cx + half, y1, cz],
      [cx - half, y1, cz],
    ],
    sideUv,
    [
      [-0.8, up, 0],
      [0.8, up, 0],
      [0.8, up, 0],
      [-0.8, up, 0],
    ],
  );
  quad(
    [
      [cx, y0, cz + half],
      [cx, y0, cz - half],
      [cx, y1, cz - half],
      [cx, y1, cz + half],
    ],
    sideUv,
    [
      [0, up, 0.8],
      [0, up, -0.8],
      [0, up, -0.8],
      [0, up, 0.8],
    ],
  );
  quad(
    [
      [cx - half, yc, cz + half],
      [cx + half, yc, cz + half],
      [cx + half, yc, cz - half],
      [cx - half, yc, cz - half],
    ],
    [
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0.5, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  );
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  const n = new Float32Array(nor);
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  g.setAttribute('normal', new BufferAttribute(n, 3));
  return g;
}
