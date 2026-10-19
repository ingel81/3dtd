import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ktx2Opaque } from './model-loader';

/**
 * The shipped models are packed (V9, tools/model-pack): a model dropped in
 * unpacked fails here until `npm run models:pack` (game models) or
 * pack_models.py / pack-map-models.mjs (map models) ran over it.
 */

interface GlbJson {
  extensionsUsed?: string[];
  meshes?: unknown[];
  images?: { uri?: string; mimeType?: string; bufferView?: number; extras?: { kept?: string } }[];
}

function glbJson(path: string): GlbJson {
  const bytes = readFileSync(path);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as GlbJson;
}

function* glbs(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'candidates') yield* glbs(path);
    } else if (name.endsWith('.glb')) {
      yield path;
    }
  }
}

const GAME = 'public/assets/models';
const MAP_ASSETS = 'public/maps/assets';

describe('game models', () => {
  for (const path of glbs(GAME)) {
    it(`${path.slice(GAME.length + 1)} is packed: meshopt geometry, KTX2 textures`, () => {
      const json = glbJson(path);
      if (json.meshes?.length) expect(json.extensionsUsed ?? []).toContain('EXT_meshopt_compression');
      for (const image of json.images ?? []) {
        // A palette or a texture its builder sized on purpose stays as it is (pack-game-models.mjs)
        if (image.extras?.kept) continue;
        expect(image.mimeType, image.uri ?? `image ${image.bufferView}`).toBe('image/ktx2');
        expect(image.uri, 'embedded').toBeUndefined();
      }
    });
  }
});

describe('map models', () => {
  const models = join(MAP_ASSETS, 'models');
  const textures = join(MAP_ASSETS, 'textures');
  const named = new Set<string>();
  const catalog = JSON.parse(readFileSync(join(MAP_ASSETS, 'catalog.json'), 'utf8')) as {
    objects: { id: string; file: string; textures?: string[]; lod?: { file: string; textures?: string[] }[] }[];
  };
  const imagesOf = (file: string): string[] =>
    (glbJson(join(MAP_ASSETS, file)).images ?? []).map((image) => posix.normalize(posix.join(posix.dirname(file), image.uri ?? '<embedded>')));

  it('name every texture as a shared KTX2 file that is there', () => {
    const wrong: string[] = [];
    for (const name of readdirSync(models).filter((n) => n.endsWith('.glb'))) {
      for (const image of glbJson(join(models, name)).images ?? []) {
        const uri = image.uri ?? '';
        if (image.mimeType !== 'image/ktx2' || !uri.startsWith('../textures/') || !existsSync(join(models, uri))) wrong.push(`${name}: ${uri || 'embedded'}`);
        named.add(posix.basename(uri));
      }
    }
    expect(wrong).toEqual([]);
  });

  it('leave no texture file that no model names', () => {
    const orphans = readdirSync(textures).filter((f) => f.endsWith('.ktx2') && !named.has(f));
    expect(orphans).toEqual([]);
  });

  it('list in the catalogue the textures each file names, for the fetch beside the GLB', () => {
    const wrong: string[] = [];
    for (const o of catalog.objects) {
      if (!o.file) continue;
      for (const [file, listed] of [[o.file, o.textures], ...(o.lod ?? []).map((l) => [l.file, l.textures] as const)] as const) {
        const want = [...new Set(imagesOf(file))].sort();
        if (JSON.stringify(want) !== JSON.stringify([...(listed ?? [])].sort())) wrong.push(`${o.id} ${file}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('tell from their data format whether they carry alpha (the enemy bake and foliage read it)', () => {
    const files = readdirSync(textures).filter((f) => f.endsWith('.ktx2'));
    const opaque = (prefix: string) => ktx2Opaque(new Uint8Array(readFileSync(join(textures, files.find((f) => f.startsWith(prefix))!))));
    // Leaf cards are cut by their alpha, a normal map (UASTC) and a plaster wall (ETC1S) have none
    expect(opaque('leaves-oak-')).toBe(false);
    expect(opaque('brushed_concrete_nor_gl_1k-')).toBe(true);
    expect(opaque('brushed_concrete_diff_1k-')).toBe(true);
  });
});
