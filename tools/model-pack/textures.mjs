// GPU-compressed textures for the packed models: what a glTF texture is used
// for decides how ktx.exe (KTX-Software 4.4) encodes it.
//
// - colour (base colour, emissive, sheen and specular colour): sRGB
// - data (metal/rough, occlusion, any other linear map): linear; the channels
//   no material reads (red of a metal/rough map, green and blue of an
//   occlusion map) carry a copy of one it reads, so the codec spends nothing
//   on them
// - normals: UASTC with RDO and Zstandard (ETC1S blocks show as facets in the
//   lighting)
//
// Colour and data take Basis ETC1S, the smallest file, unless it misses
// MIN_PSNR on the channels the materials read (independent channels, hard
// edges of print): then UASTC, as `"textureCodec": "uastc"` in objects.json
// asks for a whole model. Every texture gets its mipmaps here, wrapped like
// its sampler (a tiling texture's small mips stay seamless). Alpha is kept
// only where a blended or masked material reads it and a texel is not fully
// opaque: an opaque file carries none, and the game reads "opaque" from the file (src/app/three-engine/models/model-loader.ts).
// The browser transcodes both codecs to BC7 or ASTC: a quarter of the GPU
// memory of RGBA8.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTextureColorSpace, listTextureInfo, listTextureSlots } from '@gltf-transform/functions';
import sharp from 'sharp';

/** Bump when an encoding setting changes: it is part of every texture's content hash, so all are made again */
export const ENCODING_VERSION = 3;

/**
 * ETC1S quality (1..255) and effort (0..6); `ladder`: the lower qualities
 * tried after the full one, smallest first, for the smallest file within
 * LADDER_DB of the full one's PSNR (and above MIN_PSNR). Smooth plaster or
 * planks keep their look at a third less.
 */
export const ETC1S = { qlevel: 255, clevel: 4, ladder: [96, 128, 192] };
/** How far below the full quality's PSNR a lower ETC1S quality may fall, dB */
export const LADDER_DB = 1;
/** UASTC effort (0..4), RDO lambda for colour and data and for normals (0.25..0.75), Zstandard level */
export const UASTC = { quality: 2, rdo: 1, rdoNormal: 0.5, zstd: 18 };
/**
 * Lowest PSNR (dB) of an ETC1S file over the channels its materials read;
 * below it the texture takes UASTC. Colour: photographed surfaces at 30 to
 * 32 dB look as before (reed, gravel, bark), print breaks up there and asks
 * for UASTC by name (objects.json textureCodec). Data: baked occlusion at 29
 * to 31 dB looks as before, and so does a metal/rough/occlusion map with
 * three independent channels at 25 to 28 dB (roughness and occlusion are
 * felt, not read); only below 25 dB it takes UASTC, at three times the bytes.
 * Packed: one map read as occlusion and as metal/rough through different
 * UV sets (a model's baked occlusion joined with a tiling ARM texture, the
 * old-town houses; packedOcclusion): its
 * weathered occlusion and the tiles' roughness in one image reached 23 to
 * 24.5 dB as ETC1S and took UASTC at five to seven times the bytes; side by
 * side with UASTC it looked the same from the game's camera, only a close-up
 * showed the tiles a little softer. It keeps ETC1S down to 22 dB; one that
 * reaches the data bound at full quality keeps it on the ladder too
 * (encodeKtx2), so none that held it comes out smaller than before.
 */
export const MIN_PSNR = { color: 30, data: 25, packed: 22 };

const REPEAT = 10497;

/**
 * The ktx tool: --ktx <path>, else KTX_TOOL, else `ktx` on the PATH. Build or
 * download KTX-Software 4.4 (README).
 */
