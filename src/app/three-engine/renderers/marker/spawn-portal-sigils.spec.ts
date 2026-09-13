import { describe, it, expect } from 'vitest';
import {
  CRESCENT_HOLLOW,
  CRESCENT_SHIFT,
  PORTAL_GLYPH_CELL_GLSL,
  PORTAL_SIGILS,
  PORTAL_SIGIL_GLSL,
  SIGIL_CELLS,
  SIGIL_LAYOUT,
  SIGIL_REACH,
  SIGIL_STROKE,
  frameSigilCells,
  sigilForCell,
  type Sigil,
  type SigilPart,
} from './spawn-portal-sigils';

/** Signed distance (cell units) from (x, y) to a part's ink, as the shader has it. */
function distance(part: SigilPart, x: number, y: number): number {
  const dx = x - part.x;
  const dy = y - part.y;
  const r = Math.hypot(dx, dy);
  switch (part.kind) {
    case 'dot':
      return r - part.r;
    case 'ring':
      return Math.abs(r - part.r) - SIGIL_STROKE;
    case 'crescent': {
      const hx = dx - Math.cos(part.at) * CRESCENT_SHIFT * part.r;
      const hy = dy - Math.sin(part.at) * CRESCENT_SHIFT * part.r;
      return Math.max(r - part.r, CRESCENT_HOLLOW * part.r - Math.hypot(hx, hy));
    }
    case 'arc': {
      const rel = ((((Math.atan2(dy, dx) - part.at) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      if (Math.abs(rel) <= part.span / 2) return Math.abs(r - part.r) - SIGIL_STROKE;
      const ends = [part.at - part.span / 2, part.at + part.span / 2].map((a) =>
        Math.hypot(dx - part.r * Math.cos(a), dy - part.r * Math.sin(a)));
      return Math.min(...ends) - SIGIL_STROKE;
    }
  }
}

/** Farthest point of a part's ink from the cell centre (cell units). */
function reach(part: SigilPart): number {
  const centre = Math.hypot(part.x, part.y);
  if (part.kind === 'dot' || part.kind === 'crescent') return centre + part.r;
  if (part.kind === 'ring') return centre + part.r + SIGIL_STROKE;
  let far = 0;
  for (let i = 0; i <= 64; i++) {
    const a = part.at - part.span / 2 + (part.span * i) / 64;
    far = Math.max(far, Math.hypot(part.x + part.r * Math.cos(a), part.y + part.r * Math.sin(a)));
  }
  return far + SIGIL_STROKE;
}

const GRID = 72;

/** Which cells of a GRID × GRID raster over the cell hold ink, the sample points moved by `move`. */
function inked(sigil: Sigil, move: (x: number, y: number) => [number, number] = (x, y) => [x, y]): boolean[] {
  const out: boolean[] = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const [x, y] = move(-0.5 + (i + 0.5) / GRID, -0.5 + (j + 0.5) / GRID);
      out.push(Math.min(...sigil.parts.map((part) => distance(part, x, y))) < 0);
    }
  }
  return out;
}

/** Share of the inked raster cells that differ between two rasters. */
function difference(a: boolean[], b: boolean[]): number {
  let differ = 0;
  let ink = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] || b[k]) ink++;
    if (a[k] !== b[k]) differ++;
  }
  return differ / ink;
}

/** Parts that draw a line round a centre: rings, and arcs of more than `span`. */
const roundAbout = (part: SigilPart, span: number) =>
  part.kind === 'ring' || (part.kind === 'arc' && part.span > span);

