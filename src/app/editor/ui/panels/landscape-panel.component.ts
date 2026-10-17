import { ModePickerComponent } from './mode-picker.component';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapPathKind } from '../../../world/custom-map/map-document';
import { BIOMES, type BiomeDef, type BiomeId } from '../../ops/landscape/biomes';
import { randomSeed } from '../../../map-ops/landscape-noise';
import { cliffModelIds } from '../../ops/landscape/cliff-rocks';
import { roadSurfaces, type RoadOptions } from '../../ops/landscape/road';
import type { RiverOptions } from '../../ops/landscape/river';
import { patch, LANDSCAPE_MODES, type LandscapeMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

/** Landscape: biomes, landforms, erosion, and the line brushes for cliffs, rivers and roads */
@Component({
  selector: 'app-landscape-panel',
  standalone: true,
  imports: [ModePickerComponent, BrushPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './landscape-panel.component.html',
  styleUrl: './landscape-panel.component.scss',
})
export class LandscapePanelComponent {
  readonly session = inject(EditorSession);
  readonly modes = LANDSCAPE_MODES;
  readonly biomes = BIOMES;
  readonly s = this.session.settings.landscape;
  readonly surfaces = computed(() => roadSurfaces(this.session.catalog()));
  readonly hasMaterials = computed(() => this.session.catalog().catalog.materials.length > 0);
  readonly cliffModels = computed(() => {
    const catalog = this.session.catalog();
    return cliffModelIds(catalog).map((id) => ({ id, name: catalog.object(id).name }));
  });

  setCliffModel(id: string): void {
    patch(this.session.settings.landscape, { cliffModel: id });
  }

  thumb(b: BiomeDef): string {
    return this.session.biomePicture(b);
  }

  setMode(mode: LandscapeMode): void {
    patch(this.session.settings.landscape, { mode });
  }

  setBiome(id: BiomeId): void {
    patch(this.session.settings.landscape, { biome: id, mode: 'biome' });
  }

  roll(): void {
    patch(this.session.settings.landscape, { seed: randomSeed() });
  }

  setSeed(e: Event): void {
    const v = Math.abs(Math.round(Number((e.target as HTMLInputElement).value)));
    if (Number.isFinite(v)) patch(this.session.settings.landscape, { seed: v });
  }

  setReroll(on: boolean): void {
    patch(this.session.settings.landscape, { reroll: on });
  }

  setRiver(key: 'width' | 'depth' | 'bank', v: number): void {
    this.setRiverOption({ [key]: v });
  }

  setRiverKind(kind: 'water' | 'lava'): void {
    this.setRiverOption({ kind });
  }

  setRiverFlag(key: 'reeds' | 'bridges', on: boolean): void {
    this.setRiverOption({ [key]: on });
  }

  setRoadWidth(v: number): void {
    this.setRoadOption({ width: v });
  }

  setRoadKind(kind: MapPathKind): void {
    this.setRoadOption({ kind });
  }

  setRoadFlag(key: 'adapt' | 'lamps' | 'fences', on: boolean): void {
    this.setRoadOption({ [key]: on });
  }

  setSurface(id: string): void {
    this.setRoadOption({ surface: id ? [id] : [] });
  }

  private setRiverOption(changes: Partial<RiverOptions>): void {
    patch(this.session.settings.landscape, { river: { ...this.session.settings.landscape().river, ...changes } });
  }

  private setRoadOption(changes: Partial<RoadOptions>): void {
    patch(this.session.settings.landscape, { road: { ...this.session.settings.landscape().road, ...changes } });
  }

  setCliff(v: number): void {
    patch(this.session.settings.landscape, { cliffHeight: v });
  }

  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}
