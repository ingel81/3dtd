/**
 * Enemy Model Budget Generator.
 *
 * Measures every enemy model in ENEMY_TYPES and writes the tables between the
 * markers in docs/ENEMY_MODEL_BUDGET.md. The text around the markers (budget,
 * recommendations) is hand-written and stays untouched.
 *
 * Run on demand:
 *   npm run model-budget
 *
 * Like the other generators in tools/ it also runs with `npm test`, so the
 * tables follow model and config changes. Same inputs give the same output.
 *
 * The VAT numbers come from the helpers the baker uses (vatClips,
 * vatFrameCount, vatLayout). Which meshes get baked follows
 * InstancedEnemyRenderer.bakeAndCreatePool: skinned meshes if there are any,
 * otherwise the rigid meshes of an object-animated model, and every mesh of a
 * static one.
 *
 * The texel format (RGBA16F or RGBA32F) depends on the baked positions, so
 * every model is also loaded with the game's loaders and baked like the game
 * does it (bakeEnemyVAT). Of the textures only the base colour PNGs come
 * along, decoded in Node, so that vatAlpha picks the alpha mode the game
 * picks; JPEG has no alpha and stays out like the other textures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HalfFloatType, Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import { ENEMY_TYPES, type EnemyTypeConfig } from '../../src/app/configs/enemy-types.config';
import { TEMPLATES } from '../../src/app/ai/core/templates';
import { WAVE_CURRICULUM, STATIC_WAVE_PROFILES } from '../../src/app/configs/wave-curriculum.config';
import { TIMING } from '../../src/app/configs/timing.config';
import { bakeEnemyVAT, type VATData } from '../../src/app/three-engine/renderers/instanced-enemy/vat-baker';
import { DEFAULT_BAKE_FPS, vatClips, vatFrameCount } from '../../src/app/three-engine/renderers/instanced-enemy/vat-clips';
import {
  VAT_HALF_FLOAT_MAX_ERROR,
  vatLayout,
  type VATEncoding,
} from '../../src/app/three-engine/renderers/instanced-enemy/vat-encoding';
import type { VATAlpha } from '../../src/app/three-engine/renderers/instanced-enemy/vat-surface';
import { writeGeneratedFile } from '../generated-file';
import {
  decodePng,
  imageSize,
  inspectModel,
  LOW_ALPHA,
  type ImageInfo,
  type MeshInfo,
  type ModelInfo,
} from './model-inspect';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DOC_PATH = resolve(ROOT, 'docs/ENEMY_MODEL_BUDGET.md');
const BEGIN = '<!-- model-budget:begin -->';
const END = '<!-- model-budget:end -->';

/** A wave can bring at least this many of a swarm enemy. */
const SWARM_MIN_PER_WAVE = 400;
const NORMAL_MIN_PER_WAVE = 100;

type BakePath = 'skinned' | 'object' | 'static' | 'failed';

interface BakedClip {
  name: string;
  role: string;
  /** Null when the model has no clip of that name. */
  duration: number | null;
  frames: number;
  /** Frames left out of the bake because the game never shows them (death clip past the removal). */
  cutFrames: number;
}

interface Bake {
  path: BakePath;
  meshes: MeshInfo[];
  clips: BakedClip[];
  totalFrames: number;
}

interface Presence {
  /** Most enemies of this type one wave can bring (share x top of countRange). */
  perWave: number;
  waves: number[];
  staticMax: number;
}

interface Row {
  id: string;
  config: EnemyTypeConfig;
  model: ModelInfo;
  bake: Bake;
  vertices: number;
  triangles: number;
  texWidth: number;
  texHeight: number;
  rowsPerFrame: number;
  diffuse: ImageInfo | null;
  presence: Presence;
  /** The game's bake of the model, null if it failed. */
  baked: { encoding: VATEncoding; width: number; height: number; alpha: VATAlpha } | null;
  /** Base colour images of the baked meshes, each once. */
  baseColour: ImageInfo[];
}

function roleOf(config: EnemyTypeConfig, name: string): string {
  const roles: string[] = [];
  if (name === config.walkAnimation) roles.push('walk');
  if (name === config.runAnimation) roles.push('run');
  if (name === config.deathAnimation || config.deathAnimations?.includes(name)) roles.push('death');
  return roles.join('+');
}

