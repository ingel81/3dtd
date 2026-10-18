import {
  Color,
  DataTexture,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  UnsignedByteType,
  Vector3,
} from 'three';
import { MAX_SIGN_TEXT, type MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject, CatalogSignPanel } from '../asset-catalog';
import { mapToScene } from '../map-coords';
import { seatHeight } from './object-seat';
import { SIGN_ICONS } from './sign-icons';

/**
 * The writing on signs (MapObject.sign on a model with a catalogue
 * `signPanel`): the word in the game's font and the pictogram, both cut
 * into one atlas of single-channel masks and drawn as instanced quads over
 * the panels, one draw call for every sign of the map. The boards are the
 * objects' own models; a word only lies on them.
 *
 * Atlas: one cell per label (pictogram, word and the panel's shape), laid
 * out in shelves, cells as high as CELL_HEIGHT, as wide as the panel's
 * shape asks; the atlas grows in height to at most ATLAS_MAX. A map's
 * signs name kinds of shops (a few dozen labels), so it stays small.
 *
 * Ink: the panel's `ink`, else dark on a light board and light on a dark
 * one (the board's colour is the object's tint). The writing takes the
 * map's light, shadows and fog like the board it lies on, and fades out
 * between FADE_FROM and FADE_TO metres from the camera, where it would be a
 * shimmer of a few pixels.
 */

/** Height of a cell in the atlas, px */
export const CELL_HEIGHT = 64;
const ATLAS_WIDTH = 1024;
const ATLAS_MAX = 2048;
/** Gap between cells, px (no bleeding under mipmaps) */
const GAP = 4;
/** The writing fades out between these distances, m */
const FADE_FROM = 160;
const FADE_TO = 220;
/** The quad stands this far in front of its panel, m */
const LIFT = 0.006;
/** Signs drawn at most (the generator writes no more than its own cap) */
export const MAX_SIGNS = 2048;
const DARK_INK = '#1d1b18';
const LIGHT_INK = '#f0e8d4';

const FONT = `'Barlow Semi Condensed', 'Arial Narrow', sans-serif`;

/** One label's cell in the atlas, px */
export interface SignCell {
  key: string;
  text: string;
  icon: string;
  aspect: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What draws the cells: a canvas the size of the atlas, or none where the platform has none (tests) */
export type SignCanvasFactory = (w: number, h: number) => { getContext(id: '2d'): CanvasRenderingContext2D | null } | null;

const defaultCanvas: SignCanvasFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as { getContext(id: '2d'): CanvasRenderingContext2D | null };
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
};

/** The label key of a sign on a panel of `aspect` (width over height) */
export function signKey(text: string, icon: string, aspect: number): string {
  return `${aspect.toFixed(1)}|${icon}|${text}`;
}

/** The text a sign writes: trimmed, at most MAX_SIGN_TEXT characters */
export function signText(text: string | undefined): string {
  return (text ?? '').trim().slice(0, MAX_SIGN_TEXT);
}

/**
 * Shelf layout of the labels: each cell CELL_HEIGHT high and as wide as its
 * aspect asks (at most the atlas' width), rows left to right, top to bottom.
 * Returns the cells and the atlas height (a power of two), or null when they
 * do not fit into ATLAS_MAX
 */
export function layoutSignCells(labels: readonly { text: string; icon: string; aspect: number }[]): { cells: SignCell[]; height: number } | null {
  const cells: SignCell[] = [];
  let x = 0;
  let y = 0;
  for (const l of labels) {
    const w = Math.min(ATLAS_WIDTH, Math.max(CELL_HEIGHT, Math.round(CELL_HEIGHT * l.aspect)));
    if (x + w > ATLAS_WIDTH) {
      x = 0;
      y += CELL_HEIGHT + GAP;
    }
    cells.push({ key: signKey(l.text, l.icon, l.aspect), text: l.text, icon: l.icon, aspect: l.aspect, x, y, w, h: CELL_HEIGHT });
    x += w + GAP;
  }
  const used = cells.length ? y + CELL_HEIGHT : CELL_HEIGHT;
  let height = 64;
  while (height < used) height *= 2;
  return height > ATLAS_MAX ? null : { cells, height };
}

