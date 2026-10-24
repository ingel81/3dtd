// Measures how the detail stages of the catalogue's objects (the LOD models, the far box of buildings) differ in
// colour from the full model in the game's light, and gives each stage a tone that evens it out (catalogue
// `lod[].tone`, `far.tone`; object-layer.ts multiplies the stage's colours by it, far-boxes.ts the box's).
//
// The LOD models carry the mean colour of each texture (match_lods.py) but not the model's baked occlusion, its
// grime, normal maps or rough and smooth spots, and the far box is the model's unlit colour on a flat-shaded box:
// in the game's light a LOD house stood 20 to 60 % brighter than the model it replaced, a hedge's box half as bright
// (E268). Each object renders in /map-preview alone on black, each stage forced at the same camera from above and
// from the side; the tone is the full model's mean linear colour over the stage's, per channel, times the stage's
// tone so far (run again, it refines). Writes tools/map-assets/stage-tones.json; stage_tones.py puts it into
// public/maps/assets/catalog.json (update_catalog.py does too).
//
//   npx ng serve --port <port>
//   node tools/map-assets/stage_tones.mjs --url http://localhost:<port> [--report] [<id> ...]
//
// --report prints each stage's deviation (luminance per view) and writes nothing. Playwright comes from
// e2e/node_modules (E2E_DIR points elsewhere, e.g. at the main checkout from a worktree).
//
// --materials (buildings, before the tones): one tone evens out a stage's mean, not what each of its materials lacks.
// A textured roof of clay tiles lost a third of its blue to its texture, normal and roughness maps, a plastered wall
// less; on a LOD house the tone left the roof orange and too light (Erlenbach notes 42, 45). So per textured material
// of the full model that its first LOD has as a flat `<name>-lod`: its pixels (a marker pass finds them, the other
// materials black) as the full model draws them, over the same pixels with that material flat in the LOD's colour.
// Written as `lodMaterials` (per LOD, by the LOD material's name); stage_tones.py puts them into the catalogue as
// `lod[k].materials`, the game multiplies each LOD material's colour by its tone before it merges the plain parts
// (map-asset-library.ts). Run the tones after it: they measure the LOD with its materials toned.
//
// --switch: each stage measured where the game swaps it in, the camera just past its switch distance and both models
// at the mip levels of that distance (1024 px pictures), not close up: a textured roof far off is the mean of its
// small mips, close up its full texture, and the tone has to even out the swap the player sees.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A tone outside this range is a broken stage, not a lighting difference: it is left at its bound and reported */
const TONE_MIN = 0.4;
const TONE_MAX = 2.5;
/**
 * Views per stage as the game camera sees a building, 55 degrees down, from the four diagonals: roof and every wall
 * in the share the player sees them ([x, y, z] directions towards the camera)
 */
const PITCH = (55 * Math.PI) / 180;
const VIEWS = Object.fromEntries(
  [45, 135, 225, 315].map((a) => [`${a}°`, [Math.cos(PITCH) * Math.cos((a * Math.PI) / 180), Math.sin(PITCH), Math.cos(PITCH) * Math.sin((a * Math.PI) / 180)]]),
);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const URL_BASE = option('url', 'http://localhost:4200');
const report = args.includes('--report');
const materialsMode = args.includes('--materials');
const atSwitch = args.includes('--switch');
/** --switch: the camera this far past a level's switch distance (surface distance), the level just shown */
const SWITCH_PAST = 1.05;
/** A material showing fewer pixels than this in the four views gets no tone of its own: too few to measure */
const MATERIAL_LEAST_PIXELS = 400;
const ids = args.filter((a) => !a.startsWith('--'));
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const e2e = process.env.E2E_DIR ?? path.join(root, 'e2e');
const { chromium } = createRequire(path.join(e2e, 'package.json'))('playwright');
const catalogPath = path.join(root, 'public/maps/assets/catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const tonesPath = path.join(here, 'stage-tones.json');
const tones = JSON.parse(readFileSync(tonesPath, 'utf8'));
/**
 * One object's tones into the file at once, under a lock file: several runs over other ids may write meanwhile,
 * and a run cut short keeps what it measured
 */
function save(id, entry) {
  const lock = `${tonesPath}.lock`;
  for (let tries = 0; ; tries++) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (error) {
      if (tries > 200) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const now = JSON.parse(readFileSync(tonesPath, 'utf8'));
    if (entry) now[id] = entry;
    else delete now[id];
    const sorted = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
    // A tone on one line
    writeFileSync(tonesPath, JSON.stringify(sorted, null, 1).replace(/\[\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)\s+\]/g, '[$1, $2, $3]') + '\n');
  } finally {
    unlinkSync(lock);
  }
}
const objects = catalog.objects.filter((o) => o.file && (o.lod?.length || o.far) && (!ids.length || ids.includes(o.id)));

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
// At the switch the object is as many pixels across as in a game window about 1080 high (the preview's 55 degrees
// over 1024 px): its textures at the mip levels the game samples there
const SIZE = atSwitch ? 1024 : 512;
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.error('page error', e.message));
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toLinear = Array.from({ length: 256 }, (_, k) => linear(k / 255));

