import { InstancedMesh, Line, LineSegments, Matrix4, SphereGeometry, Vector3 } from 'three';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { EditorOverlay } from './editor-overlay';
import { drapedLine } from './overlay/draping';
import { ToolOverlay } from './overlay/tool-overlay';

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
    overlay.routes.set([{ points: [{ x: 0, y: 0 }, { x: 80, y: 0 }], length: 80, startGap: 0, endGap: 0 }]);
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
    overlay.contours.set({ minor: new Float32Array([0, 0, 5, 10, 0, 5]), major: new Float32Array(0) });
    expect(overlay.group.getObjectsByProperty('type', 'LineSegments')).toHaveLength(1);
  });
});

describe('EditorOverlay road nodes', () => {
  /** TODO E200: on an OSM map some 2000 nodes grew with the view distance in Look and covered the map */
  it('draws nodes as small dots outside the Paths tool, as growing handles in it, a selected one always as a handle', () => {
    const overlay = new EditorOverlay(() => 0);
    const doc = {
      spawns: [],
      hq: { x: 0, y: 0 },
      paths: {
        nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 50, y: 0 }],
        edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road' }],
      },
    } as unknown as CustomMapDocument;
    overlay.markers.set(doc, { kind: 'node', id: 'b' });
    overlay.setViewDistance(2200);
    // One set of plain nodes (a), one of chosen ones (b)
    const sets = overlay.group.getObjectsByProperty('renderOrder', 11).filter((o) => o instanceof InstancedMesh) as InstancedMesh[];
    const scales = () => sets.map((set) => {
      const m = new Matrix4();
      set.getMatrixAt(0, m);
      return Math.round(m.elements[0] * 100) / 100;
    });
    expect(scales()).toEqual([0.6, 18]);

    overlay.markers.setNodeHandles(true);
    expect(scales()).toEqual([18, 18]);
    overlay.markers.setNodeHandles(false);
    expect(scales()[0]).toBe(0.6);
    overlay.dispose();
  });
});

describe('EditorOverlay on moving ground', () => {
  it('lays markers, nodes, roads, selection and routes on new heights without building them anew', () => {
    let lift = 0;
    const ground = (x: number) => lift + x * 0.1;
    const overlay = new EditorOverlay(ground);
    const doc = {
      spawns: [{ id: 's', name: 'S', x: 10, y: 0 }],
      hq: { x: 60, y: 0 },
      objects: [],
      paths: {
        nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 50, y: 0 }, { id: 'c', x: 50, y: 30 }],
        edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road' }, { id: 'f', a: 'b', b: 'c', width: 6, kind: 'road' }],
      },
    } as unknown as CustomMapDocument;
    overlay.markers.set(doc, { kind: 'edge', id: 'e' });
    overlay.selection.set(doc, { kind: 'edge', id: 'e' }, () => 1);
    overlay.routes.set([{ points: [{ x: 10, y: 0 }, { x: 60, y: 0 }], length: 50, startGap: 0, endGap: 0 }]);
    const before = overlay.group.children.map((c) => c.children.length);
    lift = 5;
    overlay.redrape();
    expect(overlay.group.children.map((c) => c.children.length)).toEqual(before);
    const fresh = new EditorOverlay(ground);
    fresh.markers.set(doc, { kind: 'edge', id: 'e' });
    fresh.selection.set(doc, { kind: 'edge', id: 'e' }, () => 1);
    fresh.routes.set([{ points: [{ x: 10, y: 0 }, { x: 60, y: 0 }], length: 50, startGap: 0, endGap: 0 }]);
    const heights = (o: EditorOverlay) => {
      const out: number[] = [];
      o.group.traverse((c) => {
        if (c instanceof Line || c instanceof LineSegments) {
          const pos = c.geometry.getAttribute('position');
          if (pos) for (let k = 0; k < pos.count; k++) out.push(Math.round(pos.getY(k) * 1e4) / 1e4);
        } else if (c instanceof InstancedMesh && c.renderOrder === 11) {
          const m = new Matrix4();
          for (let k = 0; k < c.count; k++) {
            c.getMatrixAt(k, m);
            out.push(Math.round(m.elements[13] * 1e4) / 1e4);
          }
        } else if (c.parent?.parent === o.group && c.userData['pick']) {
          out.push(c.position.y);
        }
      });
      return out;
    };
    expect(heights(overlay)).toEqual(heights(fresh));
    overlay.dispose();
    fresh.dispose();
  });
});

describe('ToolOverlay', () => {
  /** M6: a tool that forgot to clean up left its lines to the next one; the switch empties every tool layer */
  it('hides everything a tool drew in one clear', () => {
    const overlay = new ToolOverlay(() => 0, new SphereGeometry());
    const line = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
    overlay.draft.set(line);
    overlay.hover.set({ x: 0, y: 0 }, 3);
    overlay.preview.set(line);
    overlay.measure.set(line);
    overlay.gizmo.ring.set({ x: 0, y: 0 }, 5);
    overlay.gizmo.handles.place(new Vector3(), 0, 1);
    overlay.rivers.set([{ id: 'r', kind: 'water', points: [{ x: 0, y: 0, height: 1, width: 6 }, { x: 20, y: 0, height: 1, width: 6 }] }], null);
    overlay.life.set([{ id: 'a', kind: 'birds', shape: 'area', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }], 'a', 0);
    const shown = () => [
      overlay.draft.line.visible,
      overlay.hover.loop.visible,
      overlay.preview.dots.count > 0,
      overlay.measure.line.visible,
      overlay.gizmo.ring.loop.visible,
      overlay.gizmo.handles.group.visible,
      overlay.rivers.handles.visible,
      overlay.life.lines.children.length > 0,
      overlay.life.handles.count > 0,
    ];
    expect(shown()).toEqual(Array(9).fill(true));
    overlay.clear();
    expect(shown()).toEqual(Array(9).fill(false));
    overlay.dispose();
  });
});
