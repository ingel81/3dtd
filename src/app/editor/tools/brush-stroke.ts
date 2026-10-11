/**
 * A stroke of a painting tool: from pointer down to pointer up, every frame
 * a dab at the pointer, written straight into the map's arrays. The tiles a
 * dab reaches are saved first; at the end the stroke becomes one undo step.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { PatchCommand, patchArray, patchLayout, type DocChange, type EditorDocument, type PatchTarget } from '../model/editor-document';
import { rectUnion, type GridRect } from '../model/grid';
import { RegionRecorder, type PatchArray } from '../model/region-patch';

export class BrushStroke {
  private readonly recorders = new Map<PatchTarget, RegionRecorder<PatchArray>>();
  private change: DocChange = {};

  constructor(
    private readonly editor: EditorDocument,
    private readonly label: string,
    targets: readonly PatchTarget[],
  ) {
    const doc = editor.doc;
    for (const t of targets) this.recorders.set(t, new RegionRecorder(patchArray(doc, t), patchLayout(doc, t)));
  }

  get doc(): CustomMapDocument {
    return this.editor.doc;
  }

  /** Save what `rect` covers in the targets before a dab writes there */
  touch(target: PatchTarget, rect: GridRect): void {
    this.recorders.get(target)?.touch(rect);
  }

  /** Tell the view about a dab */
  changed(change: DocChange): void {
    this.change = {
      ...this.change,
      ...change,
      heights: rectUnion(this.change.heights ?? null, change.heights ?? null) ?? undefined,
      splat: rectUnion(this.change.splat ?? null, change.splat ?? null) ?? undefined,
    };
    this.editor.emit(change);
  }

  /** The stroke as one undo step; nothing when it changed nothing */
  finish(): PatchCommand | null {
    const parts = [...this.recorders].map(([target, rec]) => ({ target, patches: rec.finish() }));
    const command = new PatchCommand(this.label, parts);
    if (command.empty) return null;
    this.editor.push(command);
    return command;
  }
}
