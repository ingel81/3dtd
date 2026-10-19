import { AgentControlComponent } from '../agent/agent-control.component';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { biomeById } from '../../ops/landscape/biomes';
import { MAP_TEMPLATES, templateById, type MapTemplate } from '../../ops/landscape/templates';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { DEFAULT_CELL_SIZE } from '../../../world/custom-map/map-create';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../../map-ops/generate';
import type { MapSummary } from '../../../world/custom-map/map-store';
import { EditorSession } from '../editor-session.service';
import type { EditorMake } from '../../../world/app-screen.service';
import { BrowserBack } from '../../../world/browser-back.service';
import { WorldsStageService } from '../../../worlds/worlds-stage.service';
import { WorldPathComponent, type PathAction } from '../../../components/world-path/world-path.component';
import { MatDialog } from '@angular/material/dialog';
import type { GroundMaterialEntry } from '../../../map-ops/asset-catalog';
import { AddressAutocompleteComponent } from '../../../components/address-autocomplete.component';
import { OsmFrameComponent } from '../../../components/osm-frame/osm-frame.component';
import type { OsmFrameRequest } from '../../../components/osm-frame/osm-frame-request';
import { placeLabel } from '../../../services/location/place-label';
import type { NominatimAddress } from '../../../services/location/geocoding.service';
import { injectT } from '../../../i18n/i18n.service';

/** A size for a new map; its name is the dictionary's (i18n `editor.browser.sizes`) */
export interface SizePreset {
  id: 's' | 'm' | 'l' | 'w';
  width: number;
  depth: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 's', width: 512, depth: 512 },
  { id: 'm', width: 1024, depth: 1024 },
  { id: 'l', width: 2048, depth: 2048 },
  { id: 'w', width: 2048, depth: 1024 },
];

/**
 * The editor making a map, before one is open (docs/WORLDS_STATE_PLAN.md):
 * a new one's form (a landscape, or a real place made from OpenStreetMap)
 * or files read in (`.3dtdmap`, Warcraft maps with their options and
 * report). The list of maps is the Built Worlds' menu, the one list; New
 * map and Import file there open this page, a map made or read in opens in
 * the editor, Back (Esc) goes back to that menu.
 */
@Component({
  selector: 'app-map-make',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule, AgentControlComponent, AddressAutocompleteComponent, OsmFrameComponent, WorldPathComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  templateUrl: './map-make.component.html',
  styleUrl: './map-make.component.scss',
})
export class MapMakeComponent implements OnInit, OnDestroy {
  protected readonly t = injectT();
  readonly session = inject(EditorSession);
  private readonly stage = inject(WorldsStageService);
  private readonly dialog = inject(MatDialog);
  /** The browser's Back while the page shows: the step Esc takes (BrowserBack) */
  private readonly offBack = inject(BrowserBack).register(() => this.browserBack());
  readonly pathChips = computed(() => this.stage.pathChips(null, false));

  /** What the page was opened to make */
  readonly make = input.required<EditorMake>();
  /** Why the map asked for did not open */
  readonly problem = input<string | null>(null);
  /** A map made or read in: the editor opens it */
  readonly open = output<string>();
  /** Back to the Built Worlds' menu, nothing made */
  readonly done = output<void>();

  readonly busy = signal(false);
  readonly dragging = signal(false);
  /** Read files in rather than a new map's form (Import file, a file dropped on the page) */
  readonly importing = signal(false);

  // New map form
  /** A landscape of the editor's, or a real place made from OpenStreetMap (an OSM world) */
  readonly newFrom = signal<'landscape' | 'place'>('landscape');
  /** The real place whose frame shows, null while searching */
  readonly osmPlace = signal<OsmFrameRequest | null>(null);
  readonly presets = SIZE_PRESETS;
  readonly newName = signal(this.t().editor.browser.newMapName);
  readonly newAuthor = signal('');
  readonly newSize = signal<string>('m');
  readonly presets2 = TERRAIN_PRESETS;
  readonly newPreset = signal<TerrainPreset>('hills');
  /** A ready landscape by default: an empty plain says little about what the editor can do; '' for none */
  readonly newTemplate = signal('meadows');
  readonly templates = MAP_TEMPLATES;
  readonly templatePicture = (t: MapTemplate) => this.session.pictures.biomePicture(biomeById(t.biome));
  readonly progress = this.session.maps.templateProgress;
  readonly percent = computed(() => Math.round((this.progress() ?? 0) * 100));
  readonly newSeed = signal(Math.floor(Math.random() * 100000));
  readonly newStrength = signal(60);
  readonly newMaterial = signal('grass');
  readonly materials = computed(() => this.session.catalog().catalog.materials);
  readonly thumb = (m: GroundMaterialEntry) => this.session.pictures.materialPicture(m);

  /** The page's title, as the path names it */
  readonly title = computed(() => (this.importing() ? this.t().editor.browser.importFile : this.t().editor.browser.newMap));

