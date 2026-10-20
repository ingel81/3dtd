import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { DagEdge, DagOrientation } from '../../utils/dag-layout';
import { TdIconComponent } from '../icon/icon.component';
import { buildTechTreeView, chainToRoots, type TechTreeNode } from './tech-tree-view';
import { injectT } from '../../i18n/i18n.service';

/**
 * Draws a tech tree: nodes in levels, edges between them, state per node.
 *
 * Presentational on purpose. It knows the node states and nothing else: no
 * credits, no slots, no prerequisites, no commands. Whoever uses it maps its
 * own data onto {@link TechTreeNode} and acts on `nodeActivated` and
 * `nodeFocused`. The research dialog is the first caller, the hero tech tree
 * is meant to be the second.
 *
 * Edges are SVG, nodes are HTML buttons on top. Both read the same coordinates
 * from the layout, so they cannot drift apart. HTML for the nodes because the
 * icon set renders its SVG through innerHTML into a span, which lands in the
 * wrong namespace inside an <svg>, and because a button gets focus, tab order
 * and a tooltip without rebuilding any of it.
 */
@Component({
  selector: 'td-tech-tree',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tech-tree.component.html',
  styleUrl: './tech-tree.component.scss',
})
export class TechTreeComponent {
  protected readonly t = injectT();
  readonly nodes = input.required<readonly TechTreeNode[]>();
  readonly edges = input.required<readonly DagEdge[]>();
  readonly orientation = input<DagOrientation>('vertical');
  /** Label of the whole graph for screen readers, for instance "Research tree". */
  /** The tree's accessible name; null: the dictionary's "Tech tree" */
  readonly label = input<string | null>(null);
  /** Drawn with a brighter frame: what the panel beside the tree is showing. */
  readonly selectedId = input<string | null>(null);

  /** A node was clicked or activated by keyboard. Carries the node id. */
  readonly nodeActivated = output<string>();
  /** The pointer or the focus reached a node, or left the graph (null). */
  readonly nodeFocused = output<string | null>();

  /** The node the pointer is on; its chain back to the roots stays lit. */
  protected readonly hoveredId = signal<string | null>(null);

  protected readonly view = computed(() => buildTechTreeView(this.nodes(), this.edges(), this.orientation()));

  /** Nodes and edges on the way from the hovered node back to the roots. */
  protected readonly chain = computed(() => {
    const id = this.hoveredId();
    return id ? chainToRoots(id, this.edges()) : null;
  });

  protected onEnter(id: string): void {
    this.hoveredId.set(id);
    this.nodeFocused.emit(id);
  }

  protected onLeaveGraph(): void {
    this.hoveredId.set(null);
    this.nodeFocused.emit(null);
  }

  protected inChain(id: string): boolean {
    return this.chain()?.nodes.has(id) ?? false;
  }

  protected edgeInChain(from: string, to: string): boolean {
    return this.chain()?.edges.has(`${from}>${to}`) ?? false;
  }

  protected progressPercent(value: number | undefined): number {
    return Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
  }

  /** Spoken state, so a screen reader hears more than the title. */
  protected stateLabel(node: TechTreeNode): string {
    const w = this.t().dialogs.techTree;
    switch (node.state) {
      case 'completed':
        return w.completed;
      case 'active':
        return w.active(this.progressPercent(node.progress));
      case 'queued':
        return node.badge ? w.queuedAt(node.badge) : w.queued;
      case 'available':
        return w.available;
      case 'poor':
        return w.poor;
      case 'pending':
        return w.pending;
      case 'locked':
        return node.hint ? w.lockedWhy(node.hint) : w.locked;
    }
  }
}
