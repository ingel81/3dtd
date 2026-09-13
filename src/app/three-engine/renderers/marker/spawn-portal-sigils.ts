import { PORTAL_OPENING_HEIGHT, PORTAL_OPENING_WIDTH } from '../../../configs/marker-geometry.config';

/**
 * Sigils of the spawn portal: a fixed, hand-authored set of fictional
 * occult seals. They are carved into the frame asset
 * (tools/blender/spawn_portal.py reads them, each cell's pose included,
 * from spawn_portal_layout.json, which tools/blender/spawn-portal-layout.spec.ts
 * writes from this file) and drawn as signed distances in the summoning
 * circle on the street (marker-shaders.ts, PORTAL_SIGIL_GLSL). They replace random glyphs of a
 * stem, bars and diagonals, which came out as shapes like 千, キ, ス or
 * Latin letters, and two sets of seals in rings round the cell's centre,
 * closed and then broken, which both read like buttons, dials or grilles.
 *
 * Built only from curves and dots, in loose, lopsided groups off the
 * cell's centre: small broken rings, orbits with nodes on them, fragments
 * of spirals, crescents, dots linked by bowed arcs. No sigil has a rim,
 * no large curve bends round the cell's centre,
 * none is mirror-symmetric or repeats itself under a third of a turn, and
 * every cell turns and sizes its sigil a little differently
 * (sigilPoseForCell). spawn-portal-sigils.spec.ts checks that
 * construction. Hard exclusions, which follow from it or were checked by
 * eye when the set was drawn:
 * - no straight strokes: no crosses, hooks, lightning or zigzag strokes, no
 *   runes (Elder Futhark or any other), no letters or digits;
 * - no eyes (no almond of two arcs), no tomoe or commas (no dot with a
 *   swirl for a tail, no swirls round a centre), no triple moon (a circle
 *   between two crescents), no vesica (two equal rings overlapping), no
 *   crescent with a star or a dot in its hollow, nothing like a yin-yang;
 * - no lone circle (O, 0), no circle with a dot in the middle (ʘ, ⊙), no
 *   concentric rings (◎), no dots in a two by three grid (Braille);
 * - no triskelion or anything like it: no three- or fourfold turn symmetry
 *   round any centre, no node with three or more arms running out of it;
 *   no ring and dots either side of a long flat sweep (a percent sign).
 * A new sigil has to keep to the same rules.
 */

/** One mark of a sigil, in cell units: the cell spans -0.5 to 0.5 across and up, +y up. */
export type SigilPart =
  /** Circle outline around (x, y) */
  | { kind: 'ring'; x: number; y: number; r: number }
  /**
   * Part of a circle outline around (x, y), `span` wide (rad), centred on
   * the direction `at` (rad, 0 = +x, counter-clockwise), round ends
   */
  | { kind: 'arc'; x: number; y: number; r: number; at: number; span: number }
  /** Filled disc */
  | { kind: 'dot'; x: number; y: number; r: number }
  /**
   * Filled crescent: the disc of radius r round (x, y) less its hollow (see
   * CRESCENT_HOLLOW), so that its horns point toward `at` (rad)
   */
  | { kind: 'crescent'; x: number; y: number; r: number; at: number };

export interface Sigil {
  name: string;
  parts: readonly SigilPart[];
}

/** Half the stroke width of rings and arcs (cell units). */
export const SIGIL_STROKE = 0.028;

/** A crescent's hollow: a disc of this share of its radius, shifted CRESCENT_SHIFT of it toward its horns. */
export const CRESCENT_HOLLOW = 0.82;
export const CRESCENT_SHIFT = 0.38;

const DEG = Math.PI / 180;

const ring = (r: number, x: number, y: number): SigilPart => ({ kind: 'ring', x, y, r });
const dot = (r: number, x: number, y: number): SigilPart => ({ kind: 'dot', x, y, r });
const arc = (r: number, atDeg: number, spanDeg: number, x: number, y: number): SigilPart => ({
  kind: 'arc', x, y, r, at: atDeg * DEG, span: spanDeg * DEG,
});
const crescent = (r: number, atDeg: number, x: number, y: number): SigilPart => ({
  kind: 'crescent', x, y, r, at: atDeg * DEG,
});

