import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { MapVersion } from '../../model/version-store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../../map-ops/generate';
import { detailTarget } from '../../ops/detail';
import { rangeFromName } from '../../ops/heightmap';
import { RangeRowComponent } from './range-row.component';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { MapBudgetComponent } from './map-budget.component';
import { IntroPanelComponent } from './intro-panel.component';
import { injectT } from '../../../i18n/i18n.service';

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
        <span class="td-label">{{ t().editor.mapPanel.name }}</span>
        <input class="td-input" type="text" maxlength="60" [value]="m.name" (change)="edit('name', $event)" data-test="map-name-input" />
      </label>
      <label class="td-field">
        <span class="td-label">{{ t().editor.mapPanel.author }}</span>
        <input class="td-input" type="text" maxlength="60" [value]="m.author" (change)="edit('author', $event)" />
      </label>
      <label class="td-field">
        <span class="td-label">{{ t().editor.mapPanel.description }}</span>
        <textarea class="td-input mp-text" rows="4" maxlength="600" [value]="m.description" (change)="edit('description', $event)"></textarea>
      </label>
      <p class="td-note">{{ t().editor.mapPanel.idLine(m.id) }}@if (m.source?.kind === 'w3x') { {{ t().editor.mapPanel.importedFrom(m.source.file) }} } @else if (m.source?.kind === 'osm') { {{ t().editor.mapPanel.madeFromOsm(m.source.address) }} }</p>
    }
    <app-map-budget />
    @if (size(); as s) {
      <div class="td-group">
        <h3 class="td-section">{{ t().editor.mapPanel.size }}</h3>
        <p class="td-note">{{ t().editor.mapPanel.sizeLine(s) }}</p>
        <div class="mp-size">
          <label class="td-field">
            <span class="td-label">{{ t().editor.mapPanel.width }}</span>
            <input class="td-input is-sm" type="number" min="64" max="8192" step="64" [value]="width() ?? s.width" (input)="width.set(num($event))" />
          </label>
          <label class="td-field">
            <span class="td-label">{{ t().editor.mapPanel.depth }}</span>
            <input class="td-input is-sm" type="number" min="64" max="8192" step="64" [value]="depth() ?? s.depth" (input)="depth.set(num($event))" />
          </label>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="resize()">{{ t().editor.mapPanel.resize }}</button>
        </div>
        <p class="td-note">{{ t().editor.mapPanel.resizeNote }}</p>
        @if (s.coarse) {
          <p class="td-note mp-warn">{{ t().editor.mapPanel.coarse(s.target) }}</p>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="increaseDetail()" data-test="increase-detail">{{ t().editor.mapPanel.increaseDetail }}</button>
        }
      </div>
    }
    <app-intro-panel />
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.mapPanel.generateHead }}</h3>
      <div class="td-seg is-sm mp-presets" role="radiogroup" [attr.aria-label]="t().editor.mapPanel.presetsLabel">
        @for (p of presets; track p.id) {
          @if (p.id !== 'flat') {
            <button type="button" role="radio" [attr.aria-checked]="preset() === p.id" [matTooltip]="t().editor.presets[p.id].hint" (click)="preset.set(p.id)">{{ t().editor.presets[p.id].label }}</button>
          }
        }
      </div>
      <div class="mp-size">
        <label class="td-field">
          <span class="td-label">{{ t().editor.mapPanel.seed }}</span>
          <input class="td-input is-sm" type="number" min="0" [value]="seed()" (input)="seed.set(num($event))" />
        </label>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="roll()">{{ t().editor.mapPanel.roll }}</button>
      </div>
      <app-editor-range [label]="t().editor.mapPanel.strength" unit="%" [min]="10" [max]="100" [value]="strength()" (changing)="strength.set($event)" />
      <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.mapPanel.replaceOrAdd">
        <button type="button" role="radio" [attr.aria-checked]="!add()" (click)="add.set(false)">{{ t().editor.mapPanel.replace }}</button>
        <button type="button" role="radio" [attr.aria-checked]="add()" (click)="add.set(true)">{{ t().editor.mapPanel.addTo }}</button>
      </div>
      <div class="td-setting">
        <span>{{ t().editor.mapPanel.repaintLong }}</span>
        <input class="td-switch" type="checkbox" [checked]="repaint()" (change)="repaint.set($any($event.target).checked)" [attr.aria-label]="t().editor.mapPanel.repaint" />
      </div>
      <!-- A running job shows above the panels (the shell), with Cancel -->
      <button class="td-btn-secondary td-btn-sm" type="button" [disabled]="!!job()" (click)="generate()" data-test="generate">{{ t().editor.mapPanel.generate }}</button>
      <p class="td-note">{{ t().editor.mapPanel.generateNote }}</p>
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.mapPanel.erodeHead }}</h3>
      <app-editor-range [label]="t().editor.mapPanel.rain" unit="%" [min]="10" [max]="100" [value]="rain()" (changing)="rain.set($event)" />
      <button class="td-btn-secondary td-btn-sm" type="button" [disabled]="!!job()" (click)="erode()" data-test="erode-map">{{ t().editor.mapPanel.erode }}</button>
      <p class="td-note">{{ t().editor.mapPanel.erodeNote }}</p>
    </div>
    <div class="td-group" data-test="heightmap">
      <h3 class="td-section">{{ t().editor.mapPanel.heightmap }}</h3>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="exportHeights('png')">{{ t().editor.mapPanel.exportPng }}</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="exportHeights('raw')">{{ t().editor.mapPanel.exportRaw }}</button>
      </div>
      <div class="mp-size">
        <label class="td-field">
          <span class="td-label">{{ t().editor.mapPanel.lowest }}</span>
          <input class="td-input is-sm" type="number" step="0.5" [value]="low()" (input)="low.set(num($event))" data-test="heightmap-low" />
        </label>
        <label class="td-field">
          <span class="td-label">{{ t().editor.mapPanel.highest }}</span>
          <input class="td-input is-sm" type="number" step="0.5" [value]="high()" (input)="high.set(num($event))" data-test="heightmap-high" />
        </label>
        <label class="td-btn-secondary td-btn-sm mp-file" [matTooltip]="t().editor.mapPanel.importTip">
          {{ t().editor.mapPanel.import }}
          <input type="file" accept=".png,.raw,.r16" (change)="importHeights($event)" data-test="heightmap-file" />
        </label>
      </div>
      <p class="td-note">{{ t().editor.mapPanel.heightmapNote }}</p>
    </div>
    <div class="td-group" data-test="storage">
      <h3 class="td-section">{{ t().editor.mapPanel.storage }}</h3>
      @switch (storage()) {
        @case ('folder') {
          <p class="td-note">{{ t().editor.mapPanel.folder }}</p>
        }
        @case ('kept') {
          <p class="td-note">{{ t().editor.mapPanel.kept }}</p>
        }
        @case ('evictable') {
          <p class="td-note mp-warn">{{ t().editor.mapPanel.evictable }}</p>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="download()" data-test="storage-download">{{ t().editor.mapPanel.downloadFile }}</button>
        }
        @default {
          <p class="td-note">{{ t().editor.mapPanel.checking }}</p>
        }
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.mapPanel.versions }}</h3>
      <div class="td-rows" data-test="versions">
        @for (v of versions(); track v.key) {
          <div class="td-row mp-version" [attr.data-pinned]="v.pinned || null">
            <span class="td-trunc">{{ when(v.savedAt) }}</span>
            <span class="td-muted">{{ v.manual ? t().editor.mapPanel.saved : t().editor.mapPanel.autosave }} | {{ kb(v.size) }}</span>
            <button class="td-btn-ghost td-btn-sm" type="button" [attr.aria-pressed]="!!v.pinned" (click)="pin(v)"
                    [matTooltip]="v.pinned ? t().editor.mapPanel.pinnedTip : t().editor.mapPanel.pinTip" data-test="pin-version">{{ v.pinned ? t().editor.mapPanel.pinned : t().editor.mapPanel.pin }}</button>
            <button class="td-btn-ghost td-btn-sm" type="button" (click)="restore(v)" [matTooltip]="t().editor.mapPanel.restoreTip">{{ t().editor.mapPanel.restore }}</button>
          </div>
        } @empty {
          <p class="td-note">{{ t().editor.mapPanel.noVersions }}</p>
        }
      </div>
      <p class="td-note">{{ t().editor.mapPanel.thinNote }}</p>
    </div>
  `,
  styles: [
    `.mp-warn { color: var(--td-warn-text); } .mp-file { position: relative; overflow: hidden; flex: 0 0 auto; } .mp-file > input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; } .mp-version { gap: 8px; min-height: 30px; } .mp-version > .td-trunc { flex: 1 1 auto; }
     .mp-text { height: auto; padding-top: 8px; resize: vertical; } .mp-size { display: flex; align-items: flex-end; gap: 8px; }
     .mp-presets { flex-wrap: wrap; height: auto; } .mp-presets > * { flex: 1 0 30%; }`,
  ],
})
export class MapPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('meta', 'terrain');
  readonly meta = computed(() => this.session.state.meta());
  readonly presets = TERRAIN_PRESETS;
  readonly preset = signal<TerrainPreset>('hills');
  readonly seed = signal(Math.floor(Math.random() * 100000));
  readonly strength = signal(60);
  readonly add = signal(false);
  readonly repaint = signal(true);
  readonly width = signal<number | null>(null);
  readonly depth = signal<number | null>(null);
  readonly size = computed(() => {
    this.rev();
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

  readonly versions = this.session.saves.versions;
  readonly storage = this.session.saves.storage;
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
    this.session.saves.downloadFile();
  }

  when(iso: string): string {
    return this.t().editor.mapPanel.versionTime(iso, new Date().toDateString() === new Date(iso).toDateString());
  }

  kb(bytes: number): string {
    return this.t().editor.mapPanel.bytes(bytes);
  }

  pin(v: MapVersion): void {
    void this.session.saves.pinVersion(v, !v.pinned);
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

  readonly job = this.session.jobs.job;
  readonly rain = signal(50);

  async generate(): Promise<void> {
    const done = await this.session.jobs.generate({ preset: this.preset(), seed: this.seed(), strength: this.strength() / 100, add: this.add() }, this.repaint());
    if (done) this.session.notices.flash(this.t().editor.mapPanel.generated);
  }

  async erode(): Promise<void> {
    if (await this.session.jobs.erodeWholeMap(this.rain() / 100)) this.session.notices.flash(this.t().editor.mapPanel.eroded);
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }
}
