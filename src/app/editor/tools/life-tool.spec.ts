import { describe, expect, it } from 'vitest';
import { createMapDocument } from '../../world/custom-map/map-create';
import type { MapLifeArea } from '../../world/custom-map/map-document';
import { CatalogIndex } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt } from '../model/grid';
import type { EditorOverlay } from '../view/editor-overlay';
import { LifeTool, pickArea } from './life-tool';
import { defaultSettings, type ToolContext, type ToolPointer } from './tool';

function context(editor: EditorDocument): ToolContext & { messages: string[]; drawn: () => readonly MapLifeArea[] | null } {
  const messages: string[] = [];
  let drawn: readonly MapLifeArea[] | null = null;
  const overlay = { setDraft: () => undefined, setLife: (areas: readonly MapLifeArea[] | null) => (drawn = areas) } as unknown as EditorOverlay;
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
    settingsChanged: () => undefined,
    setBox: () => undefined,
    boxToMap: () => null,
    pickGizmo: () => null,
    metresPerPixel: () => 0.2,
    toScreen: () => null,
    setLasso: () => undefined,
    objectVisible: () => true,
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

function tap(tool: LifeTool, ctx: ToolContext, x: number, y: number): void {
  const p = at(x, y);
  tool.pointerDown(p, ctx);
  tool.pointerUp(p, ctx);
}

describe('life tool', () => {
  it('clicks an outline closed with Enter: a new area of the chosen kind, one step, shown and chosen', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new LifeTool();
    tool.activate(ctx);
    ctx.settings.life.kind = 'fireflies';
    for (const [x, y] of [[0, 0], [60, 0], [60, 40], [0, 40]]) tap(tool, ctx, x, y);
    expect(ed.doc.life).toBeUndefined();
    tool.key(key('Enter'), ctx);
    expect(ed.doc.life?.areas).toEqual([{ id: 'fireflies-1', kind: 'fireflies', shape: 'area', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }] }]);
    expect(ed.historySteps).toBe(1);
    expect(ctx.settings.life.chosen).toBe('fireflies-1');
    tool.frame(0, null, ctx);
    expect(ctx.drawn()).toHaveLength(1);
    ed.undo();
    expect(ed.doc.life).toBeUndefined();
    tool.frame(0, null, ctx);
    expect(ctx.drawn()).toEqual([]);
  });

  it('draws the images of a new area and line under symmetry, in the same step', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new LifeTool();
    tool.activate(ctx);
    ctx.settings.symmetry = 'x';
    ctx.settings.life.kind = 'fog';
    for (const [x, y] of [[20, 0], [60, 0], [60, 40]]) tap(tool, ctx, x, y);
    tool.key(key('Enter'), ctx);
    expect(ed.doc.life?.areas?.map((a) => [a.id, a.points])).toEqual([
      ['fog-1', [{ x: 20, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }]],
      // Mirrored: runs backwards
      ['fog-2', [{ x: -60, y: 40 }, { x: -60, y: 0 }, { x: -20, y: 0 }]],
    ]);
    expect(ed.historySteps).toBe(1);
    expect(ctx.settings.life.chosen).toBe('fog-1');
    // An outline around the axis is its own image: no copy
    for (const [x, y] of [[-30, -80], [30, -80], [30, -40], [-30, -40]]) tap(tool, ctx, x, y);
    tool.key(key('Enter'), ctx);
    expect(ed.doc.life?.areas).toHaveLength(3);
    ed.undo();
    ed.undo();
    expect(ed.doc.life).toBeUndefined();
  });

  it('paints an outline freehand while held and draws a line for a route', () => {
    const ed = fresh();
    const ctx = context(ed);
    const tool = new LifeTool();
    tool.pointerDown(at(0, 0), ctx);
    for (let a = 0; a <= 12; a++) tool.pointerMove(at(Math.cos((a / 12) * Math.PI * 2) * 40 - 40, Math.sin((a / 12) * Math.PI * 2) * 40), ctx);
    tool.pointerUp(at(0, 0), ctx);
    const area = ed.doc.life!.areas![0];
    expect(area.shape).toBe('area');
    expect(area.points.length).toBeGreaterThan(8);
    ctx.settings.life.mode = 'route';
    ctx.settings.life.kind = 'sound';
    tap(tool, ctx, 100, 0);
    tap(tool, ctx, 150, 20);
    tool.pointerDown(at(150, 20, { button: 2 }), ctx);
    const route = ed.doc.life!.areas![1];
    expect(route).toMatchObject({ kind: 'sound', shape: 'route', sound: 'stream', points: [{ x: 100, y: 0 }, { x: 150, y: 20 }] });
    // Too little to be an outline: nothing, and the status says why
    ctx.settings.life.mode = 'area';
    tap(tool, ctx, 0, 0);
    tap(tool, ctx, 1, 0);
    tool.key(key('Enter'), ctx);
    expect(ed.doc.life!.areas).toHaveLength(2);
    expect(ctx.messages.at(-1)).toMatch(/three corners/);
  });

  it('edits: picks an area, drags a point as one step, adds and removes points, removes the area', () => {
    const ed = fresh();
    ed.doc.life = { areas: [{ id: 'b', kind: 'birds', shape: 'area', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }] }] };
    const ctx = context(ed);
    const tool = new LifeTool();
    ctx.settings.life.mode = 'edit';
    tap(tool, ctx, 20, 20);
    expect(ctx.settings.life.chosen).toBe('b');
    // Drag the corner at (50, 50)
    tool.pointerDown(at(50, 50), ctx);
    tool.pointerMove(at(70, 60), ctx);
    tool.pointerMove(at(80, 70), ctx);
    tool.pointerUp(at(80, 70), ctx);
    expect(ed.doc.life!.areas![0].points[2]).toEqual({ x: 80, y: 70 });
    expect(ed.historySteps).toBe(1);
    // Shift+click on the bottom edge adds a point after the first
    tool.pointerDown(at(25, 0, { shift: true }), ctx);
    expect(ed.doc.life!.areas![0].points).toHaveLength(5);
    expect(ed.doc.life!.areas![0].points[1]).toEqual({ x: 25, y: 0 });
    // Delete the chosen point, then (none chosen) the area
    tool.key(key('Delete'), ctx);
    expect(ed.doc.life!.areas![0].points).toHaveLength(4);
    tool.key(key('Delete'), ctx);
    expect(ed.doc.life!.areas).toEqual([]);
    expect(ctx.settings.life.chosen).toBeNull();
    ed.undo();
    ed.undo();
    ed.undo();
    expect(ed.doc.life!.areas![0].points[2]).toEqual({ x: 80, y: 70 });
    ed.undo();
    expect(ed.doc.life!.areas![0].points[2]).toEqual({ x: 50, y: 50 });
  });

  it('picks the smallest outline around a point, else a line near it', () => {
    const big: MapLifeArea = { id: 'big', kind: 'fog', shape: 'area', points: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }] };
    const small: MapLifeArea = { id: 'small', kind: 'fog', shape: 'area', points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }] };
    const line: MapLifeArea = { id: 'line', kind: 'birds', shape: 'route', points: [{ x: 150, y: 0 }, { x: 150, y: 50 }] };
    expect(pickArea([big, small, line], { x: 0, y: 0 }, 5)?.id).toBe('small');
    expect(pickArea([big, small, line], { x: 50, y: 0 }, 5)?.id).toBe('big');
    expect(pickArea([big, small, line], { x: 153, y: 20 }, 5)?.id).toBe('line');
    expect(pickArea([big, small, line], { x: 170, y: 20 }, 5)).toBeNull();
  });
});
