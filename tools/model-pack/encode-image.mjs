// One image file as a KTX2 colour texture, the way the model textures are encoded (textures.mjs): sRGB, mipmaps
// clamped at the edges, alpha kept where a texel is not opaque, ETC1S where it keeps MIN_PSNR or UASTC.
//
//   node tools/model-pack/encode-image.mjs <image> <out.ktx2> [--uastc] [--ktx <ktx.exe>]
//
// For pictures made outside a GLB, such as the far boxes' atlas (tools/map-assets/bake_far_boxes.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { MIN_PSNR, encodeKtx2, ktxTool } from './textures.mjs';

const args = process.argv.slice(2);
const flags = new Set(['--ktx']);
const [input, output] = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
if (!input || !output) {
  console.error('usage: node tools/model-pack/encode-image.mjs <image> <out.ktx2> [--uastc] [--ktx <ktx.exe>]');
  process.exit(2);
}
const tool = ktxTool(args);
const { data, info } = await sharp(readFileSync(input)).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.width % 4 || info.height % 4) throw new Error(`${input}: ${info.width} x ${info.height} is not a multiple of 4 (BC7 and ASTC blocks)`);
let alpha = false;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] !== 255) {
    alpha = true;
    break;
  }
}
const pixels = { data, width: info.width, height: info.height, alpha };
const encoding = { kind: 'color', channels: [0, 1, 2], alpha, wrap: false, codec: args.includes('--uastc') ? 'uastc' : 'auto', minPsnr: MIN_PSNR.color };
const result = await encodeKtx2(tool, pixels, encoding);
writeFileSync(output, result.bytes);
console.error(`${output}: ${info.width} x ${info.height}${alpha ? ' with alpha' : ''}, ${result.codec} ${result.psnr.toFixed(1)} dB, ${(result.bytes.length / 1024).toFixed(0)} KB`);
