// KTX2 textures for the map models, shared between them (V9).
//
//   node tools/model-pack/pack-map-models.mjs public/maps/assets [<id> ...] [--ktx <ktx.exe>]
//
// Every texture of models/<id>.glb goes to textures/<name>-<hash>.ktx2, no
// larger than the model's texture size (512 px, `"textureSize": 1024` in
// tools/map-assets/objects.json, half of it for a -lod1 copy, at least 256;
// normals NORMAL_SIZE: UASTC weighs three to four times ETC1S, and the map
// download stays where it was with WebP), and
// the GLB points at it by URI ("../textures/..."): the hash is the texture's
// content (pixels and encoding, textures.mjs), so the brick or plaster that
// dozens of buildings use is one file, downloaded once and, in the game, one
// texture on the GPU (map-asset-library.ts). The codec is ETC1S where it keeps
// the texture (textures.mjs MIN_PSNR), else UASTC, always UASTC for normals;
// `"textureCodec": "uastc"` in tools/map-assets/objects.json gives a model's
// colour and data UASTC too. Each new file prints its codec and PSNR. A model whose textures are all shared
// files already is left alone, so running it again changes nothing. Textures
// no model points at any more leave textures/ at the end.
//
// pack_models.py calls it for the models it packed; on its own it converts
// what is there (the first run turned the WebP textures into KTX2).
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { createIO, glbJson, writeGlbKeepingUris } from './glb.mjs';
import { encodeKtx2, encodingOf, ktxTool, textureHash, textureKind, texturePixels } from './textures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OBJECTS = join(HERE, '..', 'map-assets', 'objects.json');
/** Where the shared files lie, beside models/ */
const TEXTURES = 'textures';
/** Hex digits of the content hash in a file name */
const HASH_DIGITS = 16;

const args = process.argv.slice(2);
const flags = new Set(['--ktx']);
const positional = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
const [assets, ...only] = positional;
if (!assets) {
  console.error('usage: node tools/model-pack/pack-map-models.mjs public/maps/assets [<id> ...] [--ktx <ktx.exe>]');
  process.exit(2);
}
const tool = ktxTool(args);
const io = await createIO();
const spec = Object.fromEntries(JSON.parse(readFileSync(OBJECTS, 'utf8')).map((o) => [o.id, o]));
const modelsDir = join(assets, 'models');
const texturesDir = join(assets, TEXTURES);
mkdirSync(texturesDir, { recursive: true });

/** File name of every shared texture by its hash */
const library = new Map();
for (const file of readdirSync(texturesDir)) {
  const m = /-([0-9a-f]+)\.ktx2$/.exec(file);
  if (m) library.set(m[1], file);
}

/** Longest edge of a normal map, px */
const NORMAL_SIZE = 256;

/** Longest texture edge of a model */
function textureSize(id) {
  const lod = /-lod\d+$/.exec(id);
  const size = spec[lod ? id.slice(0, lod.index) : id]?.textureSize ?? 512;
  return lod ? Math.max(256, size / 2) : size;
}

const slug = (name) => (name || 'texture').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const sharedUri = (file) => posix.join('..', TEXTURES, file);
const isShared = (uri) => typeof uri === 'string' && uri.startsWith(`../${TEXTURES}/`) && uri.endsWith('.ktx2');

const ids = readdirSync(modelsDir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();
const chosen = only.length ? ids.filter((id) => only.includes(id) || only.includes(id.replace(/-lod\d+$/, ''))) : ids;
let encoded = 0;
let reused = 0;
let packed = 0;
const codecs = { etc1s: 0, uastc: 0 };
for (const id of chosen) {
  const path = join(modelsDir, `${id}.glb`);
  const before = readFileSync(path);
  const images = glbJson(before).images ?? [];
  if (images.every((im) => isShared(im.uri))) continue;
  const doc = await io.read(path);
  const uastc = spec[id.replace(/-lod\d+$/, '')]?.textureCodec === 'uastc';
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const texture of doc.getRoot().listTextures()) {
    if (isShared(texture.getURI()) && texture.getMimeType() === 'image/ktx2') continue;
    if (texture.getMimeType() === 'image/ktx2') throw new Error(`${id}: embedded KTX2 texture ${texture.getName()}, no pixels to share`);
    const pixels = await texturePixels(texture, textureKind(texture) === 'normal' ? Math.min(NORMAL_SIZE, textureSize(id)) : textureSize(id));
    const encoding = encodingOf(texture, pixels, { uastc });
    const hash = textureHash(pixels, encoding).slice(0, HASH_DIGITS);
    let file = library.get(hash);
    let bytes;
    if (file) {
      bytes = readFileSync(join(texturesDir, file));
      reused++;
    } else {
      file = `${slug(texture.getName())}-${hash}.ktx2`;
      const result = await encodeKtx2(tool, pixels, encoding);
      bytes = result.bytes;
      codecs[result.codec]++;
      console.error(`  ${file} ${encoding.kind} ${result.codec} ${result.psnr.toFixed(1)} dB${result.etc1sPsnr ? ` (ETC1S ${result.etc1sPsnr.toFixed(1)})` : ''} ${(bytes.length / 1024).toFixed(0)} KB`);
      writeFileSync(join(texturesDir, file), bytes);
      library.set(hash, file);
      encoded++;
    }
    texture.setImage(new Uint8Array(bytes)).setMimeType('image/ktx2').setURI(sharedUri(file));
  }
  // Nothing in WebP any more
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
  if (!doc.getRoot().listTextures().length) basisu.dispose();
  const after = await writeGlbKeepingUris(io, doc);
  writeFileSync(path, after);
  packed++;
  console.error(`${id.padEnd(32)} ${(before.length / 1024).toFixed(0).padStart(6)} KB -> ${(after.length / 1024).toFixed(0).padStart(5)} KB`);
}

// Textures no model points at any more
const used = new Set();
for (const id of ids) {
  for (const im of glbJson(readFileSync(join(modelsDir, `${id}.glb`))).images ?? []) {
    if (isShared(im.uri)) used.add(posix.basename(im.uri));
  }
}
let dropped = 0;
for (const file of readdirSync(texturesDir)) {
  if (file.endsWith('.ktx2') && !used.has(file)) {
    rmSync(join(texturesDir, file));
    dropped++;
  }
}
const bytes = [...used].reduce((n, f) => n + readFileSync(join(texturesDir, f)).length, 0);
console.error(`${packed} models packed, ${encoded} textures encoded (${codecs.etc1s} ETC1S, ${codecs.uastc} UASTC), ` +
  `${reused} reused, ${dropped} dropped; ${used.size} shared textures, ${(bytes / 2 ** 20).toFixed(1)} MiB`);
