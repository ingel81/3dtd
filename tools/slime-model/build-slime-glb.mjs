/**
 * Builds public/assets/models/enemies/slime.glb, the slime blob of the ooze
 * boss (sidebar preview) and of the slime clumps a killed ooze breaks into.
 *
 * Procedural and deterministic: a lumpy blob, flat at the bottom, with two
 * bones sticking out of it, and two node animations on the root node that
 * bakeObjectAnimVAT (vat-baker.ts) bakes like the skeleton's:
 *   - Wobble (0.8 s loop): squash on landing, stretch and hop, squash again.
 *   - Splat (0.45 s): flattens into a puddle, the death clip.
 * One unit is about a metre; the blob stands 1.3 units tall and 2.3 wide.
 *
 *   node tools/slime-model/build-slime-glb.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../public/assets/models/enemies/slime.glb');

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Icosphere of unit radius, `subdivisions` times split. */
function icosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = cache.get(key);
      if (i === undefined) {
        const va = verts[a];
        const vb = verts[b];
        i = verts.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])) - 1;
        cache.set(key, i);
      }
      return i;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { verts, faces };
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Area-weighted vertex normals of an indexed triangle mesh. */
function vertexNormals(positions, faces) {
  const normals = positions.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const pa = positions[a];
    const pb = positions[b];
    const pc = positions[c];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [a, b, c]) {
      normals[i][0] += n[0];
      normals[i][1] += n[1];
      normals[i][2] += n[2];
    }
  }
  return normals.map(normalize);
}

/** Appends `part` (positions + faces) to `mesh`, offsetting the indices. */
function append(mesh, part) {
  const base = mesh.positions.length;
  mesh.positions.push(...part.positions);
  mesh.faces.push(...part.faces.map(([a, b, c]) => [a + base, b + base, c + base]));
}

// ---------------------------------------------------------------------------
// The blob
// ---------------------------------------------------------------------------

function blob() {
  const { verts, faces } = icosphere(2);
  const positions = verts.map(([x, y, z]) => {
    // Lumps, fixed by the direction, so the shape is the same every build
    const lump = 1 + 0.07 * Math.sin(4 * x + 1.3) * Math.sin(3 * z + 0.7) + 0.05 * Math.cos(5 * y + 2 * x);
    let px = x * lump * 1.05;
    let py = y * lump;
    let pz = z * lump * 1.05;
    // Flat underside, a lower dome on top
    py = py < 0 ? py * 0.3 : py * 0.95;
    py += 0.3;
    // A lip where it sags onto the ground
    const sag = 1 + 0.14 * (1 - smoothstep(0, 0.45, py));
    px *= sag;
    pz *= sag;
    return [px, py, pz];
  });
  return { positions, faces };
}

// ---------------------------------------------------------------------------
// Bones: a hexagonal shaft with two knobs at each end, like a thigh bone
// ---------------------------------------------------------------------------

function bone(from, to, shaftRadius, knobRadius) {
  const mesh = { positions: [], faces: [] };
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const dir = normalize(axis);
  // Two unit vectors across the axis
  const helper = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize([
    dir[1] * helper[2] - dir[2] * helper[1],
    dir[2] * helper[0] - dir[0] * helper[2],
    dir[0] * helper[1] - dir[1] * helper[0],
  ]);
  const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];

  const sides = 6;
  const shaft = { positions: [], faces: [] };
  for (const end of [from, to]) {
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a) * shaftRadius;
      const s = Math.sin(a) * shaftRadius;
      shaft.positions.push([end[0] + u[0] * c + v[0] * s, end[1] + u[1] * c + v[1] * s, end[2] + u[2] * c + v[2] * s]);
    }
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    shaft.faces.push([k, k1, sides + k], [k1, sides + k1, sides + k]);
  }
  append(mesh, shaft);

  const knob = icosphere(0);
  for (const end of [from, to]) {
    for (const side of [-1, 1]) {
      const centre = [
        end[0] + u[0] * side * knobRadius * 0.7,
        end[1] + u[1] * side * knobRadius * 0.7,
        end[2] + u[2] * side * knobRadius * 0.7,
      ];
      append(mesh, {
        positions: knob.verts.map(([x, y, z]) => [centre[0] + x * knobRadius, centre[1] + y * knobRadius, centre[2] + z * knobRadius]),
        faces: knob.faces,
      });
    }
  }
  return mesh;
}

function bones() {
  const mesh = { positions: [], faces: [] };
  // Out of the top, leaning back
  append(mesh, bone([-0.5, 0.75, 0.15], [0.3, 1.45, -0.25], 0.055, 0.1));
  // Out of the front right flank
  append(mesh, bone([0.1, 0.45, 0.55], [0.95, 0.7, 1.05], 0.05, 0.09));
  return mesh;
}

