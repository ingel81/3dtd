/**
 * The tool in hand and the settings of all tools: picking a tool swaps the
 * brush (each tool keeps its own), hands the tool to the view and makes the
 * line of help follow it.
 */
import { computed, signal, type Signal } from '@angular/core';
import type { BrushSettings } from '../../map-ops/brush';
import { DEFAULT_BRUSH } from '../../map-ops/brush';
import { TOOL_BRUSH_RADIUS, type EditorSettings, type EditorTool, type ToolContext, type ToolId } from '../tools/tool';
import { LandscapeTool } from '../tools/landscape-tool';
import { LifeTool } from '../tools/life-tool';
import { LookTool } from '../tools/look-tool';
import { MarkerTool } from '../tools/marker-tool';
import { MeasureTool } from '../tools/measure-tool';
import { ObjectTool } from '../tools/object-tool';
import { PaintTool } from '../tools/paint-tool';
import { PathTool } from '../tools/path-tool';
import { StampTool } from '../tools/stamp-tool';
import { TerrainTool } from '../tools/terrain-tool';
import { WaterTool } from '../tools/water-tool';
import { PanelTool } from '../tools/tool';
import type { ViewHost } from './view-host';

export class ToolHost {
  /** The editor opens on Look: nothing changes the map until a tool is picked */
  readonly tool = signal<ToolId>('look');
  /** Every tool by its id */
  readonly all: Record<ToolId, EditorTool> = {
    look: new LookTool(),
    landscape: new LandscapeTool(),
    stamp: new StampTool(),
    measure: new MeasureTool(),
    gameplay: new PanelTool('gameplay', 'Start credits, HQ health, allowed towers and the waves of this map'),
    terrain: new TerrainTool(),
    paint: new PaintTool(),
    water: new WaterTool(),
    objects: new ObjectTool(),
    life: new LifeTool(),
    paths: new PathTool(),
    markers: new MarkerTool(),
    environment: new PanelTool('environment', 'Sky, sun and fog change the look of the map; the game uses them too'),
    settings: new PanelTool('settings', 'Name, author, description and size of the map'),
  };
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
      return ctx ? this.all[this.tool()].hint(ctx) : '';
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
    return { ...DEFAULT_BRUSH, radius: TOOL_BRUSH_RADIUS[id] ?? DEFAULT_BRUSH.radius };
  }
}
