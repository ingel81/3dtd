/**
 * The ground layers as undoable steps: add, change, remove and move a layer,
 * auto paint, the cliff material. Each runs as one step and returns it. The
 * terrain stays the same object (GroundCommand), so the renderer only reloads
 * the layers.
 */
import { fitSplatMaps, type MapTerrain } from '../../world/custom-map/map-document';
import type { EditCommand } from '../model/doc-change';
import type { EditorDocument } from '../model/editor-document';
import { autoPaint, defaultAutoRules, moveLayer, removeLayer, type AutoPaintRule } from '../../map-ops/paint-ops';

/** The ground (layers, splat maps, cliff) changed by `edit` as one step */
function groundEdit(editor: EditorDocument, label: string, edit: (t: MapTerrain) => void): EditCommand | null {
  const r = editor.doc.terrain.splat.resolution - 1;
  return editor.transact(label, ['ground'], (doc) => edit(doc.terrain), { layers: true, splat: { i0: 0, j0: 0, i1: r, j1: r } });
}

/** Layer list, auto paint and cliff as undoable steps; the terrain stays the same object */
export const paintCommands = {
  addLayer(editor: EditorDocument, material: string): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.addLayer, (t) => {
      t.layers.push({ material });
      fitSplatMaps(t);
    });
  },
  setMaterial(editor: EditorDocument, index: number, material: string): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.changeMaterial, (t) => (t.layers[index] = { ...t.layers[index], material }));
  },
  setScale(editor: EditorDocument, index: number, scale: number | undefined): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.textureSize, (t) => {
      const layer = { ...t.layers[index] };
      if (scale && scale > 0) layer.scale = scale;
      else delete layer.scale;
      t.layers[index] = layer;
    });
  },
  removeLayer(editor: EditorDocument, index: number): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.removeLayer, (t) => removeLayer(t, index));
  },
  moveLayer(editor: EditorDocument, from: number, to: number): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.moveLayer, (t) => moveLayer(t, from, to));
  },
  autoPaint(editor: EditorDocument, rules?: AutoPaintRule[]): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.autoPaint, (t) => autoPaint(t, rules ?? defaultAutoRules(t)));
  },
  setCliff(editor: EditorDocument, material: string, angle: number): EditCommand | null {
    return groundEdit(editor, editor.words().editor.ground.cliffMaterial, (t) => {
      t.cliffMaterial = material;
      t.cliffAngle = angle;
    });
  },
};
