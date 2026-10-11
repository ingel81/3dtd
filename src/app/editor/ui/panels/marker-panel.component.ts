import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { SPAWN_COLORS } from '../../../configs/map-constants.config';
import { spawnRoutes } from '../../ops/path-graph';
import { markerCommands } from '../../tools/marker-tool';
import type { MarkerMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';

/** Spawns (named, with their lane length to the HQ) and the HQ */
@Component({
  selector: 'app-marker-panel',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" aria-label="Click places">
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'spawn'" (click)="setMode('spawn')" data-mode="spawn">Spawn <kbd class="td-kbd">Q</kbd></button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'hq'" (click)="setMode('hq')" data-mode="hq">HQ <kbd class="td-kbd">H</kbd></button>
    </div>
    <div class="td-group">
      <h3 class="td-section">Spawns</h3>
      <div class="td-rows">
        @for (s of spawns(); track s.id) {
          <div class="td-row mk-row" role="option" tabindex="0" [attr.aria-selected]="selectedSpawn() === s.id" (click)="select(s.id)" (keydown.enter)="select(s.id)">
            <span class="td-swatch is-lg" [style.--td-mark]="s.color"></span>
            <input class="td-input is-sm mk-name" type="text" maxlength="30" [value]="s.name" (click)="$event.stopPropagation()"
                   (change)="rename(s.id, $any($event.target).value)" [attr.aria-label]="'Name of spawn ' + s.id" />
            <span class="td-num" [class.td-tone-hurt]="s.length === null" [matTooltip]="s.length === null ? 'No road leads from here to the HQ' : 'Lane length to the HQ'">
              {{ s.length === null ? 'no route' : s.length + ' m' }}
            </span>
            <button class="td-tool is-sm" type="button" aria-label="Remove spawn" (click)="$event.stopPropagation(); remove(s.id)">
              <td-icon name="trash" [size]="14" />
            </button>
          </div>
        } @empty {
          <p class="td-note">No spawn yet. Click on a road to place one.</p>
        }
      </div>
    </div>
    @if (hq(); as h) {
      <div class="td-group">
        <h3 class="td-section">HQ</h3>
        <div class="td-setting">
          <span class="td-num">{{ h.x }} east | {{ h.y }} north</span>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="focusHq()">Show</button>
        </div>
      </div>
    }
    <p class="td-note">Spawns and the HQ snap onto the nearest road; hold Alt to place freely.</p>
  `,
  styles: [`.mk-row { justify-content: flex-start; gap: 8px; cursor: pointer; } .mk-name { flex: 1 1 auto; min-width: 0; } .td-num { white-space: nowrap; }`],
})
export class MarkerPanelComponent {
  private readonly session = inject(EditorSession);
  readonly mode = computed(() => (this.session.settingsRev(), this.session.settings.markers.mode));
  readonly selectedSpawn = computed(() => {
    const s = this.session.selection();
    return s?.kind === 'spawn' ? s.id : null;
  });
  readonly spawns = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    if (!doc) return [];
    const routes = spawnRoutes(doc);
    return doc.spawns.map((s, k) => {
      const r = routes.get(s.id);
      return {
        id: s.id,
        name: s.name,
        color: `#${SPAWN_COLORS[k % SPAWN_COLORS.length].toString(16).padStart(6, '0')}`,
        length: r ? Math.round(r.length) : null,
      };
    });
  });
  readonly hq = computed(() => {
    this.session.docRev();
    const h = this.session.doc?.hq;
    return h ? { x: Math.round(h.x), y: Math.round(h.y) } : null;
  });

  setMode(mode: MarkerMode): void {
    this.session.patchSettings((s) => (s.markers.mode = mode));
  }

  select(id: string): void {
    this.session.editor?.select({ kind: 'spawn', id });
    this.session.viewport?.focusSelection();
  }

  rename(id: string, name: string): void {
    const editor = this.session.editor;
    if (editor && name.trim()) this.session.execute(markerCommands.renameSpawn(editor, id, name.trim()));
  }

  remove(id: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(markerCommands.removeSpawn(editor, id));
    if (this.selectedSpawn() === id) editor.select(null);
  }

  focusHq(): void {
    this.session.editor?.select({ kind: 'hq' });
    this.session.viewport?.focusSelection();
  }
}
