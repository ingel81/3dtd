import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { DagEdge, DagOrientation } from '../../utils/dag-layout';
import { TdIconComponent } from '../icon/icon.component';
import { buildTechTreeView, type TechTreeNode } from './tech-tree-view';

/**
 * Draws a tech tree: nodes in levels, edges between them, state per node.
 *
 * Presentational on purpose. It knows five node states and nothing else: no
 * credits, no slots, no prerequisites, no commands. Whoever uses it maps its
 * own data onto {@link TechTreeNode} and acts on `nodeActivated`. The research
 * dialog is the first caller, the hero tech tree is meant to be the second.
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
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tech-tree.component.html',
  styleUrl: './tech-tree.component.scss',
})
export class TechTreeComponent {
  readonly nodes = input.required<readonly TechTreeNode[]>();
  readonly edges = input.required<readonly DagEdge[]>();
  readonly orientation = input<DagOrientation>('horizontal');
  /** Label of the whole graph for screen readers, for instance "Research tree". */
  readonly label = input<string>('Tech tree');

  /** A node was clicked or activated by keyboard. Carries the node id. */
  readonly nodeActivated = output<string>();

  protected readonly view = computed(() => buildTechTreeView(this.nodes(), this.edges(), this.orientation()));

  protected progressPercent(value: number | undefined): number {
    return Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100);
  }

  /** Spoken state, so a screen reader hears more than the title. */
  protected stateLabel(node: TechTreeNode): string {
    switch (node.state) {
      case 'completed':
        return 'completed';
      case 'active':
        return `in progress, ${this.progressPercent(node.progress)} percent`;
      case 'queued':
        return node.badge ? `queued, position ${node.badge}` : 'queued';
      case 'available':
        return 'available';
      case 'locked':
        return node.hint ? `locked, ${node.hint}` : 'locked';
    }
  }
}
