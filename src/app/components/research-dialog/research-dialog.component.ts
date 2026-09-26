import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';
import { ResearchStore } from '../../store/research.store';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { TdIconComponent } from '../icon/icon.component';
import { TechTreeComponent } from '../tech-tree/tech-tree.component';
import { DragScrollDirective } from '../tech-tree/drag-scroll.directive';
import { buildTechTreeView, TECH_TREE_METRICS } from '../tech-tree/tech-tree-view';
import { COOP } from '../../services/coop.token';
import type { ResearchSnapshot } from '../../managers/research-snapshot';
import { RESEARCH_DIALOG_DESC_ID, RESEARCH_DIALOG_TITLE_ID, type ResearchDialogData } from './open-research-dialog';
import {
  buildResearchDetail,
  buildResearchEdges,
  buildResearchNodes,
  researchBranchCounts,
  researchClickAction,
  researchProgressCounts,
  researchTabs,
  viewOnlyTreeState,
  type ResearchDetail,
  type ResearchTreeState,
} from './research-tree-view';

/** Tier numerals for the gutter. Deeper than this is not in the tree. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * The research tree as a graph, with the queue and a detail panel beside it.
 *
 * This is where a research is picked; the sidebar panel keeps the status and
 * the building itself. Everything it shows follows the store, so a research
 * that finishes while the dialog is open moves on its own.
 *
 * In coop a row of tabs on top holds one per player (TODO E35). A partner's
 * tab shows their tree read from their ResearchManager, redrawn whenever
 * their research moves, without anything to click.
 *
 * Commands go the usual way over the bus. The facade is provided by
 * TowerDefenseComponent, not in root, so the opener has to hand this dialog an
 * injector from inside that tree (see openResearchDialog).
 */
