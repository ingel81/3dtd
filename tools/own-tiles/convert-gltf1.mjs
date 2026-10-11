// Converts an old 3D Tiles export (tileset 0.0, b3dm with glTF 1.0 inside, as
// written by ContextCapture around 2017) into something 3DTilesRendererJS
// reads: tileset 1.0 with content.uri, b3dm with a glTF 2.0 GLB inside.
//
//   node tools/own-tiles/convert-gltf1.mjs <input dir> <output dir> [--root Name.json]
//
// glTF 1.0 carries its look in WebGL techniques and shaders, which glTF 2.0
// dropped. Photo meshes only sample one texture, so every material becomes an
// unlit material with that texture (KHR_materials_unlit). CESIUM_RTC moves
// into the b3dm feature table as RTC_CENTER, which B3DMLoader applies without
// a glTF plugin. The root tileset is written as tileset.json unless --root
// names another file; everything else keeps its relative path.
//
// No dependencies; runs the b3dm work on worker threads.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const GL = {
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
  LINEAR: 9729,
  LINEAR_MIPMAP_LINEAR: 9987,
  REPEAT: 10497,
  CULL_FACE: 2884,
};
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const KEEP_ATTRIBUTES = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']);

const pad = (n, to) => (n + to - 1) & ~(to - 1);

// ---------------------------------------------------------------- tileset JSON

function upgradeTileset(json) {
  json.asset = { ...json.asset, version: '1.0' };
  const visit = (tile) => {
    if (tile.content && tile.content.url !== undefined) {
      tile.content.uri = tile.content.url;
      delete tile.content.url;
    }
    if (tile.refine) tile.refine = tile.refine.toUpperCase();
    for (const child of tile.children ?? []) visit(child);
  };
  visit(json.root);
  return json;
}

// ------------------------------------------------------------------- b3dm/glb

function readB3dm(buf) {
  if (buf.toString('latin1', 0, 4) !== 'b3dm') throw new Error('not a b3dm');
  const ftJsonLen = buf.readUInt32LE(12);
  const ftBinLen = buf.readUInt32LE(16);
  const btJsonLen = buf.readUInt32LE(20);
  const btBinLen = buf.readUInt32LE(24);
  // The legacy 20/24 byte headers would put 'glTF' at byte 20 or 24; this
  // export uses the 28 byte header, and anything else is refused loudly.
  if (btJsonLen > buf.length || btBinLen > buf.length) throw new Error('legacy b3dm header');
  let o = 28;
  const ftJson = ftJsonLen ? JSON.parse(buf.toString('utf8', o, o + ftJsonLen).trim() || '{}') : {};
  o += ftJsonLen;
  const ftBin = buf.subarray(o, o + ftBinLen);
  o += ftBinLen;
  const btJson = buf.subarray(o, o + btJsonLen);
  o += btJsonLen;
  const btBin = buf.subarray(o, o + btBinLen);
  o += btBinLen;
  return { ftJson, ftBin, btJson, btBin, glb: buf.subarray(o) };
}

function writeB3dm({ ftJson, ftBin, btJson, btBin }, glb) {
  // The GLB must start on an 8 byte boundary: pad the feature table JSON
  // with spaces, the batch table (if any) is copied as it came.
  let ftText = JSON.stringify(ftJson);
  const before = 28 + ftBin.length + btJson.length + btBin.length;
  while ((before + Buffer.byteLength(ftText)) % 8 !== 0) ftText += ' ';
  const ftBuf = Buffer.from(ftText, 'utf8');
  const header = Buffer.alloc(28);
  header.write('b3dm', 0, 'latin1');
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28 + ftBuf.length + ftBin.length + btJson.length + btBin.length + glb.length, 8);
  header.writeUInt32LE(ftBuf.length, 12);
  header.writeUInt32LE(ftBin.length, 16);
  header.writeUInt32LE(btJson.length, 20);
  header.writeUInt32LE(btBin.length, 24);
  return Buffer.concat([header, ftBuf, ftBin, btJson, btBin, glb]);
}

function readGlb1(glb) {
  if (glb.toString('latin1', 0, 4) !== 'glTF') throw new Error('no glTF in b3dm');
  const version = glb.readUInt32LE(4);
  if (version !== 1) throw new Error(`glTF version ${version}, expected 1`);
  const contentLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString('utf8', 20, 20 + contentLength));
  const body = glb.subarray(20 + contentLength);
  return { json, body };
}

