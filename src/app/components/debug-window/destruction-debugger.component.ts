import { Component, inject, ChangeDetectionStrategy, effect, untracked } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { DestructionToolService } from '../../services/debug/destruction-tool.service';
import { DEBUG_BLASTS, type DebugBlast, type StructureStage } from '../../configs/destruction.config';
import { COLLAPSE_VARIANTS, type CollapseVariant } from '../../world/custom-map/render/objects/ruin-damage';
import { TdIconComponent } from '../icon/icon.component';
import { RovingGroupDirective } from '../roving-group.directive';

/** What each blast is called in the window */
const BLAST_NAMES: Record<DebugBlast, string> = { cannonball: 'Cannon', rocket: 'Rocket', 'nuclear-strike': 'Nuke' };

/** The collapse variants as the window names them (ruin-damage.ts, E259) */
const COLLAPSE_NAMES: Record<CollapseVariant, string> = { tip: 'Tip', impact: 'Impact', buckle: 'Buckle' };

/** The stages as the window names them (destruction.config.ts) */
const STAGE_NAMES: Record<StructureStage, string> = { 0: 'Intact', 1: 'Battered', 2: 'Heavy', 3: 'Fallen' };

/**
 * The Destruction window of the developer options (E261): set off blasts on
 * the map and pick a structure to read its HP and set its stage, through
 * the simulation (DestructionToolService). Only on a destructible world;
 * closing the window ends the tool.
 */
@Component({
  selector: 'app-destruction-debugger',
  standalone: true,
  imports: [DraggableDebugPanelComponent, TdIconComponent, RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './destruction-debugger.component.html',
  styleUrl: './destruction-debugger.component.scss',
})
export class DestructionDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly tool = inject(DestructionToolService);

  readonly blasts = DEBUG_BLASTS;
  readonly blastNames = BLAST_NAMES;
  readonly stages: readonly StructureStage[] = [0, 1, 2, 3];
  readonly stageNames = STAGE_NAMES;
  readonly collapses = COLLAPSE_VARIANTS;
  readonly collapseNames = COLLAPSE_NAMES;

  constructor() {
    // The window closed: the clicks go back to the game
    effect(() => {
      if (!this.windowService.destructionWindow().isOpen) untracked(() => this.tool.stop());
    });
  }

  percent(hp: number, max: number): number {
    return Math.round((hp / max) * 100);
  }
}
