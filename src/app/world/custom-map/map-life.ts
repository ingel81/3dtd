/**
 * Life on a custom map (TODO E190, docs/CUSTOM_MAPS.md "Leben"): the life
 * areas of the document, its switches and the shapes the renderer, the
 * soundscape and the editor share. Pure: no three, no Angular.
 *
 * An area is an outline the life fills, a route a line it follows. Both are
 * map points (metres, x east, y north). The renderer draws flocks, particles
 * and boats from them, the soundscape plays an area's sound by the
 * listener's distance to it; the game's rules never read them.
 */
import type { MapBirdSpecies, MapLife, MapLifeArea, MapLifeKind, MapPoint } from './map-document';

export const LIFE_KINDS: readonly MapLifeKind[] = ['birds', 'fireflies', 'fog', 'leaves', 'embers', 'sparks', 'snow', 'dust', 'haze', 'boats', 'movers', 'sound'];
export const BIRD_SPECIES: readonly MapBirdSpecies[] = ['songbirds', 'gulls', 'crows', 'raptors'];

/** What drifts in a boats area that names no asset */
export const DEFAULT_BOAT = 'rowboat';

/** Most life areas a map holds, most points one has */
export const MAX_LIFE_AREAS = 64;
export const MAX_LIFE_POINTS = 256;
/** The density knobs' ranges: an area's, the map's */
export const LIFE_AREA_DENSITY = { min: 0.1, max: 3 } as const;
export const LIFE_DENSITY = { min: 0, max: 2 } as const;
/** A sound area's reach beyond its outline or line, metres: its range and the default (soundscape.ts AREA_REACH) */
export const LIFE_SOUND_REACH = { min: 10, max: 300, default: 70 } as const;

/** What each kind is, for the editor and the agent: name, a line on what it does, the outline's colour in the editor */
export const LIFE_KIND_INFO: Readonly<Record<MapLifeKind, { label: string; about: string; color: string }>> = {
  birds: { label: 'Birds', about: 'A flock circles over the area by day, or flies along the route and back', color: '#e8e8f0' },
  fireflies: { label: 'Fireflies', about: 'Glowing at night over the area or along the line', color: '#d8ff6a' },
  fog: { label: 'Fog', about: 'Soft banks of fog drifting low with the wind', color: '#c8d0d4' },
  leaves: { label: 'Leaves', about: 'Leaves falling and drifting with the wind', color: '#d0903a' },
  embers: { label: 'Embers', about: 'Glowing embers rising from the ground', color: '#ff8a30' },
  sparks: { label: 'Sparks', about: 'Bright sparks bursting up and falling, strongest at night', color: '#ffd060' },
  snow: { label: 'Snow', about: 'Snow flurries drifting down with the wind', color: '#f4f8ff' },
  dust: { label: 'Dust devils', about: 'Whirls of dust wandering over the ground and rising', color: '#d8b080' },
  haze: { label: 'Heat haze', about: 'The air over hot ground wavers (with the lava glow effect, High and up)', color: '#ffa060' },
  boats: { label: 'Boats', about: 'Boats drifting slowly on the water of the area, or along the route and back', color: '#6ab0ff' },
  movers: { label: 'Movers', about: 'Any object going round the area or along the route and back over the ground: a rover, a cart, grazing animals', color: '#a0e070' },
  sound: { label: 'Sound', about: 'An ambient sound, loud inside the area or along the line, fading with distance', color: '#ff70d0' },
};

/** The map's switches with their defaults filled in */
export function lifeSwitches(life: MapLife | undefined): { smoke: boolean; fireflies: boolean; birds: boolean; sparks: boolean; density: number; flags: boolean } {
  const auto = life?.auto;
  return {
    smoke: auto?.smoke !== false,
    fireflies: auto?.fireflies !== false,
    birds: auto?.birds !== false,
    sparks: auto?.sparks === true,
    density: clampDensity(life?.density, LIFE_DENSITY, 1),
    flags: life?.flags === true,
  };
}

/** An area's density, in its range */
export function areaDensity(area: MapLifeArea): number {
  return clampDensity(area.density, LIFE_AREA_DENSITY, 1);
}

function clampDensity(d: number | undefined, range: { min: number; max: number }, fallback: number): number {
  return typeof d === 'number' && Number.isFinite(d) ? Math.min(range.max, Math.max(range.min, d)) : fallback;
}