function planBake(config: EnemyTypeConfig, model: ModelInfo): Bake {
  if (!config.hasAnimations || model.clips.length === 0) {
    const meshes = model.meshes.filter((m) => !m.skinned);
    return { path: meshes.length > 0 ? 'static' : 'failed', meshes, clips: [], totalFrames: 1 };
  }

  const clipsByName = new Map(model.clips.map((c) => [c.name, c]));
  const clips = vatClips(config).map(({ name, seconds }): BakedClip => {
    const clip = clipsByName.get(name);
    // The whole clip, baked like its role: a loop, or a clip that stops at its end.
    const whole = clip ? vatFrameCount(clip.duration, DEFAULT_BAKE_FPS, seconds === Infinity ? Infinity : clip.duration) : 0;
    const frames = clip ? vatFrameCount(clip.duration, DEFAULT_BAKE_FPS, seconds) : 0;
    return { name, role: roleOf(config, name), duration: clip?.duration ?? null, frames, cutFrames: whole - frames };
  });

  const skinned = model.meshes.filter((m) => m.skinned && m.vertices > 0);
  const rigid = model.meshes.filter((m) => !m.skinned && m.vertices > 0);
  const anyClip = clips.some((c) => c.duration !== null);
  const meshes = !anyClip ? [] : skinned.length > 0 ? skinned : rigid;
  const path: BakePath = meshes.length === 0 ? 'failed' : skinned.length > 0 ? 'skinned' : 'object';
  return { path, meshes, clips, totalFrames: clips.reduce((s, c) => s + c.frames, 0) };
}

/**
 * Enemies of `id` that one enemy of `parent` puts on the route: itself if it
 * is one, plus what a kill splits it into, recursively (splitOnDeath).
 */
function bodiesOf(parent: string, id: string, depth = 0): number {
  const self = parent === id ? 1 : 0;
  const split = ENEMY_TYPES[parent]?.splitOnDeath;
  if (!split || depth >= 4) return self;
  return self + split.count * bodiesOf(split.type, id, depth + 1);
}

function presenceOf(id: string): Presence {
  let perWave = 0;
  for (const template of TEMPLATES) {
    let n = 0;
    for (const [enemy, share] of template.enemies) {
      n += Math.round(share * template.countRange[1]) * bodiesOf(enemy, id);
    }
    perWave = Math.max(perWave, n);
  }
  const waves = WAVE_CURRICULUM.flatMap((entry, i) => {
    const template = TEMPLATES.find((t) => t.id === entry.template);
    return template?.enemies.some(([enemy]) => bodiesOf(enemy, id) > 0) ? [i + 1] : [];
  });
  const staticMax = Math.max(
    0,
    ...STATIC_WAVE_PROFILES.map((p) => p.groups.reduce((s, g) => s + g.count * bodiesOf(g.enemyType, id), 0)),
  );
  return { perWave, waves, staticMax };
}

/** Loads a model with the game's loaders and bakes it as InstancedEnemyRenderer does. */
async function bakeModel(config: EnemyTypeConfig): Promise<VATData | null> {
  const path = resolve(ROOT, 'public', config.modelUrl);
  const bytes = readFileSync(path);
  // The loaders check `instanceof ArrayBuffer` against the test DOM's realm.
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const loader = new GLTFLoader();
  // Decoding images needs a browser, so this plugin decodes the base colour
  // PNGs itself: vatAlpha reads their alpha (texturePixels takes the bytes
  // as they are). JPEG has no alpha, which is the same to vatAlpha as no
  // map; other formats (WebP, ...) come as a texture without an image,
  // which vatAlpha counts as translucent. Without their extensions no
  // built-in plugin takes a texture on before this one.
  loader.register((parser) => ({
    name: 'model-budget-base-colour',
    beforeRoot: () => {
      for (const texture of parser.json.textures ?? []) delete texture.extensions;
      return null;
    },
    // A promise of null for a texture it leaves out: a plain null would hand
    // the texture to the built-in loader, which needs a browser.
    loadTexture: (async (index: number) => {
      const baseColour = (parser.json.materials ?? []).some(
        (m: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }) =>
          m.pbrMetallicRoughness?.baseColorTexture?.index === index,
      );
      const image = parser.json.images?.[parser.json.textures[index].source];
      if (!baseColour || !image) return null;
      const file: Buffer | null = image.bufferView !== undefined
        ? Buffer.from(await parser.getDependency('bufferView', image.bufferView))
        : image.uri ? readFileSync(resolve(dirname(path), decodeURIComponent(image.uri))) : null;
      if (file && imageSize(file)?.mimeType === 'image/jpeg') return null;
      const pixels = file ? decodePng(file) : null;
      return new Texture(pixels ?? undefined);
    }) as (index: number) => Promise<Texture>,
  }));
  const gltf = await loader.parseAsync(buffer, '');
  return bakeEnemyVAT(config, SkeletonUtils.clone(gltf.scene), gltf.animations);
}