/** The level `li` forced through the detail bias, rendered: the sums of linear colour over its lit pixels and their count */
async function shoot(bias, li) {
  const pixels = await page.evaluate(async ([bias, li]) => {
    const p = globalThis.__mapPreview;
    // Drawn however small it gets (drawPixels): only the level is forced
    p.view.objects.setDetail({ lodBias: bias, impostorFrom: 380, drawPixels: 0.01 });
    // Until the object shows one level alone (a band settles at rest)
    const b = p.view.objects.batches.find((x) => x.objects.length);
    for (let k = 0; k < 60 && (k < 4 || b.nextOf[0] !== -2); k++) await new Promise((done) => requestAnimationFrame(done));
    if (b.levelOf[0] !== li || b.nextOf[0] !== -2) return null;
    // Rendered and read in one task, while the drawing buffer still holds the frame
    const canvas = p.renderer.domElement;
    p.renderer.render(p.view.group.parent, p.camera);
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }, [bias, li]);
  if (!pixels) return null;
  const sum = [0, 0, 0, 0];
  for (let k = 0; k < pixels.length; k += 4) {
    if (Math.max(pixels[k], pixels[k + 1], pixels[k + 2]) < 8) continue;
    sum[0] += toLinear[pixels[k]];
    sum[1] += toLinear[pixels[k + 1]];
    sum[2] += toLinear[pixels[k + 2]];
    sum[3]++;
  }
  return sum;
}

/** The materials of a GLB by name: base colour factor, roughness, metalness */
function glbMaterials(file) {
  const data = readFileSync(file);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)));
  return Object.fromEntries((json.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    return [m.name, { color: (pbr.baseColorFactor ?? [1, 1, 1]).slice(0, 3), rough: pbr.roughnessFactor ?? 1, metal: pbr.metallicFactor ?? 1 }];
  }));
}

/** The object alone on black in the preview, its full model forced (lodBias 50); its sphere and its full model's materials */
async function openAlone(id) {
  await page.goto(`${URL_BASE}/map-preview?assets=${id}&quality=high`);
  await page.waitForFunction(() => globalThis.__mapPreview?.isReady(), null, { timeout: 120000 });
  return page.evaluate(() => {
    const p = globalThis.__mapPreview;
    const scene = p.view.group.parent;
    scene.background = null;
    p.renderer.setClearColor(0x000000, 1);
    const hide = () => scene.traverse((m) => {
      if ((m.isMesh || m.isPoints || m.isLine || m.isSprite) && !(m.userData.batch || m.userData.objectsKind)) m.visible = false;
    });
    hide();
    const update = p.view.update.bind(p.view);
    p.view.update = (...a) => {
      update(...a);
      hide();
    };
    p.view.objects.setDetail({ lodBias: 50, impostorFrom: 380, drawPixels: 0.01 });
    const b = p.view.objects.batches.find((x) => x.objects.length);
    return { sphere: Array.from(b.spheres.slice(0, 4)), materials: b.draws[0].meshes.map((m) => m.material.name) };
  });
}

/**
 * Material `name` of the full model from direction `dir` at `dist`, three renders in the page: a marker pass (the
 * material green, the others black) finds its pixels, then their summed linear colour as it draws ('full') and in
 * `flat`'s colour without its maps ('flat'), and their count. Only the sums leave the page
 */
