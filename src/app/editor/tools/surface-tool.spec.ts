import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../world/custom-map/map-create';
import { CatalogIndex } from '../../map-ops/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../../map-ops/grid';
import { SphereGeometry } from 'three';
import { ToolOverlay, type OverlayShape } from '../view/overlay/tool-overlay';
import { markingCorners } from '../ops/surfaces';
import { pickSurface, SurfaceTool } from './surface-tool';
import { patch, defaultSettings, type ToolContext, type ToolPointer } from './tool';
import { en } from '../../i18n/messages/en';

function context(editor: EditorDocument): ToolContext & { messages: string[]; drawn: () => readonly OverlayShape[] | null } {
  const messages: string[] = [];
  let drawn: readonly OverlayShape[] | null = null;
  const overlay = new ToolOverlay((x, y) => heightAt(editor.doc.terrain, x, y), new SphereGeometry());
  const set = overlay.shapes.set.bind(overlay.shapes);
  overlay.shapes.set = (shapes, chosen, point) => set((drawn = shapes), chosen, point);
  return {
    editor,
    settings: defaultSettings(),
    catalog: new CatalogIndex({ materials: [], objects: [] }),
    overlay,
    messages,
    drawn: () => drawn,
    heightAt: (x, y) => heightAt(editor.doc.terrain, x, y),
    pick: () => null,
    status: (m) => messages.push(m),
    hintChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
    pickGizmo: () => null,
    metresPerPixel: () => 0.2,
    toScreen: () => null,
    setLasso: () => undefined,
    objectVisible: () => true,
    t: () => en,
  };
}

let click = 0;
/** A pointer at a map point; each one somewhere else on the screen, so no two make a double click */
const at = (x: number, y: number, extra: Partial<ToolPointer> = {}): ToolPointer => ({
  hit: { x, y, z: 0 },
  clientX: (click += 50),
  clientY: 0,
  button: 0,
  shift: false,
  ctrl: false,
  alt: false,
  ...extra,
});

const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as KeyboardEvent;

function fresh(): EditorDocument {
  return new EditorDocument(createMapDocument({ id: 'm', name: 'M', width: 400, depth: 400, cellSize: 4 }));
}

function tap(tool: SurfaceTool, ctx: ToolContext, x: number, y: number): void {
  const p = at(x, y);
  tool.pointerDown(p, ctx);
  tool.pointerUp(p, ctx);
}

describe('surface tool', () => {
  it('clicks an outline closed: a surface of the chosen material with its lines fitted, one step, chosen and shown with its marking', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new SurfaceTool();
    tool.activate(ctx);
    patch(ctx.settings.surfaces, { material: 'red-earth', marking: 'tennis' });
    for (const [x, y] of [[0, 0], [36, 0], [36, 18], [0, 18]]) tap(tool, ctx, x, y);
    tool.key(key('Enter'), ctx);
    const s = ed.doc.surfaces![0];
    expect(s).toMatchObject({ id: 'surface-1', material: 'red-earth', outer: [{ x: 0, y: 0 }, { x: 36, y: 0 }, { x: 36, y: 18 }, { x: 0, y: 18 }] });
    expect(s.marking).toMatchObject({ kind: 'tennis', x: 18, y: 9, length: 36, width: 18 });
    expect(ed.historySteps).toBe(1);
    expect(ctx.settings.surfaces().chosen).toBe('surface-1');
    tool.frame(0, null, ctx);
    // The outline, then the chosen one's marking
    expect(ctx.drawn()!.map((d) => d.id)).toEqual(['surface-1', 'surface-1']);
    ed.undo();
    expect(ed.doc.surfaces).toBeUndefined();
  });

  it('drags a corner (the lines fit again), pulls the marking by a corner, removes a corner and the surface', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new SurfaceTool();
    tool.activate(ctx);
    patch(ctx.settings.surfaces, { material: 'asphalt', marking: 'parking' });
    for (const [x, y] of [[0, 0], [40, 0], [40, 20], [0, 20]]) tap(tool, ctx, x, y);
    tool.key(key('Enter'), ctx);
    patch(ctx.settings.surfaces, { mode: 'edit' });
    // Drag the corner at (40, 20) to (60, 20)
    tool.pointerDown(at(40, 20), ctx);
    tool.pointerMove(at(60, 20), ctx);
    tool.pointerUp(at(60, 20), ctx);
    const s = ed.doc.surfaces![0];
    expect(s.outer[2]).toEqual({ x: 60, y: 20 });
    expect(s.marking!.length).toBeGreaterThan(40);
    expect(ed.historySteps).toBe(2);
    // Pull the marking's corner: the opposite one stays
    const corners = markingCorners(s.marking!);
    const far = corners.reduce((best, c) => (c.x + c.y > best.x + best.y ? c : best));
    const k = corners.indexOf(far);
    const opposite = corners[(k + 2) % 4];
    tool.pointerDown(at(far.x, far.y), ctx);
    tool.pointerMove(at(far.x - 10, far.y - 4), ctx);
    tool.pointerUp(at(far.x - 10, far.y - 4), ctx);
    const after = markingCorners(ed.doc.surfaces![0].marking!);
    expect(after.some((c) => Math.hypot(c.x - opposite.x, c.y - opposite.y) < 0.05)).toBe(true);
    expect(ed.historySteps).toBe(3);
    // Delete with a corner chosen removes it, then the surface
    tool.pointerDown(at(0, 0), ctx);
    tool.pointerUp(at(0, 0), ctx);
    tool.key(key('Delete'), ctx);
    expect(ed.doc.surfaces![0].outer).toHaveLength(3);
    tool.key(key('Delete'), ctx);
    expect(ed.doc.surfaces).toBeUndefined();
  });

  it('draws the images of a new surface under symmetry, in the same step, its lines turned with them', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new SurfaceTool();
    tool.activate(ctx);
    ctx.settings.symmetry.set('x');
    patch(ctx.settings.surfaces, { marking: 'soccer', material: 'grass-lush' });
    for (const [x, y] of [[20, 0], [120, 0], [120, 60], [20, 60]]) tap(tool, ctx, x, y);
    tool.key(key('Enter'), ctx);
    const [a, b] = ed.doc.surfaces!;
    expect(b.outer.map((p) => p.x).sort((p, q) => p - q)).toEqual([-120, -120, -20, -20]);
    expect(b.marking).toMatchObject({ kind: 'soccer', x: -70, y: 30, length: a.marking!.length, width: a.marking!.width });
    expect(ed.historySteps).toBe(1);
  });

  it('picks the smallest surface under a point', () => {
    const big = { id: 'big', material: 'paving', outer: [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }] };
    const small = { id: 'small', material: 'sand', outer: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }] };
    expect(pickSurface([big, small], { x: 0, y: 0 })?.id).toBe('small');
    expect(pickSurface([big, small], { x: 20, y: 0 })?.id).toBe('big');
    expect(pickSurface([big, small], { x: 80, y: 0 })).toBeNull();
  });
});
