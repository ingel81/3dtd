import { Line } from 'three';
import { EditorOverlay, drapedLine } from './editor-overlay';

/** A hill 12 m high between x = 20 and 60, on flat ground elsewhere */
const hill = (x: number): number => 12 * Math.max(0, 1 - ((x - 40) / 20) ** 2);

describe('drapedLine', () => {
  /**
   * Custom maps, Ember Crater (TODO E160): a road whose points lie far
   * apart was drawn straight between them and cut through the hill it
   * crosses.
   */
  it('lays a long straight piece over the hill it crosses, in steps of 2 m', () => {
    const pos = drapedLine([{ x: 0, y: 5 }, { x: 80, y: 5 }], hill, 1.5);
    expect(pos.length / 3).toBe(41);
    for (let i = 0; i < pos.length; i += 3) {
      // Scene x is map -x, scene z map y
      expect(pos[i + 1]).toBeCloseTo(hill(-pos[i]) + 1.5, 5);
      expect(pos[i + 2]).toBe(5);
    }
    expect(Math.max(...pos.filter((_, i) => i % 3 === 1))).toBeCloseTo(13.5, 5);
  });

  it('keeps every given point and a single point', () => {
    const pos = drapedLine([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 }], () => 0, 0);
    expect(Array.from(pos)).toEqual([-0, 0, 0, -1, 0, 0, -1, 0, 1.5, -1, 0, 3]);
    expect(Array.from(drapedLine([{ x: 2, y: 3 }], () => 1, 0))).toEqual([-2, 1, 3]);
  });
});

describe('EditorOverlay routes', () => {
  /** TODO E161: the route over a bridge lies on its deck, not on the river bed under it */
  it('draws a route on the walking height: over a bridge deck, on the ground elsewhere', () => {
    const ground = (x: number) => (x > 30 && x < 50 ? -4 : 0);
    const deck = (x: number, y: number) => (x > 28 && x < 52 && Math.abs(y) < 4 ? 2 : ground(x));
    const overlay = new EditorOverlay(ground, deck);
    overlay.setRoutes([{ points: [{ x: 0, y: 0 }, { x: 80, y: 0 }], length: 80, startGap: 0, endGap: 0 }]);
    const line = overlay.group.getObjectsByProperty('type', 'Line').find((l) => (l as Line).renderOrder === 9) as Line;
    const pos = line.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = -pos.getX(i);
      expect(pos.getY(i), `x ${x}`).toBeCloseTo(deck(x, 0) + 1.6, 5);
    }
    overlay.dispose();
  });
});

describe('EditorOverlay height lines', () => {
  /** 14bf17ea put the hover ring in the place of the height lines in the overlay's group: they never showed */
  it('shows the height lines in the scene', () => {
    const overlay = new EditorOverlay(() => 0);
    overlay.setContours({ minor: new Float32Array([0, 0, 5, 10, 0, 5]), major: new Float32Array(0) });
    expect(overlay.group.getObjectsByProperty('type', 'LineSegments')).toHaveLength(1);
  });
});