async function buildRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const [id, config] of Object.entries(ENEMY_TYPES)) {
    const model = inspectModel(resolve(ROOT, 'public', config.modelUrl));
    const bake = planBake(config, model);
    const vertices = bake.meshes.reduce((s, m) => s + m.vertices, 0);
    const triangles = bake.meshes.reduce((s, m) => s + m.triangles, 0);
    const { texWidth, rowsPerFrame } = vatLayout(Math.max(1, vertices));
    // The shader samples the map of the mesh with the most vertices.
    let diffuse: ImageInfo | null = null;
    let best = 0;
    for (const mesh of bake.meshes) {
      if (mesh.diffuse && mesh.vertices > best) {
        diffuse = mesh.diffuse;
        best = mesh.vertices;
      }
    }
    const vat = await bakeModel(config);
    const baseColour = [...new Set(bake.meshes.map((m) => m.diffuse).filter((d): d is ImageInfo => d !== null))];
    rows.push({
      id,
      config,
      model,
      bake,
      vertices,
      triangles,
      texWidth,
      texHeight: bake.totalFrames * rowsPerFrame,
      rowsPerFrame,
      diffuse,
      presence: presenceOf(id),
      baked: vat && {
        encoding: vat.encoding,
        width: vat.positionTexture.image.width,
        height: vat.positionTexture.image.height,
        alpha: vat.alpha,
      },
      baseColour,
    });
  }
  return rows.sort((a, b) => b.vertices - a.vertices || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const int = (n: number): string => Math.round(n).toLocaleString('de-DE');
const dec = (n: number, digits = 1): string =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const mb = (bytes: number): string => dec(bytes / (1024 * 1024));
const size = (image: ImageInfo | null): string => (image ? `${image.width}²` : '–');
const isHalfFloat = (row: Row): boolean => row.baked?.encoding.type === HalfFloatType;
const bytesPerTexel = (row: Row): number => (isHalfFloat(row) ? 8 : 16);
const vatBytes = (row: Row): number => row.texWidth * row.texHeight * bytesPerTexel(row);

function classOf(perWave: number): string {
  if (perWave >= SWARM_MIN_PER_WAVE) return 'Swarm';
  if (perWave >= NORMAL_MIN_PER_WAVE) return 'Normal';
  return perWave > 0 ? 'Elite/Boss' : 'in keiner Welle';
}

const BAKE_LABEL: Record<BakePath, string> = {
  skinned: 'Skinning',
  object: 'Objekt-Anim.',
  static: 'statisch',
  failed: 'fehlgeschlagen',
};

/** `align`: one character per column, 'l' or 'r'. Pipes in cells (clip names) are escaped. */
function table(header: string[], align: string, rows: string[][]): string {
  const line = (cells: string[]): string => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  const rule = header.map((_, i) => (align[i] === 'r' ? '---:' : '---'));
  return [line(header), line(rule), ...rows.map(line)].join('\n');
}

function imagesLabel(images: ImageInfo[]): string {
  if (images.length === 0) return '–';
  const counts = new Map<string, number>();
  for (const image of images) {
    const key = image.width === image.height ? `${image.width}²` : `${image.width}×${image.height}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => (n > 1 ? `${n}× ${key}` : key)).join(', ');
}

function weldLabel(meshes: MeshInfo[]): string {
  if (meshes.length === 0 || meshes.some((m) => !m.weld)) return '–';
  const total = (key: 'positionsNormalUv' | 'positionsUv' | 'positions'): number =>
    meshes.reduce((s, m) => s + (m.weld?.[key] ?? 0), 0);
  return `${int(total('positionsNormalUv'))} / ${int(total('positionsUv'))} / ${int(total('positions'))}`;
}

function wavesLabel(waves: number[]): string {
  return waves.length > 0 ? waves.map((w) => `W${w}`).join(', ') : '–';
}

/** Texels below LOW_ALPHA over the base colour images of a type, null if one is not decoded. */
function lowAlphaOf(row: Row): number | null {
  let low = 0;
  for (const image of row.baseColour) {
    if (image.lowAlphaTexels === null || image.lowAlphaTexels === undefined) return null;
    low += image.lowAlphaTexels;
  }
  return low;
}

function alphaLabel(alpha: VATAlpha): string {
  if (alpha.mode === 'mask') return `Maske ${dec(alpha.cutoff, 2)}`;
  return alpha.mode === 'blend' ? 'Blend' : 'opak';
}

function renderAlpha(rows: Row[]): string {
  const out: string[] = [];
  const threshold = dec(LOW_ALPHA, 2);
  out.push('### Alpha');
  out.push('');
  out.push('Wie der VAT-Shader Alpha behandelt (`vatAlpha` in `vat-surface.ts`, aus den Materialien der');
  out.push('gebackenen Meshes und dem Alpha ihrer Basisfarb-Texturen): opak ignoriert Alpha, Maske verwirft');
  out.push(`unter dem Cutoff, Blend ist transparent und verwirft unter ${threshold}. „Texel unter ${threshold}“ zählt in den`);
  out.push('Basisfarb-Texturen der gebackenen Meshes alle Texel mit Alpha darunter, auch solche, die kein UV');
  out.push('trifft; JPEG hat kein Alpha. Die Tabelle nennt die Typen, die nicht opak sind oder solche Texel haben.');
  out.push('');
  const listed = rows.filter((r) => r.baked && (r.baked.alpha.mode !== 'opaque' || lowAlphaOf(r) !== 0));
  out.push(table(
    ['Gegner', 'Alpha', `Texel unter ${threshold}`],
    'llr',
    listed.map((r) => {
      const low = lowAlphaOf(r);
      const texels = r.baseColour.reduce((s, image) => s + image.width * image.height, 0);
      return [
        r.config.name,
        alphaLabel(r.baked!.alpha),
        low === null ? 'nicht dekodiert' : low === 0 ? '0' : `${int(low)} (${dec((100 * low) / texels)} %)`,
      ];
    }),
  ));
  out.push('');
  const names = (list: Row[]): string => (list.length > 0 ? list.map((r) => r.config.name).join(', ') : 'keine');
  const opaque = rows.filter((r) => r.baked?.alpha.mode === 'opaque' && lowAlphaOf(r) === 0);
  // Texels below LOW_ALPHA that the shader draws: opaque ignores alpha, a mask keeps what reaches its cutoff
  const drawn = rows.filter((r) => {
    const alpha = r.baked?.alpha;
    const low = lowAlphaOf(r);
    return alpha && low !== 0 && (alpha.mode === 'opaque' || (alpha.mode === 'mask' && alpha.cutoff <= LOW_ALPHA));
  });
  out.push(`Opak ohne Texel unter ${threshold} (${opaque.length}): ${names(opaque)}.`);
  out.push(`Texel unter ${threshold}, die der Shader deckend zeichnet (opak oder Maske mit Cutoff bis ${threshold}): **${names(drawn)}**.`);
  return out.join('\n');
}

function render(rows: Row[]): string {
  const vertsById = new Map(rows.map((r) => [r.id, r.vertices]));
  const out: string[] = [];

  out.push('### Laufzeitkosten pro Gegner');
  out.push('');
  out.push('Sortiert nach VAT-Vertices pro Instanz. „max./Welle“ ist Anteil × Obergrenze von');
  out.push('`countRange` über alle Templates, vor dem Fairness-Gate, das die meisten Wellen kleiner');
  out.push('macht; was ein Kill abspaltet (`splitOnDeath`), zählt mit. „Mio. Vertices“ = VAT-Vertices ×');
  out.push('max./Welle, also die Vertex-Shader-Last, wenn alle Gegner der größten Welle gleichzeitig');
  out.push('leben. Für abgespaltene Gegner ist das eine Obergrenze: Sie entstehen erst, wenn der');
  out.push('Gegner stirbt, der sie abspaltet. „Half-Fehler“ ist der größte Fehler, den');
  out.push('RGBA16F einer Position im Spiel zufügt (`vatEncoding` in `vat-encoding.ts`, aus den gebackenen');
  out.push(`Positionen). Bis ${dec(VAT_HALF_FLOAT_MAX_ERROR * 1000, 0)} mm ist die VAT RGBA16F (8 Byte pro Texel), darüber RGBA32F (16 Byte).`);
  out.push('');
  out.push(table(
    ['Gegner', 'Klasse', 'max./Welle', 'VAT-Vertices', 'Dreiecke', 'Mio. Vertices', 'Bake-Pfad', 'VAT-Frames', 'VAT-Textur', 'Format', 'Half-Fehler mm', 'VAT-MB', 'Diffuse'],
    'llrrrrlrrlrrr',
    rows.map((r) => [
      `${r.config.name} (\`${r.id}\`)`,
      classOf(r.presence.perWave),
      int(r.presence.perWave),
      int(r.vertices),
      int(r.triangles),
      dec((r.vertices * r.presence.perWave) / 1e6),
      BAKE_LABEL[r.bake.path],
      int(r.bake.totalFrames),
      `${r.texWidth}×${r.texHeight}`,
      r.baked ? (isHalfFloat(r) ? 'RGBA16F' : 'RGBA32F') : '–',
      r.baked ? dec(r.baked.encoding.halfFloatError * 1000, 2) : '–',
      mb(vatBytes(r)),
      size(r.diffuse),
    ]),
  ));
  const totalVat = rows.reduce((s, r) => s + vatBytes(r), 0);
  const totalVat32 = rows.reduce((s, r) => s + r.texWidth * r.texHeight * 16, 0);
  const cutVat = rows.reduce(
    (s, r) => s + r.bake.clips.reduce((c, clip) => c + clip.cutFrames, 0) * r.rowsPerFrame * r.texWidth * bytesPerTexel(r),
    0,
  );
  out.push('');
  out.push(`VAT-Speicher aller Typen zusammen: **${mb(totalVat)} MB** (${DEFAULT_BAKE_FPS} fps), alles in RGBA32F wären **${mb(totalVat32)} MB**.`);
  out.push(`Todes-Clips sind auf den sichtbaren Teil gekürzt; ganz gebacken kämen **${mb(cutVat)} MB** dazu.`);
  out.push('');

  out.push(renderAlpha(rows));
  out.push('');

  out.push('### Modellinhalt');
  out.push('');
  out.push('„Weld“ zählt die gebackenen Meshes: Vertices indiziert / nach Glätten der Normalen');
  out.push('(Position + UV) / nur Positionen. Liegt „indiziert“ unter den VAT-Vertices, lädt der');
  out.push('Loader das Modell nicht indiziert (FBX) oder das Modell enthält doppelte Vertices.');
  out.push('');
  out.push(table(
    ['Gegner', 'Datei', 'MB', 'Meshes (skinned)', 'Knochen', 'Morph', 'Materialien', 'Bilder im Modell', 'Clips', 'Weld'],
    'llrrrrrlrr',
    rows.map((r) => [
      r.config.name,
      `\`${basename(r.config.modelUrl)}\``,
      mb(r.model.fileBytes),
      `${r.model.meshes.length} (${r.model.meshes.filter((m) => m.skinned).length})`,
      int(r.model.bones),
      int(r.model.meshes.reduce((s, m) => s + m.morphTargets, 0)),
      int(r.model.materials),
      imagesLabel(r.model.images),
      int(r.model.clips.length),
      weldLabel(r.bake.meshes),
    ]),
  ));
  const extraJoints = rows.filter((r) => r.model.extraJointSets).map((r) => r.id);
  if (extraJoints.length > 0) {
    out.push('');
    out.push(`Mit zweitem Joint-Satz (JOINTS_1, three.js liest nur vier Einflüsse): ${extraJoints.join(', ')}.`);
  }
  out.push('');

  out.push('### Gebackene Clips');
  out.push('');
  out.push(`Todes-Clips laufen mit \`animationSpeed\`, bis der Gegner nach \`deathDuration\` (Standard ${int(TIMING.deathAnimationDuration)} ms)`);
  out.push('entfernt wird. Gebacken wird nur dieser Teil (`vatClips` in `vat-clips.ts`), „gekürzt“ zählt');
  out.push('die weggelassenen Frames.');
  out.push('');
  out.push(table(
    ['Gegner', 'Clip', 'Rolle', 'Dauer s', 'Frames', 'gekürzt'],
    'lllrrr',
    rows.flatMap((r) => r.bake.clips.map((clip) => [
      r.config.name,
      `\`${clip.name}\``,
      clip.role,
      clip.duration === null ? 'fehlt im Modell' : dec(clip.duration, 2),
      int(clip.frames),
      clip.cutFrames > 0 ? int(clip.cutFrames) : '–',
    ])),
  ));
  out.push('');

  out.push('### Vorkommen in Wellen');
  out.push('');
  out.push('Kurrikulum W1-W30 pinnt die Templates; danach wählt der Director frei (Boss jede fünfte');
  out.push('Welle). „Mio. Vertices“ = Summe über die Mischung bei der Obergrenze von `countRange`,');
  out.push('mit allem, was ein Kill abspaltet.');
  out.push('');
  // VAT vertices of one enemy and everything a kill splits it into
  const lineageVerts = (enemy: string, depth = 0): number => {
    const own = vertsById.get(enemy) ?? 0;
    const split = ENEMY_TYPES[enemy]?.splitOnDeath;
    return !split || depth >= 4 ? own : own + split.count * lineageVerts(split.type, depth + 1);
  };
  const mixLabel = (enemy: string, share: number): string => {
    const split = ENEMY_TYPES[enemy]?.splitOnDeath;
    const label = `${enemy} ${int(share * 100)} %`;
    return split ? `${label} (je Kill +${split.count} ${split.type})` : label;
  };
  const templateRows = TEMPLATES.map((t) => {
    const top = t.countRange[1];
    const load = t.enemies.reduce((s, [enemy, share]) => s + Math.round(share * top) * lineageVerts(enemy), 0);
    const waves = WAVE_CURRICULUM.flatMap((entry, i) => (entry.template === t.id ? [i + 1] : []));
    return { t, top, load, waves };
  }).sort((a, b) => b.load - a.load || a.t.id.localeCompare(b.t.id));
  out.push(table(
    ['Template', 'Kurrikulum', 'max. Anzahl', 'Mischung', 'Mio. Vertices'],
    'llrlr',
    templateRows.map(({ t, top, load, waves }) => [
      `\`${t.id}\``,
      wavesLabel(waves),
      int(top),
      t.enemies.map(([enemy, share]) => mixLabel(enemy, share)).join(', '),
      dec(load / 1e6),
    ]),
  ));
  out.push('');
  out.push(table(
    ['Gegner', 'Kurrikulum-Wellen', 'max. im Static-Fallback'],
    'llr',
    [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [
      r.config.name,
      wavesLabel(r.presence.waves),
      int(r.presence.staticMax),
    ]),
  ));
  return out.join('\n');
}

