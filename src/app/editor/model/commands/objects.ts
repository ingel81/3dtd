import type { CustomMapDocument, MapObject } from '../../../world/custom-map/map-document';
import type { DocChange, EditCommand } from '../doc-change';

/** Objects added, removed or changed; each keeps its place in the list */
export interface ObjectEdit {
  before: MapObject | null;
  after: MapObject | null;
  /** Index in the list where it stands (before for removal, after for insertion) */
  index: number;
}

export class ObjectsCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly edits: readonly ObjectEdit[],
  ) {
    this.bytes = edits.length * 160;
  }

  static add(label: string, doc: CustomMapDocument, objects: MapObject[]): ObjectsCommand {
    const start = doc.objects.length;
    return new ObjectsCommand(
      label,
      objects.map((o, k) => ({ before: null, after: { ...o }, index: start + k })),
    );
  }

  static remove(label: string, doc: CustomMapDocument, ids: readonly string[]): ObjectsCommand {
    const set = new Set(ids);
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      if (set.has(o.id)) edits.push({ before: { ...o }, after: null, index });
    });
    return new ObjectsCommand(label, edits);
  }

  /** Changes objects in place; `update` returns the new object */
  static change(label: string, doc: CustomMapDocument, ids: readonly string[], update: (o: MapObject) => MapObject): ObjectsCommand {
    const set = new Set(ids);
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      if (set.has(o.id)) edits.push({ before: { ...o }, after: { ...update({ ...o }) }, index });
    });
    return new ObjectsCommand(label, edits);
  }

  /** Before and after of objects already changed in place */
  static fromStates(label: string, doc: CustomMapDocument, before: ReadonlyMap<string, MapObject>): ObjectsCommand {
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      const b = before.get(o.id);
      if (b && !sameObject(b, o)) edits.push({ before: { ...b }, after: { ...o }, index });
    });
    return new ObjectsCommand(label, edits);
  }

  get empty(): boolean {
    return this.edits.length === 0;
  }

  apply(doc: CustomMapDocument): DocChange {
    // Removals from the back so indices hold, then insertions from the front
    const list = doc.objects;
    const removals = this.edits.filter((e) => e.before && !e.after).sort((a, b) => b.index - a.index);
    for (const e of removals) list.splice(indexOf(list, e.before!.id, e.index), 1);
    for (const e of this.edits) {
      if (e.before && e.after) list[indexOf(list, e.before.id, e.index)] = { ...e.after };
    }
    const inserts = this.edits.filter((e) => !e.before && e.after).sort((a, b) => a.index - b.index);
    for (const e of inserts) list.splice(Math.min(e.index, list.length), 0, { ...e.after! });
    return { objects: this.ids() };
  }

  revert(doc: CustomMapDocument): DocChange {
    const list = doc.objects;
    const inserted = this.edits.filter((e) => !e.before && e.after).sort((a, b) => b.index - a.index);
    for (const e of inserted) list.splice(indexOf(list, e.after!.id, e.index), 1);
    for (const e of this.edits) {
      if (e.before && e.after) list[indexOf(list, e.after.id, e.index)] = { ...e.before };
    }
    const removed = this.edits.filter((e) => e.before && !e.after).sort((a, b) => a.index - b.index);
    for (const e of removed) list.splice(Math.min(e.index, list.length), 0, { ...e.before! });
    return { objects: this.ids() };
  }

  /** The ids of the objects it adds, removes or changes */
  ids(): string[] {
    return this.edits.map((e) => (e.after ?? e.before)!.id);
  }
}

function indexOf(list: MapObject[], id: string, hint: number): number {
  if (list[hint]?.id === id) return hint;
  const k = list.findIndex((o) => o.id === id);
  if (k < 0) throw new Error(`Object ${id} is not in the map`);
  return k;
}

export function sameObject(a: MapObject, b: MapObject): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.rotation === b.rotation &&
    a.scale === b.scale &&
    a.asset === b.asset &&
    a.blocksLos === b.blocksLos &&
    a.blocksBuild === b.blocksBuild &&
    a.tint === b.tint &&
    a.pitch === b.pitch &&
    a.roll === b.roll &&
    a.group === b.group
  );
}

