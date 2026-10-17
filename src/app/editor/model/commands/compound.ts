import type { CustomMapDocument } from '../../../world/custom-map/map-document';
import { mergeChanges, type DocChange, type EditCommand } from '../doc-change';

/** Several commands as one step */
export class CompoundCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly commands: readonly EditCommand[],
  ) {
    this.bytes = commands.reduce((n, c) => n + c.bytes, 0);
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.commands.reduce<DocChange>((change, c) => mergeChanges(change, c.apply(doc)), {});
  }

  revert(doc: CustomMapDocument): DocChange {
    let change: DocChange = {};
    for (let k = this.commands.length - 1; k >= 0; k--) change = mergeChanges(change, this.commands[k].revert(doc));
    return change;
  }
}
