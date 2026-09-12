// Loads a GLB in Node with three's GLTFLoader, without its images: decoding
// them needs a browser, and the bake scripts read geometry and animation only.
// Shared by bake-compare.mjs, loop-find.mjs and clip-trace.mjs.
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** The GLB with images, textures and every texture reference in the materials removed. */
function withoutImages(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  for (const m of json.materials ?? []) {
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions;
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const rest = bytes.subarray(20 + jsonLength);
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12));
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, jsonBytes.length, true);
  outView.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out.buffer;
}

/** { root, animations } of a GLB file, as GLTFLoader builds them. */
export async function loadGlb(path) {
  const buffer = readFileSync(path);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(withoutImages(bytes), '', resolve, reject));
  return { root: gltf.scene, animations: gltf.animations };
}