function measureMaterial(sphere, dist, dir, name, flat) {
  return page.evaluate(async ([s, dist, d, name, flat]) => {
    const p = globalThis.__mapPreview;
    const l = Math.hypot(...d);
    p.controls.target.set(s[0], s[1], s[2]);
    p.camera.position.set(s[0] + (d[0] / l) * dist, s[1] + (d[1] / l) * dist, s[2] + (d[2] / l) * dist);
    p.controls.update();
    const meshes = p.view.objects.batches.find((x) => x.objects.length).draws[0].meshes;
    const target = meshes.find((m) => m.material.name === name);
    const saved = meshes.map((m) => [m, m.material]);
    const bare = (m) => {
      for (const slot of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) m[slot] = null;
      m.onBeforeCompile = () => {};
      return m;
    };
    // The others black, drawn so they still hide what is behind them
    const black = bare(target.material.clone());
    black.color.setRGB(0, 0, 0);
    black.roughness = 1;
    black.metalness = 0;
    black.envMapIntensity = 0;
    black.emissive.setRGB(0, 0, 0);
    black.customProgramCacheKey = () => 'stage-tones-black';
    for (const m of meshes) if (m !== target) m.material = black;
    const mark = black.clone();
    mark.emissive.setRGB(0, 1, 0);
    mark.customProgramCacheKey = () => 'stage-tones-mark';
    const plain = bare(target.material.clone());
    plain.color.setRGB(flat.color[0], flat.color[1], flat.color[2]);
    plain.roughness = flat.rough;
    plain.metalness = flat.metal;
    plain.customProgramCacheKey = () => 'stage-tones-flat';
    const own = saved.find(([m]) => m === target)[1];
    const canvas = p.renderer.domElement;
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    const lin = Array.from({ length: 256 }, (_, k) => {
      const c = k / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const shot = async (material) => {
      target.material = material;
      for (let k = 0; k < 6; k++) await new Promise((done) => requestAnimationFrame(done));
      // Rendered and read in one task, while the drawing buffer still holds the frame
      p.renderer.render(p.view.group.parent, p.camera);
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const m = await shot(mark);
    const mask = new Uint8Array(m.length / 4);
    for (let k = 0; k < m.length; k += 4) mask[k / 4] = m[k + 1] > 40 && m[k + 1] > 2 * m[k] + 15 && m[k + 1] > 2 * m[k + 2] + 15 ? 1 : 0;
    const sums = {};
    for (const [pass, material] of [['full', own], ['flat', plain]]) {
      const px = await shot(material);
      const sum = [0, 0, 0, 0];
      for (let k = 0; k < px.length; k += 4) {
        if (!mask[k / 4]) continue;
        sum[0] += lin[px[k]];
        sum[1] += lin[px[k + 1]];
        sum[2] += lin[px[k + 2]];
        sum[3]++;
      }
      sums[pass] = sum;
    }
    for (const [mesh, material] of saved) mesh.material = material;
    black.dispose();
    mark.dispose();
    plain.dispose();
    return sums;
  }, [sphere, dist, dir, name, flat]);
}

if (materialsMode) {
  for (const o of objects.filter((x) => x.category === 'building' && x.lod?.length)) {
    const first = [...o.lod].sort((a, b) => b.screen - a.screen)[0];
    const flats = glbMaterials(path.join(root, 'public/maps/assets', first.file));
    const info = await openAlone(o.id);
    const D = info.sphere[3] * 2.6;
    const toned = {};
    for (const name of info.materials) {
      const flat = flats[`${name}-lod`];
      if (!flat) continue;
      const sums = { full: [0, 0, 0, 0], flat: [0, 0, 0, 0] };
      for (const dir of Object.values(VIEWS)) {
        const view = await measureMaterial(info.sphere, D, dir, name, flat);
        for (const pass of ['full', 'flat']) for (let c = 0; c < 4; c++) sums[pass][c] += view[pass][c];
      }
      if (sums.full[3] < MATERIAL_LEAST_PIXELS) continue;
      const tone = [0, 1, 2].map((c) => Math.round(Math.min(TONE_MAX, Math.max(TONE_MIN, sums.full[c] / Math.max(sums.flat[c], 1e-5))) * 1000) / 1000);
      toned[`${name}-lod`] = tone;
      console.log(`${o.id} ${name}: ${sums.full[3]} px, tone ${tone.join(' ')}`);
    }
    if (report) continue;
    const entry = (tones[o.id] ??= {});
    const lodMaterials = (entry.lodMaterials ??= []);
    lodMaterials[o.lod.indexOf(first)] = Object.keys(toned).length ? toned : null;
    if (!entry.lodMaterials.some(Boolean)) delete entry.lodMaterials;
    save(o.id, Object.keys(entry).length ? entry : undefined);
  }
  await browser.close();
  if (!report) execFileSync(process.env.PYTHON ?? 'python', ['-I', path.join(here, 'stage_tones.py'), path.dirname(catalogPath)], { stdio: 'inherit' });
  process.exit(0);
}

for (const o of objects) {
  await page.goto(`${URL_BASE}/map-preview?assets=${o.id}&quality=high`);
  await page.waitForFunction(() => globalThis.__mapPreview?.isReady(), null, { timeout: 120000 });
  // The object alone on black: the map's own meshes hidden after each update too (grass, sky and water set their own)
  const info = await page.evaluate(() => {
    const p = globalThis.__mapPreview;
    const b = p.view.objects.batches.find((x) => x.objects.length);
    const scene = p.view.group.parent;
    scene.background = null;
    p.renderer.setClearColor(0x000000, 1);
    const hide = () => scene.traverse((m) => {
      if ((m.isMesh || m.isPoints || m.isLine || m.isSprite) && !(m.userData.batch || m.userData.objectsKind)) m.visible = false;
    });
    hide();
    const update = p.view.update.bind(p.view);
    p.view.update = (...a) => {
      update(...a);
      hide();
    };
    const s = b.spheres;
    return {
      levels: b.levels.map((l) => ({ from: l.from, far: !!l.shared && !l.impostor, impostor: !!l.impostor })),
      sphere: [s[0], s[1], s[2], s[3]],
      // The preview's camera is narrower than the catalogue's 60 degrees: each object switches that much further out
      viewScale: p.view.objects.viewScale,
    };
  });
  const r = info.sphere[3];
  /** Per level: the sums of linear colour and the pixel count over the views, and the full model's at the same camera */
  const sums = info.levels.map(() => [0, 0, 0, 0]);
  const fullSums = info.levels.map(() => [0, 0, 0, 0]);
  const perView = {};
  const fullPerView = {};
  for (const [view, dir] of Object.entries(VIEWS)) {
    for (let li = 1; li < info.levels.length; li++) {
      if (info.levels[li].impostor) continue;
      const lo = info.levels[li].from * r * info.viewScale;
      const hi = li + 1 < info.levels.length ? info.levels[li + 1].from * r * info.viewScale : lo * 4;
      // Where the game swaps the two: just past the level's switch, both at the mip levels of that distance (--switch);
      // else close up
      const D = atSwitch ? r + lo * SWITCH_PAST : r * 2.6;
      await page.evaluate(([sx, sy, sz, dist, dx, dy, dz]) => {
        const p = globalThis.__mapPreview;
        const l = Math.hypot(dx, dy, dz);
        p.controls.target.set(sx, sy, sz);
        p.camera.position.set(sx + (dx / l) * dist, sy + (dy / l) * dist, sz + (dz / l) * dist);
        p.controls.update();
      }, [...info.sphere.slice(0, 3), D, ...dir]);
      // The level forced at this camera through the quality's detail bias: the surface distance in the middle of its
      // range; the full model at the same camera
      for (const [level, bias, into, per] of [[0, 50, fullSums, fullPerView], [li, (D - r) / Math.sqrt(lo * hi), sums, perView]]) {
        const sum = await shoot(bias, level);
        if (!sum) continue;
        for (let c = 0; c < 4; c++) into[li][c] += sum[c];
        (per[li] ??= {})[view] = sum;
      }
    }
  }
  const mean = (s) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : null);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const entry = (tones[o.id] ??= {});
  let lodIndex = 0;
  const sortedLods = [...(o.lod ?? [])].sort((a, b) => b.screen - a.screen);
  for (let li = 1; li < info.levels.length; li++) {
    const level = info.levels[li];
    if (level.impostor) continue;
    const isFar = level.far;
    const lod = isFar ? null : sortedLods[lodIndex++];
    const stage = mean(sums[li]);
    const full = mean(fullSums[li]);
    const label = isFar ? 'far' : `lod ${lod?.file}`;
    if (!full) {
      console.log(`${o.id} ${label}: the full model shows nothing`);
      continue;
    }
    if (!stage) {
      console.log(`${o.id} ${label}: not shown at the forced bias`);
      continue;
    }
    const views = Object.entries(perView[li] ?? {}).map(([v, s]) => {
      const m = mean(s);
      const f = mean(fullPerView[li]?.[v] ?? [0, 0, 0, 0]);
      return m && f ? `${v} ${Math.round((lum(m) / lum(f) - 1) * 100)} %` : `${v} -`;
    });
    const was = (isFar ? entry.far : entry.lod?.[o.lod.indexOf(lod)]) ?? [1, 1, 1];
    const ratio = full.map((v, c) => v / Math.max(stage[c], 1e-5));
    const tone = was.map((t, c) => Math.round(Math.min(TONE_MAX, Math.max(TONE_MIN, t * ratio[c])) * 1000) / 1000);
    const clamped = tone.some((t) => t === TONE_MIN || t === TONE_MAX);
    console.log(`${o.id} ${label}: luminance ${Math.round((lum(stage) / lum(full) - 1) * 100)} % (${views.join(', ')}), tone ${tone.join(' ')}${clamped ? ' (at its bound)' : ''}`);
    if (report) continue;
    if (isFar) entry.far = tone;
    else (entry.lod ??= [])[o.lod.indexOf(lod)] = tone;
  }
  if (!Object.keys(entry).length) delete tones[o.id];
  if (!report) save(o.id, tones[o.id]);
}
await browser.close();
if (!report) execFileSync(process.env.PYTHON ?? 'python', ['-I', path.join(here, 'stage_tones.py'), path.dirname(catalogPath)], { stdio: 'inherit' });
