import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { injectT } from '../../i18n/i18n.service';

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
 * Edit as one switch, and the chips of what waits elsewhere; on the globes
 * (WorldsStageComponent) the same bar, the world and its pick as far as
 * they go. Every step is
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
    <nav class="wp-path" [attr.aria-label]="t().worlds.path.whereYouAre">
      <button class="td-crumb" type="button" (click)="go.emit('worlds')" [matTooltip]="worldsHint() ?? t().worlds.path.worldsHint"
              [attr.aria-current]="world() === null ? 'page' : null" data-test="path-worlds">{{ t().worlds.path.worlds }}</button>
      @if (world(); as name) {
        <span class="wp-sep" aria-hidden="true">›</span>
        <button class="td-crumb" type="button" (click)="go.emit('world')" [matTooltip]="worldHint() ?? t().worlds.path.worldHint"
                [attr.aria-current]="worldHere() ? 'page' : null" data-test="path-world">{{ name }}</button>
        @if (!worldHere()) {
          <span class="wp-sep" aria-hidden="true">›</span>
        }
      }
    </nav>
    <ng-content />
    @if (modes()) {
      <div class="td-seg is-compact is-sm wp-mode" role="group" [attr.aria-label]="t().worlds.path.playOrEdit">
        <button type="button" [attr.aria-pressed]="mode() === 'play'" [attr.aria-disabled]="playWhy() !== null || null"
                [matTooltip]="playWhy() ?? playHint() ?? t().worlds.path.play" (click)="mode() !== 'play' && playWhy() === null && go.emit('play')" data-test="path-play">{{ playLabel() ?? t().worlds.path.play }}</button>
        <button type="button" [attr.aria-pressed]="mode() === 'edit'" [attr.aria-disabled]="editWhy() !== null || null"
                [matTooltip]="editWhy() ?? editHint() ?? t().worlds.path.editHint" (click)="mode() !== 'edit' && editWhy() === null && go.emit('edit')" data-test="path-edit">{{ editLabel() ?? t().worlds.path.edit }}</button>
      </div>
    }
    @for (chip of chips(); track chip.id) {
      <button class="td-btn-ghost td-btn-sm wp-chip" type="button" [matTooltip]="chip.hint" (click)="go.emit({ chip: chip.id })"
              [attr.data-chip]="chip.id">{{ chip.label }}</button>
    }
  `,
  styles: [`
    :host { display: flex; align-items: center; gap: var(--td-sp-2); min-width: 0; }
    .wp-path { display: flex; align-items: center; gap: 0; white-space: nowrap; }
    .wp-sep { color: var(--td-text-disabled); }
    .wp-chip { white-space: nowrap; }
    /* Play and Edit keep their words whole (German runs longer): what is beside them gives way, never their labels */
    .wp-mode { flex-shrink: 0; white-space: nowrap; }
  `],
})
export class WorldPathComponent {
  protected readonly t = injectT();
  /** The world the window shows or edits: "Real places", "Built Worlds", "Dev world" ...; null on the globes */
  readonly world = input<string | null>(null);
  /** The world's own menu, with nothing picked in it: the path ends at the world */
  readonly worldHere = input(false);
  /** Play in the game, Edit in the editor; null where neither is (the globes' world menu, both are ways) */
  readonly mode = input<'play' | 'edit' | null>(null);
  /** Play and Edit show: off where nothing is picked yet */
  readonly modes = input(true);
  /** "Play", or "Continue" for a run that waits */
  readonly playLabel = input<string | null>(null);
  /** On a real place there is no map to edit: a map of the place is made ("Make map") */
  readonly editLabel = input<string | null>(null);
  /** Why Play or Edit cannot be taken now; null when it can */
  readonly playWhy = input<string | null>(null);
  readonly editWhy = input<string | null>(null);
  /** The hints of the steps; null takes the path's own words (worlds.path) */
  readonly playHint = input<string | null>(null);
  readonly editHint = input<string | null>(null);
  readonly worldsHint = input<string | null>(null);
  readonly worldHint = input<string | null>(null);
  readonly chips = input<readonly PathChip[]>([]);
  readonly go = output<PathAction>();
}
