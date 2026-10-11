import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapWaterKind } from '../../../world/custom-map/map-document';
import { waterCommands } from '../../tools/water-tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

const KIND_NAMES: Record<MapWaterKind, string> = { water: 'Water', sea: 'Sea', swamp: 'Swamp', ice: 'Ice', lava: 'Lava' };

/**
 * Water and lava bodies: the main water and further bodies, each with its
 * kind, level and colour; the tool's mode and the body it works on.
 */
@Component({
  selector: 'app-water-panel',
  standalone: true,
  imports: [BrushPanelComponent, RangeRowComponent, TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-group">
      <h3 class="td-section">Bodies</h3>
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

    <div class="td-seg is-sm" role="radiogroup" aria-label="Water tool">
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'fill'" (click)="setMode('fill')">Fill basin</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'lake'" (click)="setMode('lake')" data-mode="lake">Dig lake</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'paint'" (click)="setMode('paint')">Paint</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'erase'" (click)="setMode('erase')">Erase</button>
    </div>
    @if (mode() === 'fill') {
      <p class="td-note">A click into a hollow floods every connected spot below the level. A body without water takes the hollow's rim as its level.</p>
    } @else {
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

  setMode(mode: 'fill' | 'lake' | 'paint' | 'erase'): void {
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