/** Draws one label into its cell: the pictogram square at the left, the word in the rest, both centred when alone */
function drawCell(g: CanvasRenderingContext2D, c: SignCell): void {
  const pad = Math.round(c.h * 0.1);
  const inner = c.h - 2 * pad;
  const draw = c.icon ? SIGN_ICONS[c.icon] : undefined;
  const textW = c.text ? c.w - 2 * pad - (draw ? inner + pad : 0) : 0;
  let left = c.x + pad;
  if (draw) {
    // Alone: in the middle of the cell
    const ix = c.text ? left : c.x + (c.w - inner) / 2;
    g.save();
    g.translate(ix, c.y + pad);
    g.scale(inner / 64, inner / 64);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    draw(g);
    g.restore();
    left += inner + pad;
  }
  if (c.text && textW > 8) {
    let size = Math.round(inner * 0.86);
    g.font = `700 ${size}px ${FONT}`;
    const width = g.measureText(c.text).width;
    if (width > textW) {
      size = Math.max(10, Math.floor((size * textW) / width));
      g.font = `700 ${size}px ${FONT}`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(c.text, left + textW / 2, c.y + c.h / 2 + size * 0.04);
  }
}

/** The single-channel atlas of the labels (white on black), or null without a canvas */
export function drawSignAtlas(cells: readonly SignCell[], height: number, canvas: SignCanvasFactory = defaultCanvas): Uint8Array | null {
  const c = canvas(ATLAS_WIDTH, height);
  const g = c?.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#000';
  g.fillRect(0, 0, ATLAS_WIDTH, height);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  for (const cell of cells) drawCell(g, cell);
  const rgba = g.getImageData(0, 0, ATLAS_WIDTH, height).data;
  const out = new Uint8Array(ATLAS_WIDTH * height);
  // Rows flipped: texture v runs up
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * ATLAS_WIDTH * 4;
    const dst = y * ATLAS_WIDTH;
    for (let x = 0; x < ATLAS_WIDTH; x++) out[dst + x] = rgba[src + x * 4];
  }
  return out;
}

/** The ink of a sign: the panel's own, else against the board's colour (the object's tint, the light board without one) */
export function signInk(panel: CatalogSignPanel, tint: string | undefined): string {
  if (panel.ink) return panel.ink;
  if (!tint) return DARK_INK;
  const c = new Color(tint);
  // Linear luminance; a board darker than mid grey takes light writing
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.22 ? DARK_INK : LIGHT_INK;
}

/** One quad to draw: where it stands (a matrix of a unit quad), its cell and its ink */
export interface SignQuad {
  matrix: Matrix4;
  key: string;
  ink: string;
}

const UP = new Vector3(0, 1, 0);

/**
 * The quads of the map's signs: one per written face of each object with a
 * sign whose model has a panel. `groundAt`, `waterAt`: what seats the
 * objects (object-seat.ts), so a sign stands where its board is drawn
 */
export function signQuads(
  objects: readonly MapObject[],
  entries: ReadonlyMap<string, CatalogObject>,
  groundAt: (x: number, y: number) => number,
  waterAt: (x: number, y: number) => number | null,
): { quads: SignQuad[]; labels: Map<string, { text: string; icon: string; aspect: number }> } {
  const quads: SignQuad[] = [];
  const labels = new Map<string, { text: string; icon: string; aspect: number }>();
  const q = new Quaternion();
  const basis = new Matrix4();
  const origin = new Vector3();
  const at = new Vector3();
  const n = new Vector3();
  const x = new Vector3();
  for (const o of objects) {
    if (!o.sign || quads.length >= MAX_SIGNS) continue;
    const e = entries.get(o.asset);
    const panel = e?.signPanel;
    if (!e || !panel) continue;
    const text = signText(o.sign.text);
    const icon = o.sign.icon && SIGN_ICONS[o.sign.icon] ? o.sign.icon : '';
    if (!text && !icon) continue;
    const aspect = Math.round((panel.width / panel.height) * 10) / 10;
    const key = signKey(text, icon, aspect);
    if (!labels.has(key)) labels.set(key, { text, icon, aspect });
    const s = o.scale || 1;
    mapToScene(o.x, o.y, seatHeight(e, o, groundAt, waterAt) + o.z, origin);
    q.setFromAxisAngle(UP, o.rotation);
    const ink = signInk(panel, o.tint);
    const nl = panel.normal ?? [0, 0, 1];
    for (let side = 0; side < (panel.sides ?? 1); side++) {
      n.set(nl[0], nl[1], nl[2]).normalize();
      at.set(panel.at[0], panel.at[1], panel.at[2]);
      if (side === 1) {
        // The back face: the panel mirrored across the model's plane through its origin, facing the other way
        at.addScaledVector(n, -2 * at.dot(n));
        n.negate();
      }
      at.addScaledVector(n, LIFT).multiplyScalar(s).applyQuaternion(q).add(origin);
      n.applyQuaternion(q);
      // Text reads left to right seen from the front: its x is up across the normal
      x.crossVectors(UP, n).normalize();
      basis.makeBasis(x.multiplyScalar(panel.width * s), UP.clone().multiplyScalar(panel.height * s), n);
      basis.setPosition(at);
      quads.push({ matrix: basis.clone(), key, ink });
      if (quads.length >= MAX_SIGNS) break;
    }
  }
  return { quads, labels };
}

