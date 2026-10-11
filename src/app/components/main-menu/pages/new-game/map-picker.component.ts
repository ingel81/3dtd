import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TdIconComponent } from '../../../icon/icon.component';
import { GameStore } from '../../../../store/game.store';
import type { MapSummary } from '../../../../world/custom-map/map-store';
import type { OwnTileset } from '../../../../world/tileset/own-tileset';
import { WorldChoiceService, type MapChoices } from '../../../../world/world-choice.service';

/**
 * The menu's maps: own maps, the shipped ones and the own 3D Tiles sets,
 * each with its picture, name, author and size. Play loads the page on it
 * (WorldChoiceService), Edit opens the map editor on it.
 */
@Component({
  selector: 'app-map-picker',
  standalone: true,
  imports: [NgTemplateOutlet, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-picker.component.html',
  styleUrl: './map-picker.component.scss',
})
export class MapPickerComponent implements OnInit {
  readonly worlds = inject(WorldChoiceService);
  private readonly game = inject(GameStore);

  /** The maps once listed, null while they load */
  readonly maps = signal<MapChoices | null>(null);
  readonly tilesets = this.worlds.tilesets;

  /** A run under way ends when another world loads */
  readonly runEnds = computed(() => this.game.gameStarted() || this.game.towerCount() > 0);

  async ngOnInit(): Promise<void> {
    this.maps.set(await this.worlds.listMaps());
  }

  isCurrentMap(m: MapSummary): boolean {
    return this.worlds.isCurrent({ kind: 'custom-map', mapId: m.id, contentHash: '' });
  }

  isCurrentTileset(t: OwnTileset): boolean {
    return this.worlds.isCurrent({ kind: 'tileset', id: t.id });
  }

  /** "by Author | 512 x 512 m | 2 spawns | Temperate", what the list knows of the map */
  mapLine(m: MapSummary): string {
    const parts: string[] = [];
    if (m.author) parts.push(`by ${m.author}`);
    if (m.width && m.depth) parts.push(`${Math.round(m.width)} x ${Math.round(m.depth)} m`);
    if (m.spawns) parts.push(`${m.spawns} ${m.spawns === 1 ? 'spawn' : 'spawns'}`);
    if (m.biome) parts.push(m.biome.charAt(0).toUpperCase() + m.biome.slice(1));
    return parts.join(' | ');
  }

  /** "Attribution | 1.4 km around its middle" */
  tilesetLine(t: OwnTileset): string {
    const radius = t.coverage.radiusM >= 1000 ? `${(t.coverage.radiusM / 1000).toFixed(1)} km` : `${Math.round(t.coverage.radiusM)} m`;
    return [t.attribution, `${radius} around its middle`].filter(Boolean).join(' | ');
  }

  play(m: MapSummary): void {
    this.worlds.playMap(m.id);
  }

  playTileset(t: OwnTileset): void {
    this.worlds.playTileset(t);
  }
}
