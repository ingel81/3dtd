/**
 * Water and rivers as undoable steps: the bodies, their levels, kinds and
 * masks (WaterStateCommand), a river moved or taken off with its bed.
 */
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { MapRiver, MapTerrain, MapWater, MapWaterKind } from '../../world/custom-map/map-document';
import type { EditCommand, EditorDocument } from '../model/editor-document';
import { RiverListCommand, WaterStateCommand, setWaterState, waterState } from '../model/commands/terrain';
import { BODY_COLORS, emptyWater, fillFromEdge, waterBody } from '../../map-ops/water-ops';
import { LandscapeStroke } from './landscape/landscape-stroke';
import { moveRiverBed, removeRiver } from './landscape/river';

const ADD_LABELS: Record<MapWaterKind, string> = { water: 'Add lake', sea: 'Add sea', swamp: 'Add swamp', ice: 'Add ice', lava: 'Add lava' };

/** Changes all water in place and records it as one step */
export function recordWater(editor: EditorDocument, label: string, edit: (t: MapTerrain) => void): EditCommand {
  const t = editor.doc.terrain;
  const before = waterState(t);
  edit(t);
  const after = waterState(t);
  setWaterState(t, before);
  return new WaterStateCommand(label, before, after);
}

export const waterCommands = {
  enable(editor: EditorDocument, level: number): EditCommand {
    return recordWater(editor, 'Add water', (t) => (t.water = emptyWater(t, level)));
  },
  remove(editor: EditorDocument, body = -1): EditCommand {
    return recordWater(editor, body < 0 ? 'Remove water' : 'Remove body', (t) => {
      if (body < 0) t.water = null;
      else t.waterBodies?.splice(body, 1);
    });
  },
  /** A new, empty body of a kind; its level comes with its first fill */
  addBody(editor: EditorDocument, kind: MapWaterKind, level: number): EditCommand {
    return recordWater(editor, ADD_LABELS[kind], (t) => {
      const body: MapWater = { ...emptyWater(t, level), color: BODY_COLORS[kind], kind };
      t.waterBodies = [...(t.waterBodies ?? []), body];
    });
  },
  set(editor: EditorDocument, body: number, patch: Partial<Pick<MapWater, 'level' | 'color' | 'kind'>>, label: string): EditCommand {
    return recordWater(editor, label, (t) => {
      const w = waterBody(t, body);
      if (!w) return;
      const oldKind = w.kind ?? 'water';
      Object.assign(w, patch);
      // A body that kept its kind's colour takes the new kind's
      if (patch.kind && !patch.color && w.color === BODY_COLORS[oldKind]) w.color = BODY_COLORS[patch.kind];
    });
  },
  /** The body floods in from the map's edge over everything below its level: a sea or a coast */
  sea(editor: EditorDocument, body: number): EditCommand {
    return recordWater(editor, 'Sea from the edge', (t) => {
      if (body < 0 && !t.water) t.water = emptyWater(t, 0);
      fillFromEdge(t, body);
    });
  },
  clearMask(editor: EditorDocument, body: number): EditCommand {
    return recordWater(editor, 'Clear water', (t) => waterBody(t, body)?.mask.fill(0));
  },
};

/** Takes a river off the map with its bed filled, as one undo step */
export function removeWholeRiver(editor: EditorDocument, index: number, catalog: CatalogIndex): void {
  const stroke = new LandscapeStroke(editor, 'Remove river', 1, catalog);
  removeRiver(stroke, index);
  stroke.finish();
}

/**
 * A river reshaped in place (`rivers` hold the new shape, `before` the old
 * list): its bed moves with it, the old one filled, the new one carved
 * (moveRiverBed), as one undo step with the river list
 */
export function relayRiver(editor: EditorDocument, catalog: CatalogIndex, label: string, index: number, before: MapRiver[] | undefined): void {
  const t = editor.doc.terrain;
  const after = t.rivers;
  t.rivers = before ? structuredClone(before) : undefined;
  const stroke = new LandscapeStroke(editor, label, 1, catalog);
  stroke.markRivers();
  t.rivers = after;
  const old = before?.[index];
  const now = after?.[index];
  if (old && now) moveRiverBed(stroke, old, now);
  else stroke.changed({ water: true });
  stroke.finish();
}

export function riverEdit(editor: EditorDocument, label: string, edit: (rivers: MapRiver[]) => void): EditCommand {
  const t = editor.doc.terrain;
  const before = t.rivers ? structuredClone(t.rivers) : undefined;
  const list = structuredClone(t.rivers ?? []);
  edit(list);
  return new RiverListCommand(label, before, list.length ? list : undefined);
}