export function ktxTool(args) {
  const i = args.indexOf('--ktx');
  const tool = i >= 0 ? args[i + 1] : process.env.KTX_TOOL || 'ktx';
  try {
    execFileSync(tool, ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error(`ktx tool not found (${tool}): pass --ktx <ktx.exe> or set KTX_TOOL (KTX-Software 4.4)`);
  }
  return tool;
}

/** 'normal', 'color' or 'data': how a texture is used by the materials of its document */
export function textureKind(texture) {
  const slots = listTextureSlots(texture);
  if (slots.some((s) => /normal/i.test(s))) return 'normal';
  return getTextureColorSpace(texture) === 'srgb' ? 'color' : 'data';
}

/** The channels (0 red .. 2 blue) the materials of its document read from a texture */
function usedChannels(texture) {
  const used = new Set();
  for (const slot of listTextureSlots(texture)) {
    if (slot === 'metallicRoughnessTexture') [1, 2].forEach((c) => used.add(c));
    else if (slot === 'occlusionTexture') used.add(0);
    else [0, 1, 2].forEach((c) => used.add(c));
  }
  return used.size ? [...used].sort() : [0, 1, 2];
}

/**
 * Whether a material reads the texture as occlusion and as metal/rough through different UV sets: a model's baked
 * occlusion packed with a tiling ARM texture. A baked ORM read through one UV set (the cars) is not
 */
function packedOcclusion(texture) {
  return texture.listParents().some((parent) => parent.propertyType === 'Material' && parent.getOcclusionTexture() === texture
    && parent.getMetallicRoughnessTexture() === texture
    && parent.getOcclusionTextureInfo().getTexCoord() !== parent.getMetallicRoughnessTextureInfo().getTexCoord());
}

/** Whether a material reads the texture's alpha: a base colour of a blended or masked one */
function readsAlpha(texture) {
  return texture.listParents().some((parent) => parent.propertyType === 'Material' && parent.getAlphaMode() !== 'OPAQUE'
    && parent.getBaseColorTexture() === texture);
}

/** Whether every use of the texture repeats it (the mipmaps then wrap around) */
function repeats(texture) {
  const infos = listTextureInfo(texture);
  return infos.length > 0 && infos.every((info) => info.getWrapS() === REPEAT && info.getWrapT() === REPEAT);
}

/** Edge rounded to a multiple of 4 (BC7 and ASTC blocks), at least 4 */
const toBlock = (n) => Math.max(4, Math.round(n / 4) * 4);

/**
 * The texture's pixels as the encoder takes them: RGBA8, edges a multiple of
 * four, `alpha` false when every texel is opaque. `maxSize` caps the longer
 * edge (aspect kept).
 */
export async function texturePixels(texture, maxSize = Infinity) {
  const image = sharp(Buffer.from(texture.getImage()));
  const { width, height } = await image.metadata();
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const w = toBlock(width * scale);
  const h = toBlock(height * scale);
  let pipeline = image.toColourspace('srgb').ensureAlpha();
  if (w !== width || h !== height) pipeline = pipeline.resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  const data = await pipeline.raw().toBuffer();
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      alpha = true;
      break;
    }
  }
  return { data, width: w, height: h, alpha };
}

/**
 * The settings a texture is encoded with: its kind, the channels read,
 * alpha, wrapping and codec ('auto': ETC1S where it reaches `minPsnr`, which
 * the content hash includes; normals and `uastc` true: UASTC). Fills the
 * unread channels of `pixels` with a read one (see the head of the file).
 */
export function encodingOf(texture, pixels, { uastc = false, minPsnr = MIN_PSNR } = {}) {
  const kind = textureKind(texture);
  const channels = usedChannels(texture);
  if (channels.length < 3) {
    const { data } = pixels;
    const from = channels[0];
    const unused = [0, 1, 2].filter((c) => !channels.includes(c));
    for (let i = 0; i < data.length; i += 4) for (const c of unused) data[i + c] = data[i + from];
  }
  const codec = uastc || kind === 'normal' ? 'uastc' : 'auto';
  const alpha = pixels.alpha && readsAlpha(texture);
  // A baked occlusion packed with a tiling ARM texture: the packed bound, the data bound kept for the ladder (MIN_PSNR)
  const packed = kind === 'data' && minPsnr.packed !== undefined && packedOcclusion(texture);
  const bound = packed ? { minPsnr: minPsnr.packed, holdPsnr: minPsnr.data } : { minPsnr: minPsnr[kind] };
  return { kind, channels, alpha, wrap: repeats(texture), codec, ...(codec === 'auto' ? bound : {}) };
}

