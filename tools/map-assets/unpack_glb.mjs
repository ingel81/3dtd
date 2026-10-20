// A packed map model as a plain GLB Blender reads: meshopt decoded, textures dropped (names and factors kept), for
// relod_facades.py. Needs `npm install` in tools/model-pack.
//
//   node tools/map-assets/unpack_glb.mjs <packed.glb> <out.glb>
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pack = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../model-pack/package.json');
const require = createRequire(pack);
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { MeshoptDecoder } = await load('meshoptimizer');
await MeshoptDecoder.ready;
const [input, output] = process.argv.slice(2);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(input);
for (const texture of doc.getRoot().listTextures()) texture.dispose();
for (const extension of doc.getRoot().listExtensionsUsed()) extension.dispose();
await new NodeIO().write(output, doc);
