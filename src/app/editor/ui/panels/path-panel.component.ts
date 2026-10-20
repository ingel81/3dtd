import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { MapPathKind } from '../../../world/custom-map/map-document';
import { edgePolyline, polylineLength, smoothEdge, straightenEdge } from '../../../map-ops/path-graph';
import { selectedEdges, selectedNodes } from '../../model/editor-document';
import { roadSurfaces } from '../../ops/landscape/road';
import { catalogName } from '../../ops/describe';
import { editRoads, flattenRoads, paintRoads, pathCommands, rebuildRoads, setRoadSurface, setRoads } from '../../ops/road-commands';
import { patch, type PathMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { RangeRowComponent } from './range-row.component';
import { injectT } from '../../../i18n/i18n.service';

/** The kinds of road in their order; their names are the dictionary's (i18n `editor.paths.kinds`) */
const KINDS: readonly MapPathKind[] = ['road', 'path', 'bridge'];

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
    <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.paths.tool">
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'draw'" (click)="setMode('draw')" data-mode="draw">{{ t().editor.paths.draw }}</button>
      <button type="button" role="radio" [attr.aria-checked]="s().mode === 'edit'" (click)="setMode('edit')" data-mode="edit">{{ t().editor.paths.edit }}</button>
    </div>

    @if (edge(); as e) {
      <div class="td-group">
        <h3 class="td-section">{{ e.id }} <span class="td-note">{{ t().editor.paths.metres(e.length) }}</span></h3>
        <app-editor-range [label]="t().editor.paths.width" unit="m" [min]="2" [max]="40" [step]="0.5" [value]="e.width" (changed)="setEdge({ width: $event })" />
        <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.paths.kindOf">
          @for (k of kinds; track k) {
            <button type="button" role="radio" [attr.aria-checked]="e.kind === k" (click)="setEdge({ kind: k })">{{ t().editor.paths.kinds[k] }}</button>
          }
        </div>
        @if (e.kind !== 'bridge' && surfaces().length) {
          <label class="td-setting">
            <span>{{ t().editor.paths.surface }}</span>
            <select class="td-select is-auto" (change)="setSurface($any($event.target).value)" [attr.aria-label]="t().editor.paths.surfaceOf" data-test="road-surface"
                    [matTooltip]="t().editor.paths.surfaceTip">
              <option value="" [selected]="!e.surface">{{ t().editor.paths.none }}</option>
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
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="smooth()">{{ t().editor.paths.smooth }} <kbd class="td-kbd">S</kbd></button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="straighten()">{{ t().editor.paths.straighten }} <kbd class="td-kbd">X</kbd></button>
        <button class="td-btn-danger td-btn-sm" type="button" (click)="remove()">{{ t().editor.paths.delete }} <kbd class="td-kbd">Del</kbd></button>
      </div>
      <button class="td-btn-secondary td-btn-sm" type="button" (click)="rebuild()" data-test="rebuild-dressing"
              [matTooltip]="t().editor.paths.rebuildTip">{{ t().editor.paths.rebuild }}</button>
    }

    <div class="td-group">
      <h3 class="td-section">{{ t().editor.paths.newRoads }}</h3>
      <app-editor-range [label]="t().editor.paths.width" unit="m" [min]="2" [max]="40" [step]="0.5" [value]="s().width" (changing)="set('width', $event)" />
      <div class="td-seg is-sm" role="radiogroup" [attr.aria-label]="t().editor.paths.kindNew">
        @for (k of kinds; track k) {
          <button type="button" role="radio" [attr.aria-checked]="s().kind === k" (click)="setKind(k)">{{ t().editor.paths.kinds[k] }}</button>
        }
      </div>
      <app-editor-range [label]="t().editor.paths.snap" unit="m" [min]="0" [max]="40" [step]="1" [value]="s().snap" (changing)="set('snap', $event)" />
      <div class="td-setting">
        <span>{{ t().editor.paths.showRoutesLong }}</span>
        <input class="td-switch" type="checkbox" [checked]="s().showRoutes" (change)="setRoutes($any($event.target).checked)" [attr.aria-label]="t().editor.paths.showRoutes" />
      </div>
    </div>

    <div class="td-group">
      <h3 class="td-section">{{ t().editor.paths.ground }}</h3>
      <p class="td-note">{{ edgeIds().length ? t().editor.paths.forSelected : t().editor.paths.forEvery }}</p>
      <div class="td-actions is-start">
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="flatten()" [matTooltip]="t().editor.paths.flattenTip" data-test="flatten-roads">{{ t().editor.paths.flatten }}</button>
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="paint()">{{ t().editor.paths.paint }}</button>
        <select class="td-select is-auto" [value]="layer()" (change)="layer.set(+$any($event.target).value)" [attr.aria-label]="t().editor.paths.layer">
          @for (l of layers(); track l.index) {
            <option [value]="l.index" [selected]="l.index === layer()">{{ l.name }}</option>
          }
        </select>
      </div>
    </div>
  `,
})
export class PathPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('paths', 'terrain');
  readonly kinds = KINDS;
  readonly s = this.session.tools.settings.paths;
  readonly layer = signal(0);
  readonly surfaces = computed(() => roadSurfaces(this.session.catalog(), this.t()));
  readonly layers = computed(() => {
    this.rev();
    const catalog = this.session.catalog();
    const words = this.t();
    return (this.session.doc?.terrain.layers ?? []).map((l, index) => ({ index, name: catalogName(words, catalog.material(l.material)) }));
  });
  readonly edgeIds = computed(() => {
    this.rev();
    const sel = this.session.state.selection();
    const doc = this.session.doc;
    if (!doc) return [];
    // The selected roads and those at the selected nodes
    const edges = new Set(selectedEdges(sel));
    const nodes = new Set(selectedNodes(sel));
    return doc.paths.edges.filter((e) => edges.has(e.id) || nodes.has(e.a) || nodes.has(e.b)).map((e) => e.id);
  });
  readonly edge = computed(() => {
    this.rev();
    const sel = this.session.state.selection();
    const doc = this.session.doc;
    const ids = new Set(selectedEdges(sel));
    if (!ids.size || !doc) return null;
    const list = doc.paths.edges.filter((x) => ids.has(x.id));
    if (!list.length) return null;
    const length = Math.round(list.reduce((n, e) => n + polylineLength(edgePolyline(doc.paths, e)), 0));
    // Several roads: their values as the first has them, a change goes to all
    return { id: list.length === 1 ? this.t().editor.paths.roadName(list[0].id) : this.t().editor.paths.roadsCount(list.length), width: list[0].width, kind: list[0].kind, surface: list[0].surface, length, ids: list.map((e) => e.id) };
  });

  setMode(mode: PathMode): void {
    patch(this.session.tools.settings.paths, { mode });
  }

  set(key: 'width' | 'snap', v: number): void {
    patch(this.session.tools.settings.paths, { [key]: v });
  }

  setKind(kind: MapPathKind): void {
    patch(this.session.tools.settings.paths, { kind });
  }

  setRoutes(on: boolean): void {
    patch(this.session.tools.settings.paths, { showRoutes: on });
    this.session.view.refreshRoutes();
  }

  setEdge(patch: { width?: number; kind?: MapPathKind }): void {
    const ids = this.edge()?.ids ?? this.edgeIds();
    if (ids.length) this.session.edit(this.t().editor.paths.changing, (e) => setRoads(e, this.session.catalog(), ids, patch));
  }

  setSurface(material: string): void {
    const ids = this.edge()?.ids ?? [];
    if (ids.length) this.session.edit(this.t().editor.paths.changing, (e) => setRoadSurface(e, this.session.catalog(), ids, material || null));
  }

  smooth(): void {
    const ids = this.edgeIds();
    this.session.edit(this.t().editor.paths.changing, (e) => editRoads(e, this.session.catalog(), this.t().editor.paths.smoothStep, (paths) => ids.forEach((id) => smoothEdge(paths, id))));
  }

  straighten(): void {
    const ids = this.edgeIds();
    this.session.edit(this.t().editor.paths.changing, (e) => editRoads(e, this.session.catalog(), this.t().editor.paths.straightenStep, (paths) => ids.forEach((id) => straightenEdge(paths, id))));
  }

  remove(): void {
    const sel = this.session.state.selection();
    const nodes = selectedNodes(sel);
    const edges = selectedEdges(sel);
    if (!nodes.length && !edges.length) return;
    if (this.session.edit(this.t().editor.paths.changing, (e) => e.execute(pathCommands.removeMany(e, nodes, edges)))) this.session.editor?.select(null);
  }

  rebuild(): void {
    const ids = this.edgeIds();
    if (!ids.length) return;
    if (this.session.edit(this.t().editor.paths.rebuilding, (e) => rebuildRoads(e, this.session.catalog(), ids, this.session.tools.settings.landscape().road))) {
      this.session.notices.flash(this.t().editor.paths.rebuilt(ids.length));
    }
  }

  flatten(): void {
    const ids = this.edgeIds();
    let done = false;
    if (this.session.edit(this.t().editor.paths.flattening, (e) => (done = flattenRoads(e, ids.length ? ids : null)))) {
      this.session.notices.flash(done ? this.t().editor.paths.flattened : this.t().editor.paths.noFlatten);
    }
  }

  paint(): void {
    const ids = this.edgeIds();
    this.session.edit(this.t().editor.paths.painting, (e) => paintRoads(e, this.layer(), ids.length ? ids : null));
  }
}