/** Content hash of a texture's encoded file: pixels plus settings, hex */
export function textureHash(pixels, encoding) {
  const head = JSON.stringify({ v: ENCODING_VERSION, w: pixels.width, h: pixels.height, ...encoding });
  return createHash('sha256').update(head).update(pixels.data).digest('hex');
}

/**
 * Encodes pixels to a KTX2 file: { bytes, codec, psnr } with the PSNR (dB)
 * over the channels read, which 'auto' measures against `encoding.minPsnr`
 * to choose the codec (and `etc1sPsnr`, what ETC1S reached, when it chose UASTC)
 */
export async function encodeKtx2(tool, pixels, encoding) {
  const dir = mkdtempSync(join(tmpdir(), 'model-pack-'));
  try {
    const png = join(dir, 'in.png');
    const channels = encoding.alpha ? 4 : 3;
    const raw = channels === 4 ? pixels.data : stripAlpha(pixels.data);
    await sharp(raw, { raw: { width: pixels.width, height: pixels.height, channels } }).png({ compressionLevel: 1 }).toFile(png);
    const run = async (codec, qlevel = ETC1S.qlevel) => {
      const out = join(dir, `${codec}-${qlevel}.ktx2`);
      create(tool, png, out, encoding, codec, channels, qlevel);
      return { bytes: readFileSync(out), codec, psnr: await psnr(tool, out, pixels, encoding, dir) };
    };
    if (encoding.codec === 'uastc') return await run('uastc');
    const etc1s = await run('etc1s');
    if (etc1s.psnr < encoding.minPsnr) return { ...(await run('uastc')), etc1sPsnr: etc1s.psnr };
    // A map that reached `holdPsnr` at full quality stays above it (a packed map, MIN_PSNR)
    const floor = encoding.holdPsnr && etc1s.psnr >= encoding.holdPsnr ? encoding.holdPsnr : encoding.minPsnr;
    for (const qlevel of ETC1S.ladder) {
      const lower = await run('etc1s', qlevel);
      if (lower.psnr >= floor && lower.psnr >= etc1s.psnr - LADDER_DB && lower.bytes.length < etc1s.bytes.length) return lower;
    }
    return etc1s;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function create(tool, png, out, encoding, codec, channels, qlevel) {
  const srgb = encoding.kind === 'color';
  const format = `R8G8B8${channels === 4 ? 'A8' : ''}_${srgb ? 'SRGB' : 'UNORM'}`;
  const args =
    codec === 'uastc'
      ? ['--encode', 'uastc', '--uastc-quality', String(UASTC.quality), '--uastc-rdo', '--uastc-rdo-l',
          String(encoding.kind === 'normal' ? UASTC.rdoNormal : UASTC.rdo), '--uastc-rdo-m', '--zstd', String(UASTC.zstd)]
      : ['--encode', 'basis-lz', '--clevel', String(ETC1S.clevel), '--qlevel', String(qlevel)];
  execFileSync(tool, ['create', '--format', format, '--assign-tf', srgb ? 'srgb' : 'linear', ...args, '--generate-mipmap',
    '--mipmap-wrap', encoding.wrap ? 'wrap' : 'clamp', '--testrun', png, out], { stdio: 'ignore' });
}

/** PSNR (dB) of a KTX2 file's full-size level against its pixels, over the channels read (and alpha where kept) */
async function psnr(tool, file, pixels, encoding, dir) {
  const back = join(dir, 'back.png');
  execFileSync(tool, ['extract', '--transcode', 'rgba8', file, back], { stdio: 'ignore' });
  const decoded = await sharp(back).ensureAlpha().raw().toBuffer();
  const channels = encoding.alpha ? [...encoding.channels, 3] : encoding.channels;
  let error = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (const c of channels) {
      const d = pixels.data[i + c] - decoded[i + c];
      error += d * d;
    }
  }
  const mse = error / ((pixels.data.length / 4) * channels.length);
  return mse > 0 ? 10 * Math.log10((255 * 255) / mse) : 99;
}

function stripAlpha(rgba) {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}
