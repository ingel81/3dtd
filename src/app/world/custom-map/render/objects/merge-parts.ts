import { BufferAttribute, BufferGeometry, Color, type Material, type MeshStandardMaterial } from 'three';
import type { ModelPart } from '../map-asset-library';

/**
 * Fewer draw calls per model: the parts of a model whose materials differ
 * only in their colour (no texture of any kind, the same roughness,
 * metalness, glow, transparency and sides) become one part, the colour
 * moved into a vertex colour. A building of ten parts (walls and trims with
 * textures, then frames, glass, roof sheet and skylights in plain colours)
 * keeps its textured parts and draws the plain ones in one or two calls; a
 * car in plain paint, glass, lights and tyres in two or three instead of
 * seven (docs/CUSTOM_MAPS.md, Draw Calls).
 *
 * The material of a merged part is a copy of its first source with white
 * colour and vertex colours on; instance colours (tints, vegetation shades)
 * multiply with them as before. Parts with a texture, a foliage card or a
 * group of one stay as they are. Pure: the caller caches per model.
 */

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
] as const;

/** The key of the parts that may share one draw: null for a part that keeps its own */
export function mergeKey(material: Material): string | null {
  const m = material as MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.name.startsWith('foliage-')) return null;
  for (const slot of TEXTURE_SLOTS) if ((m as unknown as Record<string, unknown>)[slot]) return null;
  if (m.vertexColors) return null;
  const emissive = m.emissive ? `${m.emissive.getHexString()}*${m.emissiveIntensity}` : '-';
  return [
    m.type, m.roughness, m.metalness, emissive, m.transparent ? `t${m.opacity}` : 'o', m.side, m.alphaTest, m.depthWrite, m.flatShading,
  ].join('|');
}

/** The vertices a part draws (its draw range), compacted into a geometry of its own with position and normal */
function compact(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const total = index ? index.count : position.count;
  const start = Math.max(0, geometry.drawRange.start);
  const end = Math.min(total, start + (Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : total));
  const remap = new Map<number, number>();
  const corners: number[] = [];
  for (let k = start; k < end; k++) {
    const v = index ? index.getX(k) : k;
    let to = remap.get(v);
    if (to === undefined) remap.set(v, (to = remap.size));
    corners.push(to);
  }
  const pos = new Float32Array(remap.size * 3);
  const nor = new Float32Array(remap.size * 3);
  for (const [from, to] of remap) {
    pos.set([position.getX(from), position.getY(from), position.getZ(from)], to * 3);
    if (normal) nor.set([normal.getX(from), normal.getY(from), normal.getZ(from)], to * 3);
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setIndex(corners);
  if (!normal) out.computeVertexNormals();
  return out;
}

/** One geometry of `parts`, each vertex coloured with its part's material colour (linear) */
function mergeColored(parts: readonly ModelPart[]): BufferGeometry {
  const pieces = parts.map((p) => compact(p.geometry));
  const vertices = pieces.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const corners = pieces.reduce((n, g) => n + g.getIndex()!.count, 0);
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const col = new Float32Array(vertices * 3);
  const index = vertices > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
  let v0 = 0;
  let c0 = 0;
  const color = new Color();
  pieces.forEach((g, k) => {
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, v0 * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, v0 * 3);
    color.copy((parts[k].material as MeshStandardMaterial).color);
    for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], (v0 + i) * 3);
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index[c0 + i] = idx.getX(i) + v0;
    v0 += n;
    c0 += idx.count;
    g.dispose();
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * The parts of a model with the plain-coloured ones of one look merged;
 * the order of the first part of each group is kept
 */
export function mergeParts(parts: readonly ModelPart[]): ModelPart[] {
  const groups = new Map<string, ModelPart[]>();
  for (const p of parts) {
    const key = mergeKey(p.material);
    if (key === null) continue;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(p);
  }
  const out: ModelPart[] = [];
  const done = new Set<string>();
  for (const p of parts) {
    const key = mergeKey(p.material);
    const group = key === null ? null : groups.get(key)!;
    if (!group || group.length < 2) {
      out.push(p);
      continue;
    }
    if (done.has(key!)) continue;
    done.add(key!);
    const material = (p.material as MeshStandardMaterial).clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    material.name = `${p.material.name}+${group.length - 1}`;
    out.push({ geometry: mergeColored(group), material });
  }
  return out;
}
