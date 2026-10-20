/**
 * Copies the decoders the game loads at run time from three into public/:
 * Draco (public/draco/gltf) and the Basis transcoder (public/basis). They
 * are not in the repository (.gitignore); without them models load without
 * their KTX2 textures, with nothing but a 404 in the console. Run by
 * postinstall, `npm start` and `npm run build`, so a checkout whose
 * node_modules came from elsewhere (a worktree's junction) has them too.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const libs = 'node_modules/three/examples/jsm/libs';
const sets = [
  [`${libs}/draco/gltf`, 'public/draco/gltf', ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']],
  [`${libs}/basis`, 'public/basis', ['basis_transcoder.js', 'basis_transcoder.wasm']],
];

for (const [src, dst, files] of sets) {
  mkdirSync(dst, { recursive: true });
  for (const f of files) {
    if (!existsSync(`${src}/${f}`)) {
      console.error(`Missing ${src}/${f}: run npm ci`);
      process.exit(1);
    }
    copyFileSync(`${src}/${f}`, `${dst}/${f}`);
  }
}
console.log('Draco decoder and Basis transcoder copied');
