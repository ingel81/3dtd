import { BufferAttribute, BufferGeometry, Color, type Material, type MeshStandardMaterial, type Texture } from 'three';
import type { ModelPart } from '../map-asset-library';
import { isWindowGlass } from './night-windows';

/**
 * Fewer draw calls per model: the parts of a model whose materials differ
 * only in their colour, roughness and metalness (the same textures, often
 * just the model's baked occlusion, or none; the same glow, transparency and
 * sides) become one part, the colour moved into a vertex colour and
 * roughness and metalness into a vertex attribute (`roughMetal`, read by
 * the material addVertexRoughMetal patches). A building
 * of ten parts (walls and trims with their own textures, then frames,
 * glass, roof sheet and skylights in plain colours over one occlusion map)
 * keeps its textured parts and draws the plain ones in one or two calls; a
 * car in plain paint, glass, lights and tyres in two or three instead of
 * seven (docs/CUSTOM_MAPS.md, Draw Calls).
 *
 * The material of a merged part is a copy of its first source with white
 * colour, vertex colours on and `userData.roughMetal` set; instance colours (tints, vegetation shades)
 * multiply with them as before. Parts with a colour texture, a foliage card
 * or a group of one stay as they are. Pure: the caller caches per model.
 */

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap',
] as const;

/**
 * The key of the parts that may share one draw: null for a part that keeps
 * its own (a colour texture: its colour is not one; a foliage card). The
 * other textures must be the very same; the geometry's attributes too
 */
export function mergeKey(material: Material, geometry?: BufferGeometry): string | null {
  const m = material as MeshStandardMaterial;
  // Parts that turn (spin-…, object-layer.ts) keep their own draw
  if (!m.isMeshStandardMaterial || m.name.startsWith('foliage-') || m.name.startsWith('spin-') || m.map || m.vertexColors) return null;
  // The loader gives each material its own copy of a shared texture: the image and the uv channel tell them alike
  const textures = TEXTURE_SLOTS.map((slot) => {
    const t = (m as unknown as Record<string, Texture | null>)[slot];
    return t ? `${t.source?.uuid ?? t.uuid}:${t.channel}` : '-';
  }).join(',');
  const attributes = geometry ? Object.keys(geometry.attributes).sort().join(',') : '';
  const emissive = m.emissive ? `${m.emissive.getHexString()}*${m.emissiveIntensity}` : '-';
  // Roughness and metalness go per vertex; under a map they scale it and must agree
  return [
    m.type, m.roughnessMap ? m.roughness : '*', m.metalnessMap ? m.metalness : '*', emissive, m.transparent ? `t${m.opacity}` : 'o', m.side, m.alphaTest, m.depthWrite, m.flatShading,
    textures, m.normalScale?.toArray().join(','), m.aoMapIntensity, attributes,
  ].join('|');
}

/** The vertices a part draws (its draw range), compacted into a geometry of its own with every attribute it has */
function compact(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
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
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const size = attr.itemSize;
    const values = new Float32Array(remap.size * size);
    for (const [from, to] of remap) for (let c = 0; c < size; c++) values[to * size + c] = attr.getComponent(from, c);
    out.setAttribute(name, new BufferAttribute(values, size));
  }
  out.setIndex(corners);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

/** One geometry of `parts`, each vertex coloured with its part's material colour (linear) */
function mergeColored(parts: readonly ModelPart[]): BufferGeometry {
  const pieces = parts.map((p) => compact(p.geometry));
  const vertices = pieces.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const corners = pieces.reduce((n, g) => n + g.getIndex()!.count, 0);
  const names = Object.keys(pieces[0].attributes);
  const arrays = names.map((name) => new Float32Array(vertices * pieces[0].getAttribute(name).itemSize));
  const col = new Float32Array(vertices * 3);
  const roughMetal = new Float32Array(vertices * 2);
  // Window glass among the parts glows at night (night-windows.ts): which vertices are glass
  const glass = parts.some((p) => isWindowGlass(p.material.name)) ? new Float32Array(vertices) : null;
  const index = vertices > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
  let v0 = 0;
  let c0 = 0;
  const color = new Color();
  pieces.forEach((g, k) => {
    const n = g.getAttribute('position').count;
    names.forEach((name, a) => arrays[a].set(g.getAttribute(name).array as Float32Array, v0 * g.getAttribute(name).itemSize));
    const m = parts[k].material as MeshStandardMaterial;
    color.copy(m.color);
    for (let i = 0; i < n; i++) {
      col.set([color.r, color.g, color.b], (v0 + i) * 3);
      roughMetal.set([m.roughness, m.metalness], (v0 + i) * 2);
    }
    if (glass && isWindowGlass(m.name)) glass.fill(1, v0, v0 + n);
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index[c0 + i] = idx.getX(i) + v0;
    v0 += n;
    c0 += idx.count;
    g.dispose();
  });
  const out = new BufferGeometry();
  names.forEach((name, a) => out.setAttribute(name, new BufferAttribute(arrays[a], pieces[0].getAttribute(name).itemSize)));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setAttribute('roughMetal', new BufferAttribute(roughMetal, 2));
  if (glass) out.setAttribute('nightGlow', new BufferAttribute(glass, 1));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * Roughness and metalness from the merged part's vertices (`roughMetal`),
 * for a material of mergeParts; wraps what compiles the material so far
 */
export function addVertexRoughMetal(material: Material): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 roughMetal;\nvarying vec2 vRoughMetal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoughMetal = roughMetal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoughMetal;')
      // The vertex's values in place of the material's, where three's chunks read them: a roughness or
      // metalness map still scales them, and what is patched in after the chunks (rain's wetness,
      // addHeightFog) still works on the result
      .replace('#include <roughnessmap_fragment>', '#define roughness vRoughMetal.x\n#include <roughnessmap_fragment>\n#undef roughness')
      .replace('#include <metalnessmap_fragment>', '#define metalness vRoughMetal.y\n#include <metalnessmap_fragment>\n#undef metalness');
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-rough-metal`;
}

/**
 * The parts of a model with the plain-coloured ones of one look merged;
 * the order of the first part of each group is kept
 */
export function mergeParts(parts: readonly ModelPart[]): ModelPart[] {
  const groups = new Map<string, ModelPart[]>();
  for (const p of parts) {
    const key = mergeKey(p.material, p.geometry);
    if (key === null) continue;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(p);
  }
  const out: ModelPart[] = [];
  const done = new Set<string>();
  for (const p of parts) {
    const key = mergeKey(p.material, p.geometry);
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
    material.userData['roughMetal'] = true;
    material.name = `${p.material.name}+${group.length - 1}`;
    const geometry = mergeColored(group);
    if (geometry.getAttribute('nightGlow')) material.userData['nightGlow'] = true;
    out.push({ geometry, material });
  }
  return out;
}