function writeGlb2(json, bin) {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4 !== 0) text += ' ';
  const jsonBuf = Buffer.from(text, 'utf8');
  const binBuf = Buffer.concat([bin, Buffer.alloc(pad(bin.length, 4) - bin.length)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.write('JSON', 4, 'latin1');
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binBuf.length, 0);
  binHead.write('BIN\0', 4, 'latin1');
  return Buffer.concat([header, jsonHead, jsonBuf, binHead, binBuf]);
}

// glTF 1.0 (ids as dictionary keys, binary in KHR_binary_glTF) to glTF 2.0.
function convertGltf1(g1, body) {
  const chunks = [];
  let binLength = 0;
  const bufferViews = [];
  const addView = (data, target) => {
    const aligned = pad(binLength, 4);
    if (aligned > binLength) chunks.push(Buffer.alloc(aligned - binLength));
    chunks.push(data);
    const view = { buffer: 0, byteOffset: aligned, byteLength: data.length };
    if (target) view.target = target;
    binLength = aligned + data.length;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const viewBytes = (id) => {
    const v = g1.bufferViews[id];
    if (v.buffer !== 'binary_glTF' && v.buffer !== Object.keys(g1.buffers)[0]) {
      throw new Error(`external buffer ${v.buffer} not supported`);
    }
    return body.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  };

  const accessors = [];
  const accessorIndex = new Map();
  const accessor = (id) => {
    if (accessorIndex.has(id)) return accessorIndex.get(id);
    const a = g1.accessors[id];
    const elem = COMPONENT_SIZE[a.componentType] * TYPE_COUNT[a.type];
    const stride = a.byteStride || elem;
    const src = viewBytes(a.bufferView);
    const start = a.byteOffset ?? 0;
    let data;
    if (stride === elem) {
      data = Buffer.from(src.subarray(start, start + a.count * elem));
    } else {
      data = Buffer.alloc(a.count * elem);
      for (let i = 0; i < a.count; i++) src.copy(data, i * elem, start + i * stride, start + i * stride + elem);
    }
    const target = g1.bufferViews[a.bufferView].target;
    const out = { bufferView: addView(data, target), componentType: a.componentType, count: a.count, type: a.type };
    if (a.min && a.max) {
      out.min = a.min;
      out.max = a.max;
    } else if (a.type === 'VEC3' && a.componentType === GL.FLOAT && target === 34962) {
      const f = new Float32Array(data.buffer, data.byteOffset, a.count * 3);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < f.length; i++) {
        min[i % 3] = Math.min(min[i % 3], f[i]);
        max[i % 3] = Math.max(max[i % 3], f[i]);
      }
      out.min = min;
      out.max = max;
    }
    accessors.push(out);
    accessorIndex.set(id, accessors.length - 1);
    return accessors.length - 1;
  };

  const images = [];
  const imageIndex = new Map();
  for (const [id, img] of Object.entries(g1.images ?? {})) {
    const ext = img.extensions?.KHR_binary_glTF;
    if (!ext) throw new Error(`image ${id} without KHR_binary_glTF`);
    images.push({ bufferView: addView(Buffer.from(viewBytes(ext.bufferView))), mimeType: ext.mimeType });
    imageIndex.set(id, images.length - 1);
  }

  const samplers = [];
  const samplerIndex = new Map();
  for (const [id, s] of Object.entries(g1.samplers ?? {})) {
    // Mipmaps instead of the export's plain LINEAR: the tiles are seen from
    // far above at a slant, without mips the facades shimmer.
    samplers.push({
      magFilter: GL.LINEAR,
      minFilter: GL.LINEAR_MIPMAP_LINEAR,
      wrapS: s.wrapS ?? GL.REPEAT,
      wrapT: s.wrapT ?? GL.REPEAT,
    });
    samplerIndex.set(id, samplers.length - 1);
  }

  const textures = [];
  const textureIndex = new Map();
  for (const [id, t] of Object.entries(g1.textures ?? {})) {
    const tex = { source: imageIndex.get(t.source) };
    if (t.sampler !== undefined) tex.sampler = samplerIndex.get(t.sampler);
    textures.push(tex);
    textureIndex.set(id, textures.length - 1);
  }

  const materials = [];
  const materialIndex = new Map();
  for (const [id, m] of Object.entries(g1.materials ?? {})) {
    const values = { ...(m.values ?? {}), ...(m.extensions?.KHR_materials_common?.values ?? {}) };
    const pbr = { metallicFactor: 0, roughnessFactor: 1 };
    for (const v of Object.values(values)) {
      if (typeof v === 'string' && textureIndex.has(v)) {
        pbr.baseColorTexture = { index: textureIndex.get(v) };
        break;
      }
      if (Array.isArray(v) && v.length >= 3 && !pbr.baseColorFactor) {
        pbr.baseColorFactor = [v[0], v[1], v[2], v[3] ?? 1];
      }
    }
    if (pbr.baseColorTexture) delete pbr.baseColorFactor;
    const technique = g1.techniques?.[m.technique];
    const culled = technique?.states?.enable?.includes(GL.CULL_FACE) ?? true;
    const mat = { pbrMetallicRoughness: pbr, extensions: { KHR_materials_unlit: {} } };
    if (!culled) mat.doubleSided = true;
    materials.push(mat);
    materialIndex.set(id, materials.length - 1);
  }

  const meshes = [];
  const meshIndex = new Map();
  for (const [id, mesh] of Object.entries(g1.meshes ?? {})) {
    const primitives = mesh.primitives.map((p) => {
      const attributes = {};
      for (const [name, acc] of Object.entries(p.attributes)) {
        const key = name === 'TEXCOORD' ? 'TEXCOORD_0' : name;
        if (KEEP_ATTRIBUTES.has(key)) attributes[key] = accessor(acc);
      }
      const out = { attributes, mode: p.mode ?? 4 };
      if (p.indices !== undefined) out.indices = accessor(p.indices);
      if (p.material !== undefined) out.material = materialIndex.get(p.material);
      return out;
    });
    meshes.push({ primitives });
    meshIndex.set(id, meshes.length - 1);
  }

  // glTF 1.0 lets a node hold several meshes; 2.0 allows one, so extra
  // meshes become child nodes.
  const nodes = [];
  const nodeIndex = new Map();
  const nodeIds = Object.keys(g1.nodes ?? {});
  for (const id of nodeIds) {
    nodes.push({});
    nodeIndex.set(id, nodes.length - 1);
  }
  for (const id of nodeIds) {
    const n = g1.nodes[id];
    const out = nodes[nodeIndex.get(id)];
    if (n.matrix && n.matrix.some((v, i) => v !== (i % 5 === 0 ? 1 : 0))) out.matrix = n.matrix;
    if (n.translation) out.translation = n.translation;
    if (n.rotation) out.rotation = n.rotation;
    if (n.scale) out.scale = n.scale;
    const children = (n.children ?? []).map((c) => nodeIndex.get(c));
    const nodeMeshes = n.meshes ?? (n.mesh !== undefined ? [n.mesh] : []);
    nodeMeshes.forEach((m, i) => {
      if (i === 0) out.mesh = meshIndex.get(m);
      else {
        nodes.push({ mesh: meshIndex.get(m) });
        children.push(nodes.length - 1);
      }
    });
    if (children.length) out.children = children;
  }

  const sceneId = g1.scene ?? Object.keys(g1.scenes ?? {})[0];
  const rootNodes = (g1.scenes?.[sceneId]?.nodes ?? nodeIds).map((n) => nodeIndex.get(n));

  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: '3dtd convert-gltf1' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: rootNodes }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: pad(bin.length, 4) }],
  };
  if (textures.length) Object.assign(json, { textures, images, samplers });
  if (!samplers.length) delete json.samplers;
  return { json, bin, rtcCenter: g1.extensions?.CESIUM_RTC?.center ?? null };
}

