import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapLife, MapLifeArea, MapLifeKind } from '../../../world/custom-map/map-document';
import { centroid, LIFE_AREA_DENSITY, LIFE_KIND_INFO, LIFE_KINDS, lifeSwitches, outlineArea, shapeLength } from '../../../world/custom-map/map-life';
import { SnapshotCommand } from '../../model/editor-document';
import type { LifeMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';

/** Kinds the panel offers; the rest come with their parts */
const OFFERED: readonly MapLifeKind[] = LIFE_KINDS.filter((k) => k !== 'boats' && k !== 'sound');

/** Effect objects a click places (the Objects tool's Place), for one spot instead of an area */
const SPOTS: { asset: string; label: string }[] = [
  { asset: 'fx-smoke', label: 'Smoke column' },
  { asset: 'fx-birds', label: 'Circling flock' },
  { asset: 'fx-fireflies', label: 'Fireflies' },
  { asset: 'fx-embers', label: 'Embers' },
];

/** Kinds whose particles take a colour, and whose height is the flight height */
const TINTED: ReadonlySet<MapLifeKind> = new Set(['fireflies', 'fog', 'leaves', 'embers', 'sparks']);

/**
 * Life: what the next outline or line holds, the chosen area's settings,
 * the list of the map's areas, single effect spots and the switches of what
 * the map brings by itself. Sliders show the change live and land as one
 * step when let go.
 */
@Component({
  selector: 'app-life-panel',
  standalone: true,
  imports: [RangeRowComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" aria-label="Click draws">
      @for (m of modes; track m.id) {
        <button type="button" role="radio" [attr.aria-checked]="settings().mode === m.id" (click)="setMode(m.id)" [attr.data-mode]="m.id">{{ m.label }}</button>
      }
    </div>
    @if (settings().mode !== 'edit') {
      <div class="td-field">
        <span class="td-label" id="lp-kind">What lives there</span>
        <div class="td-seg is-sm lp-kinds" role="radiogroup" aria-labelledby="lp-kind">
          @for (k of kinds; track k) {
            <button type="button" role="radio" [attr.aria-checked]="settings().kind === k" (click)="setKind(k)" [attr.data-kind]="k">
              <span class="td-swatch" [style.--td-mark]="info[k].color"></span>{{ info[k].label }}
            </button>
          }
        </div>
        <p class="td-note">{{ info[settings().kind].about }}.</p>
      </div>
    }
    @if (chosen(); as a) {
      <div class="td-group" data-test="life-chosen">
        <h3 class="td-section">{{ info[a.kind].label }} {{ a.shape === 'area' ? 'area' : 'route' }} <span class="td-note">{{ sizeOf(a) }}</span></h3>
        <app-editor-range label="Density" unit="%" [min]="density.min * 100" [max]="density.max * 100" [step]="10" [value]="(a.density ?? 1) * 100"
                          (changing)="liveArea(a.id, { density: $event / 100 })" (changed)="commitArea(a.id, { density: $event / 100 }, 'Life density')" />
        @if (a.kind === 'birds') {
          <app-editor-range label="Flight height" unit="m" [min]="10" [max]="200" [value]="a.height ?? 40"
                            (changing)="liveArea(a.id, { height: $event })" (changed)="commitArea(a.id, { height: $event }, 'Flight height')" />
        }
        @if (tinted.has(a.kind)) {
          <app-editor-range label="Height" unit="m" [min]="0" [max]="30" [step]="0.5" [value]="a.height ?? 0"
                            (changing)="liveArea(a.id, { height: $event })" (changed)="commitArea(a.id, { height: $event }, 'Life height')" />
          <label class="td-setting">
            <span>Colour</span>
            <span class="td-inline">
              <input type="color" [value]="a.color ?? info[a.kind].color" (input)="liveArea(a.id, { color: $any($event.target).value })"
                     (change)="commitArea(a.id, { color: $any($event.target).value }, 'Life colour')" aria-label="Colour" />
              @if (a.color) {
                <button class="td-btn-secondary td-btn-sm" type="button" (click)="commitArea(a.id, { color: undefined }, 'Life colour')">Own colour</button>
              }
            </span>
          </label>
        }
        <label class="td-setting">
          <span>Shows from</span>
          <select class="td-select is-auto" [value]="a.quality ?? 'medium'" (change)="commitArea(a.id, { quality: $any($event.target).value === 'high' ? 'high' : undefined }, 'Life quality')" aria-label="Shows from">
            <option value="medium">Medium quality</option>
            <option value="high">High quality</option>
          </select>
        </label>
        <div class="td-setting">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="show(a)">Show</button>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="remove(a)" data-test="life-remove">Remove</button>
        </div>
      </div>
    }
    <div class="td-group">
      <h3 class="td-section">On this map</h3>
      <div class="td-rows" role="listbox" aria-label="Life areas">
        @for (a of areas(); track a.id) {
          <div class="td-row lp-row" role="option" tabindex="0" [attr.aria-selected]="settings().chosen === a.id" (click)="choose(a.id)" (keydown.enter)="choose(a.id)" [attr.data-area]="a.id">
            <span class="td-swatch" [style.--td-mark]="info[a.kind].color"></span>
            <span class="td-trunc">{{ info[a.kind].label }} {{ a.shape === 'area' ? 'area' : 'route' }}</span>
            <span class="td-num td-muted">{{ sizeOf(a) }}</span>
            <button class="td-tool is-sm" type="button" aria-label="Remove" (click)="$event.stopPropagation(); remove(a)"><td-icon name="trash" [size]="14" /></button>
          </div>
        } @empty {
          <p class="td-note">None yet. Pick what lives there, then click an outline on the map or hold and paint it.</p>
        }
      </div>
    </div>
    <div class="td-group">
      <h3 class="td-section">One spot</h3>
      <div class="td-inline lp-spots">
        @for (s of spots; track s.asset) {
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="placeSpot(s.asset)">{{ s.label }}</button>
        }
      </div>
      <p class="td-note">Places an effect object with the Objects tool; scale makes it larger and denser.</p>
    </div>
    @if (switches(); as w) {
      <div class="td-group" data-test="life-switches">
        <h3 class="td-section">What the map brings by itself</h3>
        <div class="td-setting">
          <span>Chimney smoke</span>
          <input class="td-switch" type="checkbox" [checked]="w.smoke" (change)="setAuto('smoke', $any($event.target).checked)" aria-label="Chimney smoke" data-test="auto-smoke" />
        </div>
        <div class="td-setting">
          <span>Fireflies over shores and woods</span>
          <input class="td-switch" type="checkbox" [checked]="w.fireflies" (change)="setAuto('fireflies', $any($event.target).checked)" aria-label="Fireflies" data-test="auto-fireflies" />
        </div>
        <div class="td-setting">
          <span>Birds over open land</span>
          <input class="td-switch" type="checkbox" [checked]="w.birds" (change)="setAuto('birds', $any($event.target).checked)" aria-label="Birds" data-test="auto-birds" />
        </div>
        <div class="td-setting">
          <span>Sparks over lava</span>
          <input class="td-switch" type="checkbox" [checked]="w.sparks" (change)="setAuto('sparks', $any($event.target).checked)" aria-label="Sparks over lava" data-test="auto-sparks" />
        </div>
        <app-editor-range label="Density" unit="%" [min]="0" [max]="200" [step]="10" [value]="w.density * 100"
                          (changing)="liveLife({ density: $event / 100 })" (changed)="commitLife({ density: $event / 100 }, 'Life density')" data-test="life-density" />
        <p class="td-note">Density scales all of the map's life, its own and its areas. Areas and objects you place take the place of the map's own fireflies and birds. Low quality shows no life areas.</p>
      </div>
    }
  `,
  styles: [
    `.lp-kinds { flex-wrap: wrap; } .lp-kinds .td-swatch { margin-right: 4px; } .lp-row { justify-content: flex-start; gap: 8px; cursor: pointer; }
     .lp-row .td-trunc { flex: 1 1 auto; min-width: 0; } .lp-spots { flex-wrap: wrap; gap: 6px; }`,
  ],
})
export class LifePanelComponent {
  private readonly session = inject(EditorSession);
  readonly info = LIFE_KIND_INFO;
  readonly kinds = OFFERED;
  readonly spots = SPOTS;
  readonly tinted = TINTED;
  readonly density = LIFE_AREA_DENSITY;
  readonly modes: { id: LifeMode; label: string }[] = [
    { id: 'area', label: 'Outline' },
    { id: 'route', label: 'Line' },
    { id: 'edit', label: 'Edit' },
  ];
  readonly settings = computed(() => (this.session.settingsRev(), { ...this.session.settings.life }));
  readonly life = computed(() => (this.session.docRev(), this.session.doc?.life));
  readonly areas = computed(() => this.life()?.areas ?? []);
  readonly chosen = computed(() => {
    const id = this.settings().chosen;
    return this.areas().find((a) => a.id === id) ?? null;
  });
  readonly switches = computed(() => (this.session.doc ? lifeSwitches(this.life()) : null));
  /** The map's life before a slider started moving */
  private before: MapLife | undefined | null = null;

  sizeOf(a: MapLifeArea): string {
    return a.shape === 'area' ? `${Math.round(outlineArea(a.points)).toLocaleString('en')} m²` : `${Math.round(shapeLength(a.points, false))} m`;
  }

  setMode(mode: LifeMode): void {
    this.session.patchSettings((s) => (s.life.mode = mode));
  }

  setKind(kind: MapLifeKind): void {
    this.session.patchSettings((s) => (s.life.kind = kind));
  }

  choose(id: string): void {
    this.session.patchSettings((s) => {
      s.life.chosen = id;
      s.life.point = -1;
    });
  }

  show(a: MapLifeArea): void {
    const c = centroid(a.points);
    const r = Math.max(...a.points.map((p) => Math.hypot(p.x - c.x, p.y - c.y)), 30);
    this.session.viewport?.focusOn(c, r * 1.2);
  }

  remove(a: MapLifeArea): void {
    this.session.editLife((life) => (life.areas = life.areas?.filter((x) => x.id !== a.id)), `Remove ${LIFE_KIND_INFO[a.kind].label.toLowerCase()}`);
    if (this.settings().chosen === a.id) this.session.patchSettings((s) => (s.life.chosen = null));
  }

  placeSpot(asset: string): void {
    this.session.patchSettings((s) => {
      s.objects.asset = asset;
      s.objects.mode = 'place';
    });
    this.session.selectTool('objects');
  }

  setAuto(key: 'smoke' | 'fireflies' | 'birds' | 'sparks', on: boolean): void {
    this.session.editLife((life) => (life.auto = { ...life.auto, [key]: on }), on ? `Life: ${key} on` : `Life: ${key} off`);
  }

  liveArea(id: string, patch: Partial<MapLifeArea>): void {
    this.live((life) => patchArea(life, id, patch));
  }

  commitArea(id: string, patch: Partial<MapLifeArea>, label: string): void {
    this.commit((life) => patchArea(life, id, patch), label);
  }

  liveLife(patch: Partial<MapLife>): void {
    this.live((life) => Object.assign(life, patch));
  }

  commitLife(patch: Partial<MapLife>, label: string): void {
    this.commit((life) => Object.assign(life, patch), label);
  }

  /** A change shown at once, not yet a step */
  private live(change: (life: MapLife) => void): void {
    const editor = this.session.editor;
    if (!editor) return;
    if (this.before === null) this.before = structuredClone(editor.doc.life);
    const life = structuredClone(editor.doc.life ?? {});
    change(life);
    editor.doc.life = life;
    editor.emit({ life: true });
  }

  private commit(change: (life: MapLife) => void, label: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    const before = this.before === null ? structuredClone(editor.doc.life) : this.before;
    this.before = null;
    const life = structuredClone(editor.doc.life ?? {});
    change(life);
    editor.doc.life = life;
    this.session.execute(new SnapshotCommand(label, { life: before }, { life: structuredClone(life) }));
  }
}

/** The area's fields with the patch; an undefined value removes the field */
function patchArea(life: MapLife, id: string, patch: Partial<MapLifeArea>): void {
  const a = life.areas?.find((x) => x.id === id);
  if (!a) return;
  for (const [k, v] of Object.entries(patch) as [keyof MapLifeArea, unknown][]) {
    if (v === undefined) delete a[k];
    else (a as unknown as Record<string, unknown>)[k] = v;
  }
}
