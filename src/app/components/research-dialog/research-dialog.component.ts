import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';
import { ResearchStore } from '../../store/research.store';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { TdIconComponent } from '../icon/icon.component';
import { TechTreeComponent } from '../tech-tree/tech-tree.component';
import { RESEARCH_DIALOG_DESC_ID, RESEARCH_DIALOG_TITLE_ID } from './open-research-dialog';
import {
  buildResearchEdges,
  buildResearchNodes,
  researchClickAction,
  type ResearchTreeState,
} from './research-tree-view';

/**
 * The research tree as a graph, with the queue beside it.
 *
 * This is where a research is picked; the sidebar panel keeps the status and
 * the building itself. Everything it shows follows the store, so a research
 * that finishes while the dialog is open moves on its own.
 *
 * Commands go the usual way over the bus. The facade is provided by
 * TowerDefenseComponent, not in root, so the opener has to hand this dialog an
 * injector from inside that tree (see openResearchDialog).
 */
@Component({
  selector: 'app-research-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent, TechTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './research-dialog.component.html',
  styleUrl: './research-dialog.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class ResearchDialogComponent {
  private readonly research = inject(ResearchStore);
  private readonly store = inject(TowerDefenseStore);
  private readonly facade = inject(TowerDefenseFacadeService);

  readonly titleId = RESEARCH_DIALOG_TITLE_ID;
  readonly descId = RESEARCH_DIALOG_DESC_ID;

  readonly edges = buildResearchEdges();

  protected readonly treeState = computed<ResearchTreeState>(() => ({
    completed: this.research.completedResearches(),
    active: this.research.activeResearches(),
    queued: this.research.queuedResearches(),
    elapsed: this.research.researchElapsed(),
    credits: this.store.credits(),
    availableSlots: this.research.availableSlots(),
  }));

  protected readonly nodes = computed(() => buildResearchNodes(this.treeState()));
  protected readonly queue = this.research.queuedResearches;
  protected readonly slotsUsed = computed(() => this.research.activeResearches().length);
  protected readonly slotsTotal = this.research.researchSlots;

  protected onNodeActivated(id: string): void {
    const researchId = id as ResearchId;
    switch (researchClickAction(researchId, this.treeState())) {
      case 'start':
        this.facade.emitCommand({ type: 'command:start-research', researchId });
        break;
      case 'queue':
        this.facade.emitCommand({ type: 'command:queue-research', researchId });
        break;
      case 'unqueue':
        this.facade.emitCommand({ type: 'command:unqueue-research', researchId });
        break;
      case 'none':
        break;
    }
  }

  protected onUnqueue(researchId: ResearchId): void {
    this.facade.emitCommand({ type: 'command:unqueue-research', researchId });
  }

  /**
   * Up and down rather than dragging: the repo has no cdk/drag-drop anywhere,
   * and a button works with a keyboard without anything else being built.
   */
  protected onMove(researchId: ResearchId, delta: number): void {
    const toIndex = this.queue().indexOf(researchId) + delta;
    if (toIndex < 0 || toIndex >= this.queue().length) return;
    this.facade.emitCommand({ type: 'command:move-queued-research', researchId, toIndex });
  }

  protected researchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
  }

  protected researchCost(id: ResearchId): number {
    return getResearch(id)?.cost ?? 0;
  }

  protected tooShort(id: ResearchId): boolean {
    return this.store.credits() < this.researchCost(id);
  }
}