/** The point at `deg` on the circle of radius `r` round (x, y). */
function on(x: number, y: number, r: number, deg: number): [number, number] {
  return [x + r * Math.cos(deg * DEG), y + r * Math.sin(deg * DEG)];
}

/** A dot of radius `r` at the point `at`. */
const node = (r: number, [x, y]: [number, number]): SigilPart => dot(r, x, y);

/**
 * Arc from (ax, ay) to (bx, by), bowed out by `bend` (cell units) to the
 * left of the way from a to b, to the right for a negative bend.
 */
function link(ax: number, ay: number, bx: number, by: number, bend: number): SigilPart {
  const length = Math.hypot(bx - ax, by - ay);
  const side = Math.sign(bend);
  // Unit normal toward the bow, the bow's height, the circle through a, b and the bow
  const nx = (-(by - ay) / length) * side;
  const ny = ((bx - ax) / length) * side;
  const s = Math.abs(bend);
  const r = (length * length / 4 + s * s) / (2 * s);
  const x = (ax + bx) / 2 - nx * (r - s);
  const y = (ay + by) / 2 - ny * (r - s);
  return { kind: 'arc', x, y, r, at: Math.atan2(ny, nx), span: 2 * Math.asin(length / (2 * r)) };
}

/**
 * A fragment of a spiral: arcs of `sweeps` degrees each (counter-clockwise
 * when positive), the first on the circle of radius `r` round (x, y) from
 * `startDeg`, each next one `shrink` times the radius of the last and
 * running on from its end without a kink.
 */
function spiral(x: number, y: number, r: number, startDeg: number, sweeps: readonly number[], shrink: number): SigilPart[] {
  const parts: SigilPart[] = [];
  let cx = x;
  let cy = y;
  let radius = r;
  let theta = startDeg * DEG;
  for (const sweepDeg of sweeps) {
    const sweep = sweepDeg * DEG;
    parts.push({ kind: 'arc', x: cx, y: cy, r: radius, at: theta + sweep / 2, span: Math.abs(sweep) });
    theta += sweep;
    const ex = cx + radius * Math.cos(theta);
    const ey = cy + radius * Math.sin(theta);
    const next = radius * shrink;
    cx = ex - (ex - cx) * (next / radius);
    cy = ey - (ey - cy) * (next / radius);
    radius = next;
  }
  return parts;
}

/** A piece of the circle of radius `r` round (x, y), from `fromDeg` to `toDeg` counter-clockwise. */
const seg = (r: number, fromDeg: number, toDeg: number, x = 0, y = 0): SigilPart =>
  arc(r, (fromDeg + toDeg) / 2, toDeg - fromDeg, x, y);

/**
 * No sigil stands in a rim or fills a round badge: each is a loose group
 * pulled off the cell's centre, its curves bent round points away from the
 * centre, so it never reads as a dial, a grille or a button. One large mark
 * (a crescent, an orbit, a sweep, a spiral fragment) and smaller ones
 * trailing from it: nodes, dots of falling size, small open rings.
 */
