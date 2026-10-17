/**
 * The ground layers as undoable steps: add, change, remove and move a layer,
 * auto paint, the cliff material. The terrain stays the same object
 * (GroundCommand), so the renderer only reloads the layers.
 */
import { fitSplatMaps } from '../../world/custom-map/map-document';
import type { EditCommand, EditorDocument } from '../model/editor-document';
import { GroundCommand } from '../model/commands/terrain';
import { autoPaint, defaultAutoRules, moveLayer, removeLayer, type AutoPaintRule } from '../../map-ops/paint-ops';

/** Layer list, auto paint and cliff as undoable steps; the terrain stays the same object */
export const paintCommands = {
  addLayer(editor: EditorDocument, material: string): EditCommand {
    return GroundCommand.record(editor, 'Add layer', (t) => {
      t.layers.push({ material });
      fitSplatMaps(t);
    });
  },
  setMaterial(editor: EditorDocument, index: number, material: string): EditCommand {
    return GroundCommand.record(editor, 'Change material', (t) => (t.layers[index] = { ...t.layers[index], material }));
  },
  setScale(editor: EditorDocument, index: number, scale: number | undefined): EditCommand {
    return GroundCommand.record(editor, 'Texture size', (t) => {
      const layer = { ...t.layers[index] };
      if (scale && scale > 0) layer.scale = scale;
      else delete layer.scale;
      t.layers[index] = layer;
    });
  },
  removeLayer(editor: EditorDocument, index: number): EditCommand {
    return GroundCommand.record(editor, 'Remove layer', (t) => removeLayer(t, index));
  },
  moveLayer(editor: EditorDocument, from: number, to: number): EditCommand {
    return GroundCommand.record(editor, 'Move layer', (t) => moveLayer(t, from, to));
  },
  autoPaint(editor: EditorDocument, rules?: AutoPaintRule[]): EditCommand {
    return GroundCommand.record(editor, 'Auto paint', (t) => autoPaint(t, rules ?? defaultAutoRules(t)));
  },
  setCliff(editor: EditorDocument, material: string, angle: number): EditCommand {
    return GroundCommand.record(editor, 'Cliff material', (t) => {
      t.cliffMaterial = material;
      t.cliffAngle = angle;
    });
  },
};