@Component({
  selector: 'app-research-dialog',
  standalone: true,
  imports: [MatDialogModule, TdIconComponent, TechTreeComponent, DragScrollDirective],
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
  private readonly coop = inject(COOP, { optional: true });
  private readonly data = inject<ResearchDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  /** Coop: one tab a player, this one first as "You"; none alone */
  protected readonly tabs = computed(() => {
    const coop = this.coop;
    if (!coop?.inGame()) return [];
    return researchTabs(coop.roster(), coop.playerId());
  });

  /** The tab picked; null is this player's own */
  protected readonly viewedId = signal<string | null>(this.data?.playerId ?? null);

  /** The partner whose tree is shown, null for this player's own */
  protected readonly partnerId = computed(() => {
    const id = this.viewedId();
    const coop = this.coop;
    if (!id || !coop?.inGame() || id === coop.playerId()) return null;
    return this.tabs().some((t) => t.id === id) ? id : null;
  });
  protected readonly partnerName = computed(() => {
    const id = this.partnerId();
    return id && this.coop ? this.coop.nameOf(id) : null;
  });
  protected readonly viewOnly = computed(() => this.partnerId() !== null);

  /** The partner's research, read again on each of their research events */
  private readonly partner = signal<ResearchSnapshot | null>(null);

  readonly titleId = RESEARCH_DIALOG_TITLE_ID;
  readonly descId = RESEARCH_DIALOG_DESC_ID;

  readonly edges = buildResearchEdges();
  /** Top down: the roots on top, every prerequisite above what it opens. */
  readonly orientation = 'vertical' as const;

  /** The node the detail panel shows. Follows the pointer, stays on leave. */
  protected readonly selectedId = signal<ResearchId | null>(null);

  protected readonly treeState = computed<ResearchTreeState>(() => {
    const partner = this.partner();
    if (partner) return viewOnlyTreeState(partner);
    return {
      completed: this.research.completedResearches(),
      active: this.research.activeResearches(),
      queued: this.research.queuedResearches(),
      elapsed: this.research.researchElapsed(),
      credits: this.store.credits(),
      availableSlots: this.research.availableSlots(),
    };
  });

  protected readonly nodes = computed(() => buildResearchNodes(this.treeState()));
  protected readonly queue = computed(() => this.treeState().queued);
  protected readonly credits = this.store.credits;
  protected readonly slotsUsed = computed(() => this.treeState().active.length);
  protected readonly slotsTotal = computed(() => this.partner()?.maxSlots ?? this.research.researchSlots());
  /** A partner's research center level, 0 when they have none */
  protected readonly partnerCenter = computed(() => this.partner()?.centerLevel ?? 0);

  constructor() {
    // Follow the partner picked: read their research now and on every change
    effect((onCleanup) => {
      const id = this.partnerId();
      if (!id) {
        this.partner.set(null);
        return;
      }
      const read = () => this.partner.set(this.facade.researchSnapshotOf(id));
      read();
      onCleanup(this.facade.watchResearchOf(id, read));
    });
  }

  /** A tab: null goes back to this player's own tree */
  protected selectTab(id: string | null): void {
    this.viewedId.set(id);
  }

  protected readonly progress = computed(() => researchProgressCounts(this.treeState()));
  protected readonly branches = computed(() => researchBranchCounts(this.treeState()));

  /**
   * The same layout the tree component builds. Computed once here because the
   * tier gutter and the detail panel both need to know how deep a node sits.
   */
  private readonly view = computed(() => buildTechTreeView(this.nodes(), this.edges, this.orientation));

  /** Levels of the laid-out graph, for the tier gutter beside the well. */
  protected readonly tiers = computed(() => {
    const view = this.view();
    const byId = new Map(this.nodes().map((n) => [n.id, n]));
    const pitch = TECH_TREE_METRICS.nodeHeight + TECH_TREE_METRICS.levelGap;
    return view.levels.map((ids, index) => ({
      numeral: ROMAN[index] ?? String(index + 1),
      // Sits at the top of its own row, so the mark and the nodes line up
      // however far the board is scrolled or dragged.
      top: index * pitch,
      // One diamond per node on the level, lit by what is going on there.
      dots: ids.map((id) => byId.get(id)!.state),
      open: ids.some((id) => {
        const state = byId.get(id)!.state;
        return state === 'available' || state === 'poor' || state === 'active' || state === 'queued';
      }),
    }));
  });

  /** One segment per research, in tree order: the run's progress at a glance. */
  protected readonly segments = computed(() => this.nodes().map((n) => n.state));

  protected readonly detail = computed(() => {
    const id = this.selectedId();
    if (!id) return null;
    const tier = this.nodes().length ? this.tierOf(id) : 0;
    return buildResearchDetail(id, this.treeState(), tier);
  });

  protected readonly tierNumeral = computed(() => {
    const detail = this.detail();
    return detail ? (ROMAN[detail.tier] ?? String(detail.tier + 1)) : '';
  });

  protected onNodeFocused(id: string | null): void {
    if (id) this.selectedId.set(id as ResearchId);
  }

  protected onNodeActivated(id: string): void {
    this.selectedId.set(id as ResearchId);
    this.runAction(id as ResearchId);
  }

  /** The button in the detail panel does what a click on the node would do. */
  protected onDetailAction(): void {
    const id = this.selectedId();
    if (id) this.runAction(id);
  }

  private runAction(researchId: ResearchId): void {
    if (this.viewOnly()) return;
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
    if (this.viewOnly()) return;
    this.facade.emitCommand({ type: 'command:unqueue-research', researchId });
  }

  /**
   * Up and down rather than dragging: the repo has no cdk/drag-drop anywhere,
   * and a button works with a keyboard without anything else being built.
   */
  protected onMove(researchId: ResearchId, delta: number): void {
    if (this.viewOnly()) return;
    const toIndex = this.queue().indexOf(researchId) + delta;
    if (toIndex < 0 || toIndex >= this.queue().length) return;
    this.facade.emitCommand({ type: 'command:move-queued-research', researchId, toIndex });
  }

  /** The detail panel's last line on a partner's tree, where nothing can be done */
  protected viewOnlyNote(d: ResearchDetail): string {
    const name = this.partnerName() ?? 'They';
    switch (d.state) {
      case 'completed':
        return `Active for the rest of ${name}'s run.`;
      case 'active':
        return `Finishes in ${(d.remaining ?? 0).toFixed(1)} seconds.`;
      case 'queued':
        return `Position ${d.queuePosition} in ${name}'s queue.`;
      default:
        return `View only: ${name} picks their own research.`;
    }
  }

  protected researchName(id: ResearchId): string {
    return getResearch(id)?.name ?? id;
  }

  protected researchIcon(id: ResearchId): string {
    return getResearch(id)?.icon ?? 'flask';
  }

  protected researchCost(id: ResearchId): number {
    return getResearch(id)?.cost ?? 0;
  }

  protected tooShort(id: ResearchId): boolean {
    return this.store.credits() < this.researchCost(id);
  }

  private tierOf(id: ResearchId): number {
    return this.view().nodes.find((n) => n.id === id)?.level ?? 0;
  }
}
