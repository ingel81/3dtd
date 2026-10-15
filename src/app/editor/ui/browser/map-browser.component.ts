import { AgentControlComponent } from '../agent/agent-control.component';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { biomeById } from '../../ops/landscape/biomes';
import { MAP_TEMPLATES, templateById, type MapTemplate } from '../../ops/landscape/templates';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { DEFAULT_CELL_SIZE } from '../../../world/custom-map/map-create';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../ops/generate';
import { MAP_FILE_EXTENSION, packMapFile } from '../../../world/custom-map/map-file';
import { TRASH_DAYS, type MapSummary } from '../../../world/custom-map/map-store';
import { download, EditorSession } from '../editor-session.service';
import { WorldChoiceService } from '../../../world/world-choice.service';
import type { GroundMaterialEntry } from '../../catalog/asset-catalog';

export interface SizePreset {
  id: string;
  label: string;
  width: number;
  depth: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: 's', label: 'Small', width: 512, depth: 512 },
  { id: 'm', label: 'Medium', width: 1024, depth: 1024 },
  { id: 'l', label: 'Large', width: 2048, depth: 2048 },
  { id: 'w', label: 'Wide', width: 2048, depth: 1024 },
];

/**
 * The start of `/editor`: own and shipped maps as a list with a picture,
 * details of the chosen one beside it, and New map, Import. Shipped maps
 * open only as a copy.
 */
@Component({
  selector: 'app-map-browser',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule, AgentControlComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-browser.component.html',
  styleUrl: './map-browser.component.scss',
})
export class MapBrowserComponent implements OnInit, OnDestroy {
  readonly session = inject(EditorSession);
  /** The desktop app's map folder (its button) */
  readonly worlds = inject(WorldChoiceService);
  /** Why the map in the address did not open */
  readonly problem = input<string | null>(null);
  readonly open = output<string>();

  readonly own = signal<MapSummary[]>([]);
  readonly shipped = signal<MapSummary[]>([]);
  /** Maps a coop host sent: kept apart, opened as copies like the shipped ones */
  readonly shared = signal<MapSummary[]>([]);
  readonly chosen = signal<MapSummary | null>(null);
  readonly mode = signal<'details' | 'new'>('details');
  readonly previews = signal<Record<string, string>>({});
  readonly confirmDelete = signal<string | null>(null);
  /** Deleted own maps, waiting TRASH_DAYS */
  readonly trash = signal<MapSummary[]>([]);
  /** The map just moved to the trash, for the banner that can bring it back */
  readonly trashed = signal<{ key: string; name: string } | null>(null);
  /** The trash entry asking whether to go for good */
  readonly confirmPurge = signal<string | null>(null);
  readonly trashDays = TRASH_DAYS;
  readonly busy = signal(false);
  readonly dragging = signal(false);

  // New map form
  readonly presets = SIZE_PRESETS;
  readonly newName = signal('New map');
  readonly newAuthor = signal('');
  readonly newSize = signal<string>('m');
  readonly presets2 = TERRAIN_PRESETS;
  readonly newPreset = signal<TerrainPreset>('hills');
  /** A template for the new map, '' for none */
  /** A ready landscape by default: an empty plain says little about what the editor can do */
  readonly newTemplate = signal('meadows');
  readonly templates = MAP_TEMPLATES;
  readonly templatePicture = (t: MapTemplate) => this.session.biomePicture(biomeById(t.biome));
  readonly progress = this.session.templateProgress;
  readonly percent = computed(() => Math.round((this.progress() ?? 0) * 100));
  readonly newSeed = signal(Math.floor(Math.random() * 100000));
  readonly newStrength = signal(60);
  readonly newMaterial = signal('grass');
  readonly materials = computed(() => this.session.catalog().catalog.materials);
  readonly thumb = (m: GroundMaterialEntry) => this.session.materialPicture(m);

  private urls: string[] = [];

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  ngOnDestroy(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
  }

  async reload(select?: string): Promise<void> {
    const store = this.session.store;
    const [stored, shipped, trash] = await Promise.all([store.listOwn().catch(() => []), store.listShipped(), this.session.listTrash().catch(() => [])]);
    this.trash.set(trash);
    const own = stored.filter((m) => m.origin !== 'shared');
    const shared = stored.filter((m) => m.origin === 'shared');
    this.own.set(own);
    this.shared.set(shared);
    this.shipped.set(shipped);
    // Stored pictures anew: a deleted map's picture must not stay with a new map of its id
    const previews: Record<string, string> = Object.fromEntries(
      Object.entries(this.previews()).filter(([k]) => !k.startsWith('own:') && !k.startsWith('shared:')),
    );
    for (const m of stored) {
      const bytes = await store.previewOf(m.id).catch(() => null);
      if (bytes) {
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
        this.urls.push(url);
        previews[`${m.origin}:${m.id}`] = url;
      }
    }
    for (const m of shipped) {
      const url = await store.shippedPreviewUrl(m.id);
      if (url) previews[`shipped:${m.id}`] = url;
    }
    this.previews.set(previews);
    const all = [...own, ...shared, ...shipped];
    const keep = select ?? this.chosen()?.id;
    this.chosen.set(all.find((m) => m.id === keep) ?? all[0] ?? null);
  }