  ngOnInit(): void {
    const make = this.make();
    if (make.kind === 'import') void this.importFiles(make.files);
  }

  ngOnDestroy(): void {
    this.offBack();
  }

  rollSeed(): void {
    this.newSeed.set(Math.floor(Math.random() * 100000));
  }

  choosePlace(found: { lat: number; lon: number; name: string; address?: NominatimAddress }): void {
    this.osmPlace.set({ place: { lat: found.lat, lon: found.lon, name: placeLabel(found.name, found.address), address: found.name }, spawnsAt: [] });
  }

  /** A map made from a real place: stored already, it opens */
  openMade(summary: MapSummary): void {
    this.osmPlace.set(null);
    this.open.emit(summary.id);
  }

  async createMap(): Promise<void> {
    const preset = SIZE_PRESETS.find((p) => p.id === this.newSize()) ?? SIZE_PRESETS[1];
    this.busy.set(true);
    try {
      const id = await this.session.maps.createNew(
        {
          name: this.newName().trim() || this.t().editor.browser.newMapName,
          author: this.newAuthor().trim(),
          width: preset.width,
          depth: preset.depth,
          cellSize: DEFAULT_CELL_SIZE,
          ground: 'flat',
          baseMaterial: this.newMaterial(),
        },
        { preset: this.newPreset(), seed: this.newSeed(), strength: this.newStrength() / 100 },
        templateById(this.newTemplate()),
      );
      // Busy until the editor takes the page: the form does not come back to life for a moment first
      this.open.emit(id);
    } catch (e) {
      this.busy.set(false);
      throw e;
    }
  }

  /**
   * Files read in one after the other: one map read straight in opens; several go back to the
   * Built Worlds' menu, which lists them; a Warcraft map shows its options, a file matching an own
   * map waits for Replace or Keep both, a file that is no map says why
   */
  async importFiles(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    this.importing.set(true);
    this.busy.set(true);
    try {
      const made: string[] = [];
      for (const f of files) {
        const id = await this.session.library.importFile(f);
        if (id) made.push(id);
        // A file that matches an own map waits for the answer; the rest can come again after
        if (this.session.library.importMatch()) break;
      }
      if (this.session.library.importMatch() || this.session.library.importState() || this.session.notices.error()) return;
      if (made.length === 1) this.open.emit(made[0]);
      else if (made.length > 1) this.done.emit();
    } finally {
      this.busy.set(false);
    }
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.importFiles(Array.from(input.files ?? [])).then(() => (input.value = ''));
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.importFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  /** A step of the path: Worlds to the globes, Built Worlds to its menu, a chip to its world's Continue */
  onPath(action: PathAction): void {
    if (typeof action === 'object') this.stage.goChip(action.chip);
    else if (action === 'world') this.done.emit();
    else if (action === 'worlds') this.stage.leaveEditorTo(null);
  }

  /**
   * Esc steps back one level: a question, the import panel, the frame of a real place, then back to the
   * Built Worlds' menu
   */
  onEscape(event: Event): void {
    // A dialog over the page and a list of addresses keep their own Esc
    if (event.defaultPrevented || this.dialog.openDialogs.length > 0) return;
    event.preventDefault();
    this.stepBack();
  }

  /** One level up, for Esc and the browser's Back (BrowserBack); true when it took a step */
  private stepBack(): boolean {
    if (this.busy() && !this.session.library.importState()) return true;
    if (this.session.library.importMatch()) void this.resolveImport('cancel');
    else if (this.session.library.importState()) this.closeImport();
    else if (this.osmPlace()) this.osmPlace.set(null);
    else this.done.emit();
    return true;
  }

  /** The browser's Back: a dialog over the page first, then the step Esc takes */
  private browserBack(): boolean {
    const dialogs = this.dialog.openDialogs;
    if (dialogs.length > 0) {
      dialogs[dialogs.length - 1].close();
      return true;
    }
    return this.stepBack();
  }

  async startW3x(metresPerTile: number, maxObjects: number, cropToPlayable: boolean, enhance: boolean, waves: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await this.session.library.importW3x({
        metresPerTile: Math.min(16, Math.max(1, metresPerTile || 4)),
        maxObjects: Math.min(20000, Math.max(0, Math.round(maxObjects))),
        cropToPlayable,
        style: enhance ? 'enhanced' : 'original',
        waves,
      });
    } finally {
      this.busy.set(false);
    }
  }

  async resolveImport(choice: 'replace' | 'copy' | 'cancel'): Promise<void> {
    const id = await this.session.library.resolveImport(choice);
    // A Warcraft map's report stays to be read: its Open the map opens it
    if (this.session.library.importState()) return;
    if (id) this.open.emit(id);
    else this.done.emit();
  }

  when(iso: string): string {
    return formatDate(iso);
  }

  /** Closes the panel (a running import stops), back to the Built Worlds' menu */
  closeImport(): void {
    this.session.library.cancelImport();
    this.done.emit();
  }

  readonly asValue = (e: Event) => (e.target as HTMLInputElement).value;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
