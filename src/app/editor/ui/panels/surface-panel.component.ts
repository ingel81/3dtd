import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../../../components/icon/icon.component';
import { MAP_SURFACE_MARKINGS, type MapSurface, type MapSurfaceMarkingKind } from '../../../world/custom-map/map-document';
import { centroid } from '../../../world/custom-map/map-life';
import { fitMarking, MAX_SURFACE_MATERIALS, surfaceArea, surfaceMaterials } from '../../../world/custom-map/map-surfaces';
import { refitMarking, surfacesCommand } from '../../ops/surfaces';
import { patch, type SurfaceMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';

/** Materials a surface takes first (those the catalogue has): pavings, sport and play grounds, sand and gravel */
const SUGGESTED = [
  'paving',
  'cobblestone',
  'cobblestone-grey',
  'pavers',
  'herringbone',
  'red-paving',
  'sidewalk',
  'asphalt',
  'concrete',
  'gravel-light',
  'sand',
  'wood-chips',
  'grass-lush',
  'red-earth',
  'tartan',
  'rubber-safety',
  'artificial-turf',
  'hard-court-green',
  'hard-court-blue',
  'pool-tiles',
];

/**
 * Surfaces: the material and lines of the next outline, the chosen
 * surface's (material, marking fitted again, turned a quarter), the list of
 * the map's surfaces
 */
@Component({
  selector: 'app-surface-panel',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" aria-label="Click draws">
      @for (m of modes; track m.id) {
        <button type="button" role="radio" [attr.aria-checked]="settings().mode === m.id" (click)="setMode(m.id)" [attr.data-mode]="m.id">{{ m.label }}</button>
      }
    </div>
    @if (chosen(); as s) {
      <div class="td-group" data-test="surface-chosen">
        <h3 class="td-section">{{ titleOf(s) }} <span class="td-note">{{ sizeOf(s) }}</span></h3>
        <label class="td-setting">
          <span>Material</span>
          <select class="td-select is-auto" [value]="s.material" (change)="setMaterial(s, $any($event.target).value)" aria-label="Material" data-test="surface-material">
            @for (m of materials(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </label>
        <label class="td-setting">
          <span>Lines</span>
          <select class="td-select is-auto" [value]="s.marking?.kind ?? 'none'" (change)="setMarking(s, $any($event.target).value)" aria-label="Lines" data-test="surface-marking">
            <option value="none">None</option>
            @for (k of markings; track k) {
              <option [value]="k">{{ session.t().editor.surfaceMarkings[k] }}</option>
            }
          </select>
        </label>
        @if (s.marking) {
          <div class="td-setting">
            <span>The lines' rectangle</span>
            <span class="td-inline">
              <button class="td-btn-secondary td-btn-sm" type="button" (click)="fit(s)">Fit to outline</button>
              <button class="td-btn-secondary td-btn-sm" type="button" (click)="turn(s)">Turn</button>
            </span>
          </div>
          <p class="td-note">Drag the corners of the gold rectangle to place the lines; the court keeps its real size inside it.</p>
        }
        <div class="td-setting">
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="show(s)">Show</button>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="remove(s)" data-test="surface-remove">Remove</button>
        </div>
      </div>
    } @else {
      <div class="td-group">
        <label class="td-setting">
          <span>Material</span>
          <select class="td-select is-auto" [value]="settings().material" (change)="setNext({ material: $any($event.target).value })" aria-label="Material of the next surface">
            @for (m of materials(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </label>
        <div class="td-inline sp-swatches">
          @for (m of suggested(); track m.id) {
            <button type="button" class="td-tool is-sm sp-swatch" [attr.aria-pressed]="settings().material === m.id" [attr.aria-label]="m.name" [title]="m.name" (click)="setNext({ material: m.id })">
              @if (m.thumbnail) {
                <img [src]="m.thumbnail" alt="" />
              } @else {
                <span class="td-swatch" [style.--td-mark]="m.color"></span>
              }
            </button>
          }
        </div>
        <label class="td-setting">
          <span>Lines</span>
          <select class="td-select is-auto" [value]="settings().marking" (change)="setNext({ marking: $any($event.target).value })" aria-label="Lines of the next surface">
            <option value="none">None</option>
            @for (k of markings; track k) {
              <option [value]="k">{{ session.t().editor.surfaceMarkings[k] }}</option>
            }
          </select>
        </label>
        <p class="td-note">Surfaces are drawn only: enemies, roads and building do not see them. A map draws up to {{ maxMaterials }} materials on its surfaces.</p>
      </div>
    }
    <div class="td-group">
      <h3 class="td-section">On this map <span class="td-note">{{ list().length }}</span></h3>
      <div class="td-rows" role="listbox" aria-label="Surfaces">
        @for (s of shown(); track s.id) {
          <div class="td-row sp-row" role="option" tabindex="0" [attr.aria-selected]="settings().chosen === s.id" (click)="choose(s)" (keydown.enter)="choose(s)" [attr.data-surface]="s.id">
            <span class="td-swatch" [style.--td-mark]="colorOf(s.material)"></span>
            <span class="td-trunc">{{ titleOf(s) }}</span>
            <span class="td-num td-muted">{{ sizeOf(s) }}</span>
            <button class="td-tool is-sm" type="button" aria-label="Remove" (click)="$event.stopPropagation(); remove(s)"><td-icon name="trash" [size]="14" /></button>
          </div>
        } @empty {
          <p class="td-note">None yet. Pick a material and lines, then click an outline on the map or hold and paint it.</p>
        }
        @if (list().length > shown().length) {
          <p class="td-note">and {{ list().length - shown().length }} more; click one on the map to choose it.</p>
        }
      </div>
    </div>
  `,
  styles: [
    `.sp-swatches { flex-wrap: wrap; gap: 4px; }
     .sp-swatch { width: 30px; height: 30px; padding: 2px; }
     .sp-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
     .sp-swatch[aria-pressed='true'] { outline: 2px solid var(--td-brass); }
     .sp-row { justify-content: flex-start; gap: 8px; cursor: pointer; }
     .sp-row .td-trunc { flex: 1 1 auto; min-width: 0; }`,
  ],
})
export class SurfacePanelComponent {
  readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('surfaces');
  readonly markings = MAP_SURFACE_MARKINGS;
  readonly maxMaterials = MAX_SURFACE_MATERIALS;
  readonly modes: { id: SurfaceMode; label: string }[] = [
    { id: 'draw', label: 'Outline' },
    { id: 'edit', label: 'Edit' },
  ];
  readonly settings = this.session.tools.settings.surfaces;
  readonly list = computed(() => (this.rev(), this.session.doc?.surfaces ?? []));
  /** The first hundred: an OSM city has some nine hundred */
  readonly shown = computed(() => this.list().slice(0, 100));
  readonly chosen = computed(() => {
    const id = this.settings().chosen;
    return this.list().find((s) => s.id === id) ?? null;
  });
  readonly materials = computed(() => [...this.session.catalog().materials.values()].sort((a, b) => a.name.localeCompare(b.name)));
  readonly suggested = computed(() => {
    const index = this.session.catalog().materials;
    return SUGGESTED.map((id) => index.get(id)).filter((m) => !!m);
  });

  titleOf(s: MapSurface): string {
    const material = this.session.catalog().material(s.material).name;
    return s.marking ? `${this.session.t().editor.surfaceMarkings[s.marking.kind]}, ${material}` : material;
  }

  sizeOf(s: MapSurface): string {
    return `${Math.round(surfaceArea(s)).toLocaleString('en')} m²`;
  }

  colorOf(material: string): string {
    return this.session.catalog().material(material).color;
  }

  setMode(mode: SurfaceMode): void {
    patch(this.settings, { mode });
  }

  setNext(changes: { material?: string; marking?: MapSurfaceMarkingKind | 'none' }): void {
    patch(this.settings, changes);
  }

  choose(s: MapSurface): void {
    patch(this.settings, { chosen: s.id, point: -1, mode: 'edit' });
  }

  show(s: MapSurface): void {
    const c = centroid(s.outer);
    const r = Math.max(...s.outer.map((p) => Math.hypot(p.x - c.x, p.y - c.y)), 20);
    this.session.view.focusOn(c, r * 1.3);
  }

  setMaterial(s: MapSurface, material: string): void {
    const used = surfaceMaterials(this.list());
    if (!used.includes(material) && used.length >= MAX_SURFACE_MATERIALS) {
      this.session.notices.flash(`Surfaces draw ${MAX_SURFACE_MATERIALS} materials at most: this one shows its mean colour`);
    }
    this.change(s.id, (f) => (f.material = material), 'Surface material');
  }

  setMarking(s: MapSurface, kind: MapSurfaceMarkingKind | 'none'): void {
    this.change(
      s.id,
      (f) => {
        if (kind === 'none') delete f.marking;
        else if (f.marking) f.marking = { ...f.marking, kind };
        else {
          const m = fitMarking(kind, f.outer, f.holes ?? [], 0);
          if (m) f.marking = m;
        }
      },
      'Surface lines',
    );
  }

  fit(s: MapSurface): void {
    this.change(s.id, refitMarking, 'Fit lines');
  }

  turn(s: MapSurface): void {
    this.change(
      s.id,
      (f) => {
        if (f.marking) f.marking = { ...f.marking, angle: Math.round((f.marking.angle + Math.PI / 2) * 1e4) / 1e4, length: f.marking.width, width: f.marking.length };
      },
      'Turn lines',
    );
  }

  remove(s: MapSurface): void {
    this.session.edit('Changing the surfaces', (e) => e.execute(surfacesCommand(e.doc, (list) => list.splice(list.findIndex((x) => x.id === s.id), 1), 'Remove surface')));
    if (this.settings().chosen === s.id) patch(this.settings, { chosen: null, point: -1 });
  }

  private change(id: string, edit: (s: MapSurface) => void, label: string): void {
    this.session.edit('Changing the surfaces', (e) =>
      e.execute(
        surfacesCommand(
          e.doc,
          (list) => {
            const f = list.find((x) => x.id === id);
            if (f) edit(f);
          },
          label,
        ),
      ),
    );
  }
}
