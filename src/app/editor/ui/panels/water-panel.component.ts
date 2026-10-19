import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapRiver, MapWaterKind } from '../../../world/custom-map/map-document';
import { recarveRiver, relevelRiver } from '../../ops/landscape/river';
import { LandscapeContext } from '../../ops/landscape/landscape-context';
import { meanWidth, riverLength, setMeanWidth, simplifyRiver } from '../../ops/river-edit';
import { relayRiver, removeWholeRiver, riverEdit, waterCommands } from '../../ops/water-commands';
import { patch, type WaterMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';
import { ModePickerComponent, type EditorMode } from './mode-picker.component';
import { injectT } from '../../../i18n/i18n.service';

/** The tool's modes in their order; their names and hints are the dictionary's (i18n `editor.water.modes`) */
const WATER_MODES: readonly WaterMode[] = ['fill', 'pour', 'lake', 'paint', 'erase', 'river'];

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
    <app-editor-modes [label]="t().editor.water.tool" [modes]="modes()" [value]="mode()" (picked)="setMode($any($event))" />

    <div class="td-group">
      <h3 class="td-section">{{ t().editor.water.bodies }} <span class="td-note">{{ t().editor.water.bodiesNote }}</span></h3>
      <div class="td-rows" role="listbox" [attr.aria-label]="t().editor.water.bodies">
        @for (b of bodies(); track b.index) {
          <div class="td-row wp-row" role="option" tabindex="0" [attr.aria-selected]="active() === b.index" (click)="choose(b.index)"
               (keydown.enter)="choose(b.index)" [attr.data-body]="b.index">
            <span class="td-swatch is-lg" [style.--td-mark]="b.color"></span>
            <span class="td-trunc wp-name">{{ b.name }}</span>
            <span class="td-muted td-num">{{ b.exists ? t().editor.water.metres(b.level) : t().editor.water.none }}</span>
            @if (b.exists) {
              <button class="td-tool is-sm" type="button" [attr.aria-label]="t().editor.water.remove" [matTooltip]="t().editor.water.remove" (click)="$event.stopPropagation(); remove(b.index)">
                <td-icon name="trash" [size]="14" />
              </button>
            }
          </div>
        }
      </div>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('water')" data-test="add-lake">{{ t().editor.water.addLake }}</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('lava')" data-test="add-lava">{{ t().editor.water.addLava }}</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('swamp')">{{ t().editor.water.addSwamp }}</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="add('ice')">{{ t().editor.water.addIce }}</button>
      </div>
    </div>

    @if (current(); as c) {
      <div class="td-group">
        <h3 class="td-section">{{ c.name }}</h3>
        <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.water.fills">
          @for (k of kinds; track k) {
            <button type="button" role="radio" [attr.aria-checked]="c.kind === k" (click)="set({ kind: k }, kindName(k))">{{ kindName(k) }}</button>
          }
        </div>
        <app-editor-range [label]="t().editor.water.level" unit="m" [min]="-100" [max]="400" [step]="0.5" [value]="c.level" (changed)="set({ level: $event }, t().editor.water.level)" />
        <label class="td-setting">
          <span>{{ t().editor.water.colour }}</span>
          <input type="color" [value]="c.color" (change)="set({ color: $any($event.target).value }, t().editor.water.colour)" [attr.aria-label]="t().editor.water.colour" />
        </label>
        <div class="td-actions is-start">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="sea()" [matTooltip]="t().editor.water.seaTip">{{ t().editor.water.sea }}</button>
          <button class="td-btn-ghost td-btn-sm" type="button" (click)="clear()">{{ t().editor.water.clear }}</button>
        </div>
      </div>
    }


    @if (mode() === 'pour') {
      <div class="td-group">
        <h3 class="td-section">{{ t().editor.water.pour }} <span class="td-note">{{ t().editor.water.pourNote }}</span></h3>
        <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.water.whatPour">
          <button type="button" role="radio" [attr.aria-checked]="pour() === 'water'" (click)="setPour('water')" data-test="pour-water">{{ t().editor.water.water }}</button>
          <button type="button" role="radio" [attr.aria-checked]="pour() === 'lava'" (click)="setPour('lava')" data-test="pour-lava">{{ t().editor.water.lava }}</button>
        </div>
        <p class="td-note">{{ t().editor.water.pourHelp }}</p>
      </div>
    }

    @if (mode() === 'river') {
      <div class="td-group">
        <h3 class="td-section">{{ t().editor.water.rivers }} <span class="td-note">{{ t().editor.water.riversNote }}</span></h3>
        <div class="td-rows" role="listbox" [attr.aria-label]="t().editor.water.rivers">
          @for (r of rivers(); track r.index) {
            <div class="td-row wp-row" role="option" tabindex="0" [attr.aria-selected]="r.index === river()" (click)="chooseRiver(r.index)"
                 (keydown.enter)="chooseRiver(r.index)" [attr.data-river]="r.index">
              <span class="td-swatch is-lg" [style.--td-mark]="r.kind === 'lava' ? '#ff5a14' : '#2f6f8f'"></span>
              <span class="td-trunc wp-name">{{ t().editor.water.riverName(r.kind === 'lava', r.index + 1) }}</span>
              <span class="td-muted td-num">{{ t().editor.water.riverSize(r.length, r.points) }}</span>
            </div>
          } @empty {
            <p class="td-note">{{ t().editor.water.noRivers }}</p>
          }
        </div>
      </div>
      @if (chosenRiver(); as c) {
        <div class="td-group">
          <app-editor-range [label]="t().editor.water.width" unit="m" [min]="2" [max]="80" [step]="1" [value]="c.width" (changed)="setRiverWidth($event)" />
          <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.water.flows">
            <button type="button" role="radio" [attr.aria-checked]="c.kind === 'water'" (click)="setRiverKind('water')">{{ t().editor.water.water }}</button>
            <button type="button" role="radio" [attr.aria-checked]="c.kind === 'lava'" (click)="setRiverKind('lava')">{{ t().editor.water.lava }}</button>
          </div>
          <div class="td-actions is-start">
            <button class="td-btn-secondary td-btn-sm" type="button" (click)="recarve()" [matTooltip]="t().editor.water.carveTip">{{ t().editor.water.carve }}</button>
            <button class="td-btn-secondary td-btn-sm" type="button" (click)="simplify()" [matTooltip]="t().editor.water.fewerTip">{{ t().editor.water.fewer }}</button>
            <button class="td-btn-ghost td-btn-sm" type="button" (click)="removeRiver()">{{ t().editor.water.removeRiver }}</button>
          </div>
        </div>
      }
      <p class="td-note">{{ t().editor.water.riverHelp }}</p>
    } @else if (mode() !== 'fill' && mode() !== 'pour') {
      @if (mode() === 'lake') {
        <app-editor-range [label]="t().editor.water.depth" unit="m" [min]="0.5" [max]="20" [step]="0.5" [value]="depth()" (changing)="setDepth($event)" />
      }
      <app-brush-panel />
    }
  `,
  styles: [`.wp-row { justify-content: flex-start; gap: 8px; cursor: pointer; min-height: 32px; } .wp-name { flex: 1 1 auto; }`],
})
export class WaterPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('water', 'terrain');
  readonly kinds: MapWaterKind[] = ['water', 'sea', 'swamp', 'ice', 'lava'];
  readonly modes = computed<EditorMode[]>(() => WATER_MODES.map((id) => ({ id, ...this.t().editor.water.modes[id] })));
  readonly mode = computed(() => this.session.tools.settings.water().mode);
  readonly active = computed(() => this.session.tools.settings.water().body);
  readonly pour = computed(() => this.session.tools.settings.water().pour);
  readonly depth = computed(() => this.session.tools.settings.water().depth);

  readonly bodies = computed(() => {
    this.rev();
    const t = this.session.doc?.terrain;
    if (!t) return [];
    const main = t.water;
    const list = [
      { index: -1, name: this.t().editor.water.mainWater, exists: !!main, level: main?.level ?? 0, color: main?.color ?? '#2f5f6f', kind: main?.kind ?? 'water' },
    ];
    (t.waterBodies ?? []).forEach((b, k) =>
      list.push({ index: k, name: this.t().editor.water.bodyName(this.t().editor.water.kinds[b.kind ?? 'water'], k + 1), exists: true, level: b.level, color: b.color, kind: b.kind ?? 'water' }),
    );
    return list;
  });
  readonly current = computed(() => this.bodies().find((b) => b.index === this.active() && b.exists) ?? null);

  kindName(k: MapWaterKind): string {
    return this.t().editor.water.kinds[k];
  }

  choose(index: number): void {
    patch(this.session.tools.settings.water, { body: index });
  }

  readonly river = computed(() => this.session.tools.settings.water().river);
  readonly rivers = computed(() => {
    this.rev();
    return (this.session.doc?.terrain.rivers ?? []).map((r, index) => ({
      index,
      kind: r.kind,
      points: r.points.length,
      length: Math.round(riverLength(r)),
    }));
  });
  readonly chosenRiver = computed(() => {
    this.rev();
    const r = this.session.doc?.terrain.rivers?.[this.river()];
    return r ? { kind: r.kind, width: Math.round(meanWidth(r)) } : null;
  });

  chooseRiver(index: number): void {
    patch(this.session.tools.settings.water, { river: index, riverPoint: -1 });
    const r = this.session.doc?.terrain.rivers?.[index];
    if (r) this.session.view.focusOn(r.points[Math.floor(r.points.length / 2)], Math.max(60, riverLength(r) / 2));
  }

  setRiverWidth(width: number): void {
    this.reshapeRiver(this.t().editor.water.undoWidth, (r) => setMeanWidth(r, width));
  }

  setRiverKind(kind: 'water' | 'lava'): void {
    this.editRiver(kind === 'lava' ? this.t().editor.water.undoLavaFlow : this.t().editor.water.undoRiver, (r) => (r.kind = kind));
  }

  recarve(): void {
    const river = this.session.doc?.terrain.rivers?.[this.river()];
    if (!river) return;
    this.session.edit(this.t().editor.water.changingRiver, (e) => {
      const stroke = new LandscapeContext(e.begin(this.t().editor.water.undoCarve), 1, this.session.catalog());
      // The surface first, from the banks as they are: a river from before sinks into a channel
      relevelRiver(stroke, river);
      recarveRiver(stroke, river);
      stroke.finish();
    });
  }

  simplify(): void {
    this.reshapeRiver(this.t().editor.water.undoFewer, (r) => simplifyRiver(r, Math.max(1.5, meanWidth(r) / 6)));
    patch(this.session.tools.settings.water, { riverPoint: -1 });
  }

  removeRiver(): void {
    const index = this.river();
    if (index < 0 || !this.session.edit(this.t().editor.water.changingRiver, (e) => removeWholeRiver(e, index, this.session.catalog()))) return;
    patch(this.session.tools.settings.water, { river: -1, riverPoint: -1 });
  }

  /** A change of the river's course or width: its bed follows (one step) */
  private reshapeRiver(label: string, edit: (r: MapRiver) => void): void {
    const index = this.river();
    if (!this.session.doc?.terrain.rivers?.[index]) return;
    this.session.edit(this.t().editor.water.changingRiver, (e) => {
      const before = structuredClone(e.doc.terrain.rivers);
      edit(e.doc.terrain.rivers![index]);
      relayRiver(e, this.session.catalog(), label, index, before);
    });
  }

  private editRiver(label: string, edit: (r: MapRiver) => void): void {
    const index = this.river();
    if (index >= 0) this.session.edit(this.t().editor.water.changingRiver, (e) => e.execute(riverEdit(e, label, (rivers) => rivers[index] && edit(rivers[index]))));
  }

  setMode(mode: WaterMode): void {
    patch(this.session.tools.settings.water, { mode });
  }

  setPour(kind: 'water' | 'lava'): void {
    patch(this.session.tools.settings.water, { pour: kind });
  }

  setDepth(v: number): void {
    patch(this.session.tools.settings.water, { depth: v });
  }

  add(kind: MapWaterKind): void {
    const level = Math.round((this.session.view.hover()?.height ?? 0) * 10) / 10;
    if (!this.session.edit(this.t().editor.water.changing, (e) => waterCommands.addBody(e, kind, level))) return;
    const index = (this.session.doc!.terrain.waterBodies?.length ?? 1) - 1;
    patch(this.session.tools.settings.water, { body: index, mode: 'fill' });
    this.session.notices.flash(this.t().editor.water.added(this.t().editor.water.bodyName(this.t().editor.water.kinds[kind], index + 1)));
  }

  remove(index: number): void {
    if (this.session.edit(this.t().editor.water.changing, (e) => waterCommands.remove(e, index)) && index >= 0 && this.active() >= index) this.choose(this.active() - 1);
  }

  set(patch: { level?: number; color?: string; kind?: MapWaterKind }, label: string): void {
    this.session.edit(this.t().editor.water.changing, (e) => waterCommands.set(e, this.active(), patch, label));
  }

  sea(): void {
    this.session.edit(this.t().editor.water.changing, (e) => waterCommands.sea(e, this.active()));
  }

  clear(): void {
    this.session.edit(this.t().editor.water.changing, (e) => waterCommands.clearMask(e, this.active()));
  }
}
