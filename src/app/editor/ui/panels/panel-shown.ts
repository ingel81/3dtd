import { computed, Directive, inject, input, type Signal } from '@angular/core';
import { EditorSession } from '../editor-session.service';
import type { DocPart } from '../../model/doc-change';

/**
 * Whether the panel under this element is in sight. Every tool's panel
 * stays mounted once made (the first switch to it is quick), and each reads
 * the revisions of the map's parts it shows: hidden, they worked out
 * routes, scene costs and copies of the map's parts all through a stroke.
 * Under this gate a panel's revision holds still while it is out of sight
 * and catches up when it shows (panelRev).
 */
@Directive({ selector: '[appPanelShown]' })
export class PanelShown {
  readonly appPanelShown = input.required<boolean>();

  /** `source` while the panel shows, its last value while it is hidden */
  follow(source: Signal<number>): Signal<number> {
    let seen = 0;
    return computed(() => {
      if (this.appPanelShown()) seen = source();
      return seen;
    });
  }
}

/** The revision of the map's `parts` a panel follows (all without parts): held while its gate (PanelShown) hides it */
export function panelRev(...parts: DocPart[]): Signal<number> {
  const source = inject(EditorSession).state.rev(...parts);
  return inject(PanelShown, { optional: true })?.follow(source) ?? source;
}
