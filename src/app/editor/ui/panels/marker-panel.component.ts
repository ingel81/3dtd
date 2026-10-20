import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { markerCommands } from '../../ops/marker-commands';
import { patch, type MarkerMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { injectT } from '../../../i18n/i18n.service';

/** Spawns (named, with their lane length to the HQ) and the HQ */
@Component({
  selector: 'app-marker-panel',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    @let w = t().editor.markers;
    <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="w.clickPlaces">
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'spawn'" (click)="setMode('spawn')" data-mode="spawn">{{ w.spawn }} <kbd class="td-kbd">Q</kbd></button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'hq'" (click)="setMode('hq')" data-mode="hq">HQ <kbd class="td-kbd">H</kbd></button>
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ w.spawns }}</h3>
      <div class="td-rows">
        @for (s of spawns(); track s.id) {
          <div class="td-row mk-row" role="option" [attr.data-spawn]="s.id" tabindex="0" [attr.aria-selected]="selectedSpawn() === s.id" (click)="select(s.id)" (keydown.enter)="select(s.id)">
            <span class="td-swatch is-lg" [style.--td-mark]="s.color"></span>
            <input class="td-input is-sm mk-name" type="text" maxlength="30" [value]="s.name" (click)="$event.stopPropagation()"
                   (change)="rename(s.id, $any($event.target).value)" [attr.aria-label]="w.nameOf(s.id)" />
            <label class="td-check mk-optional"
                   [matTooltip]="w.optionalTip">
              <input class="td-switch" type="checkbox" [checked]="s.optional" (click)="$event.stopPropagation()" (change)="setOptional(s.id, $any($event.target).checked)"
                     [attr.aria-label]="w.optionalOf(s.name)" />
              <span class="td-caps">{{ w.opt }}</span>
            </label>
            <span class="td-num" [class.td-tone-hurt]="s.length === null" [matTooltip]="s.length === null ? w.noRouteTip : w.lengthTip">
              {{ s.length === null ? w.noRoute : w.length(s.length) }}
            </span>
            <button class="td-tool is-sm" type="button" [attr.aria-label]="w.remove" (click)="$event.stopPropagation(); remove(s.id)">
              <td-icon name="trash" [size]="14" />
            </button>
          </div>
        } @empty {
          <p class="td-note">{{ w.none }}</p>
        }
      </div>
    </div>
    @if (hq(); as h) {
      <div class="td-group">
        <h3 class="td-section">HQ</h3>
        <div class="td-setting">
          <span class="td-num">{{ w.hqAt(h.x, h.y) }}</span>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="focusHq()">{{ w.show }}</button>
        </div>
      </div>
    }
    <p class="td-note">{{ w.snap }}</p>
  `,
  styles: [`.mk-row { justify-content: flex-start; gap: 8px; cursor: pointer; } .mk-name { flex: 1 1 auto; min-width: 0; } .td-num { white-space: nowrap; }`],
})
export class MarkerPanelComponent {
  private readonly session = inject(EditorSession);
  protected readonly t = injectT();
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('markers', 'paths');
  readonly mode = computed(() => this.session.tools.settings.markers().mode);
  readonly selectedSpawn = computed(() => {
    const s = this.session.state.selection();
    return s?.kind === 'spawn' ? s.id : null;
  });
  readonly spawns = computed(() => {
    this.rev();
    const doc = this.session.doc;
    if (!doc) return [];
    const routes = this.session.routes.routes();
    return doc.spawns.map((s, k) => {
      const r = routes.get(s.id);
      return {
        id: s.id,
        name: s.name,
        optional: s.optional === true,
        color: `#${SPAWN_COLORS[k % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`,
        length: r ? Math.round(r.length) : null,
      };
    });
  });
  readonly hq = computed(() => {
    this.rev();
    const h = this.session.doc?.hq;
    return h ? { x: Math.round(h.x), y: Math.round(h.y) } : null;
  });

  setMode(mode: MarkerMode): void {
    patch(this.session.tools.settings.markers, { mode });
  }

  select(id: string): void {
    this.session.editor?.select({ kind: 'spawn', id });
    this.session.view.focusSelection();
  }

  rename(id: string, name: string): void {
    const editor = this.session.editor;
    if (editor && name.trim()) this.session.edit(this.t().editor.markers.changing, (e) => e.execute(markerCommands.renameSpawn(editor, id, name.trim())));
  }

  setOptional(id: string, optional: boolean): void {
    const editor = this.session.editor;
    if (editor) this.session.edit(this.t().editor.markers.changing, (e) => e.execute(markerCommands.setSpawnOptional(editor, id, optional)));
  }

  remove(id: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.edit(this.t().editor.markers.changing, (e) => e.execute(markerCommands.removeSpawn(editor, id)));
    if (this.selectedSpawn() === id) editor.select(null);
  }

  focusHq(): void {
    this.session.editor?.select({ kind: 'hq' });
    this.session.view.focusSelection();
  }
}
