// Packs the game's own models in place (V9): towers, enemies, hero, projectiles, buildings.
//
//   npm run models:pack [-- <file or folder> ...] [--ktx <ktx.exe>]
//   (node tools/model-pack/pack-game-models.mjs [public/assets/models] ...)
//
// Geometry: meshopt (EXT_meshopt_compression), normals, texture
// coordinates, joints, weights and colours quantised (KHR_mesh_quantization);
// animations lossless. Positions stay float: quantised, they
// need a scale on their node, which moves its children and the transforms
// the game reads (the hero's muzzle, the enemy bake's heights, the towers'
// kicks). Textures: KTX2
// in the GLB, ETC1S for colour and data, UASTC for normals (textures.mjs);
// a palette texture (sampled nearest, or at most 64 px: the low-poly kits'
// colormap) stays PNG, where every texel is one colour. Nodes, their names,
// materials, morph targets and animations stay as they are: the game finds
// muzzles, saws and arms by name (tower-model.spec.ts). Identical accessors
// and textures are merged.
//
// A model packed already (meshopt and no image but KTX2, PNG palettes or
// textures kept as built) is
// left alone, so running it again changes nothing and a new model dropped in
// gets packed on the next run; model-pack.spec.ts fails while one is not.
// Folders named `candidates` (not shipped) are skipped.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, listTextureInfo, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createIO, glbJson } from './glb.mjs';
import { encodeKtx2, encodingOf, ktxTool, textureKind, texturePixels } from './textures.mjs';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const NEAREST = 9728;
/** Attributes quantised (KHR_mesh_quantization): all but positions and tangents (normal mapping wants them unit length) */
const QUANTIZED = /^(NORMAL|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/;
/**
 * Models whose textures stay as their builder made them (geometry packed):
 * the spawn portal's emissive map holds data (sigil field, stroke order,
 * cracks) that must stay lossless, and its maps were sized for the download
 * by tools/blender/spawn_portal.py (spawn-portal-frame.spec.ts)
 */
const TEXTURES_AS_BUILT = new Set(['structures/spawn_portal.glb']);
/**
 * Longest edge of an enemy's normal map, px: the game draws enemies through
 * their VAT with the colour map only, the normals serve the sidebar preview
 */
const ENEMY_NORMAL_SIZE = 256;
/**
 * The PSNR gate of ETC1S (textures.mjs) for these models: their atlases are
 * seen at a hundred or two pixels, where ETC1S softening at 28 to 31 dB stays
 * under a pixel (sight check V9); the map gate keeps print and signs sharp
 */
const MIN_PSNR_GAME = { color: 28, data: 25 };
/** Edge up to which a texture counts as a palette */
const PALETTE_MAX = 64;

const args = process.argv.slice(2);
const flags = new Set(['--ktx']);
const targets = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
const tool = ktxTool(args);
const io = await createIO();

function* glbs(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name === 'candidates') continue;
      yield* glbs(join(path, name));
    }
  } else if (path.endsWith('.glb')) {
    yield path;
  }
}

/** Whether a GLB is packed already: meshopt geometry, and every image KTX2 or kept on purpose (extras.kept) */
export function isPacked(json) {
  const meshopt = (json.extensionsUsed ?? []).includes('EXT_meshopt_compression') || !(json.meshes ?? []).length;
  return meshopt && (json.images ?? []).every((im) => im.mimeType === 'image/ktx2' || im.extras?.kept !== undefined);
}

/** A palette texture: small, or sampled nearest by every use */
async function isPalette(texture) {
  const { width, height } = await sharp(Buffer.from(texture.getImage())).metadata();
  if (Math.max(width, height) <= PALETTE_MAX) return true;
  const infos = listTextureInfo(texture);
  return infos.length > 0 && infos.every((info) => info.getMagFilter() === NEAREST);
}

const paths = (targets.length ? targets : [join(ROOT, 'public', 'assets', 'models')]).flatMap((t) => [...glbs(t)]);
let before = 0;
let after = 0;
let packed = 0;
for (const path of paths) {
  const bytes = readFileSync(path);
  if (isPacked(glbJson(bytes))) continue;
  const doc = await io.read(path);
  // Blended surfaces draw their triangles in file order (a ghost's veil over its body): their order stays
  const blended = doc.getRoot().listMaterials().some((m) => m.getAlphaMode() === 'BLEND');
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }),
    ...(blended ? [] : [reorder({ encoder: MeshoptEncoder, target: 'size' })]),
    // Positions stay floats: quantising them puts a scale on the mesh's node, which moves its children
    // (the hero's muzzle under the gun) and every node transform the game reads or animates
    quantize({ pattern: QUANTIZED, patternTargets: QUANTIZED, quantizeNormal: 10, quantizeTexcoord: 14 }),
  );
  // Without meshopt's filters: their quaternion filter turns the bones 0.8 degrees off, the hero's muzzle 8 cm
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  let basisu = null;
  const name = relative(join(ROOT, 'public', 'assets', 'models'), path).split(sep).join('/');
  const asBuilt = TEXTURES_AS_BUILT.has(name);
  const enemy = name.startsWith('enemies/');
  for (const texture of doc.getRoot().listTextures()) {
    if (texture.getMimeType() === 'image/ktx2') continue;
    if (asBuilt) {
      texture.setURI('').setExtras({ ...texture.getExtras(), kept: 'as built' });
      continue;
    }
    if (await isPalette(texture)) {
      const png = await sharp(Buffer.from(texture.getImage())).png({ compressionLevel: 9 }).toBuffer();
      texture.setImage(new Uint8Array(png)).setMimeType('image/png').setURI('').setExtras({ ...texture.getExtras(), kept: 'palette' });
      continue;
    }
    const pixels = await texturePixels(texture, enemy && textureKind(texture) === 'normal' ? ENEMY_NORMAL_SIZE : Infinity);
    const encoding = encodingOf(texture, pixels, { minPsnr: MIN_PSNR_GAME });
    const ktx = await encodeKtx2(tool, pixels, encoding);
    basisu ??= doc.createExtension(KHRTextureBasisu).setRequired(true);
    texture.setImage(new Uint8Array(ktx.bytes)).setMimeType('image/ktx2').setURI('');
    console.error(`  ${texture.getName() || 'texture'} ${encoding.kind} ${ktx.codec} ${ktx.psnr.toFixed(1)} dB ${(ktx.bytes.length / 1024).toFixed(0)} KB`);
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_texture_webp') ext.dispose();
  const out = Buffer.from(await io.writeBinary(doc));
  writeFileSync(path, out);
  before += bytes.length;
  after += out.length;
  packed++;
  console.error(`${relative(ROOT, path).padEnd(56)} ${(bytes.length / 2 ** 20).toFixed(2).padStart(6)} MiB -> ${(out.length / 2 ** 20).toFixed(2).padStart(5)} MiB`);
}
console.error(`${packed} of ${paths.length} models packed: ${(before / 2 ** 20).toFixed(1)} -> ${(after / 2 ** 20).toFixed(1)} MiB`);
