import { PORTAL_OPENING_HEIGHT, PORTAL_OPENING_WIDTH } from '../../../configs/marker-geometry.config';

/**
 * Sigils on the spawn portal's frame: a fixed, hand-authored set of
 * fictional occult seals, drawn as signed distances by the gate shader
 * (marker-shaders.ts, PORTAL_SIGIL_GLSL). They replace random glyphs of a
 * stem, bars and diagonals, which came out as shapes like 千, キ, ス or
 * Latin letters, and a set of centred seals in perfect rings, which read
 * like buttons or dials.
 *
 * Built only from curves and dots, in loose, lopsided groups: broken and
 * offset rings, orbits with nodes on them, fragments of spirals, crescents,
 * dots linked by bowed arcs. No sigil sits in a closed ring round its cell,
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
 *   concentric rings (◎), no dots in a two by three grid (Braille).
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
 * Every sigil stands in a broken, uneven rim of two or three pieces, their
 * radii and centres a little apart, nodes in some of the gaps: no closed
 * frame, and an open curve inside never reads as a letter. Inside, off the
 * centre, an orbit, a spiral, crescents, a constellation or nested breaks.
 */
export const PORTAL_SIGILS: readonly Sigil[] = [
  {
    name: 'fractured orbit',
    parts: [
      seg(0.4, 20, 150), seg(0.38, 175, 290, 0.01, -0.01), seg(0.405, 305, 355),
      node(0.05, on(0, 0, 0.4, 162)),
      ring(0.085, 0.16, 0.16), node(0.03, on(0.16, 0.16, 0.085, 210)), crescent(0.08, 250, -0.18, -0.2),
    ],
  },
  {
    name: 'spiral seal',
    parts: [
      seg(0.39, 60, 200), seg(0.4, 230, 330),
      ...spiral(0.02, -0.03, 0.25, 120, [100, 110, 110], 0.66),
      node(0.045, on(0, 0, 0.33, 350)), node(0.035, on(0, 0, 0.35, 15)), node(0.025, on(0, 0, 0.37, 38)),
    ],
  },
  {
    name: 'crescent cradle',
    parts: [
      seg(0.4, 100, 250), seg(0.37, 280, 400, 0.02, 0),
      node(0.04, on(0, 0, 0.39, 265)),
      crescent(0.19, 30, -0.08, -0.12), dot(0.045, -0.22, 0.16), dot(0.03, -0.06, 0.26), dot(0.02, 0.06, 0.31),
    ],
  },
  {
    name: 'nested fractures',
    parts: [
      seg(0.4, 200, 450), seg(0.27, 20, 250, 0.05, 0.03), seg(0.14, 240, 470, -0.02, 0.06),
      dot(0.045, 0.13, -0.14), node(0.035, on(0, 0, 0.4, 170)),
    ],
  },
  {
    name: 'constellation',
    parts: [
      seg(0.4, 250, 470),
      dot(0.045, -0.2, 0.05), dot(0.03, 0.02, 0.18), dot(0.05, 0.18, 0.02), dot(0.035, 0.05, -0.2),
      link(-0.2, 0.05, 0.02, 0.18, 0.04), link(0.02, 0.18, 0.18, 0.02, -0.04), link(0.18, 0.02, 0.05, -0.2, 0.05),
      node(0.04, on(0, 0, 0.36, 150)), node(0.025, on(0, 0, 0.33, 200)),
    ],
  },
  {
    name: 'eclipse seal',
    parts: [
      seg(0.4, 0, 120), seg(0.39, 150, 230, -0.01, 0.01), seg(0.4, 255, 330),
      node(0.04, on(0, 0, 0.4, 137)),
      ring(0.12, -0.1, 0.1), crescent(0.13, 210, 0.14, -0.12),
    ],
  },
  {
    name: 'dotted spiral',
    parts: [
      seg(0.41, 150, 330),
      ...[[20, 0.32, 0.05], [70, 0.27, 0.045], [120, 0.22, 0.04], [170, 0.18, 0.035], [220, 0.14, 0.03], [270, 0.1, 0.025]]
        .map(([deg, r, size]) => node(size, on(0, 0, r, deg))),
      crescent(0.07, 300, 0.1, -0.12),
    ],
  },
  {
    name: 'moon over nodes',
    parts: [
      seg(0.4, 40, 180), seg(0.38, 210, 320),
      crescent(0.12, 300, 0.12, 0.1),
      dot(0.045, -0.25, 0.14), dot(0.035, -0.27, -0.06), dot(0.04, -0.14, -0.22),
      link(-0.25, 0.14, -0.27, -0.06, 0.04), link(-0.27, -0.06, -0.14, -0.22, 0.04),
    ],
  },
  {
    name: 'crescent pair',
    parts: [
      seg(0.4, 280, 380), seg(0.39, 70, 220, -0.01, 0),
      crescent(0.15, 160, 0.1, 0.05), crescent(0.1, 180, -0.15, -0.1),
      dot(0.03, 0.2, -0.22), node(0.04, on(0, 0, 0.395, 245)),
    ],
  },
  {
    name: 'star chart',
    parts: [
      seg(0.4, 280, 350), seg(0.39, 20, 110, 0.01, 0),
      ...[[100, 0.055], [135, 0.045], [170, 0.04], [205, 0.03], [240, 0.025]].map(([deg, size]) => node(size, on(0.05, 0.05, 0.3, deg))),
      ...[[300, 0.04], [340, 0.03], [20, 0.025]].map(([deg, size]) => node(size, on(-0.05, -0.1, 0.2, deg))),
      ring(0.06, 0.16, 0.18),
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

/**
 * How the sigil in frame cell `cell` is carved: turned by `turn` (rad,
 * -30° to 30°) and sized by `scale` (0.8 to 1), a little differently in
 * every cell, the same on every portal.
 */
export function sigilPoseForCell(cell: number): { turn: number; scale: number } {
  return { turn: (((cell * 7) % 11) - 5) * 6 * DEG, scale: 0.8 + 0.05 * ((cell * 3) % 5) };
}

/** A frame cell: its number (sigilForCell), the centre of its square in portal space (m, scale 1), its pose. */
export interface SigilCell {
  cell: number;
  x: number;
  y: number;
  turn: number;
  scale: number;
}

/** The frame's cells in order: up the left pillar, along the lintel, down the right pillar. */
export function frameSigilCells(): SigilCell[] {
  const L = SIGIL_LAYOUT;
  const pillarX = PORTAL_OPENING_WIDTH / 2 + L.pillarInset;
  const pillarY = (row: number) => L.pillarBottom + (row + 0.5) * L.pillarPitch;
  const lintelHalf = (L.lintelColumns * L.lintelPitch) / 2;
  const cells: Omit<SigilCell, 'turn' | 'scale'>[] = [];
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

/** A GLSL float array of `values`. */
function glslArray(values: readonly number[]): string {
  return `float[${values.length}](${values.map(glslFloat).join(', ')})`;
}

const CELL_POSES = [...Array(SIGIL_CELLS).keys()].map(sigilPoseForCell);

/**
 * GLSL of the sigils, generated from PORTAL_SIGILS and SIGIL_LAYOUT:
 * portalFrameSigils(p, opening, fade) gives the distance (cell units) from
 * a point of the frame (portal space, front or back face) to the ink of
 * its cell's sigil, turned and sized as sigilPoseForCell says, 1.0 off the
 * cells, and in `fade` a weight that falls to 0 at the cell's border, for
 * a glow round the ink.
 */
export const PORTAL_SIGIL_GLSL = /* glsl */ `
  const float SIGIL_STROKE = ${glslFloat(SIGIL_STROKE)};
  const float CRESCENT_HOLLOW = ${glslFloat(CRESCENT_HOLLOW)};
  const float CRESCENT_SHIFT = ${glslFloat(CRESCENT_SHIFT)};
  const float SIGIL_SIZE = ${glslFloat(SIGIL_LAYOUT.size)};
  const float SIGIL_PILLAR_INSET = ${glslFloat(SIGIL_LAYOUT.pillarInset)};
  const float SIGIL_PILLAR_BOTTOM = ${glslFloat(SIGIL_LAYOUT.pillarBottom)};
  const float SIGIL_PILLAR_PITCH = ${glslFloat(SIGIL_LAYOUT.pillarPitch)};
  const float SIGIL_PILLAR_ROWS = ${glslFloat(SIGIL_LAYOUT.pillarRows)};
  const float SIGIL_LINTEL_RISE = ${glslFloat(SIGIL_LAYOUT.lintelRise)};
  const float SIGIL_LINTEL_PITCH = ${glslFloat(SIGIL_LAYOUT.lintelPitch)};
  const float SIGIL_LINTEL_COLUMNS = ${glslFloat(SIGIL_LAYOUT.lintelColumns)};
  const float SIGIL_TURNS[${SIGIL_CELLS}] = ${glslArray(CELL_POSES.map((pose) => pose.turn))};
  const float SIGIL_SCALES[${SIGIL_CELLS}] = ${glslArray(CELL_POSES.map((pose) => pose.scale))};

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

  // Sigil of frame cell 'cell', see sigilForCell()
  float portalSigilIndex(float cell) {
    return mod(cell * ${glslFloat(SIGIL_STRIDE)}, ${glslFloat(PORTAL_SIGILS.length)});
  }

  // Distance to the ink of frame cell 'cell' from q (cell units from the
  // cell's centre), its sigil turned and sized as sigilPoseForCell says
  float portalCellSigil(vec2 q, float cell) {
    int i = int(cell + 0.5);
    float c = cos(SIGIL_TURNS[i]);
    float s = sin(SIGIL_TURNS[i]);
    float scale = SIGIL_SCALES[i];
    return portalSigil(mat2(c, -s, s, c) * q / scale, portalSigilIndex(cell)) * scale;
  }

  float portalFrameSigils(vec3 p, vec2 opening, out float fade) {
    fade = 0.0;
    float row = floor((p.y - SIGIL_PILLAR_BOTTOM) / SIGIL_PILLAR_PITCH);
    if (row >= 0.0 && row < SIGIL_PILLAR_ROWS) {
      vec2 q = vec2(
        abs(p.x) - opening.x - SIGIL_PILLAR_INSET,
        p.y - SIGIL_PILLAR_BOTTOM - (row + 0.5) * SIGIL_PILLAR_PITCH
      ) / SIGIL_SIZE;
      float box = max(abs(q.x), abs(q.y));
      if (box < 0.5) {
        // Up the left pillar, down the right one after the lintel
        float cell = p.x < 0.0 ? row : SIGIL_PILLAR_ROWS + SIGIL_LINTEL_COLUMNS + SIGIL_PILLAR_ROWS - 1.0 - row;
        fade = 1.0 - smoothstep(0.4, 0.5, box);
        return portalCellSigil(q, cell);
      }
    }
    float lintelHalf = SIGIL_LINTEL_COLUMNS * SIGIL_LINTEL_PITCH * 0.5;
    float column = floor((p.x + lintelHalf) / SIGIL_LINTEL_PITCH);
    if (column >= 0.0 && column < SIGIL_LINTEL_COLUMNS) {
      vec2 q = vec2(
        p.x + lintelHalf - (column + 0.5) * SIGIL_LINTEL_PITCH,
        p.y - opening.y - SIGIL_LINTEL_RISE
      ) / SIGIL_SIZE;
      float box = max(abs(q.x), abs(q.y));
      if (box < 0.5) {
        fade = 1.0 - smoothstep(0.4, 0.5, box);
        return portalCellSigil(q, SIGIL_PILLAR_ROWS + column);
      }
    }
    return 1.0;
  }
`;
