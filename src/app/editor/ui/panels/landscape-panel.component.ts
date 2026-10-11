import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapPathKind } from '../../../world/custom-map/map-document';
import { BIOMES, type BiomeDef, type BiomeId } from '../../ops/landscape/biomes';
import { randomSeed } from '../../ops/landscape/landscape-noise';
import { LANDSCAPE_MODES, type LandscapeMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

/** Landscape: biomes, landforms, erosion, and the line brushes for cliffs, rivers and roads */
@Component({
  selector: 'app-landscape-panel',
  standalone: true,
  imports: [BrushPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  templateUrl: './landscape-panel.component.html',
  styleUrl: './landscape-panel.component.scss',
})
export class LandscapePanelComponent {
  readonly session = inject(EditorSession);
  readonly modes = LANDSCAPE_MODES;
  readonly biomes = BIOMES;
  readonly s = computed(() => (this.session.settingsRev(), structuredClone(this.session.settings.landscape)));
  readonly surfaces = computed(() =>
    this.session
      .catalog()
      .catalog.materials.filter((m) => /path|paving|cobble|gravel|dirt|road/.test(m.id))
      .map((m) => ({ id: m.id, name: m.name })),
  );
  readonly hasMaterials = computed(() => this.session.catalog().catalog.materials.length > 0);

  thumb(b: BiomeDef): string {
    return this.session.biomePicture(b);
  }

  setMode(mode: LandscapeMode): void {
    this.session.patchSettings((s) => (s.landscape.mode = mode));
  }

  setBiome(id: BiomeId): void {
    this.session.patchSettings((s) => {
      s.landscape.biome = id;
      s.landscape.mode = 'biome';
    });
  }

  roll(): void {
    this.session.patchSettings((s) => (s.landscape.seed = randomSeed()));
  }

  setSeed(e: Event): void {
    const v = Math.abs(Math.round(Number((e.target as HTMLInputElement).value)));
    if (Number.isFinite(v)) this.session.patchSettings((s) => (s.landscape.seed = v));
  }

  setReroll(on: boolean): void {
    this.session.patchSettings((s) => (s.landscape.reroll = on));
  }

  setRiver(key: 'width' | 'depth' | 'bank', v: number): void {
    this.session.patchSettings((s) => (s.landscape.river[key] = v));
  }

  setRiverKind(kind: 'water' | 'lava'): void {
    this.session.patchSettings((s) => (s.landscape.river.kind = kind));
  }

  setRiverFlag(key: 'reeds' | 'bridges', on: boolean): void {
    this.session.patchSettings((s) => (s.landscape.river[key] = on));
  }

  setRoadWidth(v: number): void {
    this.session.patchSettings((s) => (s.landscape.road.width = v));
  }

  setRoadKind(kind: MapPathKind): void {
    this.session.patchSettings((s) => (s.landscape.road.kind = kind));
  }

  setRoadFlag(key: 'adapt' | 'lamps' | 'fences', on: boolean): void {
    this.session.patchSettings((s) => (s.landscape.road[key] = on));
  }

  setSurface(id: string): void {
    this.session.patchSettings((s) => (s.landscape.road.surface = id ? [id] : []));
  }

  setCliff(v: number): void {
    this.session.patchSettings((s) => (s.landscape.cliffHeight = v));
  }

  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}
