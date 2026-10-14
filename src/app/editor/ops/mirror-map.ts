/**
 * "Mirror the map now": the part of the map around `from` (its sector of
 * the symmetry) becomes the whole map. Heights, ground paint and the water
 * masks are copied cell by cell to the images; objects, spawns, roads and
 * rivers of the other sectors give way to images of the source sector's.
 * A road that leaves the source sector across an axis ends at the image of
 * its source end, so the roads of both halves meet; a river that crosses an
 * axis stays as it is (its bed follows the copied heights only on the
 * source side). The HQ stays where it is. Like the level scripts'
 * `kit.mirrorFrom`, but for everything the map holds.
 */
import type { CustomMapDocument, MapPathEdge, MapPathNode, MapRiver, MapSpawn } from '../../world/custom-map/map-document';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { spawnName } from '../tools/marker-tool';
import { ObjectIds } from './object-ops';
import { newId } from './path-graph';
import { mirrorChange, sameSector, symmetryImages, type SymmetryMode } from './symmetry';

export interface MirrorResult {
  objects: number;
  spawns: number;
  /** Spawn images left out: the map holds at most MAX_SPAWN_PORTALS */
  spawnsLeftOut?: number;
  roads: number;
}

const TAU = Math.PI * 2;
const turn = (r: number) => Math.round((((r % TAU) + TAU) % TAU) * 1000) / 1000;
const round = (v: number) => Math.round(v * 100) / 100;

export function mirrorMap(doc: CustomMapDocument, mode: SymmetryMode, from: { x: number; y: number }): MirrorResult {
  if (mode === 'none') return { objects: 0, spawns: 0, roads: 0 };
  const t = doc.terrain;
  const g = t.grid;
  const images = symmetryImages(mode, g.columns === g.rows);
  const inSource = (p: { x: number; y: number }) => sameSector(mode, p, from);
  const inside = (p: { x: number; y: number }) => Math.abs(p.x) <= t.width / 2 && Math.abs(p.y) <= t.depth / 2;

  // The ground, cell by cell
  const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
  const texels = { i0: 0, j0: 0, i1: t.splat.resolution - 1, j1: t.splat.resolution - 1 };
  const bodies = (t.waterBodies ?? []).map((_, k) => k);
  mirrorChange(
    doc,
    mode,
    from,
    { heights: all, splat: texels, water: !!t.water || bodies.length > 0 },
    { heights: () => undefined, splat: () => undefined, water: t.water ? () => undefined : undefined, bodies, body: () => undefined },
    all,
  );

  // Objects: the source sector's and their images; a group of an image is a group of its own
  const ids = new ObjectIds(doc.objects);
  const kept = doc.objects.filter(inSource);
  const objects = [...kept];
  images.slice(1).forEach((img, k) => {
    for (const o of kept) {
      const p = img.point(o);
      if (!inside(p) || Math.hypot(p.x - o.x, p.y - o.y) < 0.01) continue;
      const copy = { ...o, id: ids.take(), x: round(p.x), y: round(p.y), rotation: turn(img.turn(o.rotation)) };
      if (o.group) copy.group = `${o.group}m${k + 1}`;
      objects.push(copy);
    }
  });
  doc.objects = objects;

  // Spawns
  const spawns: MapSpawn[] = doc.spawns.filter(inSource);
  let spawnsLeftOut = 0;
  for (const img of images.slice(1)) {
    for (const s of spawns.slice(0, doc.spawns.filter(inSource).length)) {
      const p = img.point(s);
      if (!inside(p) || spawns.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 1)) continue;
      // The game uses only the first spawns: no more images than the map may hold
      if (spawns.length >= MAX_SPAWN_PORTALS) {
        spawnsLeftOut++;
        continue;
      }
      spawns.push({ ...s, id: newId('s', spawns), name: spawnName(doc, p, spawns), x: round(p.x), y: round(p.y) });
    }
  }
  const spawnCount = spawns.length - doc.spawns.filter(inSource).length;
  doc.spawns = spawns;

  // Roads: nodes of the source sector and their images; edges within it copied, edges across an axis end at an image
  const byId = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  const nodes: MapPathNode[] = doc.paths.nodes.filter(inSource);
  const source = new Set(nodes.map((n) => n.id));
  const imageOf = new Map<string, string>();
  const nodeImage = (n: MapPathNode, k: number): string | null => {
    const key = `${n.id}|${k}`;
    const known = imageOf.get(key);
    if (known) return known;
    const p = images[k].point(n);
    if (!inside(p)) return null;
    // On the axis the image is the node itself
    if (Math.hypot(p.x - n.x, p.y - n.y) < 0.5) {
      imageOf.set(key, n.id);
      return n.id;
    }
    const id = newId('n', nodes);
    nodes.push({ id, x: round(p.x), y: round(p.y) });
    imageOf.set(key, id);
    return id;
  };
  const edges: MapPathEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (e: MapPathEdge) => {
    const key = [e.a, e.b].sort().join('|');
    if (e.a === e.b || seen.has(key)) return;
    seen.add(key);
    edges.push(e);
  };
  for (const e of doc.paths.edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) continue;
    const ina = source.has(a.id);
    const inb = source.has(b.id);
    if (ina && inb) {
      addEdge(e);
      images.slice(1).forEach((img, j) => {
        const ia = nodeImage(a, j + 1);
        const ib = nodeImage(b, j + 1);
        if (!ia || !ib) return;
        addEdge({ ...e, id: newId('e', edges), a: ia, b: ib, ...(e.via ? { via: e.via.map((v) => img.point(v)).map((v) => ({ x: round(v.x), y: round(v.y) })) } : {}) });
      });
    } else if (ina || inb) {
      // Across an axis: from the source end to its image in the sector the other end lies in
      const s = ina ? a : b;
      const o = ina ? b : a;
      let best = -1;
      let bestDist = Infinity;
      images.forEach((img, k) => {
        if (k === 0) return;
        const p = img.point(s);
        const d = Math.hypot(p.x - o.x, p.y - o.y);
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      });
      const target = best > 0 ? nodeImage(s, best) : null;
      if (target) {
        const { via: _via, ...rest } = e;
        addEdge({ ...rest, id: newId('e', edges), a: s.id, b: target });
      }
    }
  }
  const roadCount = edges.length - doc.paths.edges.filter((e) => source.has(e.a) && source.has(e.b)).length;
  doc.paths = { nodes: nodes.filter((n) => edges.some((e) => e.a === n.id || e.b === n.id) || source.has(n.id)), edges };

  // Rivers wholly in the source sector are copied; those wholly outside go; those across an axis stay
  if (t.rivers?.length) {
    const rivers: MapRiver[] = [];
    for (const r of t.rivers) {
      const ins = r.points.filter(inSource).length;
      if (ins === 0) continue;
      rivers.push(r);
      if (ins < r.points.length) continue;
      images.slice(1).forEach((img, k) => {
        const points = r.points.map((p) => ({ ...p, ...img.point(p) }));
        if (points.every(inside)) rivers.push({ ...r, id: `${r.id}m${k + 1}`, points });
      });
    }
    t.rivers = rivers;
  }
  return { objects: objects.length - kept.length, spawns: spawnCount, roads: roadCount, ...(spawnsLeftOut ? { spawnsLeftOut } : {}) };
}
