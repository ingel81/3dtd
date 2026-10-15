import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { MapVersion } from '../../model/version-store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../ops/generate';
import { detailTarget } from '../../ops/detail';
import { rangeFromName } from '../../ops/heightmap';
import { RangeRowComponent } from './range-row.component';
import { EditorSession } from '../editor-session.service';
import { MapBudgetComponent } from './map-budget.component';
import { IntroPanelComponent } from './intro-panel.component';

/** Name, author, description; budget; size and resize; the intro flight */
@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [RangeRowComponent, MatTooltipModule, MapBudgetComponent, IntroPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    @if (meta(); as m) {
      <label class="td-field">
        <span class="td-label">Name</span>
        <input class="td-input" type="text" maxlength="60" [value]="m.name" (change)="edit('name', $event)" data-test="map-name-input" />
      </label>
      <label class="td-field">
        <span class="td-label">Author</span>
        <input class="td-input" type="text" maxlength="60" [value]="m.author" (change)="edit('author', $event)" />
      </label>
      <label class="td-field">
        <span class="td-label">Description</span>
        <textarea class="td-input mp-text" rows="4" maxlength="600" [value]="m.description" (change)="edit('description', $event)"></textarea>
      </label>
      <p class="td-note">Id {{ m.id }}@if (m.source?.kind === 'w3x') { | imported from {{ m.source.file }} } @else if (m.source?.kind === 'osm') { | made from OpenStreetMap at {{ m.source.address }} }</p>
    }
    <app-map-budget />
    @if (size(); as s) {
      <div class="td-group">
        <h3 class="td-section">Size</h3>
        <p class="td-note">{{ s.width }} x {{ s.depth }} m | {{ s.columns }} x {{ s.rows }} height points every {{ s.cell }} m | ground paint {{ s.splat }} px</p>
        <div class="mp-size">
          <label class="td-field">
            <span class="td-label">Width</span>
            <input class="td-input is-sm" type="number" min="64" max="8192" step="64" [value]="width() ?? s.width" (input)="width.set(num($event))" />
          </label>
          <label class="td-field">
            <span class="td-label">Depth</span>
            <input class="td-input is-sm" type="number" min="64" max="8192" step="64" [value]="depth() ?? s.depth" (input)="depth.set(num($event))" />
          </label>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="resize()">Resize</button>
        </div>
        <p class="td-note">Resizing keeps the middle; smaller crops the edges, larger extends them at the edge height.</p>
        @if (s.coarse) {
          <p class="td-note mp-warn">This map's ground is coarser than new maps and the shipped levels have (height points every 2 m, ground paint {{ s.target }} px).</p>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="increaseDetail()" data-test="increase-detail">Increase detail</button>
        }
      </div>
    }
    <app-intro-panel />
    <div class="td-group">
      <h3 class="td-section">Generate terrain</h3>
      <div class="td-seg is-sm mp-presets" role="radiogroup" aria-label="Landscape">
        @for (p of presets; track p.id) {
          @if (p.id !== 'flat') {
            <button type="button" role="radio" [attr.aria-checked]="preset() === p.id" [matTooltip]="p.hint" (click)="preset.set(p.id)">{{ p.label }}</button>
          }
        }
      </div>
      <div class="mp-size">
        <label class="td-field">
          <span class="td-label">Seed</span>
          <input class="td-input is-sm" type="number" min="0" [value]="seed()" (input)="seed.set(num($event))" />
        </label>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="roll()">Roll</button>
      </div>
      <app-editor-range label="Strength" unit="%" [min]="10" [max]="100" [value]="strength()" (changing)="strength.set($event)" />
      <div class="td-seg is-sm" role="radiogroup" aria-label="Replace or add">
        <button type="button" role="radio" [attr.aria-checked]="!add()" (click)="add.set(false)">Replace the ground</button>
        <button type="button" role="radio" [attr.aria-checked]="add()" (click)="add.set(true)">Add to it</button>
      </div>
      <div class="td-setting">
        <span>Repaint by slope and height</span>
        <input class="td-switch" type="checkbox" [checked]="repaint()" (change)="repaint.set($any($event.target).checked)" aria-label="Repaint" />
      </div>
      @if (job(); as j) {
        <div class="mp-job" role="status" data-test="terrain-job">
          <span class="td-note">{{ j.label }} {{ percent(j.progress) }} %</span>
          <progress class="mp-progress" max="100" [value]="percent(j.progress)"></progress>
          <button class="td-btn-ghost td-btn-sm" type="button" (click)="cancel()" data-test="terrain-cancel">Cancel</button>
        </div>
      } @else {
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="generate()" data-test="generate">Generate</button>
      }
      <p class="td-note">Roads keep a level bed; one undo step takes it all back. Big maps build in the background, band by band.</p>
    </div>
    <div class="td-group">
      <h3 class="td-section">Erode the whole map</h3>
      <app-editor-range label="Rain" unit="%" [min]="10" [max]="100" [value]="rain()" (changing)="rain.set($event)" />
      <button class="td-btn-secondary td-btn-sm" type="button" [disabled]="!!job()" (click)="erode()" data-test="erode-map">Erode</button>
      <p class="td-note">Rain carves gullies down every slope and leaves fans of scree at their feet; flat land stays. Cancel or one undo step takes it back.</p>
    </div>
    <div class="td-group" data-test="heightmap">
      <h3 class="td-section">Heightmap</h3>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="exportHeights('png')">Export 16-bit PNG</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="exportHeights('raw')">Export RAW</button>
      </div>
      <div class="mp-size">
        <label class="td-field">
          <span class="td-label">Lowest m</span>
          <input class="td-input is-sm" type="number" step="0.5" [value]="low()" (input)="low.set(num($event))" data-test="heightmap-low" />
        </label>
        <label class="td-field">
          <span class="td-label">Highest m</span>
          <input class="td-input is-sm" type="number" step="0.5" [value]="high()" (input)="high.set(num($event))" data-test="heightmap-high" />
        </label>
        <label class="td-btn-secondary td-btn-sm mp-file" matTooltip="A 16-bit greyscale PNG or a square 16-bit RAW (Gaea, World Machine …), scaled to the map">
          Import…
          <input type="file" accept=".png,.raw,.r16" (change)="importHeights($event)" data-test="heightmap-file" />
        </label>
      </div>
      <p class="td-note">Black is the lowest, white the highest height. An exported file carries its range in its name, an import of it fills the fields; one undo step.</p>
    </div>
    <div class="td-group" data-test="storage">
      <h3 class="td-section">Storage</h3>
      @switch (storage()) {
        @case ('folder') {
          <p class="td-note">Every save also goes to the map folder (Documents/3DTD/Maps) as a file.</p>
        }
        @case ('kept') {
          <p class="td-note">This browser keeps your maps for good (persistent storage).</p>
        }
        @case ('evictable') {
          <p class="td-note mp-warn">This browser has not promised to keep your maps: clearing site data or a full disk removes them, versions included. Download the map file now and then.</p>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="download()" data-test="storage-download">Download map file</button>
        }
        @default {
          <p class="td-note">Checking how this browser keeps maps</p>
        }
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">Versions</h3>
      <div class="td-rows" data-test="versions">
        @for (v of versions(); track v.key) {
          <div class="td-row mp-version" [attr.data-pinned]="v.pinned || null">
            <span class="td-trunc">{{ when(v.savedAt) }}</span>
            <span class="td-muted">{{ v.manual ? 'Saved' : 'Autosave' }} | {{ kb(v.size) }}</span>
            <button class="td-btn-ghost td-btn-sm" type="button" [attr.aria-pressed]="!!v.pinned" (click)="pin(v)"
                    [matTooltip]="v.pinned ? 'Pinned: kept whatever happens to older versions. Click to let it go' : 'Pin: keep this version for good'" data-test="pin-version">{{ v.pinned ? 'Pinned' : 'Pin' }}</button>
            <button class="td-btn-ghost td-btn-sm" type="button" (click)="restore(v)" [matTooltip]="'Put this version back (one undo step)'">Restore</button>
          </div>
        } @empty {
          <p class="td-note">Every save and an autosave every few minutes land here.</p>
        }
      </div>
      <p class="td-note">Older versions thin out: all of the last hour, one an hour for a day, one a day for a month, one a week before. Pinned ones stay.</p>
    </div>
  `,
  styles: [
    `.mp-job { display: flex; align-items: center; gap: 8px; } .mp-progress { flex: 1 1 auto; height: 6px; accent-color: var(--td-brass); }
     .mp-warn { color: var(--td-warn-text); } .mp-file { position: relative; overflow: hidden; } .mp-file > input { position: absolute; inset: 0; opacity: 0; cursor: pointer; } .mp-version { gap: 8px; min-height: 30px; } .mp-version > .td-trunc { flex: 1 1 auto; }
     .mp-text { height: auto; padding-top: 8px; resize: vertical; } .mp-size { display: flex; align-items: flex-end; gap: 8px; }
     .mp-presets { flex-wrap: wrap; height: auto; } .mp-presets > * { flex: 1 0 30%; }`,
  ],
})
export class MapPanelComponent {
  private readonly session = inject(EditorSession);
  readonly meta = computed(() => this.session.meta());
  readonly presets = TERRAIN_PRESETS;
  readonly preset = signal<TerrainPreset>('hills');
  readonly seed = signal(Math.floor(Math.random() * 100000));
  readonly strength = signal(60);
  readonly add = signal(false);
  readonly repaint = signal(true);
  readonly width = signal<number | null>(null);
  readonly depth = signal<number | null>(null);
  readonly size = computed(() => {
    this.session.docRev();
    const t = this.session.doc?.terrain;
    if (!t) return null;
    const target = detailTarget(t);
    return {
      width: t.width,
      depth: t.depth,
      columns: t.grid.columns,
      rows: t.grid.rows,
      cell: +t.grid.cellSize.toFixed(2),
      splat: t.splat.resolution,
      coarse: !!target,
      target: target?.splatResolution ?? t.splat.resolution,
    };
  });

  readonly versions = this.session.versions;
  readonly storage = this.session.storage;
  /** Height range for a heightmap import, metres */
  readonly low = signal(0);
  readonly high = signal(50);

  exportHeights(format: 'png' | 'raw'): void {
    this.session.downloadHeightmap(format);
  }

  async importHeights(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // An exported file says its range; the fields take it
    const range = rangeFromName(file.name);
    if (range) {
      this.low.set(range.low);
      this.high.set(range.high);
    }
    await this.session.importHeightmap(file, this.low(), this.high());
  }

  download(): void {
    this.session.downloadFile();
  }

  when(iso: string): string {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  kb(bytes: number): string {
    return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`;
  }

  pin(v: MapVersion): void {
    void this.session.pinVersion(v, !v.pinned);
  }

  restore(v: MapVersion): void {
    void this.session.restoreVersion(v);
  }

  edit(key: 'name' | 'author' | 'description', e: Event): void {
    const value = (e.target as HTMLInputElement).value.trim();
    if (key === 'name' && !value) return;
    this.session.editMeta({ [key]: value });
  }

  resize(): void {
    const s = this.size();
    if (!s) return;
    const w = Math.min(8192, Math.max(64, this.width() ?? s.width));
    const d = Math.min(8192, Math.max(64, this.depth() ?? s.depth));
    if (w === s.width && d === s.depth) return;
    this.session.resize(w, d);
    this.width.set(null);
    this.depth.set(null);
  }

  increaseDetail(): void {
    this.session.increaseDetail();
  }

  roll(): void {
    this.seed.set(Math.floor(Math.random() * 100000));
  }

  readonly job = this.session.terrainJob;
  readonly rain = signal(50);

  percent(p: number): number {
    return Math.round(p * 100);
  }

  async generate(): Promise<void> {
    const done = await this.session.generate({ preset: this.preset(), seed: this.seed(), strength: this.strength() / 100, add: this.add() }, this.repaint());
    if (done) this.session.flash('Terrain generated; Ctrl+Z takes it back');
  }

  async erode(): Promise<void> {
    if (await this.session.erodeWholeMap(this.rain() / 100)) this.session.flash('The map is eroded; Ctrl+Z takes it back');
  }

  cancel(): void {
    this.session.cancelTerrainJob();
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }
}