export const PORTAL_SIGILS: readonly Sigil[] = [
  {
    name: 'falling moon',
    parts: [
      crescent(0.16, 160, -0.17, 0.19),
      link(-0.34, -0.02, 0.19, -0.245, -0.09), dot(0.045, -0.34, -0.02), ring(0.055, 0.22, -0.27),
      dot(0.035, 0.1, 0.08), dot(0.028, 0.22, 0.16), dot(0.02, 0.33, 0.22),
    ],
  },
  {
    name: 'wandering orbit',
    parts: [
      seg(0.3, 115, 245, 0.2, 0.06),
      node(0.05, on(0.2, 0.06, 0.3, 150)), node(0.035, on(0.2, 0.06, 0.3, 205)), ring(0.05, ...on(0.2, 0.06, 0.3, 275)),
      crescent(0.1, 90, 0.24, 0.24),
      dot(0.025, 0.34, -0.08), dot(0.02, 0.38, 0.04),
    ],
  },
  {
    name: 'spiral shard',
    parts: [
      // The spiral runs on in dots where its curve ends
      ...spiral(-0.08, 0.02, 0.3, 20, [100, 90], 0.62),
      dot(0.035, -0.237, -0.024), dot(0.028, -0.159, -0.024), dot(0.022, -0.098, 0.027),
      crescent(0.13, 70, 0.2, -0.22),
      dot(0.03, -0.1, -0.3), dot(0.02, -0.22, -0.34),
    ],
  },
  {
    name: 'crescents in tow',
    parts: [
      crescent(0.17, 200, 0.14, 0.17), crescent(0.1, 170, -0.08, -0.12), crescent(0.065, 140, -0.26, -0.28),
      link(0.3, -0.05, 0.08, -0.33, -0.06), dot(0.03, 0.3, -0.05), ring(0.06, -0.2, 0.28),
    ],
  },
  {
    // Replaces 'chained nodes', whose three bowed arms round a central node
    // read as a triskelion
    name: 'tethered seeds',
    parts: [
      dot(0.055, -0.22, 0.14), link(-0.22, 0.14, 0.06, 0.28, 0.07), dot(0.03, 0.06, 0.28),
      dot(0.03, 0.06, -0.1), link(0.06, -0.1, 0.34, -0.22, 0.06), dot(0.04, 0.34, -0.22),
      crescent(0.1, 200, -0.18, -0.22), ring(0.045, 0.33, 0.12),
    ],
  },
  {
    name: 'broken moonring',
    parts: [
      seg(0.15, 35, 125, -0.12, -0.1), seg(0.14, 215, 305, -0.13, -0.11), node(0.035, on(-0.12, -0.1, 0.15, 170)),
      seg(0.62, 200, 250, 0.45, 0.62), dot(0.04, 0.238, 0.037),
      crescent(0.09, 20, 0.24, -0.26),
    ],
  },
  {
    name: 'eclipse trail',
    parts: [
      ring(0.14, -0.08, 0.08), dot(0.09, 0.03, 0),
      dot(0.04, 0.18, -0.16), dot(0.03, 0.27, -0.23), dot(0.02, 0.32, -0.28),
      crescent(0.1, 150, -0.22, 0.27),
    ],
  },
  {
    name: 'dotted whorl',
    parts: [
      ...[[200, 0.3, 0.05], [250, 0.25, 0.045], [300, 0.2, 0.038], [350, 0.16, 0.032], [40, 0.12, 0.026], [90, 0.09, 0.02]]
        .map(([deg, r, size]) => node(size, on(0.12, 0.1, r, deg))),
      ring(0.045, -0.28, 0.24),
      crescent(0.08, 240, -0.28, -0.25),
    ],
  },
  {
    name: 'haloed moon',
    parts: [
      crescent(0.17, 60, -0.1, -0.1),
      seg(0.3, 110, 200, -0.06, -0.08), seg(0.28, 250, 300, -0.08, -0.06),
      dot(0.04, 0.26, 0.26), dot(0.028, 0.34, 0.05), dot(0.02, 0.3, -0.2),
    ],
  },
  {
    // Replaces 'drifting bodies', whose ring and dots either side of a long
    // flat sweep read as a percent sign
    name: 'averted moon',
    parts: [
      crescent(0.19, 215, -0.12, -0.02),
      seg(0.1, 10, 120, 0.2, 0.22), seg(0.1, 150, 250, 0.2, 0.22), seg(0.095, 285, 345, 0.2, 0.22),
      dot(0.03, -0.02, -0.36), dot(0.035, 0.12, -0.28), dot(0.028, 0.26, -0.2), dot(0.022, 0.36, -0.08),
    ],
  },
];

/**
 * Where the sigils sit on the frame at scale 1 (m), in a frieze round the
 * opening on the front and the back: a column up each pillar, a row along
 * the lintel. A sigil fills a square of `size`.
 */
export const SIGIL_LAYOUT = {
  size: 1.4,
  /** Pillar column: centre from the opening's edge, bottom of the lowest cell, row pitch, rows */
  pillarInset: 1,
  pillarBottom: 2.6,
  pillarPitch: 1.6,
  pillarRows: 5,
  /** Lintel row: centre above the opening, column pitch, columns */
  lintelRise: 1.5,
  lintelPitch: 2,
  lintelColumns: 6,
} as const;

/** Number of frame cells: up the left pillar, along the lintel, down the right pillar. */
export const SIGIL_CELLS = 2 * SIGIL_LAYOUT.pillarRows + SIGIL_LAYOUT.lintelColumns;