function convertB3dm(buf) {
  const b3dm = readB3dm(buf);
  const { json: g1, body } = readGlb1(b3dm.glb);
  const { json, bin, rtcCenter } = convertGltf1(g1, body);
  const ftJson = { BATCH_LENGTH: 0, ...b3dm.ftJson };
  if (rtcCenter) {
    if (ftJson.RTC_CENTER) throw new Error('both CESIUM_RTC and RTC_CENTER set');
    ftJson.RTC_CENTER = rtcCenter;
  }
  return writeB3dm({ ...b3dm, ftJson }, writeGlb2(json, bin));
}

// ---------------------------------------------------------------- main thread

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const rootName = rootFlag >= 0 ? args.splice(rootFlag, 2)[1] : null;
  const [inDir, outDir] = args.map((a) => path.resolve(a));
  if (!inDir || !outDir) {
    console.error('usage: node tools/own-tiles/convert-gltf1.mjs <input dir> <output dir> [--root Name.json]');
    process.exit(2);
  }

  const files = [...walk(inDir)];
  const b3dms = [];
  const tilesets = new Map();
  for (const file of files) {
    const rel = path.relative(inDir, file);
    if (file.endsWith('.b3dm')) {
      b3dms.push(rel);
    } else if (file.endsWith('.json')) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json.asset && json.root) tilesets.set(rel, upgradeTileset(json));
    }
  }
  const rootRel = rootName ?? [...tilesets.keys()].find((rel) => path.dirname(rel) === '.');
  if (!tilesets.has(rootRel)) throw new Error(`root tileset ${rootRel} not found`);
  if (path.dirname(rootRel) !== '.') throw new Error('the root tileset must sit at the top of the input dir');

  // The root and the tilesets it references stay separate files; deeper
  // external tilesets (ContextCapture writes one per tile from L19 on) are
  // inlined into their parent, which saves one request per tile when the
  // camera comes close.
  let inlined = 0;
  const inline = (json, hostDir) => {
    const visit = (tile) => {
      const uri = tile.content?.uri;
      if (uri?.endsWith('.json') && !tile.children?.length) {
        const extRel = path.join(hostDir, uri);
        const ext = tilesets.get(extRel);
        if (!ext) throw new Error(`external tileset ${extRel} missing`);
        inline(ext, path.dirname(extRel));
        const rebase = (t) => {
          if (t.content?.uri) t.content.uri = path.relative(hostDir, path.join(path.dirname(extRel), t.content.uri)).split(path.sep).join('/');
          for (const c of t.children ?? []) rebase(c);
        };
        rebase(ext.root);
        for (const key of Object.keys(tile)) delete tile[key];
        Object.assign(tile, ext.root);
        inlined++;
        return;
      }
      for (const child of tile.children ?? []) visit(child);
    };
    visit(json.root);
  };
  const write = (rel, json) => {
    fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(outDir, rel), JSON.stringify(json));
  };
  const rootJson = tilesets.get(rootRel);
  let written = 1;
  const visitRoot = (tile) => {
    const uri = tile.content?.uri;
    if (uri?.endsWith('.json')) {
      const rel = path.join(path.dirname(rootRel), uri);
      const json = tilesets.get(rel);
      inline(json, path.dirname(rel));
      write(rel, json);
      written++;
    }
    for (const child of tile.children ?? []) visitRoot(child);
  };
  visitRoot(rootJson.root);
  write('tileset.json', rootJson);
  console.log(`${tilesets.size} tileset files read, ${written} written, ${inlined} inlined; ${b3dms.length} b3dm to convert`);

  const threads = Math.max(1, availableParallelism() - 2);
  const per = Math.ceil(b3dms.length / threads);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: threads }, (_, i) => {
      const slice = b3dms.slice(i * per, (i + 1) * per);
      return new Promise((resolve, reject) => {
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: { inDir, outDir, files: slice } });
        w.on('message', resolve);
        w.on('error', reject);
      });
    }),
  );
  const sum = results.reduce((s, r) => ({ inBytes: s.inBytes + r.inBytes, outBytes: s.outBytes + r.outBytes, errors: [...s.errors, ...r.errors] }), {
    inBytes: 0,
    outBytes: 0,
    errors: [],
  });
  const mb = (n) => (n / 1e6).toFixed(0);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s: ${mb(sum.inBytes)} MB in, ${mb(sum.outBytes)} MB out, ${sum.errors.length} errors`);
  for (const e of sum.errors.slice(0, 20)) console.log(`  ${e}`);
  process.exit(sum.errors.length ? 1 : 0);
}

function workerMain() {
  const { inDir, outDir, files } = workerData;
  let inBytes = 0;
  let outBytes = 0;
  const errors = [];
  for (const rel of files) {
    try {
      const buf = fs.readFileSync(path.join(inDir, rel));
      const out = convertB3dm(buf);
      const target = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, out);
      inBytes += buf.length;
      outBytes += out.length;
    } catch (e) {
      errors.push(`${rel}: ${e.message}`);
    }
  }
  parentPort.postMessage({ inBytes, outBytes, errors });
}

if (isMainThread) await main();
else workerMain();
