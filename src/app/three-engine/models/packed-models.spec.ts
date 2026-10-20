import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { LOD_BAND } from '../../world/custom-map/render/objects/lod-fade';
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
    objects: { id: string; file: string; textures?: string[]; lod?: { file: string; screen: number; textures?: string[]; tone?: number[] }[]; far?: { screen: number; tone?: number[] } }[];
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

  it('give each LOD its full model look: flat colours from match_lods.py, not the builder guess', () => {
    // blender_kit.flat_copy leaves roughness 0.8 and metalness 0 on each `<name>-lod`, and a first-guess colour (the
    // mean of the sRGB values as a linear colour, too light). match_lods.py writes the texture means in four digits
    // instead. A LOD it never ran over changes colour at its switch distance: the old town's roofs went from dark
    // red to salmon (E265). A source without a texture may well have 0.8 and 0 itself
    interface Materials {
      materials?: { name?: string; pbrMetallicRoughness?: { roughnessFactor?: number; metallicFactor?: number; baseColorTexture?: unknown } }[];
    }
    const unmatched: string[] = [];
    for (const o of catalog.objects) {
      if (!o.lod?.length) continue;
      const textured = new Set(((glbJson(join(MAP_ASSETS, o.file)) as Materials).materials ?? []).filter((m) => m.pbrMetallicRoughness?.baseColorTexture).map((m) => `${m.name}-lod`));
      for (const l of o.lod) {
        for (const m of (glbJson(join(MAP_ASSETS, l.file)) as Materials).materials ?? []) {
          if (!m.name || !textured.has(m.name)) continue;
          const pbr = m.pbrMetallicRoughness ?? {};
          if (Math.abs((pbr.roughnessFactor ?? 1) - 0.8) < 1e-6 && (pbr.metallicFactor ?? 1) === 0) unmatched.push(`${l.file} ${m.name}`);
        }
      }
    }
    expect(unmatched).toEqual([]);
  });

  it('give every detail stage that shows a tone measured against its full model (stage_tones.mjs)', () => {
    // Without one a stage keeps the brightness of its own build: a LOD house 20 to 60 % brighter than its model, a
    // hedge's box half as bright (E268). A LOD whose switch lies within a band's width (LOD_BAND, 12 %) of the far
    // box's never shows alone, and one past it never shows at all: neither is measured
    const missing: string[] = [];
    for (const o of catalog.objects) {
      for (const l of o.lod ?? []) if (!l.tone && !(o.far && l.screen <= (o.far.screen * (1 + LOD_BAND / 2)) / (1 - LOD_BAND / 2))) missing.push(`${o.id} ${l.file}`);
      if (o.far && !o.far.tone) missing.push(`${o.id} far`);
    }
    expect(missing).toEqual([]);
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