/** Step through the set from one frame cell to the next, coprime with its size. */
export const SIGIL_STRIDE = 3;

/**
 * Sigil (index into PORTAL_SIGILS) of frame cell `cell`. The cells run up
 * the left pillar, along the lintel and down the right pillar
 * (frameSigilCells); the stride gives neighbours different sigils and
 * shows every sigil once in the first PORTAL_SIGILS.length cells.
 */
export function sigilForCell(cell: number): number {
  return (cell * SIGIL_STRIDE) % PORTAL_SIGILS.length;
}

/** How far a sigil's ink reaches from its centre at most (cell units, scale 1). */
export const SIGIL_REACH = 0.46;

/**
 * How the sigil in frame cell `cell` is carved: turned by `turn` (rad,
 * -30° to 30°), sized by `scale` (0.72 to 1) and moved off the cell's
 * centre by (dx, dy) (cell units) as far as its size leaves room, a
 * little differently in every cell, the same on every portal.
 */
export function sigilPoseForCell(cell: number): { turn: number; scale: number; dx: number; dy: number } {
  const scale = 0.72 + 0.07 * ((cell * 3) % 5);
  const room = 0.49 - SIGIL_REACH * scale;
  // The golden angle spreads the shifts' directions
  const a = cell * 2.39996;
  return { turn: (((cell * 7) % 11) - 5) * 6 * DEG, scale, dx: room * Math.cos(a), dy: room * Math.sin(a) };
}

/**
 * How the sigil in frame cell `cell` breathes (the gate shader,
 * portalGlyphState): two slow waves, each `rate` of the way from the
 * slowest to the fastest breath of the look (0 to 1) and starting at
 * `phase` (rad). Irrational steps spread them, so neighbouring cells never
 * breathe in step; the portal's phase shifts them all once more, so
 * portals side by side do not either. The same on every run.
 */
export function sigilBreathForCell(cell: number): { rate: [number, number]; phase: [number, number] } {
  const frac = (v: number) => v - Math.floor(v);
  return {
    rate: [frac(0.31 + cell * 0.618034), frac(0.77 + cell * 0.414214)],
    phase: [2 * Math.PI * frac(0.13 + cell * 0.56984), 2 * Math.PI * frac(0.52 + cell * 0.707107)],
  };
}

/** A frame cell: its number (sigilForCell), the centre of its square in portal space (m, scale 1), its pose. */
export interface SigilCell {
  cell: number;
  x: number;
  y: number;
  turn: number;
  scale: number;
  dx: number;
  dy: number;
}

/** The frame's cells in order: up the left pillar, along the lintel, down the right pillar. */
export function frameSigilCells(): SigilCell[] {
  const L = SIGIL_LAYOUT;
  const pillarX = PORTAL_OPENING_WIDTH / 2 + L.pillarInset;
  const pillarY = (row: number) => L.pillarBottom + (row + 0.5) * L.pillarPitch;
  const lintelHalf = (L.lintelColumns * L.lintelPitch) / 2;
  const cells: Pick<SigilCell, 'cell' | 'x' | 'y'>[] = [];
  for (let row = 0; row < L.pillarRows; row++) cells.push({ cell: row, x: -pillarX, y: pillarY(row) });
  for (let column = 0; column < L.lintelColumns; column++) {
    cells.push({
      cell: L.pillarRows + column,
      x: -lintelHalf + (column + 0.5) * L.lintelPitch,
      y: PORTAL_OPENING_HEIGHT + L.lintelRise,
    });
  }
  for (let row = L.pillarRows - 1; row >= 0; row--) {
    cells.push({ cell: 2 * L.pillarRows + L.lintelColumns - 1 - row, x: pillarX, y: pillarY(row) });
  }
  return cells.map((c) => ({ ...c, ...sigilPoseForCell(c.cell) }));
}

function glslFloat(value: number): string {
  const text = value.toFixed(4);
  return text === '-0.0000' ? '0.0000' : text;
}

