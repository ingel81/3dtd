/**
 * The tool in hand and the settings of all tools: picking a tool swaps the
 * brush (each tool keeps its own), hands the tool to the view and makes the
 * line of help follow it.
 */
import { computed, signal, type Signal } from '@angular/core';
import type { BrushSettings } from '../../map-ops/brush';
import { DEFAULT_BRUSH } from '../../map-ops/brush';
import { TOOL_DEFS, TOOL_INFO, type ToolId } from '../tools/tool-defs';
import type { EditorSettings, EditorTool, ToolContext } from '../tools/tool';
import type { ViewHost } from './view-host';

export class ToolHost {
  /** The editor opens on Look: nothing changes the map until a tool is picked */
  readonly tool = signal<ToolId>('look');
  /** Every tool by its id */
  readonly all = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t.create()])) as Record<ToolId, EditorTool>;
  /** Bumps when the tool's line of help says something new from what the tool holds (ToolContext.hintChanged) */
  private readonly hintRev = signal(0);
  /** The brushes of the tools not in hand (select swaps them) */
  private readonly brushes = new Map<ToolId, BrushSettings>();
  /** The tool's line of help under the map: follows the tool, its settings and the map */
  readonly hint: Signal<string>;

  constructor(
    readonly settings: EditorSettings,
    private readonly view: ViewHost,
    /** Rises with every change of the map */
    mapRev: Signal<number>,
  ) {
    this.hint = computed(() => {
      this.view.attached();
      this.hintRev();
      mapRev();
      const ctx = this.view.toolContext;
      if (!ctx) return '';
      ctx.t();
      return this.all[this.tool()].hint(ctx);
    });
  }

  /** The tool in hand */
  get current(): EditorTool {
    return this.all[this.tool()];
  }

  select(id: ToolId): void {
    const previous = this.tool();
    if (previous !== id) {
      // Every tool keeps its own brush: a big landscape brush is no big paint brush
      this.brushes.set(previous, this.settings.brush());
      this.settings.brush.set(this.brushFor(id));
    }
    this.tool.set(id);
    this.view.setTool(this.all[id]);
  }

  /** The context the tools work in (a panel's button that runs a tool's own action), null without a view */
  context(): ToolContext | null {
    return this.view.toolContext;
  }

  /** The tool's line of help says something new */
  hintChanged(): void {
    this.hintRev.update((n) => n + 1);
  }

  /** The brush a tool had last, or its own first size */
  private brushFor(id: ToolId): BrushSettings {
    const kept = this.brushes.get(id);
    if (kept) return { ...kept };
    return { ...DEFAULT_BRUSH, radius: TOOL_INFO.get(id)?.brushRadius ?? DEFAULT_BRUSH.radius };
  }
}
