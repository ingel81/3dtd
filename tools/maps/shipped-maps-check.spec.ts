/**
 * Quality check of the maps the game ships (`public/maps/index.json`): each
 * file reads and validates, its content hash is the listed one, every spawn
 * reaches the HQ over the map's roads as the game routes them (300 to 1200 m),
 * no object that blocks building stands on a road, every asset and material
 * is in the catalogue, objects and file size stay in budget
 * (docs/SHOWCASE_LEVELS.md, "Regeln für alle Level").
 *
 * Runs with `npm test`; one map alone: `npx vitest run tools/maps/shipped-maps-check.spec.ts -t <id>`
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { edgePolyline, nearestOnEdges, nearestOnPolyline } from '../../src/app/editor/ops/path-graph';
import { validateMap } from '../../src/app/editor/validation/map-validation';
import { CustomMapStreets } from '../../src/app/world/custom-map/custom-map-streets';
import { MAP_METERS_PER_DEGREE, mapToGeo, type CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { contentHash, unpackMapFile, validateMapDocument } from '../../src/app/world/custom-map/map-file';
import type { ShippedMapIndex } from '../../src/app/world/custom-map/map-store';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps');

/** Lane length per spawn, metres along the route */
const MIN_LANE = 300;
const MAX_LANE = 1200;
/** Objects on a map at most */
const MAX_OBJECTS = 15000;
/** A map file at most, bytes (a Medium map with many objects and its picture) */
const MAX_FILE_BYTES = 6 * 1024 * 1024;
/** How far a route may begin off its spawn, metres */
const SNAP = 16;
/** Gates and arches a road runs through by design: they may stand on it */
const ROAD_GATES = new Set(['castle-gate', 'gate-ruin', 'ruin-arch', 'rock-arch', 'hell-gate', 'palisade-gate', 'iron-gate', 'gate-farm']);

interface CatalogFile {
  materials: { id: string }[];
  objects: { id: string; blocksBuild?: boolean }[];
}

const index = JSON.parse(readFileSync(resolve(MAPS_DIR, 'index.json'), 'utf8')) as ShippedMapIndex;
const catalog = JSON.parse(readFileSync(resolve(MAPS_DIR, 'assets/catalog.json'), 'utf8')) as CatalogFile;
const materials = new Set(catalog.materials.map((m) => m.id));
const objects = new Map(catalog.objects.map((o) => [o.id, o]));

/** Metres between two lat/lon points of the synthetic frame (mapToGeo, undistorted at latitude 0) */
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return Math.hypot(a.lat - b.lat, a.lon - b.lon) * MAP_METERS_PER_DEGREE;
}

/**
 * Each spawn's route to the HQ as the game finds it and its length: along the
 * roads to the end of the segment nearest the HQ, then straight to the HQ as
 * the game walks it (PathAndRouteService.leavePathForBase)
 */
async function lanes(doc: CustomMapDocument): Promise<{ spawn: string; length: number; startOff: number }[]> {
  const streets = new CustomMapStreets(doc);
  const network = await streets.loadStreets();
  const hq = mapToGeo(doc.hq);
  return doc.spawns.map((s) => {
    const from = mapToGeo(s);
    const path = streets.findPath(network, from.lat, from.lon, hq.lat, hq.lon);
    let length = path.length ? metres(path[path.length - 1], hq) : 0;
    for (let i = 1; i < path.length; i++) length += metres(path[i - 1], path[i]);
    return { spawn: s.id, length: Math.round(length), startOff: path.length ? metres(path[0], from) : Infinity };
  });
}

describe('shipped maps check', () => {
  it('lists maps with distinct ids', () => {
    expect(index.maps.length).toBeGreaterThan(0);
    expect(new Set(index.maps.map((m) => m.id)).size).toBe(index.maps.length);
  });

  for (const entry of index.maps) {
    describe(entry.id, () => {
      const path = resolve(MAPS_DIR, entry.file);
      const doc = existsSync(path) ? unpackMapFile(readFileSync(path)).doc : null;

      it('reads, validates and matches its entry in index.json', async () => {
        expect(doc, `${entry.file} missing`).not.toBeNull();
        expect(validateMapDocument(doc!)).toEqual([]);
        expect(doc!.meta.id).toBe(entry.id);
        expect(await contentHash(doc!)).toBe(entry.contentHash);
        expect([doc!.terrain.width, doc!.terrain.depth, doc!.spawns.length]).toEqual([entry.width, entry.depth, entry.spawns]);
        if (entry.preview) expect(existsSync(resolve(MAPS_DIR, entry.preview)), `${entry.preview} missing`).toBe(true);
      });

      it(`routes every spawn to the HQ over ${MIN_LANE} to ${MAX_LANE} m of road`, async () => {
        for (const lane of await lanes(doc!)) {
          expect(lane.startOff, `${lane.spawn}: route starts off the spawn`).toBeLessThan(SNAP);
          expect(lane.length, `${lane.spawn}: lane length`).toBeGreaterThanOrEqual(MIN_LANE);
          expect(lane.length, `${lane.spawn}: lane length`).toBeLessThanOrEqual(MAX_LANE);
        }
      });

      it("passes the editor's check without errors", () => {
        const issues = validateMap(doc!, { blocksBuild: (a) => objects.get(a)?.blocksBuild ?? false });
        expect(issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`)).toEqual([]);
      });

      it('keeps objects that block building off the roads (gates and arches excepted)', () => {
        const onRoad: string[] = [];
        for (const o of doc!.objects) {
          if (!(o.blocksBuild ?? objects.get(o.asset)?.blocksBuild ?? false) || ROAD_GATES.has(o.asset)) continue;
          const hit = nearestOnEdges(doc!.paths, o, 30);
          if (hit && nearestOnPolyline(edgePolyline(doc!.paths, hit.edge), o)!.dist < hit.edge.width / 2) {
            onRoad.push(`${o.id} ${o.asset} at ${Math.round(o.x)},${Math.round(o.y)} on ${hit.edge.id}`);
          }
        }
        expect(onRoad).toEqual([]);
      });

      it('uses only catalogue assets and materials', () => {
        const unknownAssets = [...new Set(doc!.objects.map((o) => o.asset).filter((a) => !objects.has(a)))];
        const used = [...doc!.terrain.layers.map((l) => l.material), doc!.terrain.cliffMaterial];
        expect(unknownAssets, 'assets not in the catalogue').toEqual([]);
        expect(used.filter((m) => !materials.has(m)), 'materials not in the catalogue').toEqual([]);
      });

      it(`stays in budget: ${MAX_OBJECTS} objects, ${MAX_FILE_BYTES / 1024 / 1024} MB`, () => {
        expect(doc!.objects.length).toBeLessThanOrEqual(MAX_OBJECTS);
        expect(statSync(path).size).toBeLessThanOrEqual(MAX_FILE_BYTES);
      });
    });
  }
});