// ---------------------------------------------------------------------------
// glTF binary
// ---------------------------------------------------------------------------

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];

/** Adds a typed array as its own buffer view (4-byte aligned) and returns the view index. */
function addView(array, target) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const padding = (4 - (bytes.length % 4)) % 4;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(bytes, Buffer.alloc(padding));
  byteLength += bytes.length + padding;
  return bufferViews.length - 1;
}

function addAccessor(array, componentType, type, count, target, withBounds) {
  const view = addView(array, target);
  const accessor = { bufferView: view, componentType, count, type };
  if (withBounds) {
    const size = type === 'VEC3' ? 3 : 1;
    const min = new Array(size).fill(Infinity);
    const max = new Array(size).fill(-Infinity);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < size; c++) {
        const value = array[i * size + c];
        min[c] = Math.min(min[c], value);
        max[c] = Math.max(max[c], value);
      }
    }
    accessor.min = min.map(Math.fround);
    accessor.max = max.map(Math.fround);
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

function addMesh({ positions, faces }) {
  const normals = vertexNormals(positions, faces);
  const position = addAccessor(new Float32Array(positions.flat()), FLOAT, 'VEC3', positions.length, ARRAY_BUFFER, true);
  const normal = addAccessor(new Float32Array(normals.flat()), FLOAT, 'VEC3', normals.length, ARRAY_BUFFER, false);
  const indices = addAccessor(new Uint16Array(faces.flat()), UNSIGNED_SHORT, 'SCALAR', faces.length * 3, ELEMENT_ARRAY_BUFFER, false);
  return { position, normal, indices };
}

/** Keyframes of one clip on the root node: times (s), scale and translation per key. */
function addClip(name, keys) {
  const times = addAccessor(new Float32Array(keys.map((k) => k.t)), FLOAT, 'SCALAR', keys.length, undefined, true);
  const scale = addAccessor(new Float32Array(keys.flatMap((k) => k.scale)), FLOAT, 'VEC3', keys.length, undefined, false);
  const translation = addAccessor(new Float32Array(keys.flatMap((k) => k.move)), FLOAT, 'VEC3', keys.length, undefined, false);
  return {
    name,
    channels: [
      { sampler: 0, target: { node: 0, path: 'scale' } },
      { sampler: 1, target: { node: 0, path: 'translation' } },
    ],
    samplers: [
      { input: times, output: scale, interpolation: 'LINEAR' },
      { input: times, output: translation, interpolation: 'LINEAR' },
    ],
  };
}

const body = addMesh(blob());
const boneMesh = addMesh(bones());

const animations = [
  addClip('Wobble', [
    { t: 0.0, scale: [1.12, 0.84, 1.12], move: [0, 0, 0] },
    { t: 0.2, scale: [0.9, 1.16, 0.9], move: [0, 0.28, 0] },
    { t: 0.4, scale: [0.96, 1.06, 0.96], move: [0, 0.42, 0] },
    { t: 0.6, scale: [0.92, 1.12, 0.92], move: [0, 0.18, 0] },
    { t: 0.8, scale: [1.12, 0.84, 1.12], move: [0, 0, 0] },
  ]),
  addClip('Splat', [
    { t: 0.0, scale: [1, 1, 1], move: [0, 0, 0] },
    { t: 0.12, scale: [1.3, 0.7, 1.3], move: [0, 0, 0] },
    { t: 0.45, scale: [1.9, 0.1, 1.9], move: [0, 0, 0] },
  ]),
];

const gltf = {
  asset: { version: '2.0', generator: '3dtd tools/slime-model/build-slime-glb.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'Slime', children: [1, 2] },
    { name: 'Body', mesh: 0 },
    { name: 'Bones', mesh: 1 },
  ],
  meshes: [
    { name: 'Body', primitives: [{ attributes: { POSITION: body.position, NORMAL: body.normal }, indices: body.indices, material: 0 }] },
    { name: 'Bones', primitives: [{ attributes: { POSITION: boneMesh.position, NORMAL: boneMesh.normal }, indices: boneMesh.indices, material: 1 }] },
  ],
  materials: [
    {
      name: 'Slime',
      pbrMetallicRoughness: { baseColorFactor: [0.22, 0.85, 0.08, 1], metallicFactor: 0, roughnessFactor: 0.3 },
      emissiveFactor: [0.04, 0.2, 0.02],
    },
    {
      name: 'Bone',
      pbrMetallicRoughness: { baseColorFactor: [0.82, 0.78, 0.66, 1], metallicFactor: 0, roughnessFactor: 0.8 },
    },
  ],
  animations,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const json = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'

writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]));
console.log(`wrote ${OUT}: ${accessors[body.position].count} + ${accessors[boneMesh.position].count} vertices`);