/** The writing of every sign on the map, one instanced mesh over one atlas */
export class SignLayer {
  readonly group = new Group();
  private mesh: InstancedMesh | null = null;
  private atlas: DataTexture | null = null;
  /** The atlas' labels, so a change that keeps them keeps the atlas */
  private atlasKeys = '';
  private cells = new Map<string, SignCell>();
  private atlasHeight = 64;
  private readonly fade = { value: new Vector3(FADE_FROM, FADE_TO, 0) };

  constructor(private readonly canvas: SignCanvasFactory = defaultCanvas) {
    this.group.name = 'custom-map-signs';
    this.group.userData['losTransparent'] = true;
  }

  /** Number of quads drawn (one per written face) */
  get count(): number {
    return this.mesh?.count ?? 0;
  }

  /**
   * Draws the signs of `objects` anew. The atlas is drawn again only when
   * the set of labels changes; the font must be loaded (`fontsReady`), else
   * the canvas writes a fallback face
   */
  set(
    objects: readonly MapObject[],
    catalog: AssetCatalog,
    groundAt: (x: number, y: number) => number,
    waterAt: (x: number, y: number) => number | null,
  ): void {
    const entries = new Map(catalog.objects.filter((e) => e.signPanel).map((e) => [e.id, e]));
    const { quads, labels } = signQuads(objects, entries, groundAt, waterAt);
    this.disposeMesh();
    if (!quads.length) return;
    const keys = [...labels.keys()].sort().join('\n');
    if (keys !== this.atlasKeys || !this.atlas) {
      const layout = layoutSignCells([...labels.keys()].sort().map((k) => labels.get(k)!));
      if (!layout) return;
      const pixels = drawSignAtlas(layout.cells, layout.height, this.canvas);
      if (!pixels) return;
      this.atlas?.dispose();
      const tex = new DataTexture(pixels, ATLAS_WIDTH, layout.height, RedFormat, UnsignedByteType);
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      this.atlas = tex;
      this.atlasKeys = keys;
      this.atlasHeight = layout.height;
      this.cells = new Map(layout.cells.map((c) => [c.key, c]));
    }
    const geometry = new PlaneGeometry(1, 1);
    const rects = new Float32Array(quads.length * 4);
    const mesh = new InstancedMesh(geometry, this.material(), quads.length);
    const color = new Color();
    quads.forEach((quad, i) => {
      const c = this.cells.get(quad.key)!;
      rects[i * 4] = c.x / ATLAS_WIDTH;
      rects[i * 4 + 1] = 1 - (c.y + c.h) / this.atlasHeight;
      rects[i * 4 + 2] = c.w / ATLAS_WIDTH;
      rects[i * 4 + 3] = c.h / this.atlasHeight;
      mesh.setMatrixAt(i, quad.matrix);
      mesh.setColorAt(i, color.set(quad.ink));
    });
    geometry.setAttribute('aSignRect', new InstancedBufferAttribute(rects, 4));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'custom-map-sign-text';
    this.mesh = mesh;
    this.group.add(mesh);
  }

  private material(): MeshStandardMaterial {
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0, alphaTest: 0.5 });
    m.alphaToCoverage = true;
    const atlas = { value: this.atlas };
    const fade = this.fade;
    m.onBeforeCompile = (shader) => {
      shader.uniforms['uSignAtlas'] = atlas;
      shader.uniforms['uSignFade'] = fade;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec4 aSignRect;
uniform vec3 uSignFade;
varying vec2 vSignUv;
varying float vSignFade;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
vSignUv = aSignRect.xy + uv * aSignRect.zw;
vec4 signWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
vSignFade = 1.0 - smoothstep(uSignFade.x, uSignFade.y, distance(signWorld.xyz, cameraPosition));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uSignAtlas;
varying vec2 vSignUv;
varying float vSignFade;`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `diffuseColor.a = texture2D(uSignAtlas, vSignUv).r * vSignFade;
#include <alphatest_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'custom-map-sign-text';
    return m;
  }

  private disposeMesh(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
    this.mesh = null;
  }

  dispose(): void {
    this.disposeMesh();
    this.atlas?.dispose();
    this.atlas = null;
    this.atlasKeys = '';
  }
}

/** Resolves when the game's font can draw the signs (at once where the platform has no font loading) */
export function fontsReady(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  return fonts.load(`700 48px 'Barlow Semi Condensed'`).then(
    () => undefined,
    () => undefined,
  );
}
