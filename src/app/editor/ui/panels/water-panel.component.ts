import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapRiver, MapWaterKind } from '../../../world/custom-map/map-document';
import { recarveRiver } from '../../ops/landscape/river';
import { LandscapeStroke } from '../../ops/landscape/landscape-stroke';
import { meanWidth, riverLength, setMeanWidth, simplifyRiver } from '../../ops/river-edit';
import { riverEdit, waterCommands } from '../../tools/water-tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';
import { ModePickerComponent, type EditorMode } from './mode-picker.component';

const WATER_MODES: readonly EditorMode[] = [
  { id: 'fill', label: 'Fill a hollow', hint: 'Click into a hollow: every connected spot below the level floods. Without water yet, the hollow\'s rim sets the level' },
  { id: 'lake', label: 'Dig a lake', hint: 'Hold to dig a lake bed to the depth set below and fill it' },
  { id: 'paint', label: 'Paint', hint: 'Hold to paint water of the chosen body by hand' },
  { id: 'erase', label: 'Erase', hint: 'Hold to take water away' },
  { id: 'river', label: 'Rivers', hint: 'Edit rivers drawn with Landscape, River: move points, width, water or lava' },
];

const KIND_NAMES: Record<MapWaterKind, string> = { water: 'Water', sea: 'Sea', swamp: 'Swamp', ice: 'Ice', lava: 'Lava' };

/**
 * Water and lava bodies: the main water and further bodies, each with its
 * kind, level and colour; the tool's mode and the body it works on.
 */
