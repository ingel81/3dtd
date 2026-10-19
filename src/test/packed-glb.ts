import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * A model file as the game serves it (packed by tools/model-pack: meshopt
 * geometry, KTX2 textures), parsed without its textures: jsdom decodes no
 * image and has no transcoder, and these specs read geometry, nodes and
 * clips only. `file`: the bytes (readFileSync of public/<modelUrl>).
 */
export async function parsePackedGlb(file: Uint8Array): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  // A copy made here: GLTFLoader checks `instanceof ArrayBuffer`, and a Node Buffer's is another realm's under jsdom
  const data = new Uint8Array(file).buffer;
  // Under the name of GLTFLoader's KTX2 plugin, so it answers for every texture first (null: none)
  const loader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .register(() => ({ name: 'KHR_texture_basisu', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((done, fail) => loader.parse(data, '', done as never, fail));
}
