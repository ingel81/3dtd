import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EditorSession } from '../editor-session.service';

/** Name, author, description; size and resize */
@Component({
  selector: 'app-map-panel',
  standalone: true,
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
  `,
  styles: [`.mp-text { height: auto; padding-top: 8px; resize: vertical; } .mp-size { display: flex; align-items: flex-end; gap: 8px; }`],
})
export class MapPanelComponent {
  private readonly session = inject(EditorSession);
  readonly meta = computed(() => this.session.meta());
  readonly width = signal<number | null>(null);
  readonly depth = signal<number | null>(null);
  readonly size = computed(() => {
    this.session.docRev();
    const t = this.session.doc?.terrain;
    return t ? { width: t.width, depth: t.depth, columns: t.grid.columns, rows: t.grid.rows, cell: t.grid.cellSize } : null;
  });

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

  num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }
}
