import { describe, it, expect } from 'vitest';
import { PORTAL_MASONRY, PORTAL_STONE_GLSL, type MasonryBand } from './spawn-portal-stone';
import { SIGIL_LAYOUT, frameSigilCells } from './spawn-portal-sigils';

/** Band the height y lies in. */
function bandAt(y: number): MasonryBand {
  return PORTAL_MASONRY.find((band) => y < band.below)!;
}

describe('Portal-Stein: Quader und Fugen', () => {
  it('teilt den Rahmen von unten nach oben in Bänder, das letzte bis zur Spitze', () => {
    for (let i = 1; i < PORTAL_MASONRY.length; i++) {
      expect(PORTAL_MASONRY[i].below).toBeGreaterThan(PORTAL_MASONRY[i - 1].below);
    }
    expect(PORTAL_MASONRY[PORTAL_MASONRY.length - 1].below).toBe(Infinity);
    for (const band of PORTAL_MASONRY) {
      expect(band.course).toBeGreaterThanOrEqual(0);
      expect(band.front).toBeGreaterThanOrEqual(0);
      expect(band.side).toBeGreaterThanOrEqual(0);
    }
  });

  it('lässt keine Fuge durch ein Siegel laufen, mit 5 cm Abstand', () => {
    // Siegel sitzen auf den Stirnseiten: waagerechte Fugen aus den Lagen,
    // senkrechte aus der Blocklänge vorn (front)
    const half = SIGIL_LAYOUT.size / 2 + 0.05;
    for (const { x, y } of frameSigilCells()) {
      const band = bandAt(y);
      const index = PORTAL_MASONRY.indexOf(band);
      const floor = index === 0 ? -Infinity : PORTAL_MASONRY[index - 1].below;
      expect(y - half, `Siegel bei (${x}, ${y})`).toBeGreaterThanOrEqual(floor);
      expect(y + half).toBeLessThanOrEqual(band.below);

      let course = 0;
      if (band.course > 0) {
        course = Math.floor((y - band.courseOrigin) / band.course);
        expect(Math.floor((y - half - band.courseOrigin) / band.course)).toBe(course);
        expect(Math.floor((y + half - band.courseOrigin) / band.course)).toBe(course);
      }
      if (band.front > 0) {
        const shift = band.bond ? 0.5 * (((course % 2) + 2) % 2) : 0;
        const block = (u: number) => Math.floor((u - band.blockOrigin) / band.front + shift);
        expect(block(x - half)).toBe(block(x + half));
      }
    }
  });

  it('erzeugt je Band einen Zweig im Shader', () => {
    expect(PORTAL_STONE_GLSL.match(/if \(y < /g)).toHaveLength(PORTAL_MASONRY.length - 1);
    for (const band of PORTAL_MASONRY) expect(PORTAL_STONE_GLSL).toContain(`// ${band.name}`);
    expect(PORTAL_STONE_GLSL).not.toContain('NaN');
    expect(PORTAL_STONE_GLSL).not.toContain('Infinity');
  });
});
