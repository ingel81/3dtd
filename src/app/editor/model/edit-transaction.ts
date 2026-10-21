/**
 * One undoable change of the map being made: a brush stroke from pointer
 * down to up, a landscape stroke, a terrain job, an agent's play, a panel's
 * edit. Every edit records the same way: it writes straight into the
 * document and tells the transaction first what it is about to change (the
 * tiles of an array, a part kept whole, objects added or taken away, a step
 * of its own already done). `commit` keeps it all as one step in the
 * history, `abort` writes everything back as it was and tells the view.
 *
 *   const tx = editor.begin('Raise');   // refused while the document is held
 *   tx.touch('heights', rect);          // before writing there
 *   ...write the heights...
 *   tx.changed({ heights: rect });      // the view redraws it
 *   tx.commit();                        // or tx.abort()
 */
import type { CustomMapDocument, MapCrater, MapGroundLayer, MapObject, MapRiver } from '../../world/custom-map/map-document';
import type { GridRect } from '../../map-ops/grid';
import { mergeChanges, type DocChange, type EditCommand } from './doc-change';
import type { EditorDocument } from './editor-document';
import { RegionRecorder, type PatchArray } from './region-patch';
import { CompoundCommand } from './commands/compound';
import { ObjectsCommand } from './commands/objects';
import { PatchCommand, patchArray, patchLayout, splatTargets, type PatchTarget } from './commands/patch';
import { SnapshotCommand, partsChange, type DocParts } from './commands/snapshot';
import { CraterListCommand, GroundCommand, LayerListCommand, RiverListCommand, WaterStateCommand, groundState, waterState, type GroundState, type WaterState } from './commands/terrain';

/**
 * What a transaction can keep whole before it changes it: a part of the
 * document, or of its terrain: the layer list, the ground (layers, splat
 * maps and cliff together), all water (bodies, levels, masks), the rivers,
 * the craters dug in the editor
 */
export type TxPart = keyof DocParts | 'layers' | 'ground' | 'water' | 'rivers' | 'craters';

interface TxBefore {
  layers: MapGroundLayer[];
  ground: GroundState;
  water: WaterState;
  rivers: { list: MapRiver[] | undefined };
  craters: { list: MapCrater[] | undefined };
}

export class EditTransaction {
  /** The arrays' tiles saved at their first touch, by target */
  private readonly recorders = new Map<PatchTarget, RegionRecorder<PatchArray>>();
  /** The parts of the document kept whole as they were */
  private readonly parts: Partial<DocParts> = {};
  private readonly partKeys: (keyof DocParts)[] = [];
  private readonly terrainParts: Partial<TxBefore> = {};
  /** Steps of their own the edit took already (a new water body), in order */
  private readonly included: EditCommand[] = [];
  /** Objects taken off the map, before any are added */
  private readonly removed: ObjectsCommand[] = [];
  /** Objects added to the end of the list */
  readonly added: MapObject[] = [];
  private reported: DocChange = {};
  private over = false;

  constructor(
    readonly editor: EditorDocument,
    readonly label: string,
  ) {}

  get doc(): CustomMapDocument {
    return this.editor.doc;
  }

  /** Whether it was kept or dropped already */
  get done(): boolean {
    return this.over;
  }

  /** Save what `rect` covers in `target` before writing there; a target the map has not (no water yet) records nothing */
  touch(target: PatchTarget, rect: GridRect): void {
    this.recorder(target)?.touch(rect);
  }

  /** Save what `rect` covers in every splat map the map has now */
  touchSplat(rect: GridRect): void {
    for (const target of splatTargets(this.doc)) this.touch(target, rect);
  }

  /** Records `target` from here on even before its first touch (its symmetric images copy with it) */
  record(target: PatchTarget): void {
    this.recorder(target);
  }

  /** Whether `target` is recorded (touched, or `record`) */
  recording(target: PatchTarget): boolean {
    return this.recorders.has(target);
  }

  /** The further water bodies whose masks are recorded, by index */
  get recordedBodies(): number[] {
    return [...this.recorders.keys()].filter((k) => k.startsWith('body')).map((k) => Number(k.slice(4)));
  }

  /** What element (i, j, channel) of `target` held before the transaction; the array's value where it is not recorded */
  original(target: PatchTarget, i: number, j: number, channel = 0): number {
    const recorder = this.recorders.get(target);
    if (recorder) return recorder.original(i, j, channel);
    const layout = patchLayout(this.doc, target);
    return patchArray(this.doc, target)[(j * layout.columns + i) * layout.channels + channel];
  }

  /** Keeps parts whole as they are now, before the edit changes them; a part kept already stays as it was first */
  snapshot(...parts: TxPart[]): void {
    const t = this.doc.terrain;
    for (const part of parts) {
      if (this.marked(part)) continue;
      switch (part) {
        case 'layers':
          this.terrainParts.layers = t.layers.map((l) => ({ ...l }));
          break;
        case 'ground':
          this.terrainParts.ground = groundState(t);
          break;
        case 'water':
          this.terrainParts.water = waterState(t);
          break;
        case 'rivers':
          this.terrainParts.rivers = { list: t.rivers ? structuredClone(t.rivers) : undefined };
          break;
        case 'craters':
          this.terrainParts.craters = { list: t.craters?.map((c) => ({ ...c })) };
          break;
        default:
          if (part === 'objects' && (this.added.length || this.removed.length)) throw new Error('Objects are kept whole or added and removed, not both');
          Object.assign(this.parts, SnapshotCommand.capture(this.doc, [part]));
          this.partKeys.push(part);
      }
    }
  }

