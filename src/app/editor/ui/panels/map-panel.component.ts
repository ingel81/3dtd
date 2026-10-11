import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { MapVersion } from '../../model/version-store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TERRAIN_PRESETS, type TerrainPreset } from '../../ops/generate';
import { RangeRowComponent } from './range-row.component';
import { EditorSession } from '../editor-session.service';

/** Name, author, description; size and resize */
@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [RangeRowComponent, MatTooltipModule],
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
      <p class="td-note">Id {{ m.id }}@if (m.source) { | imported from {{ m.source.file }} }</p>
    }
    @if (size(); as s) {
      <div class="td-group">
        <h3 class="td-section">Size</h3>
        <p class="td-note">{{ s.width }} x {{ s.depth }} m | {{ s.columns }} x {{ s.rows }} height points every {{ s.cell }} m</p>
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
      </div>
    }
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
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="generate()" data-test="generate">Generate</button>
      <p class="td-note">Roads keep a level bed; one undo step takes it all back.</p>
    </div>
    <div class="td-group">
      <h3 class="td-section">Versions</h3>
      <div class="td-rows" data-test="versions">
        @for (v of versions(); track v.key) {
          <div class="td-row mp-version">
            <span class="td-trunc">{{ when(v.savedAt) }}</span>
            <span class="td-muted">{{ v.manual ? 'Saved' : 'Autosave' }} | {{ kb(v.size) }}</span>
            <button class="td-btn-ghost td-btn-sm" type="button" (click)="restore(v)" [matTooltip]="'Put this version back (one undo step)'">Restore</button>
          </div>
        } @empty {
          <p class="td-note">Every save and an autosave every few minutes land here, the last 20.</p>
        }
      </div>
    </div>
  `,
  styles: [
    `.mp-version { gap: 8px; min-height: 30px; } .mp-version > .td-trunc { flex: 1 1 auto; }
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
    return t ? { width: t.width, depth: t.depth, columns: t.grid.columns, rows: t.grid.rows, cell: t.grid.cellSize } : null;
  });

  readonly versions = this.session.versions;

  when(iso: string): string {
    const d = new Date(iso);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  kb(bytes: number): string {
    return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`;
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

  roll(): void {
    this.seed.set(Math.floor(Math.random() * 100000));
  }

  generate(): void {
    this.session.generate({ preset: this.preset(), seed: this.seed(), strength: this.strength() / 100, add: this.add() }, this.repaint());
    this.session.flash('Terrain generated; Ctrl+Z takes it back');
  }

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }
}
