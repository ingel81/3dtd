import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { SavedStamp, StampKeep } from '../../model/stamp-store';
import type { StampParts } from '../../ops/stamp';
import type { StampTool } from '../../tools/stamp-tool';
import { EditorSession } from '../editor-session.service';
import type { KeptStamp } from './prefab-panel.component';
import { RangeRowComponent } from './range-row.component';

const PARTS: { id: keyof StampParts; label: string }[] = [
  { id: 'heights', label: 'Heights' },
  { id: 'paint', label: 'Ground paint' },
  { id: 'water', label: 'Water' },
  { id: 'objects', label: 'Objects' },
  { id: 'roads', label: 'Roads' },
];

/** Copy a rectangle, place it, save it as a stamp, and the stamp library */
@Component({
  selector: 'app-stamp-panel',
  standalone: true,
  imports: [RangeRowComponent, TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" aria-label="Copy and stamps">
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'select'" (click)="setMode('select')" data-mode="select">Select</button>
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'paste'" (click)="setMode('paste')" data-mode="paste">Place</button>
    </div>
    @if (s().mode === 'select') {
      <div class="td-group">
        @if (s().region; as r) {
          <p class="td-note">{{ size(r.x1 - r.x0) }} x {{ size(r.y1 - r.y0) }} m chosen</p>
        } @else {
          <p class="td-note">Drag a rectangle on the map.</p>
        }
        <button class="td-btn-secondary td-btn-sm" type="button" [attr.aria-disabled]="!s().region || null" (click)="copy()" data-test="copy">
          Copy <kbd class="td-kbd">Ctrl+C</kbd>
        </button>
      </div>
    } @else {
      <div class="td-group">
        <p class="td-note">{{ s().current ? 'Placing ' + (s().currentName || 'the copy') + ', turned ' + degrees() + ' degrees' : 'Copy a piece or pick a stamp below.' }}</p>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="turn(90)">Turn left <kbd class="td-kbd">R</kbd></button>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="turn(-90)">Turn right</button>
        </div>
        <app-editor-range label="Soft rim" unit="%" [min]="0" [max]="100" [value]="s().feather * 100" (changing)="setFeather($event / 100)" />
      </div>
    }
    <div class="td-group">
      <h3 class="td-section">Take along</h3>
      @for (p of parts; track p.id) {
        <div class="td-setting">
          <span>{{ p.label }}</span>
          <input class="td-switch" type="checkbox" [checked]="s().parts[p.id]" (change)="setPart(p.id, $any($event.target).checked)" [attr.aria-label]="p.label" />
        </div>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">Stamps and prefabs</h3>
      <div class="sp-save">
        <input class="td-input is-sm" type="text" maxlength="40" placeholder="Name" [value]="name()" (input)="name.set($any($event.target).value)" aria-label="Stamp name" />
        <button class="td-btn-secondary td-btn-sm" type="button" [attr.aria-disabled]="!s().current || null" (click)="save()" data-test="save-stamp">Save the copy</button>
      </div>
      <div class="td-seg is-sm" role="radiogroup" aria-label="Keep for">
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'library'" (click)="keep.set('library')" matTooltip="In this browser, for every map">Every map</button>
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'map'" (click)="keep.set('map')" matTooltip="In this map's file: it travels with the map">This map</button>
      </div>
      <div class="td-rows">
        @for (k of stamps(); track k.saved.id) {
          @let st = k.saved;
          <div class="td-row sp-row" role="option" tabindex="0" [attr.aria-selected]="s().currentName === st.name && s().mode === 'paste'"
               (click)="use(st)" (keydown.enter)="use(st)" [attr.data-stamp]="st.name">
            @if (st.preview) {
              <img class="sp-thumb" [src]="st.preview" alt="" />
            } @else {
              <span class="sp-thumb td-well" aria-hidden="true"></span>
            }
            <span class="sp-text">
              <span class="td-name">{{ st.name }}</span>
              <span class="td-sub">{{ st.stamp.prefab ? 'Prefab, ' : '' }}{{ size(st.stamp.width) }} x {{ size(st.stamp.depth) }} m | {{ st.stamp.objects.length }} objects{{ k.keep === 'map' ? ' | this map' : '' }}</span>
            </span>
            <button class="td-tool is-sm" type="button" aria-label="Delete stamp" matTooltip="Delete" (click)="$event.stopPropagation(); remove(k)">
              <td-icon name="trash" [size]="14" />
            </button>
          </div>
        } @empty {
          <p class="td-note">No stamps yet. Copy a piece of the map and save it here, for every map or in this map's file.</p>
        }
      </div>
    </div>
  `,
  styles: [
    `.sp-save { display: flex; gap: 8px; } .sp-save .td-input { flex: 1 1 auto; }
     .sp-row { justify-content: flex-start; gap: 8px; min-height: 48px; cursor: pointer; }
     .sp-thumb { width: 40px; height: 40px; flex: 0 0 auto; object-fit: cover; }
     .sp-text { flex: 1 1 auto; min-width: 0; }`,
  ],
})
export class StampPanelComponent implements OnInit {
  private readonly session = inject(EditorSession);
  readonly parts = PARTS;
  readonly name = signal('');
  readonly keep = signal<StampKeep>('library');
  /** The map's own first, then the library's */
  readonly stamps = computed<KeptStamp[]>(() => {
    this.session.docRev();
    return [
      ...this.session.mapStamps().map((saved) => ({ saved, keep: 'map' as const })),
      ...this.session.libraryStamps().map((saved) => ({ saved, keep: 'library' as const })),
    ];
  });
  readonly s = computed(() => (this.session.settingsRev(), { ...this.session.settings.stamp }));
  readonly degrees = computed(() => Math.round((((this.s().rotation * 180) / Math.PI) % 360 + 360) % 360));

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    await this.session.reloadStamps();
  }

  setMode(mode: 'select' | 'paste'): void {
    this.session.patchSettings((s) => (s.stamp.mode = mode));
  }

  copy(): void {
    const vp = this.session.viewport;
    if (vp) (this.session.tools.stamp as StampTool).copy(vp.ctx);
  }

  turn(deg: number): void {
    this.session.patchSettings((s) => (s.stamp.rotation += (deg * Math.PI) / 180));
  }

  setFeather(v: number): void {
    this.session.patchSettings((s) => (s.stamp.feather = v));
  }

  setPart(id: keyof StampParts, on: boolean): void {
    this.session.patchSettings((s) => (s.stamp.parts = { ...s.stamp.parts, [id]: on }));
  }

  async save(): Promise<void> {
    const st = this.session.settings.stamp;
    if (!st.current) return;
    const name = this.name().trim() || `Stamp ${this.stamps().length + 1}`;
    if (!(await this.session.saveStamp(name, st.current, st.region, this.keep()))) return;
    this.name.set('');
    this.session.flash(`Saved stamp ${name}${this.keep() === 'map' ? ' in this map' : ''}`);
  }

  use(st: SavedStamp): void {
    this.session.patchSettings((s) => {
      s.stamp.current = st.stamp;
      s.stamp.currentName = st.name;
      s.stamp.rotation = 0;
      s.stamp.mode = 'paste';
    });
  }

  async remove(k: KeptStamp): Promise<void> {
    if (k.keep === 'map') this.session.removeMapStamp(k.saved.id);
    else await this.session.deleteStamp(k.saved.id);
  }

  size(v: number): number {
    return Math.round(Math.abs(v));
  }
}
