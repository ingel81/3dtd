/**
 * A stroke of a painting tool: from pointer down to pointer up, every frame
 * a dab at the pointer, written straight into the map's arrays. The tiles a
 * dab reaches are saved first; at the end the stroke becomes one undo step.
 */
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';
import { mirrorChange, type SymmetryMode } from '../ops/symmetry';
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
    /** Copy every dab to its symmetric images */
    private readonly symmetry: SymmetryMode = 'none',
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

  /** Save what `rect` covers in every splat map the stroke records */
  touchSplat(rect: GridRect): void {
    for (const [target, recorder] of this.recorders) if (target.startsWith('splat')) recorder.touch(rect);
  }

  /** Tell the view about a dab; with the pointer's position the dab is copied to its symmetric images */
  changed(dab: DocChange, center?: MapPoint, waterRect?: GridRect): void {
    const change =
      center && this.symmetry !== 'none'
        ? mirrorChange(this.doc, this.symmetry, center, dab, {
            heights: (r) => this.touch('heights', r),
            splat: (r) => this.touchSplat(r),
            water: this.recorders.has('water') ? (r) => this.touch('water', r) : undefined,
            bodies: [...this.recorders.keys()].filter((k) => k.startsWith('body')).map((k) => Number(k.slice(4))),
            body: (index, r) => this.touch(`body${index}`, r),
          }, waterRect)
        : dab;
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