function partGlsl(part: SigilPart): string {
  const centre = `vec2(${glslFloat(part.x)}, ${glslFloat(part.y)})`;
  switch (part.kind) {
    case 'ring':
      return `sigilRing(p, ${centre}, ${glslFloat(part.r)})`;
    case 'dot':
      return `sigilDot(p, ${centre}, ${glslFloat(part.r)})`;
    case 'crescent': {
      const dir = `vec2(${glslFloat(Math.cos(part.at))}, ${glslFloat(Math.sin(part.at))})`;
      return `sigilCrescent(p, ${centre}, ${glslFloat(part.r)}, ${dir})`;
    }
    case 'arc': {
      const dir = `vec2(${glslFloat(Math.cos(part.at))}, ${glslFloat(Math.sin(part.at))})`;
      const sc = `vec2(${glslFloat(Math.sin(part.span / 2))}, ${glslFloat(Math.cos(part.span / 2))})`;
      return `sigilArc(p, ${centre}, ${glslFloat(part.r)}, ${dir}, ${sc})`;
    }
  }
}

function sigilBranches(): string {
  const last = PORTAL_SIGILS.length - 1;
  return PORTAL_SIGILS.map((sigil, i) => {
    const head = i === 0 ? 'if (index < 0.5)' : i < last ? `else if (index < ${i}.5)` : 'else';
    const body = sigil.parts.map((part) => `d = min(d, ${partGlsl(part)});`).join('\n          ');
    return `${head} { // ${sigil.name}\n          ${body}\n        }`;
  }).join(' ');
}

/** A GLSL constant array of vec4, one row each. */
function vec4Array(name: string, rows: readonly (readonly number[])[]): string {
  const items = rows.map((row) => `vec4(${row.map(glslFloat).join(', ')})`).join(',\n    ');
  return `const vec4 ${name}[${rows.length}] = vec4[${rows.length}](\n    ${items}\n  );`;
}

/**
 * GLSL of the frame's sigil cells, generated from SIGIL_LAYOUT and the
 * cells' poses and breaths; needs PORTAL_SIGIL_GLSL before it.
 * portalGlyphCell(p, opening, centre) gives the number of the cell whose
 * square holds p (portal space, front or back), numbered as
 * frameSigilCells() does, -1 off the cells, and in `centre` the square's
 * centre. portalGlyphInk(p, cell, centre, wobble, stroke) gives the
 * distance (m at scale 1) from p to the ink of the sigil carved there,
 * turned, sized and moved as the asset carves it (sigilPoseForCell), and in
 * `stroke` half the width of its strokes (m). GLYPH_BREATH holds each
 * cell's breath (sigilBreathForCell: rates, phases). The gate shader keys
 * each carved sigil's glow and life to them.
 */
