import { PORTAL_OPENING_HEIGHT, PORTAL_OPENING_WIDTH } from '../../../configs/marker-geometry.config';

/**
 * Sigils on the spawn portal's frame: a fixed, hand-authored set of
 * fictional seals, drawn as signed distances by the gate shader
 * (marker-shaders.ts, PORTAL_SIGIL_GLSL). They replace random glyphs of a
 * stem, bars and diagonals, which came out as shapes like 千, キ, ス or
 * Latin letters.
 *
 * Built only from circles, arcs and dots, in the manner of a demonic seal:
 * every sigil sits in a seal ring and holds at least two more marks, at
 * least one of them off the centre, most arranged in threes, fives or
 * sixes; each is mirror-symmetric to the vertical, as the left pillar
 * shows it mirrored. spawn-portal-sigils.spec.ts checks that construction.
 * Hard exclusions, which follow from it or were checked by eye when the
 * set was drawn:
 * - no straight strokes at all: no crosses, no hooked or rotated crosses,
 *   no lightning or zigzag strokes, nothing like the straight-stroke runes
 *   of the Elder Futhark (Sowilo, Othala, Algiz or any other);
 * - no letters or digits, nothing that reads as a real script: no lone
 *   circle (O, 0), no circle with a single dot in the middle (ʘ, ⊙), no
 *   bare pair of concentric circles (◎), no open single curve (C, U, or
 *   the round letters of scripts such as Burmese), no dots in a two by
 *   three grid (Braille).
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
  | { kind: 'dot'; x: number; y: number; r: number };

export interface Sigil {
  name: string;
  parts: readonly SigilPart[];
}

/** Half the stroke width of rings and arcs (cell units). */
export const SIGIL_STROKE = 0.035;

/** Radius of the seal ring every sigil sits in (cell units). */
export const SIGIL_SEAL = 0.4;

const DEG = Math.PI / 180;

const ring = (r: number, x = 0, y = 0): SigilPart => ({ kind: 'ring', x, y, r });
const dot = (r: number, x = 0, y = 0): SigilPart => ({ kind: 'dot', x, y, r });
const arc = (r: number, atDeg: number, spanDeg: number, x = 0, y = 0): SigilPart => ({
  kind: 'arc', x, y, r, at: atDeg * DEG, span: spanDeg * DEG,
});

/** `count` marks evenly round a circle of `radius`, the first at `startDeg` (0 right, 90 up). */
function around(count: number, radius: number, startDeg: number, mark: (x: number, y: number) => SigilPart): SigilPart[] {
  const parts: SigilPart[] = [];
  for (let i = 0; i < count; i++) {
    const a = (startDeg + (360 / count) * i) * DEG;
    parts.push(mark(radius * Math.cos(a), radius * Math.sin(a)));
  }
  return parts;
}

/** Eyelids: arcs of radius 0.36 around (0, ∓0.22), meeting in the eye's corners on y = 0. */
const LID_RADIUS = 0.36;
const LID_OFFSET = 0.22;
const LID_SPAN = (2 * Math.acos(LID_OFFSET / LID_RADIUS)) / DEG;

const seal = ring(SIGIL_SEAL);

export const PORTAL_SIGILS: readonly Sigil[] = [
  { name: 'triad', parts: [seal, ...around(3, 0.2, 90, (x, y) => dot(0.065, x, y))] },
  { name: 'hollow triad', parts: [seal, ...around(3, 0.19, 270, (x, y) => ring(0.09, x, y))] },
  { name: 'beaded seal', parts: [seal, ...around(5, SIGIL_SEAL, 90, (x, y) => dot(0.06, x, y)), ring(0.12)] },
  {
    name: 'dotted halo',
    parts: [seal, ...[90, 210, 330].map((a) => arc(0.24, a, 64)), ...around(3, 0.24, 30, (x, y) => dot(0.045, x, y))],
  },
  { name: 'trefoil', parts: [seal, ...around(3, 0.13, 90, (x, y) => ring(0.15, x, y))] },
  { name: 'hexad', parts: [seal, ...around(6, 0.27, 90, (x, y) => dot(0.05, x, y)), ring(0.11)] },
  {
    name: 'eye',
    parts: [seal, arc(LID_RADIUS, 90, LID_SPAN, 0, -LID_OFFSET), arc(LID_RADIUS, 270, LID_SPAN, 0, LID_OFFSET), dot(0.07)],
  },
  { name: 'orbit', parts: [seal, ring(0.22), ...around(3, 0.22, 90, (x, y) => dot(0.06, x, y))] },
  { name: 'double seal', parts: [seal, ring(0.32), ...around(3, 0.13, 270, (x, y) => dot(0.055, x, y))] },
  {
    name: 'pentad',
    parts: [seal, ...around(5, 0.26, 90, (x, y) => dot(0.05, x, y)), ...around(5, 0.12, 270, (x, y) => dot(0.04, x, y))],
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

/** A frame cell: its number (sigilForCell) and the centre of its square in portal space (m, scale 1). */
export interface SigilCell {
  cell: number;
  x: number;
  y: number;
}

/** The frame's cells in order: up the left pillar, along the lintel, down the right pillar. */
export function frameSigilCells(): SigilCell[] {
  const L = SIGIL_LAYOUT;
  const pillarX = PORTAL_OPENING_WIDTH / 2 + L.pillarInset;
  const pillarY = (row: number) => L.pillarBottom + (row + 0.5) * L.pillarPitch;
  const lintelHalf = (L.lintelColumns * L.lintelPitch) / 2;
  const cells: SigilCell[] = [];
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
  return cells;
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

/**
 * GLSL of the sigils, generated from PORTAL_SIGILS and SIGIL_LAYOUT:
 * portalFrameSigils(p, opening, fade) gives the distance (cell units) from
 * a point of the frame (portal space, front or back face) to the ink of
 * its cell's sigil, 1.0 off the cells, and in `fade` a weight that falls
 * to 0 at the cell's border, for a glow round the ink.
 */
export const PORTAL_SIGIL_GLSL = /* glsl */ `
  const float SIGIL_STROKE = ${glslFloat(SIGIL_STROKE)};
  const float SIGIL_SIZE = ${glslFloat(SIGIL_LAYOUT.size)};
  const float SIGIL_PILLAR_INSET = ${glslFloat(SIGIL_LAYOUT.pillarInset)};
  const float SIGIL_PILLAR_BOTTOM = ${glslFloat(SIGIL_LAYOUT.pillarBottom)};
  const float SIGIL_PILLAR_PITCH = ${glslFloat(SIGIL_LAYOUT.pillarPitch)};
  const float SIGIL_PILLAR_ROWS = ${glslFloat(SIGIL_LAYOUT.pillarRows)};
  const float SIGIL_LINTEL_RISE = ${glslFloat(SIGIL_LAYOUT.lintelRise)};
  const float SIGIL_LINTEL_PITCH = ${glslFloat(SIGIL_LAYOUT.lintelPitch)};
  const float SIGIL_LINTEL_COLUMNS = ${glslFloat(SIGIL_LAYOUT.lintelColumns)};

  float sigilRing(vec2 p, vec2 c, float r) {
    return abs(length(p - c) - r) - SIGIL_STROKE;
  }

  float sigilDot(vec2 p, vec2 c, float r) {
    return length(p - c) - r;
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
        return portalSigil(q, portalSigilIndex(cell));
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
        return portalSigil(q, portalSigilIndex(SIGIL_PILLAR_ROWS + column));
      }
    }
    return 1.0;
  }
`;