describe('enemy model budget', () => {
  it('measures every enemy model and writes the budget tables', async () => {
    const rows = await buildRows();
    for (const row of rows) {
      expect(row.bake.path, `${row.id}: VAT bake`).not.toBe('failed');
      expect(row.vertices, `${row.id}: VAT vertices`).toBeGreaterThan(0);
      const missing = row.bake.clips.filter((c) => c.duration === null).map((c) => c.name);
      expect(missing, `${row.id}: configured clips missing from the model`).toEqual([]);
      // The size planned from the file must be what the game's bake builds.
      expect(row.baked, `${row.id}: bake with the game's loaders`).not.toBeNull();
      expect([row.baked?.width, row.baked?.height], `${row.id}: baked VAT size`).toEqual([row.texWidth, row.texHeight]);
    }

    const doc = readFileSync(DOC_PATH, 'utf8');
    const begin = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(begin, `${BEGIN} in ${DOC_PATH}`).toBeGreaterThanOrEqual(0);
    expect(end, `${END} after ${BEGIN}`).toBeGreaterThan(begin);

    // The doc is CRLF in an autocrlf checkout and the tables are LF, so write
    // only real changes and keep the doc's own line endings.
    writeGeneratedFile(DOC_PATH, `${doc.slice(0, begin + BEGIN.length)}\n\n${render(rows)}\n\n${doc.slice(end)}`);
  }, 60_000);
});
