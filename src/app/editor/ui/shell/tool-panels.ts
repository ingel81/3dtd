/**
 * The panel of each tool, shown in the side column while the tool is in
 * hand. A tool without its panel here does not compile (tools/tool-defs.ts).
 */
import type { Type } from '@angular/core';
import type { ToolId } from '../../tools/tool-defs';
import { EnvironmentPanelComponent } from '../panels/environment-panel.component';
import { GameplayPanelComponent } from '../panels/gameplay-panel.component';
import { LandscapePanelComponent } from '../panels/landscape-panel.component';
import { LifePanelComponent } from '../panels/life-panel.component';
import { LookPanelComponent } from '../panels/look-panel.component';
import { MapPanelComponent } from '../panels/map-panel.component';
import { MarkerPanelComponent } from '../panels/marker-panel.component';
import { MeasurePanelComponent } from '../panels/measure-panel.component';
import { ObjectPanelComponent } from '../panels/object-panel.component';
import { PaintPanelComponent } from '../panels/paint-panel.component';
import { PathPanelComponent } from '../panels/path-panel.component';
import { StampPanelComponent } from '../panels/stamp-panel.component';
import { TerrainPanelComponent } from '../panels/terrain-panel.component';
import { WaterPanelComponent } from '../panels/water-panel.component';

export const TOOL_PANELS: Record<ToolId, Type<unknown>> = {
  look: LookPanelComponent,
  landscape: LandscapePanelComponent,
  terrain: TerrainPanelComponent,
  paint: PaintPanelComponent,
  water: WaterPanelComponent,
  objects: ObjectPanelComponent,
  life: LifePanelComponent,
  paths: PathPanelComponent,
  markers: MarkerPanelComponent,
  gameplay: GameplayPanelComponent,
  environment: EnvironmentPanelComponent,
  settings: MapPanelComponent,
  stamp: StampPanelComponent,
  measure: MeasurePanelComponent,
};
