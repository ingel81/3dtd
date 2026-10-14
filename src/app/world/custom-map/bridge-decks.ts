import type { MapPathEdge, MapPaths, MapPoint, MapTerrain } from './map-document';
import type { HeightField } from './render/height-field';
import { bridgeWaterLevel } from './render/paths/bridge-water';

/**
 * One bridge deck in map metres: from the terrain at each end, at least a
 * metre over the water the bridge crosses, with a slight arch. The
 * renderer's BridgeLayer lays its pieces on it, the game's CustomMapSurface
 * and the editor walk on it.
 */
export interface BridgeDeck {
  edge: MapPathEdge;
  line: MapPoint[];
  /** Cumulative length at each line point */
  at: number[];
  total: number;
  half: number;
  hA: number;
  hB: number;
  arch: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The decks of the bridge edges (`kind: 'bridge'`) of `paths` over `terrain` */
export function bridgeDecks(paths: MapPaths, terrain: MapTerrain, field: HeightField): BridgeDeck[] {
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  const out: BridgeDeck[] = [];
  for (const edge of paths.edges) {
    if (edge.kind !== 'bridge') continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b];
    const at = [0];
    for (let s = 0; s + 1 < line.length; s++) at.push(at[s] + Math.hypot(line[s + 1].x - line[s].x, line[s + 1].y - line[s].y));
    const total = at[at.length - 1];
    if (total <= 0) continue;
    const half = edge.width / 2;
    // At least a metre over the water this bridge crosses (none: on the ground at both ends)
    const minDeck = bridgeWaterLevel(line, terrain, field) + 1;
    out.push({
      edge,
      line,
      at,
      total,
      half,
      hA: Math.max(field.heightAt(a.x, a.y), minDeck),
      hB: Math.max(field.heightAt(b.x, b.y), minDeck),
      arch: Math.min(1.5, total * 0.04),
      minX: Math.min(...line.map((p) => p.x)) - half,
      minY: Math.min(...line.map((p) => p.y)) - half,
      maxX: Math.max(...line.map((p) => p.x)) + half,
      maxY: Math.max(...line.map((p) => p.y)) + half,
    });
  }
  return out;
}

/** Deck height at `t` (0 at the first end, 1 at the other) */
export function deckHeight(deck: BridgeDeck, t: number): number {
  return deck.hA + (deck.hB - deck.hA) * t + Math.sin(t * Math.PI) * deck.arch;
}

/** Deck height of the bridge spanning a map point, NaN where none does; allocation-free */
export function deckHeightAt(decks: readonly BridgeDeck[], x: number, y: number): number {
  for (const b of decks) {
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    for (let s = 0; s + 1 < b.line.length; s++) {
      const p = b.line[s];
      const q = b.line[s + 1];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const u = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
      if (Math.hypot(x - p.x - dx * u, y - p.y - dy * u) > b.half) continue;
      return deckHeight(b, (b.at[s] + u * Math.sqrt(len2)) / b.total);
    }
  }
  return NaN;
}
