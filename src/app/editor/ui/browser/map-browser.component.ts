import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { DEFAULT_CELL_SIZE } from '../../../world/custom-map/map-create';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../ops/generate';
import { MAP_FILE_EXTENSION, packMapFile } from '../../../world/custom-map/map-file';
import type { MapSummary } from '../../../world/custom-map/map-store';
import { download, EditorSession } from '../editor-session.service';
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
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-browser.component.html',
  styleUrl: './map-browser.component.scss',
})
export class MapBrowserComponent implements OnInit, OnDestroy {
  readonly session = inject(EditorSession);
  /** Why the map in the address did not open */
  readonly problem = input<string | null>(null);
  readonly open = output<string>();

  readonly own = signal<MapSummary[]>([]);
  readonly shipped = signal<MapSummary[]>([]);
  readonly chosen = signal<MapSummary | null>(null);
  readonly mode = signal<'details' | 'new'>('details');
  readonly previews = signal<Record<string, string>>({});
  readonly confirmDelete = signal<string | null>(null);
  readonly busy = signal(false);
  readonly dragging = signal(false);

  // New map form
  readonly presets = SIZE_PRESETS;
  readonly newName = signal('New map');
  readonly newAuthor = signal('');
  readonly newSize = signal<string>('m');
  readonly presets2 = TERRAIN_PRESETS;
  readonly newPreset = signal<TerrainPreset>('hills');
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
    const [own, shipped] = await Promise.all([store.listOwn().catch(() => []), store.listShipped()]);
    this.own.set(own);
    this.shipped.set(shipped);
    const previews: Record<string, string> = { ...this.previews() };
    for (const m of own) {
      const bytes = await store.previewOf(m.id).catch(() => null);
      if (bytes) {
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
        this.urls.push(url);
        previews[`own:${m.id}`] = url;
      }
    }
    for (const m of shipped) {
      const url = await store.shippedPreviewUrl(m.id);
      if (url) previews[`shipped:${m.id}`] = url;
    }
    this.previews.set(previews);
    const all = [...own, ...shipped];
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
    if (m.origin === 'own') parts.push(`${m.spawns} ${m.spawns === 1 ? 'spawn' : 'spawns'}`, `${m.objects} objects`);
    // Generated maps carry the epoch as their time: no date then
    if (m.updatedAt && Date.parse(m.updatedAt) > Date.UTC(2000, 0, 1)) parts.push(formatDate(m.updatedAt));
    return parts.join(' | ');
  }

  async openChosen(): Promise<void> {
    const m = this.chosen();
    if (!m) return;
    if (m.origin === 'shipped') return this.duplicate(m, true);
    this.open.emit(m.id);
  }

  async duplicate(m: MapSummary, thenOpen = false): Promise<void> {
    this.busy.set(true);
    try {
      const copy = await this.session.store.duplicate(m.id, undefined, m.origin);
      await this.reload(copy.doc.meta.id);
      if (thenOpen) this.open.emit(copy.doc.meta.id);
    } finally {
      this.busy.set(false);
    }
  }

  async remove(m: MapSummary): Promise<void> {
    if (this.confirmDelete() !== m.id) {
      this.confirmDelete.set(m.id);
      return;
    }
    this.confirmDelete.set(null);
    await this.session.store.delete(m.id);
    await this.reload();
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
      );
      this.open.emit(id);
    } finally {
      this.busy.set(false);
    }
  }

  async importFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    this.busy.set(true);
    try {
      let last: string | null = null;
      for (const f of Array.from(files)) last = (await this.session.importFile(f)) ?? last;
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

  async startW3x(metresPerTile: number, maxObjects: number, cropToPlayable: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const id = await this.session.importW3x({
        metresPerTile: Math.min(16, Math.max(1, metresPerTile || 4)),
        maxObjects: Math.min(20000, Math.max(0, Math.round(maxObjects))),
        cropToPlayable,
      });
      if (id) await this.reload(id);
    } finally {
      this.busy.set(false);
    }
  }

  closeImport(): void {
    this.session.importState.set(null);
  }

  readonly asValue = (e: Event) => (e.target as HTMLInputElement).value;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
