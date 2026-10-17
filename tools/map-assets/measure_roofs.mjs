// Measures the top surface of every model that can carry a tower: a grid
// over the model's bounds at scale 1, each cell the highest point rays
// straight down from above meet on it (SUBSAMPLES² of them, so a thin stake
// of a palisade is not missed between cell middles): a ridge, a flat roof, a
// wall's walk, the floor inside a ruin. The game stands a tower on it as on the
// roofs of the 3D tiles (CustomMapSurface, object-roof.ts). Writes
// tools/map-assets/roofs.json, which update_catalog.py puts into the
// catalogue as `roof`.
//
// What carries: buildings, walls and structures that forbid building, are
// at least ROOF_ABOVE_GROUND high, neither float nor span a gap (aloft).
// Walls and gatehouses (a road through them) get `kind: 'crown'`, a long
// narrow top a tower may hang over on both sides (tower-footprint.ts), but
// only where the bake shows a solid walk: along nearly all its length a run
// across of solid cells (most of their rays hit within a few decimetres of
// the cell's top) at least CROWN_MIN_WIDTH wide, at about one height. A
// fence, an iron gate, chains or a palisade of single stakes have none: a
// wall without it carries no tower at all, a gatehouse keeps a plain roof.
// Read from the catalogue, so run it after update_catalog.py has written the
// entries, then update_catalog.py again.
//
//   node tools/map-assets/measure_roofs.mjs public/maps/assets
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, DoubleSide, Raycaster, Vector3 } from 'three';
import { loadGlb } from '../model-budget/glb-node.mjs';

const CATEGORIES = new Set(['building', 'wall', 'structure']);
/** Least height that carries (PLINTH_CONFIG.ROOF_ABOVE_GROUND): lower is a fence or a hedge, ground for the tower */
const LEAST_HEIGHT = 2.5;
/** Cells along the longer side at most, and the finest cell, m */
const MAX_CELLS = 24;
const MIN_CELL = 0.5;
/** A hit lower than this is the ground (a floor, a plinth): no roof there, m */
const FLOOR = 0.3;
/** Rays per cell along each side */
const SUBSAMPLES = 3;
/** A cell is solid where at least this share of its rays hit within SOLID_BAND of its top */
const SOLID_SHARE = 0.6;
const SOLID_BAND = 0.6;
/** Narrowest solid walk across a crown, m, and the share of its length that must have it */
const CROWN_MIN_WIDTH = 1;
const CROWN_MIN_LENGTH_SHARE = 0.8;
/** Largest step between two neighbouring cells of a walk, m */
const CROWN_MAX_STEP = 1;

/**
 * Whether the grid holds a solid walk along the model's x or z (see the
 * head; a short wall segment is longer across than along): per position
 * along it the widest run across of solid cells whose neighbours differ at
 * most CROWN_MAX_STEP, CROWN_MIN_WIDTH or more on CROWN_MIN_LENGTH_SHARE of
 * the positions
 */
function hasSolidCrown(tops, solid, columns, rows, cell) {
  return solidWalk(tops, solid, columns, rows, cell, true) || solidWalk(tops, solid, columns, rows, cell, false);
}

function solidWalk(tops, solid, columns, rows, cell, alongX) {
  const length = alongX ? columns : rows;
  const across = alongX ? rows : columns;
  const at = (u, v) => (alongX ? v * columns + u : u * columns + v);
  const need = Math.ceil(CROWN_MIN_WIDTH / cell - 1e-9);
  let carrying = 0;
  for (let u = 0; u < length; u++) {
    let run = 0;
    let best = 0;
    for (let v = 0; v < across; v++) {
      const k = at(u, v);
      const joins = run > 0 && Math.abs(tops[k] - tops[at(u, v - 1)]) <= CROWN_MAX_STEP;
      run = solid[k] ? (joins ? run + 1 : 1) : 0;
      best = Math.max(best, run);
    }
    if (best >= need) carrying++;
  }
  return carrying >= CROWN_MIN_LENGTH_SHARE * length;
}

const assets = process.argv[2];
if (!assets) {
  console.error('usage: node tools/map-assets/measure_roofs.mjs <public/maps/assets>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(assets, 'catalog.json'), 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100 || 0;
const out = {};
const raycaster = new Raycaster();
const down = new Vector3(0, -1, 0);
const from = new Vector3();
for (const o of catalog.objects) {
  if (!CATEGORIES.has(o.category) || !o.blocksBuild || o.float || o.aloft || o.file === '' || o.height < LEAST_HEIGHT) continue;
  const { root } = await loadGlb(join(assets, o.file));
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) m.side = DoubleSide;
    meshes.push(child);
  });
  const b = new Box3().setFromObject(root, true);
  const cell = Math.max(MIN_CELL, Math.ceil((Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / MAX_CELLS) * 10) / 10);
  const columns = Math.max(1, Math.ceil((b.max.x - b.min.x) / cell));
  const rows = Math.max(1, Math.ceil((b.max.z - b.min.z) / cell));
  // The grid's middle on the bounds' middle
  const x0 = (b.min.x + b.max.x) / 2 - (columns * cell) / 2;
  const z0 = (b.min.z + b.max.z) / 2 - (rows * cell) / 2;
  const tops = new Float64Array(columns * rows);
  const solid = new Uint8Array(columns * rows);
  const hits = [];
  let highest = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      let y = 0;
      hits.length = 0;
      for (let si = 0; si < SUBSAMPLES; si++) {
        for (let sj = 0; sj < SUBSAMPLES; sj++) {
          from.set(x0 + (i + (si + 0.5) / SUBSAMPLES) * cell, b.max.y + 1, z0 + (j + (sj + 0.5) / SUBSAMPLES) * cell);
          raycaster.set(from, down);
          const hit = raycaster.intersectObjects(meshes, false)[0];
          if (hit && hit.point.y >= FLOOR) {
            y = Math.max(y, hit.point.y);
            hits.push(hit.point.y);
          }
        }
      }
      tops[j * columns + i] = y;
      solid[j * columns + i] = y > 0 && hits.filter((h) => h >= y - SOLID_BAND).length >= SOLID_SHARE * SUBSAMPLES * SUBSAMPLES ? 1 : 0;
      highest = Math.max(highest, y);
    }
  }
  if (highest === 0) continue;
  // One byte per cell in steps of `step` metres, 0 where nothing carries
  const step = Math.ceil((highest / 255) * 1000) / 1000;
  const bytes = Buffer.from(Array.from(tops, (y) => (y === 0 ? 0 : Math.max(1, Math.min(255, Math.round(y / step))))));
  const crown = (o.category === 'wall' || o.roadThrough === true) && hasSolidCrown(tops, solid, columns, rows, cell);
  if (o.category === 'wall' && !crown) continue;
  out[o.id] = { x: r2(x0), z: r2(z0), cell, columns, rows, step, heights: bytes.toString('base64'), ...(crown ? { kind: 'crown' } : {}) };
}
const lines = Object.entries(out).map(([id, roof]) => `  ${JSON.stringify(id)}: ${JSON.stringify(roof)}`);
writeFileSync(join(here, 'roofs.json'), `{\n${lines.join(',\n')}\n}\n`);
console.error(lines.length, 'models measured');
