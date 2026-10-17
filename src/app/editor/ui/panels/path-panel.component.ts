import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapPathKind } from '../../../world/custom-map/map-document';
import { edgePolyline, polylineLength, smoothEdge, straightenEdge } from '../../../map-ops/path-graph';
import { selectedEdges, selectedNodes } from '../../model/editor-document';
import { roadSurfaces } from '../../ops/landscape/road';
import { editRoads, flattenRoads, paintRoads, pathCommands, rebuildRoads, setRoadSurface, setRoads } from '../../ops/road-commands';
import { patch, type PathMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { RangeRowComponent } from './range-row.component';

/** What a road edit says when it has to wait */
const ROADS = 'Changing roads';

const KINDS: { id: MapPathKind; label: string }[] = [
  { id: 'road', label: 'Road' },
  { id: 'path', label: 'Path' },
  { id: 'bridge', label: 'Bridge' },
];

/**
 * Roads: draw or edit, width and kind for new roads and the selected one,
 * the selected road's surface,
 * smoothing, routes on or off, and "Flatten road" / "Paint road" for the
 * ground under them.
 */
@Component({
  selector: 'app-path-panel',
  standalone: true,
  imports: [RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-seg is-sm" role="radiogroup" aria-label="Road tool">
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'draw'" (click)="setMode('draw')" data-mode="draw">Draw</button>
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'edit'" (click)="setMode('edit')" data-mode="edit">Edit</button>
    </div>

    @if (edge(); as e) {
      <div class="td-group">
        <h3 class="td-section">{{ e.id }} <span class="td-note">{{ e.length }} m</span></h3>
        <app-editor-range label="Width" unit="m" [min]="2" [max]="40" [step]="0.5" [value]="e.width" (changed)="setEdge({ width: $event })" />
        <div class="td-seg is-sm" role="radiogroup" aria-label="Kind of the road">
          @for (k of kinds; track k.id) {
            <button type="button" role="radio" [attr.aria-checked]="e.kind === k.id" (click)="setEdge({ kind: k.id })">{{ k.label }}</button>
          }
        </div>
        @if (e.kind !== 'bridge' && surfaces().length) {
          <label class="td-setting">
            <span>Surface</span>
            <select class="td-select is-auto" (change)="setSurface($any($event.target).value)" aria-label="Surface of the road" data-test="road-surface"
                    matTooltip="The road's own ground, painted under it at once and kept when the dressing is laid anew; None draws cobbles and ruts over the ground">
              <option value="" [selected]="!e.surface">None</option>
              @for (m of surfaces(); track m.id) {
                <option [value]="m.id" [selected]="e.surface === m.id">{{ m.name }}</option>
              }
            </select>
          </label>
        }
      </div>
    }
    @if (edgeIds().length) {
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="smooth()">Smooth <kbd class="td-kbd">S</kbd></button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="straighten()">Straighten <kbd class="td-kbd">X</kbd></button>
        <button class="td-btn-danger td-btn-sm" type="button" (click)="remove()">Delete <kbd class="td-kbd">Del</kbd></button>
      </div>
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="rebuild()" data-test="rebuild-dressing"
              matTooltip="Lays embankment, surface, lamps and fences anew along the road: as the road brush built it, as the map shows it, or with the road brush's settings (Landscape, Road)">Rebuild road dressing</button>
    }

    <div class="td-group">
      <h3 class="td-section">New roads</h3>
      <app-editor-range label="Width" unit="m" [min]="2" [max]="40" [step]="0.5" [value]="s().width" (changing)="set('width', $event)" />
      <div class="td-seg is-sm" role="radiogroup" aria-label="Kind of new roads">
        @for (k of kinds; track k.id) {
          <button type="button" role="radio" [attr.aria-checked]="s().kind === k.id" (click)="setKind(k.id)">{{ k.label }}</button>
        }
      </div>
      <app-editor-range label="Snap" unit="m" [min]="0" [max]="40" [step]="1" [value]="s().snap" (changing)="set('snap', $event)" />
      <div class="td-setting">
        <span>Show routes from the spawns</span>
        <input class="td-switch" type="checkbox" [checked]="s().showRoutes" (change)="setRoutes($any($event.target).checked)" aria-label="Show routes" />
      </div>
    </div>

    <div class="td-group">
      <h3 class="td-section">Ground under roads</h3>
      <p class="td-note">{{ edgeIds().length ? 'For the selected road.' : 'For every road.' }}</p>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="flatten()" matTooltip="Levels the ground across each road and smooths it along" data-test="flatten-roads">Flatten road</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="paint()">Paint road</button>
        <select class="td-select is-auto" [value]="layer()" (change)="layer.set(+$any($event.target).value)" aria-label="Layer to paint">
          @for (l of layers(); track l.index) {
            <option [value]="l.index" [selected]="l.index === layer()">{{ l.name }}</option>
          }
        </select>
      </div>
    </div>
  `,
})
export class PathPanelComponent {
  private readonly session = inject(EditorSession);
  /** The map's revision while this panel is in sight (PanelShown) */
  private readonly rev = panelRev();
  readonly kinds = KINDS;
  readonly s = this.session.settings.paths;
  readonly layer = signal(0);
  readonly surfaces = computed(() => roadSurfaces(this.session.catalog()));
  readonly layers = computed(() => {
    this.rev();
    const catalog = this.session.catalog();
    return (this.session.doc?.terrain.layers ?? []).map((l, index) => ({ index, name: catalog.material(l.material).name }));
  });
  readonly edgeIds = computed(() => {
    this.rev();
    const sel = this.session.selection();
    const doc = this.session.doc;
    if (!doc) return [];
    // The selected roads and those at the selected nodes
    const edges = new Set(selectedEdges(sel));
    const nodes = new Set(selectedNodes(sel));
    return doc.paths.edges.filter((e) => edges.has(e.id) || nodes.has(e.a) || nodes.has(e.b)).map((e) => e.id);
  });
  readonly edge = computed(() => {
    this.rev();
    const sel = this.session.selection();
    const doc = this.session.doc;
    const ids = new Set(selectedEdges(sel));
    if (!ids.size || !doc) return null;
    const list = doc.paths.edges.filter((x) => ids.has(x.id));
    if (!list.length) return null;
    const length = Math.round(list.reduce((n, e) => n + polylineLength(edgePolyline(doc.paths, e)), 0));
    // Several roads: their values as the first has them, a change goes to all
    return { id: list.length === 1 ? `Road ${list[0].id}` : `${list.length} roads`, width: list[0].width, kind: list[0].kind, surface: list[0].surface, length, ids: list.map((e) => e.id) };
  });

  setMode(mode: PathMode): void {
    patch(this.session.settings.paths, { mode });
  }

  set(key: 'width' | 'snap', v: number): void {
    patch(this.session.settings.paths, { [key]: v });
  }

  setKind(kind: MapPathKind): void {
    patch(this.session.settings.paths, { kind });
  }

  setRoutes(on: boolean): void {
    patch(this.session.settings.paths, { showRoutes: on });
    this.session.viewport?.refreshRoutes();
  }

  setEdge(patch: { width?: number; kind?: MapPathKind }): void {
    const ids = this.edge()?.ids ?? this.edgeIds();
    if (ids.length) this.session.edit(ROADS, (e) => setRoads(e, this.session.catalog(), ids, patch));
  }

  setSurface(material: string): void {
    const ids = this.edge()?.ids ?? [];
    if (ids.length) this.session.edit(ROADS, (e) => setRoadSurface(e, this.session.catalog(), ids, material || null));
  }

  smooth(): void {
    const ids = this.edgeIds();
    this.session.edit(ROADS, (e) => editRoads(e, this.session.catalog(), 'Smooth road', (paths) => ids.forEach((id) => smoothEdge(paths, id))));
  }

  straighten(): void {
    const ids = this.edgeIds();
    this.session.edit(ROADS, (e) => editRoads(e, this.session.catalog(), 'Straighten road', (paths) => ids.forEach((id) => straightenEdge(paths, id))));
  }

  remove(): void {
    const sel = this.session.selection();
    const nodes = selectedNodes(sel);
    const edges = selectedEdges(sel);
    if (!nodes.length && !edges.length) return;
    if (this.session.edit(ROADS, (e) => e.execute(pathCommands.removeMany(e, nodes, edges)))) this.session.editor?.select(null);
  }

  rebuild(): void {
    const ids = this.edgeIds();
    if (!ids.length) return;
    if (this.session.edit('Rebuilding roads', (e) => rebuildRoads(e, this.session.catalog(), ids, this.session.settings.landscape().road))) {
      this.session.flash(`Dressing laid anew along ${ids.length} ${ids.length === 1 ? 'road' : 'roads'}`);
    }
  }

  flatten(): void {
    const ids = this.edgeIds();
    let done = false;
    if (this.session.edit('Flattening roads', (e) => (done = flattenRoads(e, ids.length ? ids : null)))) {
      this.session.flash(done ? 'Ground under the roads flattened' : 'No road to flatten');
    }
  }

  paint(): void {
    const ids = this.edgeIds();
    this.session.edit('Painting roads', (e) => paintRoads(e, this.layer(), ids.length ? ids : null));
  }
}