  /** Whether `part` is kept whole */
  marked(part: TxPart): boolean {
    return part in this.terrainParts || this.partKeys.includes(part as keyof DocParts);
  }

  /** The layer list as the transaction found it (snapshot 'layers' first) */
  get layersBefore(): readonly MapGroundLayer[] {
    const layers = this.terrainParts.layers;
    if (!layers) throw new Error('The layers are not kept');
    return layers;
  }

  /** A step the edit took already on the map (a water body made); part of this one, undone with it */
  include(command: EditCommand): void {
    this.included.push(command);
  }

  /** Takes objects off the map, before any are added */
  removeObjects(ids: readonly string[]): void {
    if (!ids.length) return;
    if (this.added.length) throw new Error('Objects are removed before the transaction adds any');
    if (this.partKeys.includes('objects')) throw new Error('Objects are kept whole or added and removed, not both');
    const command = ObjectsCommand.remove(this.label, this.doc, ids);
    command.apply(this.doc);
    this.removed.push(command);
  }

  /** Puts objects at the end of the map's list */
  addObjects(objects: readonly MapObject[]): void {
    if (this.partKeys.includes('objects')) throw new Error('Objects are kept whole or added and removed, not both');
    for (const o of objects) {
      this.doc.objects.push(o);
      this.added.push(o);
    }
  }

  /** Tell the view about a change made now (a dab of a running stroke) */
  changed(change: DocChange): void {
    this.reported = mergeChanges(this.reported, change);
    this.editor.emit(change);
  }

  /** Everything told to the view so far */
  get changes(): DocChange {
    return this.reported;
  }

  /**
   * Keeps the transaction as one step (refused while the document is held:
   * the map goes back and EditorHeldError is thrown). `report` is what the
   * view hears with it, beyond what `changed` told it already, and what
   * the step holds is told with it too (`held`). Null when nothing changed.
   */
  commit(report: DocChange = {}): EditCommand | null {
    this.end();
    const command = this.build();
    if (command) this.editor.push(command, mergeChanges(report, this.held()));
    return command;
  }

  /**
   * What the step holds, whether the edit told it or not: the parts kept
   * whole (an edit may change them in place without a word: a road brush
   * that split a road and then found no road to draw) and the objects taken
   * away and added (a stroke tells the object it set, not its symmetric
   * images). What follows the document by its changes would miss them: the
   * worker's mirror, the view, the editor's count of object ids.
   */
  private held(): DocChange {
    const change = this.partKeys.length ? partsChange(this.partKeys) : {};
    const ids = [...this.removed.flatMap((c) => c.ids()), ...this.added.map((o) => o.id)];
    return ids.length ? mergeChanges(change, { objects: ids }) : change;
  }

  /** Writes everything back as it was before the transaction and tells the view */
  abort(): void {
    this.end();
    const command = this.build();
    if (command) this.editor.emit(command.revert(this.doc));
  }

  private end(): void {
    if (this.over) throw new Error(`${this.label} is over already`);
    this.over = true;
  }

  private recorder(target: PatchTarget): RegionRecorder<PatchArray> | null {
    let recorder = this.recorders.get(target);
    if (recorder) return recorder;
    const t = this.doc.terrain;
    if (target === 'water' ? !t.water : target.startsWith('body') && !t.waterBodies?.[Number(target.slice(4))]) return null;
    recorder = new RegionRecorder(patchArray(this.doc, target), patchLayout(this.doc, target));
    this.recorders.set(target, recorder);
    return recorder;
  }

  /**
   * The steps in the order they apply: what is kept whole first (it writes
   * all of its part), then the steps already taken, the tiles, the objects
   * taken away and those added. Undo runs it backwards.
   */
  private build(): EditCommand | null {
    const doc = this.doc;
    const t = doc.terrain;
    const label = this.label;
    const parts: EditCommand[] = [];
    if (this.partKeys.length) parts.push(new SnapshotCommand(label, this.parts, SnapshotCommand.capture(doc, this.partKeys)));
    const before = this.terrainParts;
    if (before.layers) {
      const after = t.layers.map((l) => ({ ...l }));
      // A longer list, or a layer that took over another material
      if (after.length !== before.layers.length || after.some((l, k) => l.material !== before.layers![k].material)) parts.push(new LayerListCommand(label, before.layers, after));
    }
    if (before.ground) parts.push(new GroundCommand(label, before.ground, groundState(t)));
    if (before.water) parts.push(new WaterStateCommand(label, before.water, waterState(t)));
    if (before.rivers) parts.push(new RiverListCommand(label, before.rivers.list, t.rivers ? structuredClone(t.rivers) : undefined));
    if (before.craters) parts.push(new CraterListCommand(label, before.craters.list, t.craters?.map((c) => ({ ...c }))));
    parts.push(...this.included);
    const patches = new PatchCommand(label, [...this.recorders].map(([target, recorder]) => ({ target, patches: recorder.finish() })));
    if (!patches.empty) parts.push(patches);
    parts.push(...this.removed);
    if (this.added.length) {
      const start = doc.objects.length - this.added.length;
      parts.push(new ObjectsCommand(label, this.added.map((o, k) => ({ before: null, after: { ...o }, index: start + k }))));
    }
    if (!parts.length) return null;
    return parts.length === 1 && parts[0].label === label ? parts[0] : new CompoundCommand(label, parts);
  }
}
