import { computed, Directive, inject, input, type Signal } from '@angular/core';
import { EditorSession } from '../editor-session.service';

/**
 * Whether the panel under this element is in sight. Every tool's panel
 * stays mounted once made (the first switch to it is quick), and each reads
 * the document's revision, which rises every 150 ms while the map changes:
 * hidden, they worked out routes, scene costs and copies of the map's
 * parts all through a stroke. Under this gate a panel's revision holds still
 * while it is out of sight and catches up when it shows (panelRev).
 */
@Directive({ selector: '[appPanelShown]' })
export class PanelShown {
  readonly appPanelShown = input.required<boolean>();
  private readonly session = inject(EditorSession);
  private seen = 0;
  readonly rev = computed(() => {
    if (this.appPanelShown()) this.seen = this.session.docRev();
    return this.seen;
  });
}

/** The document revision a panel follows: held while its gate (PanelShown) hides it, the session's outside one */
export function panelRev(): Signal<number> {
  return inject(PanelShown, { optional: true })?.rev ?? inject(EditorSession).docRev;
}