describe('Portal-Sigillen: der Satz', () => {
  it('ist fest, 8 bis 12 Sigillen, alle verschieden', () => {
    expect(PORTAL_SIGILS.length).toBeGreaterThanOrEqual(8);
    expect(PORTAL_SIGILS.length).toBeLessThanOrEqual(12);
    expect(new Set(PORTAL_SIGILS.map((s) => s.name)).size).toBe(PORTAL_SIGILS.length);
    expect(new Set(PORTAL_SIGILS.map((s) => JSON.stringify(s.parts))).size).toBe(PORTAL_SIGILS.length);
  });

  it('besteht nur aus Kreisen, Bögen, Punkten und Sicheln, innerhalb der Zelle', () => {
    // Keine geraden Striche: keine Kreuze, Haken, Blitze, Runen, Buchstaben
    for (const sigil of PORTAL_SIGILS) {
      for (const part of sigil.parts) {
        expect(['ring', 'arc', 'dot', 'crescent']).toContain(part.kind);
        expect(part.r, sigil.name).toBeGreaterThan(0);
        expect(reach(part), `${sigil.name}: ${JSON.stringify(part)}`).toBeLessThanOrEqual(SIGIL_REACH);
        if (part.kind === 'dot') expect(part.r).toBeGreaterThanOrEqual(0.02);
        if (part.kind === 'crescent') expect(part.r).toBeGreaterThanOrEqual(0.06);
        if (part.kind === 'arc') {
          // Kein bloßer Tupfen, und nichts, das sich zu C, U oder O schließt
          expect(part.span).toBeGreaterThan(0.5);
          expect(part.span, `${sigil.name}: Bogen über 160°`).toBeLessThanOrEqual((160 * Math.PI) / 180 + 1e-9);
        }
      }
    }
  });

  it('hat mindestens drei Zeichen, zwei davon außerhalb der Mitte', () => {
    for (const sigil of PORTAL_SIGILS) {
      expect(sigil.parts.length, sigil.name).toBeGreaterThanOrEqual(3);
      expect(sigil.parts.filter((part) => Math.hypot(part.x, part.y) > 0.05).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('hat keinen Rand um die Zellmitte, keine konzentrischen Ringe, keinen Punkt in der Mitte eines Rings', () => {
    for (const sigil of PORTAL_SIGILS) {
      const round = sigil.parts.filter((part) => roundAbout(part, (270 * Math.PI) / 180));
      // Kein Rand, auch kein gebrochener: große Ringe und Bögen um die
      // Zellmitte zusammen höchstens einen halben Kreis (Drehregler, Plakette)
      let rim = 0;
      for (const part of sigil.parts) {
        if ((part.kind === 'ring' || part.kind === 'arc') && part.r >= 0.25 && Math.hypot(part.x, part.y) < 0.12) {
          rim += part.kind === 'ring' ? 2 * Math.PI : part.span;
        }
      }
      expect(rim, `${sigil.name}: Rand`).toBeLessThanOrEqual(Math.PI);
      // ʘ, ⊙: kein Punkt in der Mitte eines Rings
      for (const circle of round) {
        for (const part of sigil.parts.filter((p) => p.kind === 'dot')) {
          expect(Math.hypot(part.x - circle.x, part.y - circle.y), `${sigil.name}: Punkt im Ring`).toBeGreaterThan(0.05);
        }
      }
      // ◎: keine zwei Ringe oder Bögen verschiedener Größe um denselben
      // Mittelpunkt; Stücke desselben gebrochenen Rings dürfen es
      const curves = sigil.parts.filter((part) => roundAbout(part, (120 * Math.PI) / 180) && part.r >= 0.1);
      for (let i = 0; i < curves.length; i++) {
        for (let j = i + 1; j < curves.length; j++) {
          const apart = Math.hypot(curves[i].x - curves[j].x, curves[i].y - curves[j].y);
          const sizes = Math.abs(curves[i].r - curves[j].r);
          expect(apart > 0.03 || sizes < 0.04, `${sigil.name}: konzentrisch`).toBe(true);
        }
      }
    }
  });

  it('hat in keiner Sichel einen Punkt oder Stern in der Höhlung', () => {
    for (const sigil of PORTAL_SIGILS) {
      for (const moon of sigil.parts.filter((part) => part.kind === 'crescent')) {
        if (moon.kind !== 'crescent') continue;
        for (const part of sigil.parts.filter((p) => p.kind === 'dot')) {
          const vx = part.x - moon.x;
          const vy = part.y - moon.y;
          const away = Math.hypot(vx, vy);
          const off = Math.acos((vx * Math.cos(moon.at) + vy * Math.sin(moon.at)) / away);
          expect(away > 0.45 || off > (35 * Math.PI) / 180, `${sigil.name}: Punkt in der Höhlung`).toBe(true);
        }
      }
    }
  });

  it('ist schief: weder spiegelsymmetrisch noch gleich nach einer Dritteldrehung', () => {
    const third = (2 * Math.PI) / 3;
    for (const sigil of PORTAL_SIGILS) {
      const ink = inked(sigil);
      const mirrored = inked(sigil, (x, y) => [-x, y]);
      const turned = inked(sigil, (x, y) => [x * Math.cos(third) - y * Math.sin(third), x * Math.sin(third) + y * Math.cos(third)]);
      expect(difference(ink, mirrored), `${sigil.name}: gespiegelt`).toBeGreaterThan(0.3);
      expect(difference(ink, turned), `${sigil.name}: gedreht`).toBeGreaterThan(0.3);
    }
  });
});

describe('Portal-Sigillen: Auswahl und Platz auf dem Rahmen', () => {
  it('nummeriert die Zellen den Pfeiler hinauf, über den Sturz, den anderen hinab', () => {
    const cells = frameSigilCells();
    const L = SIGIL_LAYOUT;
    expect(cells.map((c) => c.cell)).toEqual([...Array(SIGIL_CELLS).keys()]);
    expect(SIGIL_CELLS).toBe(2 * L.pillarRows + L.lintelColumns);
    expect(cells[0].x).toBeLessThan(0);
    expect(cells[L.pillarRows - 1].y).toBeGreaterThan(cells[0].y);
    expect(cells[cells.length - 1].x).toBeGreaterThan(0);
    expect(cells[cells.length - 1].y).toBe(cells[0].y);
  });

  it('wählt je Zelle fest eine Sigille, Nachbarn verschieden, jede auf einem Rahmen', () => {
    const cells = frameSigilCells();
    const picks = cells.map((c) => sigilForCell(c.cell));
    for (const pick of picks) {
      expect(Number.isInteger(pick)).toBe(true);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(PORTAL_SIGILS.length);
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    expect(new Set(picks).size).toBe(PORTAL_SIGILS.length);
  });

  it('dreht, skaliert und verschiebt die Sigille je Zelle anders, nie über die Zelle hinaus', () => {
    const cells = frameSigilCells();
    for (const { turn, scale, dx, dy } of cells) {
      expect(Math.abs(turn)).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-9);
      expect(scale).toBeGreaterThanOrEqual(0.72);
      expect(scale).toBeLessThanOrEqual(1);
      // Die weiteste Tinte bleibt in der Zelle
      expect(SIGIL_REACH * scale + Math.hypot(dx, dy)).toBeLessThanOrEqual(0.49 + 1e-9);
    }
    expect(new Set(cells.map((c) => c.turn.toFixed(4))).size).toBeGreaterThan(6);
    expect(new Set(cells.map((c) => c.scale.toFixed(4))).size).toBeGreaterThan(3);
    // Nicht jede Sigille mittig: die Hälfte der Zellen merklich verschoben
    expect(cells.filter((c) => Math.hypot(c.dx, c.dy) > 0.05).length).toBeGreaterThanOrEqual(SIGIL_CELLS / 2);
  });

  it('erzeugt die Zellsuche des Tors aus dem Layout, gezählt wie frameSigilCells', () => {
    const L = SIGIL_LAYOUT;
    const values: [string, number][] = [
      ['SIZE', L.size], ['PILLAR_INSET', L.pillarInset], ['PILLAR_BOTTOM', L.pillarBottom],
      ['PILLAR_PITCH', L.pillarPitch], ['PILLAR_ROWS', L.pillarRows], ['LINTEL_RISE', L.lintelRise],
      ['LINTEL_PITCH', L.lintelPitch], ['LINTEL_COLUMNS', L.lintelColumns],
    ];
    for (const [name, value] of values) expect(PORTAL_GLYPH_CELL_GLSL).toContain(`GLYPH_${name} = ${value.toFixed(4)};`);
    // Rechts von oben nach unten: die unterste rechte Zelle ist die letzte
    const cells = frameSigilCells();
    const last = cells[cells.length - 1];
    expect(last.x).toBeGreaterThan(0);
    expect(last.y).toBe(Math.min(...cells.map((c) => c.y)));
    expect(PORTAL_GLYPH_CELL_GLSL).toContain('2.0 * GLYPH_PILLAR_ROWS + GLYPH_LINTEL_COLUMNS - 1.0 - row');
  });

  it('erzeugt je Sigille einen Zweig im Shader', () => {
    expect(PORTAL_SIGIL_GLSL.match(/index < /g)).toHaveLength(PORTAL_SIGILS.length - 1);
    expect(PORTAL_SIGIL_GLSL).toContain('sigilCrescent(p, ');
    expect(PORTAL_SIGIL_GLSL).not.toContain('NaN');
  });
});