@Component({
  selector: 'app-water-panel',
  standalone: true,
  imports: [ModePickerComponent, BrushPanelComponent, RangeRowComponent, TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <app-editor-modes label="Water tool" [modes]="modes" [value]="mode()" (picked)="setMode($any($event))" />

    <div class="td-group">
      <h3 class="td-section">Water bodies <span class="td-note">the tool works on the chosen one</span></h3>
      <div class="td-rows" role="listbox" aria-label="Water bodies">
        @for (b of bodies(); track b.index) {
          <div class="td-row wp-row" role="option" tabindex="0" [attr.aria-selected]="active() === b.index" (click)="choose(b.index)"
               (keydown.enter)="choose(b.index)" [attr.data-body]="b.index">
            <span class="td-swatch is-lg" [style.--td-mark]="b.color"></span>
            <span class="td-trunc wp-name">{{ b.name }}</span>
            <span class="td-muted td-num">{{ b.exists ? b.level + ' m' : 'none' }}</span>
            @if (b.exists) {
              <button class="td-tool is-sm" type="button" aria-label="Remove" matTooltip="Remove" (click)="$event.stopPropagation(); remove(b.index)">
                <td-icon name="trash" [size]="14" />
              </button>
            }
          </div>
        }
      </div>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('water')" data-test="add-lake">Add lake</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('lava')" data-test="add-lava">Add lava</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('swamp')">Add swamp</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('ice')">Add ice</button>
      </div>
    </div>

    @if (current(); as c) {
      <div class="td-group">
        <h3 class="td-section">{{ c.name }}</h3>
        <div class="td-seg is-sm" role="radiogroup" aria-label="What fills it">
          @for (k of kinds; track k) {
            <button type="button" role="radio" [attr.aria-checked]="c.kind === k" (click)="set({ kind: k }, kindName(k))">{{ kindName(k) }}</button>
          }
        </div>
        <app-editor-range label="Level" unit="m" [min]="-100" [max]="400" [step]="0.5" [value]="c.level" (changed)="set({ level: $event }, 'Level')" />
        <label class="td-setting">
          <span>Colour</span>
          <input type="color" [value]="c.color" (change)="set({ color: $any($event.target).value }, 'Colour')" aria-label="Colour" />
        </label>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="sea()" matTooltip="Flood it in from the map's edge over all ground below its level">Sea from the edge</button>
          <button class="td-btn-ghost td-btn-sm" type="button" (click)="clear()">Clear</button>
        </div>
      </div>
    }


    @if (mode() === 'river') {
      <div class="td-group">
        <h3 class="td-section">Rivers <span class="td-note">drawn with Landscape, River</span></h3>
        <div class="td-rows" role="listbox" aria-label="Rivers">
          @for (r of rivers(); track r.index) {
            <div class="td-row wp-row" role="option" tabindex="0" [attr.aria-selected]="r.index === river()" (click)="chooseRiver(r.index)"
                 (keydown.enter)="chooseRiver(r.index)" [attr.data-river]="r.index">
              <span class="td-swatch is-lg" [style.--td-mark]="r.kind === 'lava' ? '#ff5a14' : '#2f6f8f'"></span>
              <span class="td-trunc wp-name">{{ r.kind === 'lava' ? 'Lava flow' : 'River' }} {{ r.index + 1 }}</span>
              <span class="td-muted td-num">{{ r.length }} m | {{ r.points }} points</span>
            </div>
          } @empty {
            <p class="td-note">No rivers yet: draw one with the Landscape tool's River brush (1).</p>
          }
        </div>
      </div>
      @if (chosenRiver(); as c) {
        <div class="td-group">
          <app-editor-range label="Width" unit="m" [min]="2" [max]="80" [step]="1" [value]="c.width" (changed)="setRiverWidth($event)" />
          <div class="td-seg is-sm" role="radiogroup" aria-label="What flows">
            <button type="button" role="radio" [attr.aria-checked]="c.kind === 'water'" (click)="setRiverKind('water')">Water</button>
            <button type="button" role="radio" [attr.aria-checked]="c.kind === 'lava'" (click)="setRiverKind('lava')">Lava</button>
          </div>
          <div class="td-actions is-start">
            <button class="td-btn-secondary td-btn-sm" type="button" (click)="recarve()" matTooltip="Carve the bed again along the points as they are now">Carve the bed</button>
            <button class="td-btn-secondary td-btn-sm" type="button" (click)="simplify()" matTooltip="Fewer points where the river runs straight, easier to edit">Fewer points</button>
            <button class="td-btn-ghost td-btn-sm" type="button" (click)="removeRiver()">Remove river</button>
          </div>
        </div>
      }
      <p class="td-note">Drag a point to move it, Shift click on a river adds one, Del removes the chosen point. The bed the brush carved stays; widen the banks with the terrain tools.</p>
    } @else if (mode() !== 'fill') {
      @if (mode() === 'lake') {
        <app-editor-range label="Depth" unit="m" [min]="0.5" [max]="20" [step]="0.5" [value]="depth()" (changing)="setDepth($event)" />
      }
      <app-brush-panel />
    }
  `,
  styles: [`.wp-row { justify-content: flex-start; gap: 8px; cursor: pointer; min-height: 32px; } .wp-name { flex: 1 1 auto; }`],
})
export class WaterPanelComponent {
  private readonly session = inject(EditorSession);
  readonly kinds: MapWaterKind[] = ['water', 'sea', 'swamp', 'ice', 'lava'];
  readonly modes = WATER_MODES;
  readonly mode = computed(() => (this.session.settingsRev(), this.session.settings.water.mode));
  readonly active = computed(() => (this.session.settingsRev(), this.session.settings.water.body));
  readonly depth = computed(() => (this.session.settingsRev(), this.session.settings.water.depth));

  readonly bodies = computed(() => {
    this.session.docRev();
    const t = this.session.doc?.terrain;
    if (!t) return [];
    const main = t.water;
    const list = [
      { index: -1, name: 'Main water', exists: !!main, level: main?.level ?? 0, color: main?.color ?? '#2f5f6f', kind: main?.kind ?? 'water' },
    ];
    (t.waterBodies ?? []).forEach((b, k) =>
      list.push({ index: k, name: `${KIND_NAMES[b.kind ?? 'water']} ${k + 1}`, exists: true, level: b.level, color: b.color, kind: b.kind ?? 'water' }),
    );
    return list;
  });
  readonly current = computed(() => this.bodies().find((b) => b.index === this.active() && b.exists) ?? null);

  kindName(k: MapWaterKind): string {
    return KIND_NAMES[k];
  }

  choose(index: number): void {
    this.session.patchSettings((s) => (s.water.body = index));
  }

  readonly river = computed(() => (this.session.settingsRev(), this.session.settings.water.river));
  readonly rivers = computed(() => {
    this.session.docRev();
    return (this.session.doc?.terrain.rivers ?? []).map((r, index) => ({
      index,
      kind: r.kind,
      points: r.points.length,
      length: Math.round(riverLength(r)),
    }));
  });
  readonly chosenRiver = computed(() => {
    this.session.docRev();
    const r = this.session.doc?.terrain.rivers?.[this.river()];
    return r ? { kind: r.kind, width: Math.round(meanWidth(r)) } : null;
  });

  chooseRiver(index: number): void {
    this.session.patchSettings((s) => {
      s.water.river = index;
      s.water.riverPoint = -1;
    });
    const r = this.session.doc?.terrain.rivers?.[index];
    if (r) this.session.viewport?.focusOn(r.points[Math.floor(r.points.length / 2)], Math.max(60, riverLength(r) / 2));
  }

  setRiverWidth(width: number): void {
    this.editRiver('River width', (r) => setMeanWidth(r, width));
  }

  setRiverKind(kind: 'water' | 'lava'): void {
    this.editRiver(kind === 'lava' ? 'Lava flow' : 'River', (r) => (r.kind = kind));
  }

  recarve(): void {
    const editor = this.session.editor;
    const river = this.session.doc?.terrain.rivers?.[this.river()];
    if (!editor || !river) return;
    const stroke = new LandscapeStroke(editor, 'Carve the river bed', 1, this.session.catalog());
    recarveRiver(stroke, river);
    stroke.finish();
    this.session.refresh();
  }

  simplify(): void {
    this.editRiver('Fewer river points', (r) => simplifyRiver(r, Math.max(1.5, meanWidth(r) / 6)));
    this.session.patchSettings((s) => (s.water.riverPoint = -1));
  }

  removeRiver(): void {
    const editor = this.session.editor;
    const index = this.river();
    if (!editor || index < 0) return;
    this.session.execute(riverEdit(editor, 'Remove river', (rivers) => rivers.splice(index, 1)));
    this.session.patchSettings((s) => {
      s.water.river = -1;
      s.water.riverPoint = -1;
    });
  }

  private editRiver(label: string, edit: (r: MapRiver) => void): void {
    const editor = this.session.editor;
    const index = this.river();
    if (!editor || index < 0) return;
    this.session.execute(riverEdit(editor, label, (rivers) => rivers[index] && edit(rivers[index])));
  }

  setMode(mode: 'fill' | 'lake' | 'paint' | 'erase' | 'river'): void {
    this.session.patchSettings((s) => (s.water.mode = mode));
  }

  setDepth(v: number): void {
    this.session.patchSettings((s) => (s.water.depth = v));
  }

  add(kind: MapWaterKind): void {
    const editor = this.session.editor;
    if (!editor) return;
    const level = Math.round((this.session.hover()?.height ?? 0) * 10) / 10;
    this.session.execute(waterCommands.addBody(editor, kind, level));
    const index = (editor.doc.terrain.waterBodies?.length ?? 1) - 1;
    this.session.patchSettings((s) => {
      s.water.body = index;
      s.water.mode = 'fill';
    });
    this.session.flash(`${KIND_NAMES[kind]} ${index + 1} added: click a hollow to fill it, or dig a lake`);
  }

  remove(index: number): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(waterCommands.remove(editor, index));
    if (index >= 0 && this.active() >= index) this.choose(this.active() - 1);
  }

  set(patch: { level?: number; color?: string; kind?: MapWaterKind }, label: string): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(waterCommands.set(editor, this.active(), patch, label));
  }

  sea(): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(waterCommands.sea(editor, this.active()));
  }

  clear(): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(waterCommands.clearMask(editor, this.active()));
  }
}