  preview(m: MapSummary): string | null {
    return this.previews()[`${m.origin}:${m.id}`] ?? null;
  }

  choose(m: MapSummary): void {
    this.chosen.set(m);
    this.mode.set('details');
    this.confirmDelete.set(null);
  }

  line(m: MapSummary): string {
    const parts = [`${Math.round(m.width)} x ${Math.round(m.depth)} m`];
    if (m.origin !== 'shipped') parts.push(`${m.spawns} ${m.spawns === 1 ? 'spawn' : 'spawns'}`, `${m.objects} objects`);
    // Generated maps carry the epoch as their time: no date then
    if (m.updatedAt && Date.parse(m.updatedAt) > Date.UTC(2000, 0, 1)) parts.push(formatDate(m.updatedAt));
    return parts.join(' | ');
  }

  async openChosen(): Promise<void> {
    const m = this.chosen();
    if (!m) return;
    // Shipped maps and coop hosts' maps open as an own copy (EditorSession.open)
    this.open.emit(m.id);
  }

  async duplicate(m: MapSummary): Promise<void> {
    this.busy.set(true);
    try {
      const copy = await this.session.store.duplicate(m.id, undefined, m.origin);
      await this.reload(copy.doc.meta.id);
    } finally {
      this.busy.set(false);
    }
  }

  /** An own map goes to the trash at once (it can come back); a coop host's map is asked about and goes for good */
  async remove(m: MapSummary): Promise<void> {
    if (m.origin === 'own') {
      const key = await this.session.deleteMap(m.id, m.name);
      if (!key) return;
      this.trashed.set({ key, name: m.name });
      await this.reload();
      return;
    }
    if (this.confirmDelete() !== m.id) {
      this.confirmDelete.set(m.id);
      return;
    }
    this.confirmDelete.set(null);
    await this.session.store.delete(m.id);
    await this.reload();
  }

  async restore(key: string): Promise<void> {
    const id = await this.session.restoreMap(key);
    this.trashed.set(null);
    await this.reload(id);
  }

  async purge(m: MapSummary): Promise<void> {
    if (this.confirmPurge() !== m.id) {
      this.confirmPurge.set(m.id);
      return;
    }
    this.confirmPurge.set(null);
    await this.session.deleteForGood(m);
    await this.reload();
  }

  /** "deleted today", "deleted 3 days ago" for the trash list */
  deletedLine(m: MapSummary): string {
    const days = Math.floor((Date.now() - Date.parse(m.trash?.at ?? '')) / 86_400_000);
    const left = Math.max(0, TRASH_DAYS - days);
    const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    return `Deleted ${when} | goes for good in ${left} ${left === 1 ? 'day' : 'days'}`;
  }

  async downloadMap(m: MapSummary): Promise<void> {
    const loaded = await this.session.store.load(m.id, m.origin);
    download(packMapFile(loaded.doc, { preview: loaded.preview ?? undefined }), `${m.id}${MAP_FILE_EXTENSION}`, 'application/zip');
  }

  rollSeed(): void {
    this.newSeed.set(Math.floor(Math.random() * 100000));
  }

  startNew(): void {
    this.mode.set('new');
    this.confirmDelete.set(null);
  }

  async createMap(): Promise<void> {
    const preset = SIZE_PRESETS.find((p) => p.id === this.newSize()) ?? SIZE_PRESETS[1];
    this.busy.set(true);
    try {
      const id = await this.session.createNew(
        {
          name: this.newName().trim() || 'New map',
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

  async importFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    this.busy.set(true);
    try {
      let last: string | null = null;
      for (const f of Array.from(files)) {
        last = (await this.session.importFile(f)) ?? last;
        // A file that matches an own map waits for the answer; the rest can come again after
        if (this.session.importMatch()) break;
      }
      await this.reload(last ?? undefined);
    } finally {
      this.busy.set(false);
    }
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.importFiles(input.files).then(() => (input.value = ''));
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.importFiles(event.dataTransfer?.files ?? null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  backToGame(): void {
    window.location.href = new URL('./', document.baseURI).toString();
  }

  async startW3x(metresPerTile: number, maxObjects: number, cropToPlayable: boolean, enhance: boolean, waves: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const id = await this.session.importW3x({
        metresPerTile: Math.min(16, Math.max(1, metresPerTile || 4)),
        maxObjects: Math.min(20000, Math.max(0, Math.round(maxObjects))),
        cropToPlayable,
        style: enhance ? 'enhanced' : 'original',
        waves,
      });
      if (id) await this.reload(id);
    } finally {
      this.busy.set(false);
    }
  }

  async resolveImport(choice: 'replace' | 'copy' | 'cancel'): Promise<void> {
    const id = await this.session.resolveImport(choice);
    if (id) await this.reload(id);
  }

  when(iso: string): string {
    return formatDate(iso);
  }

  /** Closes the panel; a running import stops */
  closeImport(): void {
    this.session.cancelImport();
  }

  readonly asValue = (e: Event) => (e.target as HTMLInputElement).value;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
