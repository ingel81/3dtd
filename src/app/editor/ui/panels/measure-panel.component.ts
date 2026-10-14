import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { polylineLength, spawnRoutes } from '../../ops/path-graph';
import { measureLine } from '../../tools/measure-tool';
import { EditorSession } from '../editor-session.service';
import { TOWER_SPOT_M2, TYPICAL_TOWER_RANGE } from '../../validation/build-areas';

/** Walking speeds of the ground enemies, metres per second */
const SPEEDS = (() => {
  const ground = Object.values(ENEMY_TYPES).filter((e) => !e.isBoss && !e.isAirUnit && e.baseSpeed > 0);
  const speeds = ground.map((e) => e.baseSpeed).sort((a, b) => a - b);
  return { slow: speeds[0] ?? 3, typical: speeds[Math.floor(speeds.length / 2)] ?? 5, fast: speeds[speeds.length - 1] ?? 8 };
})();

/** Measured line, lane lengths and how long enemies walk them; build areas, height lines and grid */
@Component({
  selector: 'app-measure-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  styles: [
    `.ms-legend { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
     .ms-key { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: var(--td-radius); vertical-align: -1px; }
     .ms-key.is-reach { background: var(--td-green-dark); }
     .ms-key.is-far { background: var(--td-green); opacity: 0.45; }
     .ms-key.is-blocked { background: var(--td-danger-edge); opacity: 0.8; }`,
  ],
  template: `
    <div class="td-group">
      <h3 class="td-section">Measured</h3>
      @if (result(); as r) {
        <div class="td-kv"><span>On the map</span><span class="td-num" data-test="measured">{{ r.flat }} m</span></div>
        <div class="td-kv"><span>Along the ground</span><span class="td-num">{{ r.ground }} m</span></div>
        <div class="td-kv"><span>Up | down</span><span class="td-num">{{ r.climb }} m | {{ r.drop }} m</span></div>
        <button class="td-btn-ghost td-btn-sm" type="button" (click)="clear()">Clear <kbd class="td-kbd">Esc</kbd></button>
      } @else {
        <p class="td-note">Click two or more points on the map.</p>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">Lanes</h3>
      <p class="td-note">Walking time at {{ speeds.slow }}, {{ speeds.typical }} and {{ speeds.fast }} m/s (slowest, typical, fastest ground enemy).</p>
      @for (l of lanes(); track l.id) {
        <div class="td-kv">
          <span class="td-trunc">{{ l.name }}</span>
          <span class="td-num" [class.td-tone-hurt]="l.length === null">{{ l.length === null ? 'no route' : l.length + ' m | ' + l.times }}</span>
        </div>
      } @empty {
        <p class="td-note">No spawns yet.</p>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">Overlays</h3>
      <div class="td-setting">
        <span>Build areas</span>
        <input class="td-switch" type="checkbox" [checked]="view().buildAreas" (change)="setBuildAreas($any($event.target).checked)" aria-label="Build areas" data-test="build-areas" />
      </div>
      @if (view().buildAreas) {
        <ul class="ms-legend td-note">
          <li><span class="ms-key is-reach"></span>A tower may stand and reaches a route ({{ range }} m)</li>
          <li><span class="ms-key is-far"></span>A tower may stand, out of reach</li>
          <li><span class="ms-key is-blocked"></span>No tower: water, too steep, an object, the route, HQ or spawn</li>
        </ul>
        @if (room(); as r) {
          <div class="td-kv"><span>In reach of the routes</span><span class="td-num" data-test="build-room">{{ r.area }} m² | about {{ r.spots }} towers</span></div>
        } @else {
          <p class="td-note">Judging the map …</p>
        }
      }
      <div class="td-setting">
        <span>Height lines every {{ view().contourStep }} m</span>
        <input class="td-switch" type="checkbox" [checked]="view().contours" (change)="set('contours', $any($event.target).checked)" aria-label="Height lines" data-test="contours" />
      </div>
      <div class="td-seg is-compact is-sm" role="radiogroup" aria-label="Height line step">
        @for (s of [1, 2, 5, 10]; track s) {
          <button type="button" role="radio" [attr.aria-checked]="view().contourStep === s" (click)="setStep('contourStep', s)">{{ s }} m</button>
        }
      </div>
      <div class="td-setting">
        <span>Grid every {{ view().gridStep }} m</span>
        <input class="td-switch" type="checkbox" [checked]="view().grid" (change)="set('grid', $any($event.target).checked)" aria-label="Grid" />
      </div>
      <div class="td-seg is-compact is-sm" role="radiogroup" aria-label="Grid step">
        @for (s of [10, 25, 50, 100]; track s) {
          <button type="button" role="radio" [attr.aria-checked]="view().gridStep === s" (click)="setStep('gridStep', s)">{{ s }} m</button>
        }
      </div>
    </div>
  `,
})
export class MeasurePanelComponent {
  private readonly session = inject(EditorSession);
  readonly speeds = SPEEDS;
  readonly range = TYPICAL_TOWER_RANGE;
  /** The buildable area in reach of any route, and how many towers fit on it at the least spacing */
  readonly room = computed(() => {
    const a = this.session.buildAreas();
    return a ? { area: Math.round(a.inReach).toLocaleString('en-US'), spots: Math.floor(a.inReach / TOWER_SPOT_M2).toLocaleString('en-US') } : null;
  });
  readonly view = computed(() => (this.session.settingsRev(), { ...this.session.settings.view }));
  readonly result = computed(() => {
    this.session.settingsRev();
    this.session.docRev();
    const pts = this.session.settings.measure;
    const doc = this.session.doc;
    if (!doc || pts.length < 2) return null;
    const r = measureLine(doc.terrain, pts);
    return { flat: Math.round(r.flat), ground: Math.round(r.ground), climb: Math.round(r.climb), drop: Math.round(r.drop) };
  });
  readonly lanes = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    if (!doc) return [];
    const routes = spawnRoutes(doc);
    return doc.spawns.map((s) => {
      const r = routes.get(s.id);
      const length = r ? Math.round(polylineLength(r.points)) : null;
      const time = (v: number) => {
        const sec = Math.round((length ?? 0) / v);
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      };
      return { id: s.id, name: s.name, length, times: length === null ? '' : `${time(SPEEDS.slow)} | ${time(SPEEDS.typical)} | ${time(SPEEDS.fast)}` };
    });
  });

  setBuildAreas(on: boolean): void {
    this.session.setBuildAreaOverlay(on);
  }

  set(key: 'contours' | 'grid', on: boolean): void {
    this.session.patchSettings((s) => (s.view[key] = on));
  }

  setStep(key: 'contourStep' | 'gridStep', v: number): void {
    this.session.patchSettings((s) => {
      s.view[key] = v;
      s.view[key === 'contourStep' ? 'contours' : 'grid'] = true;
    });
  }

  clear(): void {
    this.session.patchSettings((s) => (s.measure = []));
  }
}