/** Whether a quality level's life share (render-quality.ts `life`) shows the area: Low none, Medium those not asking for High */
export function areaShown(area: MapLifeArea, share: number): boolean {
  return share > 0 && (area.quality !== 'high' || share >= 1);
}

/** Problems of a document's `life`, as the map file names them (empty when fine) */
export function lifeProblems(life: unknown): string[] {
  if (life === undefined) return [];
  const p: string[] = [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!life || typeof life !== 'object') return ['life is not an object'];
  const l = life as MapLife;
  if (l.auto !== undefined && (!l.auto || typeof l.auto !== 'object' || Object.values(l.auto).some((v) => typeof v !== 'boolean'))) {
    p.push('life.auto must hold true or false switches');
  }
  if (l.density !== undefined && (!finite(l.density) || l.density < LIFE_DENSITY.min || l.density > LIFE_DENSITY.max)) {
    p.push(`life.density must be ${LIFE_DENSITY.min} to ${LIFE_DENSITY.max}`);
  }
  if (l.flags !== undefined && typeof l.flags !== 'boolean') p.push('life.flags must be true or false');
  const amb = l.ambience;
  if (amb !== undefined && (!amb || typeof amb.sound !== 'string' || !finite(amb.volume) || amb.volume < 0 || amb.volume > 1)) {
    p.push('life.ambience needs a sound and a volume 0 to 1');
  }
  const ws = l.waveSound;
  if (ws !== undefined && (!ws || typeof ws.sound !== 'string' || !finite(ws.volume) || ws.volume < 0 || ws.volume > 1 || (ws.area !== undefined && typeof ws.area !== 'string'))) {
    p.push('life.waveSound needs a sound, a volume 0 to 1 and, if it names one, the id of a life area');
  }
  if (l.areas === undefined) return p;
  if (!Array.isArray(l.areas) || l.areas.length > MAX_LIFE_AREAS) return [...p, `life.areas must be a list of at most ${MAX_LIFE_AREAS}`];
  const ids = new Set<string>();
  for (const a of l.areas) {
    if (!a || typeof a !== 'object') {
      p.push('a life area is not an object');
      continue;
    }
    const name = `life area ${a.id}`;
    if (!a.id || typeof a.id !== 'string' || ids.has(a.id)) p.push(`life area id "${a.id}" is missing or twice`);
    ids.add(a.id);
    if (!LIFE_KINDS.includes(a.kind)) p.push(`${name}: kind ${String(a.kind)} is unknown`);
    if (a.shape !== 'area' && a.shape !== 'route') p.push(`${name}: shape must be area or route`);
    const least = a.shape === 'area' ? 3 : 2;
    if (!Array.isArray(a.points) || a.points.length < least || a.points.length > MAX_LIFE_POINTS) {
      p.push(`${name} needs ${least} to ${MAX_LIFE_POINTS} points`);
    } else if (a.points.some((q) => !finite(q?.x) || !finite(q?.y))) p.push(`${name} has a bad point`);
    if (a.density !== undefined && (!finite(a.density) || a.density < LIFE_AREA_DENSITY.min || a.density > LIFE_AREA_DENSITY.max)) {
      p.push(`${name}: density must be ${LIFE_AREA_DENSITY.min} to ${LIFE_AREA_DENSITY.max}`);
    }
    if (a.height !== undefined && !finite(a.height)) p.push(`${name}: height is not a number`);
    if (a.volume !== undefined && (!finite(a.volume) || a.volume < 0 || a.volume > 1)) p.push(`${name}: volume must be 0 to 1`);
    if (a.reach !== undefined && (!finite(a.reach) || a.reach < LIFE_SOUND_REACH.min || a.reach > LIFE_SOUND_REACH.max)) {
      p.push(`${name}: reach must be ${LIFE_SOUND_REACH.min} to ${LIFE_SOUND_REACH.max} metres`);
    }
    if (a.color !== undefined && !/^#[0-9a-f]{6}$/i.test(a.color)) p.push(`${name}: color must be #rrggbb`);
    for (const key of ['sound', 'asset'] as const) {
      if (a[key] !== undefined && typeof a[key] !== 'string') p.push(`${name}: ${key} must be an id`);
    }
    if (a.quality !== undefined && a.quality !== 'medium' && a.quality !== 'high') p.push(`${name}: quality must be medium or high`);
    if (a.species !== undefined && !BIRD_SPECIES.includes(a.species)) p.push(`${name}: species must be ${BIRD_SPECIES.join(', ')}`);
    if (a.speed !== undefined && (!finite(a.speed) || a.speed <= 0 || a.speed > 30)) p.push(`${name}: speed must be above 0 and at most 30`);
  }
  return p;
}

/** Whether a map point lies inside an outline (even-odd rule) */
export function insideOutline(points: readonly MapPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The point of an area's shape nearest to (x, y), into `out`, and its
 * distance: 0 inside an outline (the point itself), else to the nearest
 * edge; for a route to the nearest point of the line
 */
export function nearestOnShape(area: Pick<MapLifeArea, 'shape' | 'points'>, x: number, y: number, out: MapPoint): number {
  const pts = area.points;
  if (area.shape === 'area' && pts.length >= 3 && insideOutline(pts, x, y)) {
    out.x = x;
    out.y = y;
    return 0;
  }
  let best = Infinity;
  const segments = area.shape === 'area' ? pts.length : pts.length - 1;
  for (let k = 0; k < segments; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      out.x = px;
      out.y = py;
    }
  }
  if (best === Infinity && pts.length) {
    out.x = pts[0].x;
    out.y = pts[0].y;
    best = Math.hypot(x - out.x, y - out.y);
  }
  return best;
}

/** Length of a line, or of an outline closed back to its start */
export function shapeLength(points: readonly MapPoint[], closed: boolean): number {
  let n = 0;
  const segments = closed ? points.length : points.length - 1;
  for (let k = 0; k < segments; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    n += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return n;
}

/** Area of an outline, m² */
export function outlineArea(points: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) s += points[j].x * points[i].y - points[i].x * points[j].y;
  return Math.abs(s) / 2;
}

/** `count` points evenly along a line (closed: around the outline, the last one before the start) */
export function resampleShape(points: readonly MapPoint[], closed: boolean, count: number): MapPoint[] {
  const total = shapeLength(points, closed);
  const out: MapPoint[] = [];
  if (points.length < 2 || total <= 0) {
    for (let k = 0; k < count; k++) out.push({ ...(points[0] ?? { x: 0, y: 0 }) });
    return out;
  }
  const segments = closed ? points.length : points.length - 1;
  const step = total / (closed ? count : Math.max(1, count - 1));
  let seg = 0;
  let segStart = 0;
  for (let k = 0; k < count; k++) {
    const at = Math.min(total, k * step);
    for (;;) {
      const a = points[seg];
      const b = points[(seg + 1) % points.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (at <= segStart + len || seg >= segments - 1) {
        const t = len > 0 ? Math.min(1, Math.max(0, (at - segStart) / len)) : 0;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
      segStart += len;
      seg++;
    }
  }
  return out;
}

/** A small seeded random source (Park and Miller), the same numbers on every machine */
export function lifeRandom(seed: number): () => number {
  let s = Math.max(1, Math.floor(Math.abs(seed) % 2147483646) + 1);
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A seed from an area's id, so an area keeps its look when others change */
export function lifeSeed(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return (h >>> 0) % 2147483646;
}

/**
 * Spots for particle emitters over an area's shape, about `spacing` metres
 * apart: on a jittered grid inside an outline, along a line every
 * `spacing` metres. At most `most` of them, spread over the whole shape
 */
export function lifeSpots(area: Pick<MapLifeArea, 'id' | 'shape' | 'points'>, spacing: number, most: number): MapPoint[] {
  const random = lifeRandom(lifeSeed(area.id));
  const pts = area.points;
  let out: MapPoint[] = [];
  if (area.shape === 'route') {
    const count = Math.max(2, Math.round(shapeLength(pts, false) / spacing) + 1);
    out = resampleShape(pts, false, count).map((p) => ({ x: p.x + (random() - 0.5) * spacing * 0.5, y: p.y + (random() - 0.5) * spacing * 0.5 }));
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    for (let y = minY + spacing / 2; y < maxY; y += spacing) {
      for (let x = minX + spacing / 2; x < maxX; x += spacing) {
        const px = x + (random() - 0.5) * spacing * 0.8;
        const py = y + (random() - 0.5) * spacing * 0.8;
        if (insideOutline(pts, px, py)) out.push({ x: px, y: py });
      }
    }
    // A thin outline that no grid point hits still gets its middle
    if (!out.length && pts.length) out.push(centroid(pts));
  }
  if (out.length <= most) return out;
  const k = out.length / most;
  return Array.from({ length: most }, (_, n) => out[Math.floor(n * k)]);
}

/** The mean of the points */
export function centroid(points: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, points.length), y: y / Math.max(1, points.length) };
}

/**
 * A smooth closed loop inside an outline for something to wander along
 * (a flock, a boat): rays from its middle in `count` directions, each
 * reaching `reach` of the way to the edge (with some wobble), joined as a
 * Catmull-Rom curve of `samples` points. Concave outlines may poke out a
 * little where a ray crosses a bay
 */
export function loopInside(points: readonly MapPoint[], seed: number, samples: number, reach = 0.7, count = 9): MapPoint[] {
  const random = lifeRandom(seed);
  const c = insideOutline(points, centroid(points).x, centroid(points).y) ? centroid(points) : points[0];
  const turn = random() * Math.PI * 2;
  const keys: MapPoint[] = [];
  for (let k = 0; k < count; k++) {
    const a = turn + (k / count) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const edge = rayToOutline(points, c, dx, dy);
    const r = edge * reach * (0.75 + random() * 0.5);
    keys.push({ x: c.x + dx * r, y: c.y + dy * r });
  }
  return catmullRomLoop(keys, samples);
}

/** Distance from `from` along (dx, dy) to the first edge of the outline (the farthest vertex when none is hit) */
function rayToOutline(points: readonly MapPoint[], from: MapPoint, dx: number, dy: number): number {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  if (best < Infinity) return best;
  return Math.max(...points.map((p) => Math.hypot(p.x - from.x, p.y - from.y)), 1);
}

/** A closed Catmull-Rom curve through the keys, `samples` points */
export function catmullRomLoop(keys: readonly MapPoint[], samples: number): MapPoint[] {
  const n = keys.length;
  const out: MapPoint[] = [];
  for (let s = 0; s < samples; s++) {
    const f = (s / samples) * n;
    const k = Math.floor(f);
    const t = f - k;
    const p0 = keys[(k - 1 + n) % n];
    const p1 = keys[k % n];
    const p2 = keys[(k + 1) % n];
    const p3 = keys[(k + 2) % n];
    const t2 = t * t;
    const t3 = t2 * t;
    const w = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    out.push({ x: w(p0.x, p1.x, p2.x, p3.x), y: w(p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}

/** A new area id not in the list */
export function newLifeId(areas: readonly MapLifeArea[], kind: MapLifeKind): string {
  const ids = new Set(areas.map((a) => a.id));
  for (let n = 1; ; n++) {
    const id = `${kind}-${n}`;
    if (!ids.has(id)) return id;
  }
}

/**
 * A closed loop along a line: out on one side `offset` metres from it,
 * round its end and back on the other side; something on it goes there and
 * back without turning on the spot
 */
export function routeLoop(points: readonly MapPoint[], offset: number): MapPoint[] {
  const length = shapeLength(points, false);
  const count = Math.max(3, Math.min(24, Math.round(length / 40) + 1));
  const line = resampleShape(points, false, count);
  const side = (k: number): MapPoint => {
    const a = line[Math.max(0, k - 1)];
    const b = line[Math.min(line.length - 1, k + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  const keys: MapPoint[] = [];
  for (let k = 0; k < line.length; k++) {
    const n = side(k);
    keys.push({ x: line[k].x + n.x * offset, y: line[k].y + n.y * offset });
  }
  for (let k = line.length - 1; k >= 0; k--) {
    const n = side(k);
    keys.push({ x: line[k].x - n.x * offset, y: line[k].y - n.y * offset });
  }
  return catmullRomLoop(keys, Math.max(32, Math.min(96, keys.length * 4)));
}

/** Metres a route's movers drive off its line, out on one side and back on the other (life-movers.ts) */
export const MOVER_LANE = 2.5;
/** Metres a mover's way needs clear to either side of the lane it drives: a rover's or a cart's half width and a little room */
export const MOVER_CLEARANCE = 1.8;

/** The loops the movers of the ground routes drive (not those hanging from a line at a height), their way to keep clear */
export function moverWays(life: MapLife | undefined): MapPoint[][] {
  return (life?.areas ?? []).filter((a) => a.kind === 'movers' && a.shape === 'route' && a.height === undefined && a.points.length >= 2).map((a) => routeLoop(a.points, MOVER_LANE));
}
