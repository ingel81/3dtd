import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

/** A chip beside the path: a run that waits, the editor's map; a click goes there */
export interface PathChip {
  id: string;
  label: string;
  /** What the chip does, for its tooltip */
  hint: string;
}

/** A step of the path a click acts on: all worlds, the world, play or edit, or one of the chips by id */
export type PathAction = 'worlds' | 'world' | 'play' | 'edit' | { chip: string };

/**
 * Where the window is (docs/WORLDS_NAVIGATION_PLAN.md, 3.4): `Worlds ›
 * world ›`, the place or map beside it (the host's own name box), Play and
 * Edit as one switch, and the chips of what waits elsewhere. Every step is
 * a button; a step that is blocked stays visible with its reason as
 * tooltip. The host wires what each step does: the game's menu, the
 * editor's list, AppScreen.
 */
@Component({
  selector: 'app-world-path',
  standalone: true,
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="wp-path" aria-label="Where you are">
      <button class="td-link wp-step" type="button" (click)="go.emit('worlds')" [matTooltip]="worldsHint()" data-test="path-worlds">Worlds</button>
      <span class="wp-sep" aria-hidden="true">›</span>
      <button class="td-link wp-step" type="button" (click)="go.emit('world')" [matTooltip]="worldHint()" data-test="path-world">{{ world() }}</button>
      <span class="wp-sep" aria-hidden="true">›</span>
    </nav>
    <ng-content />
    <div class="td-seg is-compact is-sm wp-mode" role="group" aria-label="Play or edit">
      <button type="button" [attr.aria-pressed]="mode() === 'play'" [attr.aria-disabled]="playWhy() !== null || null"
              [matTooltip]="playWhy() ?? playHint()" (click)="mode() !== 'play' && playWhy() === null && go.emit('play')" data-test="path-play">Play</button>
      <button type="button" [attr.aria-pressed]="mode() === 'edit'" [attr.aria-disabled]="editWhy() !== null || null"
              [matTooltip]="editWhy() ?? editHint()" (click)="mode() !== 'edit' && editWhy() === null && go.emit('edit')" data-test="path-edit">{{ editLabel() }}</button>
    </div>
    @for (chip of chips(); track chip.id) {
      <button class="td-btn-ghost td-btn-sm wp-chip" type="button" [matTooltip]="chip.hint" (click)="go.emit({ chip: chip.id })"
              [attr.data-chip]="chip.id">{{ chip.label }}</button>
    }
  `,
  styles: [`
    :host { display: flex; align-items: center; gap: var(--td-sp-2); min-width: 0; }
    .wp-path { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
    .wp-sep { opacity: .6; }
    .wp-chip { white-space: nowrap; }
  `],
})
export class WorldPathComponent {
  /** The world the window shows or edits: "Real places", "Maps", "DevWorld" ... */
  readonly world = input.required<string>();
  /** Play in the game, Edit in the editor */
  readonly mode = input.required<'play' | 'edit'>();
  /** On a real place there is no map to edit: a map of the place is made ("Make map") */
  readonly editLabel = input('Edit');
  /** Why Play or Edit cannot be taken now; null when it can */
  readonly playWhy = input<string | null>(null);
  readonly editWhy = input<string | null>(null);
  readonly playHint = input('Play');
  readonly editHint = input('Edit this map');
  readonly worldsHint = input('All worlds');
  readonly worldHint = input('This world');
  readonly chips = input<readonly PathChip[]>([]);
  readonly go = output<PathAction>();
}
