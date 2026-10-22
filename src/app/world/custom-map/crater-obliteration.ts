/**
 * What a crater wipes out (docs/DESTRUCTION_PLAN.md, "Krater löschen aus"):
 * an object counts as gone where the craters under it reach OBLITERATE_CM
 * deep at its middle or at a corner of its ground: a fallen structure (no
 * stump, floors or embers left, its rubble lies on the crater's floor), a
 * hedge, fence or wall that fell, a tree, a lamp, a bench. A structure that
 * still stands (a tower on its roof holds it) or one the map keeps standing
 * is never gone; nothing that only stands at a rim is either: it sinks with
 * the ground (CustomMapGroundDamage.standing).
 *
 * A tree (a target that `fells`) falls before that: where a crater reaches
 * FELL_CM deep at its trunk or half way out under its crown, the blast that
 * dug it felled it. It lies there (CustomMapView.setFelled) out of the sight
 * and the build blocking, until a deeper crater wipes it out too.
 *
 * A function of what the simulation holds (the crater list and the
 * structures' stages, whole numbers) and the map: every client, replay and
 * restore comes to the same objects, nothing of it lives in the snapshot.
 */

/** Centimetres of crater under an object's middle or a corner of its ground from which it is gone */
export const OBLITERATE_CM = 150;
/** Centimetres of crater under a tree's trunk or half way out under its crown from which the blast felled it */
export const FELL_CM = 8;

/** An object a crater may wipe out: map metres, its middle first, then points of its ground's rim */
export interface ObliterationTarget {
  id: string;
  /** x, y pairs: the middle, then the corners of its ground (or points round its footprint) */
  points: Float64Array;
  /** A structure: gone only once it lies fallen */
  structure: boolean;
  /** A tree: a shallower crater fells it (FELL_CM) before a deep one wipes it out */
  fells?: boolean;
  /** Bounds of the points */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A rectangle in map metres */
export interface ObliterationRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The target of an object at map metres (`x`, `y`) whose ground is the rectangle `box` (x, y, half x, half y, turn) */
export function boxTarget(id: string, structure: boolean, box: readonly [number, number, number, number, number]): ObliterationTarget {
  const [cx, cy, hx, hy, turn] = box;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const points = new Float64Array(10);
  points[0] = cx;
  points[1] = cy;
  let k = 2;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    points[k++] = cx + u * hx * c - v * hy * s;
    points[k++] = cy + u * hx * s + v * hy * c;
  }
  return withBounds(id, structure, points);
}

/** The target of an object at map metres (`x`, `y`) with ground radius `radius`: its middle and four points half way out */
export function roundTarget(id: string, structure: boolean, x: number, y: number, radius: number, fells = false): ObliterationTarget {
  const r = radius * 0.5;
  const t = withBounds(id, structure, Float64Array.of(x, y, x - r, y, x + r, y, x, y - r, x, y + r));
  if (fells) t.fells = true;
  return t;
}

function withBounds(id: string, structure: boolean, points: Float64Array): ObliterationTarget {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < points.length; k += 2) {
    minX = Math.min(minX, points[k]);
    maxX = Math.max(maxX, points[k]);
    minY = Math.min(minY, points[k + 1]);
    maxY = Math.max(maxY, points[k + 1]);
  }
  return { id, points, structure, minX, minY, maxX, maxY };
}

/** What changed: objects gone and back, trees felled and standing again */
export interface ObliterationChange {
  gone: string[];
  back: string[];
  felled: string[];
  rose: string[];
}

/** The objects gone into the craters and the trees they felled, kept up to date as craters come and go and structures fall and stand */
export class CraterObliteration {
  private targets: ObliterationTarget[] = [];
  private readonly byId = new Map<string, ObliterationTarget>();
  private readonly gone = new Set<string>();
  private readonly felled = new Set<string>();

  /** The objects that may go; one gone or felled before and no longer a target comes back */
  setTargets(targets: readonly ObliterationTarget[]): ObliterationChange {
    this.targets = [...targets];
    this.byId.clear();
    for (const t of targets) this.byId.set(t.id, t);
    const back = [...this.gone].filter((id) => !this.byId.has(id));
    for (const id of back) this.gone.delete(id);
    const rose = [...this.felled].filter((id) => !this.byId.has(id));
    for (const id of rose) this.felled.delete(id);
    return { gone: [], back, felled: [], rose };
  }

  isGone(id: string): boolean {
    return this.gone.has(id);
  }

  /** Every object gone now */
  goneIds(): string[] {
    return [...this.gone];
  }

  /** Every tree lying felled now (not those gone) */
  felledIds(): string[] {
    return [...this.felled];
  }

  /**
   * The objects touching `rect` (all with null) looked at again, the
   * craters' centimetres from `craterCmAt` and the fallen structures from
   * `fallen`: those gone now and those back
   */
  update(rect: ObliterationRect | null, craterCmAt: (x: number, y: number) => number, fallen: (id: string) => boolean): ObliterationChange {
    const out = changes();
    for (const t of this.targets) {
      if (rect && (t.maxX < rect.minX || t.minX > rect.maxX || t.maxY < rect.minY || t.minY > rect.maxY)) continue;
      this.judge(t, craterCmAt, fallen, out);
    }
    return out;
  }

  /** Object `id` looked at again (its structure fell or stands again) */
  updateOne(id: string, craterCmAt: (x: number, y: number) => number, fallen: (id: string) => boolean): ObliterationChange {
    const out = changes();
    const t = this.byId.get(id);
    if (t) this.judge(t, craterCmAt, fallen, out);
    return out;
  }

  private judge(t: ObliterationTarget, craterCmAt: (x: number, y: number) => number, fallen: (id: string) => boolean, out: ObliterationChange): void {
    let deepest = 0;
    if (!t.structure || fallen(t.id)) {
      const p = t.points;
      for (let k = 0; k < p.length && deepest > -OBLITERATE_CM; k += 2) deepest = Math.min(deepest, craterCmAt(p[k], p[k + 1]));
    }
    const deep = deepest <= -OBLITERATE_CM;
    if (deep !== this.gone.has(t.id)) {
      if (deep) {
        this.gone.add(t.id);
        out.gone.push(t.id);
      } else {
        this.gone.delete(t.id);
        out.back.push(t.id);
      }
    }
    if (!t.fells) return;
    // A tree a deeper crater wiped out lies no more
    const down = !deep && deepest <= -FELL_CM;
    if (down === this.felled.has(t.id)) return;
    if (down) {
      this.felled.add(t.id);
      out.felled.push(t.id);
    } else {
      this.felled.delete(t.id);
      out.rose.push(t.id);
    }
  }
}

function changes(): ObliterationChange {
  return { gone: [], back: [], felled: [], rose: [] };
}
