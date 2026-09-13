import { describe, it, expect } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import {
  PORTAL_SIGILS,
  PORTAL_SIGIL_GLSL,
  SIGIL_LAYOUT,
  SIGIL_SEAL,
  SIGIL_STRIDE,
  SIGIL_STROKE,
  frameSigilCells,
  sigilForCell,
  type SigilPart,
} from './spawn-portal-sigils';
import { createPortalFrameGeometry } from './spawn-portal-geometry';

/** Farthest point of a part's ink from the cell centre (cell units). */
function reach(part: SigilPart): number {
  const centre = Math.hypot(part.x, part.y);
  if (part.kind === 'dot') return centre + part.r;
  if (part.kind === 'ring') return centre + part.r + SIGIL_STROKE;
  let far = 0;
  for (let i = 0; i <= 64; i++) {
    const a = part.at - part.span / 2 + (part.span * i) / 64;
    far = Math.max(far, Math.hypot(part.x + part.r * Math.cos(a), part.y + part.r * Math.sin(a)));
  }
  return far + SIGIL_STROKE;
}

/** The part mirrored at the vertical axis. */
function mirrored(part: SigilPart): SigilPart {
  return part.kind === 'arc' ? { ...part, x: -part.x, at: Math.PI - part.at } : { ...part, x: -part.x };
}

function samePart(a: SigilPart, b: SigilPart): boolean {
  const close = (u: number, v: number) => Math.abs(u - v) < 1e-9;
  if (a.kind !== b.kind || !close(a.x, b.x) || !close(a.y, b.y) || !close(a.r, b.r)) return false;
  if (a.kind !== 'arc' || b.kind !== 'arc') return true;
  const turn = (((a.at - b.at) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return close(a.span, b.span) && (turn < 1e-9 || 2 * Math.PI - turn < 1e-9);
}

describe('Portal-Sigillen: der Satz', () => {
  it('ist fest, 8 bis 12 Sigillen, alle verschieden', () => {
    expect(PORTAL_SIGILS.length).toBeGreaterThanOrEqual(8);
    expect(PORTAL_SIGILS.length).toBeLessThanOrEqual(12);
    expect(new Set(PORTAL_SIGILS.map((s) => s.name)).size).toBe(PORTAL_SIGILS.length);
    expect(new Set(PORTAL_SIGILS.map((s) => JSON.stringify(s.parts))).size).toBe(PORTAL_SIGILS.length);
  });

  it('besteht nur aus Kreisen, Bögen und Punkten, innerhalb der Zelle', () => {
    // Keine geraden Striche: keine Kreuze, Haken, Blitze, keine Futhark-Runen
    for (const sigil of PORTAL_SIGILS) {
      for (const part of sigil.parts) {
        expect(['ring', 'arc', 'dot']).toContain(part.kind);
        expect(part.r).toBeGreaterThan(0);
        expect(reach(part)).toBeLessThanOrEqual(0.46);
        if (part.kind === 'dot') expect(part.r).toBeGreaterThanOrEqual(SIGIL_STROKE);
        if (part.kind === 'arc') {
          // Kein ganzer Kreis und kein bloßer Tupfen
          expect(part.span).toBeGreaterThan(0.5);
          expect(part.span).toBeLessThan(2 * Math.PI - 0.5);
        }
      }
    }
  });

  it('sitzt in einem Siegelring mit mindestens zwei weiteren Zeichen, eins davon außerhalb der Mitte', () => {
    // So zerfällt keine Sigille zu einem Kreis (O, 0), einem Kreis mit
    // Mittelpunkt (ʘ) oder zwei konzentrischen Kreisen (◎)
    for (const sigil of PORTAL_SIGILS) {
      const [first, ...rest] = sigil.parts;
      expect(first).toEqual({ kind: 'ring', x: 0, y: 0, r: SIGIL_SEAL });
      expect(rest.length).toBeGreaterThanOrEqual(2);
      expect(rest.some((part) => Math.hypot(part.x, part.y) > 0.05)).toBe(true);
    }
  });

  it('ist spiegelsymmetrisch zur Senkrechten, der linke Pfeiler zeigt sie gespiegelt', () => {
    for (const sigil of PORTAL_SIGILS) {
      for (const part of sigil.parts) {
        expect(sigil.parts.some((other) => samePart(other, mirrored(part)))).toBe(true);
      }
    }
  });
});

describe('Portal-Sigillen: Auswahl und Platz auf dem Rahmen', () => {
  it('nummeriert die Zellen den Pfeiler hinauf, über den Sturz, den anderen hinab', () => {
    const cells = frameSigilCells();
    const L = SIGIL_LAYOUT;
    expect(cells.map((c) => c.cell)).toEqual([...Array(2 * L.pillarRows + L.lintelColumns).keys()]);
    expect(cells[0].x).toBeLessThan(0);
    expect(cells[L.pillarRows - 1].y).toBeGreaterThan(cells[0].y);
    expect(cells[cells.length - 1].x).toBeGreaterThan(0);
    expect(cells[cells.length - 1].y).toBe(cells[0].y);
  });

  it('wählt je Zelle fest eine Sigille, Nachbarn verschieden, jede auf einem Rahmen', () => {
    const cells = frameSigilCells();
    const picks = cells.map((c) => sigilForCell(c.cell));
    expect(cells.map((c) => sigilForCell(c.cell))).toEqual(picks);
    for (const pick of picks) {
      expect(Number.isInteger(pick)).toBe(true);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(PORTAL_SIGILS.length);
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    expect(new Set(picks).size).toBe(PORTAL_SIGILS.length);
  });

  it('setzt jede Sigille ganz auf die Stirnseite eines Pfeilers oder des Sturzes, vorn und hinten', () => {
    const mesh = new Mesh(createPortalFrameGeometry(), new MeshBasicMaterial({ side: DoubleSide }));
    const raycaster = new Raycaster();
    const half = 0.46 * SIGIL_LAYOUT.size;
    for (const { x, y } of frameSigilCells()) {
      for (const [dx, dy] of [[-half, -half], [half, -half], [-half, half], [half, half], [0, 0]]) {
        for (const side of [1, -1]) {
          raycaster.set(new Vector3(x + dx, y + dy, 30 * side), new Vector3(0, 0, -side));
          const hit = raycaster.intersectObject(mesh)[0];
          expect(hit, `Zelle bei (${x}, ${y})`).toBeDefined();
          expect(hit.face!.normal.z * side).toBeGreaterThan(0.6);
        }
      }
    }
  });

  it('erzeugt je Sigille einen Zweig im Shader und dieselbe Auswahl', () => {
    expect(PORTAL_SIGIL_GLSL.match(/index < /g)).toHaveLength(PORTAL_SIGILS.length - 1);
    expect(PORTAL_SIGIL_GLSL).toContain(
      `mod(cell * ${SIGIL_STRIDE.toFixed(4)}, ${PORTAL_SIGILS.length.toFixed(4)})`,
    );
    expect(PORTAL_SIGIL_GLSL).not.toContain('NaN');
  });
});