export const PORTAL_GLYPH_CELL_GLSL = /* glsl */ `
  const float GLYPH_SIGILS = ${glslFloat(PORTAL_SIGILS.length)};
  const float GLYPH_STRIDE = ${glslFloat(SIGIL_STRIDE)};
  // Per cell: turn (rad), scale, shift (cell units)
  ${vec4Array('GLYPH_POSE', frameSigilCells().map((c) => [c.turn, c.scale, c.dx, c.dy]))}
  // Per cell: the rates of its two breaths (0 to 1), their phases (rad)
  ${vec4Array('GLYPH_BREATH', frameSigilCells().map((c) => {
    const b = sigilBreathForCell(c.cell);
    return [...b.rate, ...b.phase];
  }))}
  const float GLYPH_SIZE = ${glslFloat(SIGIL_LAYOUT.size)};
  const float GLYPH_PILLAR_INSET = ${glslFloat(SIGIL_LAYOUT.pillarInset)};
  const float GLYPH_PILLAR_BOTTOM = ${glslFloat(SIGIL_LAYOUT.pillarBottom)};
  const float GLYPH_PILLAR_PITCH = ${glslFloat(SIGIL_LAYOUT.pillarPitch)};
  const float GLYPH_PILLAR_ROWS = ${glslFloat(SIGIL_LAYOUT.pillarRows)};
  const float GLYPH_LINTEL_RISE = ${glslFloat(SIGIL_LAYOUT.lintelRise)};
  const float GLYPH_LINTEL_PITCH = ${glslFloat(SIGIL_LAYOUT.lintelPitch)};
  const float GLYPH_LINTEL_COLUMNS = ${glslFloat(SIGIL_LAYOUT.lintelColumns)};

  float portalGlyphCell(vec3 p, vec2 opening, out vec2 centre) {
    float row = floor((p.y - GLYPH_PILLAR_BOTTOM) / GLYPH_PILLAR_PITCH);
    float pillarX = opening.x + GLYPH_PILLAR_INSET;
    centre = vec2(sign(p.x) * pillarX, GLYPH_PILLAR_BOTTOM + (row + 0.5) * GLYPH_PILLAR_PITCH);
    if (row >= 0.0 && row < GLYPH_PILLAR_ROWS
        && abs(abs(p.x) - pillarX) < 0.5 * GLYPH_SIZE && abs(p.y - centre.y) < 0.5 * GLYPH_SIZE) {
      // Up the left pillar, down the right one after the lintel
      return p.x < 0.0 ? row : 2.0 * GLYPH_PILLAR_ROWS + GLYPH_LINTEL_COLUMNS - 1.0 - row;
    }
    float lintelHalf = 0.5 * GLYPH_LINTEL_COLUMNS * GLYPH_LINTEL_PITCH;
    float column = floor((p.x + lintelHalf) / GLYPH_LINTEL_PITCH);
    centre = vec2(-lintelHalf + (column + 0.5) * GLYPH_LINTEL_PITCH, opening.y + GLYPH_LINTEL_RISE);
    if (column >= 0.0 && column < GLYPH_LINTEL_COLUMNS
        && abs(p.x - centre.x) < 0.5 * GLYPH_SIZE && abs(p.y - centre.y) < 0.5 * GLYPH_SIZE) {
      return GLYPH_PILLAR_ROWS + column;
    }
    return -1.0;
  }

  float portalGlyphInk(vec2 p, float cell, vec2 centre, vec2 wobble, out float stroke) {
    vec4 pose = GLYPH_POSE[int(cell)];
    vec2 local = (p - centre) / GLYPH_SIZE - pose.zw + wobble;
    float c = cos(pose.x);
    float s = sin(pose.x);
    vec2 q = vec2(c * local.x + s * local.y, c * local.y - s * local.x) / pose.y;
    float metres = pose.y * GLYPH_SIZE;
    stroke = SIGIL_STROKE * metres;
    return portalSigil(q, mod(cell * GLYPH_STRIDE, GLYPH_SIGILS)) * metres;
  }
`;

/**
 * GLSL of the sigils, generated from PORTAL_SIGILS: portalSigil(p, index)
 * gives the distance (cell units) from p to the ink of sigil `index`.
 */
export const PORTAL_SIGIL_GLSL = /* glsl */ `
  const float SIGIL_STROKE = ${glslFloat(SIGIL_STROKE)};
  const float CRESCENT_HOLLOW = ${glslFloat(CRESCENT_HOLLOW)};
  const float CRESCENT_SHIFT = ${glslFloat(CRESCENT_SHIFT)};

  float sigilRing(vec2 p, vec2 c, float r) {
    return abs(length(p - c) - r) - SIGIL_STROKE;
  }

  float sigilDot(vec2 p, vec2 c, float r) {
    return length(p - c) - r;
  }

  // Crescent: the disc (c, r) less a disc of CRESCENT_HOLLOW r shifted
  // CRESCENT_SHIFT r toward dir, the way its horns point
  float sigilCrescent(vec2 p, vec2 c, float r, vec2 dir) {
    return max(length(p - c) - r, CRESCENT_HOLLOW * r - length(p - c - dir * (CRESCENT_SHIFT * r)));
  }

  // Arc of the circle (c, r) centred on the direction dir, sc = (sin, cos)
  // of half its span, with round ends
  float sigilArc(vec2 p, vec2 c, float r, vec2 dir, vec2 sc) {
    vec2 q = p - c;
    q = vec2(abs(q.x * dir.y - q.y * dir.x), dot(q, dir));
    float d = sc.y * q.x > sc.x * q.y ? length(q - sc * r) : abs(length(q) - r);
    return d - SIGIL_STROKE;
  }

  // Distance from p (cell units) to the ink of sigil 'index'
  float portalSigil(vec2 p, float index) {
    float d = 1.0;
    ${sigilBranches()}
    return d;
  }
`;
