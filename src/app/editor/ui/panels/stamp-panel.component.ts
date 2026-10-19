import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { SavedStamp, StampKeep } from '../../model/stamp-store';
import type { StampParts } from '../../ops/stamp';
import type { StampTool } from '../../tools/stamp-tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import type { KeptStamp } from './prefab-panel.component';
import { RangeRowComponent } from './range-row.component';
import { patch } from '../../tools/tool';
import { injectT } from '../../../i18n/i18n.service';

/** The parts a stamp takes along, in their order; their names are the dictionary's (i18n `editor.stamps.parts`) */
const PARTS: readonly (keyof StampParts)[] = ['heights', 'paint', 'water', 'objects', 'roads', 'life'];

/** Copy a rectangle, place it, save it as a stamp, and the stamp library */
@Component({
  selector: 'app-stamp-panel',
  standalone: true,
  imports: [RangeRowComponent, TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.stamps.modeLabel">
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'select'" (click)="setMode('select')" data-mode="select">{{ t().editor.stamps.select }}</button>
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'paste'" (click)="setMode('paste')" data-mode="paste">{{ t().editor.stamps.place }}</button>
    </div>
    @if (s().mode === 'select') {
      <div class="td-group">
        @if (s().region; as r) {
          <p class="td-note">{{ t().editor.stamps.chosen(size(r.x1 - r.x0), size(r.y1 - r.y0)) }}</p>
        } @else {
          <p class="td-note">{{ t().editor.stamps.dragRect }}</p>
        }
        <button class="td-btn-secondary td-btn-sm" type="button" [attr.aria-disabled]="!s().region || null" (click)="copy()" data-test="copy">
          {{ t().editor.stamps.copy }} <kbd class="td-kbd">Ctrl+C</kbd>
        </button>
      </div>
    } @else {
      <div class="td-group">
        <p class="td-note">{{ s().current ? t().editor.stamps.placing(s().currentName || t().editor.stamps.theCopy, degrees()) : t().editor.stamps.copyOrPick }}</p>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="turn(90)">{{ t().editor.stamps.turnLeft }} <kbd class="td-kbd">R</kbd></button>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="turn(-90)">{{ t().editor.stamps.turnRight }}</button>
        </div>
        <app-editor-range [label]="t().editor.stamps.softRim" unit="%" [min]="0" [max]="100" [value]="s().feather * 100" (changing)="setFeather($event / 100)" />
      </div>
    }
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.stamps.takeAlong }}</h3>
      @for (p of parts; track p) {
        <div class="td-setting">
          <span>{{ t().editor.stamps.parts[p] }}</span>
          <input class="td-switch" type="checkbox" [checked]="s().parts[p]" (change)="setPart(p, $any($event.target).checked)" [attr.aria-label]="t().editor.stamps.parts[p]" />
        </div>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.stamps.title }}</h3>
      <div class="sp-save">
        <input class="td-input is-sm" type="text" maxlength="40" [placeholder]="t().editor.stamps.name" [value]="name()" (input)="name.set($any($event.target).value)" [attr.aria-label]="t().editor.stamps.stampName" />
        <button class="td-btn-secondary td-btn-sm" type="button" [attr.aria-disabled]="!s().current || null" (click)="save()" data-test="save-stamp">{{ t().editor.stamps.saveCopy }}</button>
      </div>
      <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.stamps.keepFor">
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'library'" (click)="keep.set('library')" [matTooltip]="t().editor.stamps.everyMapTip">{{ t().editor.stamps.everyMap }}</button>
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'map'" (click)="keep.set('map')" [matTooltip]="t().editor.stamps.thisMapTip">{{ t().editor.stamps.thisMap }}</button>
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
              <span class="td-sub">{{ t().editor.stamps.line(!!st.stamp.prefab, size(st.stamp.width), size(st.stamp.depth), st.stamp.objects.length, k.keep === 'map') }}</span>
            </span>
            <button class="td-tool is-sm" type="button" [attr.aria-label]="t().editor.stamps.deleteStamp" [matTooltip]="t().editor.stamps.delete" (click)="$event.stopPropagation(); remove(k)">
              <td-icon name="trash" [size]="14" />
            </button>
          </div>
        } @empty {
          <p class="td-note">{{ t().editor.stamps.noStamps }}</p>
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
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('prefabs');
  readonly parts = PARTS;
  readonly name = signal('');
  readonly keep = signal<StampKeep>('library');
  /** The map's own first, then the library's */
  readonly stamps = computed<KeptStamp[]>(() => {
    this.rev();
    return [
      ...this.session.mapStamps().map((saved) => ({ saved, keep: 'map' as const })),
      ...this.session.library.libraryStamps().map((saved) => ({ saved, keep: 'library' as const })),
    ];
  });
  readonly s = this.session.tools.settings.stamp;
  readonly degrees = computed(() => Math.round((((this.s().rotation * 180) / Math.PI) % 360 + 360) % 360));

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    await this.session.library.reloadStamps();
  }

  setMode(mode: 'select' | 'paste'): void {
    patch(this.session.tools.settings.stamp, { mode });
  }

  copy(): void {
    const ctx = this.session.tools.context();
    if (ctx) (this.session.tools.all.stamp as StampTool).copy(ctx);
  }

  turn(deg: number): void {
    patch(this.session.tools.settings.stamp, { rotation: this.session.tools.settings.stamp().rotation + (deg * Math.PI) / 180 });
  }

  setFeather(v: number): void {
    patch(this.session.tools.settings.stamp, { feather: v });
  }

  setPart(id: keyof StampParts, on: boolean): void {
    patch(this.session.tools.settings.stamp, { parts: { ...this.session.tools.settings.stamp().parts, [id]: on } });
  }

  async save(): Promise<void> {
    const st = this.session.tools.settings.stamp();
    if (!st.current) return;
    const name = this.name().trim() || this.t().editor.stamps.defaultName(this.stamps().length + 1);
    if (!(await this.session.saveStamp(name, st.current, st.region, this.keep()))) return;
    this.name.set('');
    this.session.notices.flash(this.t().editor.stamps.saved(name, this.keep() === 'map'));
  }

  use(st: SavedStamp): void {
    patch(this.session.tools.settings.stamp, { current: st.stamp, currentName: st.name, rotation: 0, mode: 'paste' });
  }

  async remove(k: KeptStamp): Promise<void> {
    if (k.keep === 'map') this.session.removeMapStamp(k.saved.id);
    else await this.session.library.deleteStamp(k.saved.id);
  }

  size(v: number): number {
    return Math.round(Math.abs(v));
  }
}
