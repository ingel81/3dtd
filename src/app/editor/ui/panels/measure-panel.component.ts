import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { polylineLength } from '../../../map-ops/path-graph';
import { measureLine } from '../../ops/measure';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { TOWER_SPOT_M2, TYPICAL_TOWER_RANGE } from '../../../map-ops/validation/build-areas';
import { patch } from '../../tools/tool';
import { injectT } from '../../../i18n/i18n.service';

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
      <h3 class="td-section">{{ t().editor.measure.measured }}</h3>
      @if (result(); as r) {
        <div class="td-kv"><span>{{ t().editor.measure.onMap }}</span><span class="td-num" data-test="measured">{{ t().editor.measure.metres(r.flat) }}</span></div>
        <div class="td-kv"><span>{{ t().editor.measure.alongGround }}</span><span class="td-num">{{ t().editor.measure.metres(r.ground) }}</span></div>
        <div class="td-kv"><span>{{ t().editor.measure.upDown }}</span><span class="td-num">{{ t().editor.measure.metres(r.climb) }} | {{ t().editor.measure.metres(r.drop) }}</span></div>
        <button class="td-btn-ghost td-btn-sm" type="button" (click)="clear()">{{ t().editor.measure.clear }} <kbd class="td-kbd">Esc</kbd></button>
      } @else {
        <p class="td-note">{{ t().editor.measure.clickPoints }}</p>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.measure.lanes }}</h3>
      <p class="td-note">{{ t().editor.measure.walking(speeds.slow, speeds.typical, speeds.fast) }}</p>
      @for (l of lanes(); track l.id) {
        <div class="td-kv">
          <span class="td-trunc">{{ l.name }}</span>
          <span class="td-num" [class.td-tone-hurt]="l.length === null">{{ l.length === null ? t().editor.measure.noRoute : t().editor.measure.metres(l.length) + ' | ' + l.times }}</span>
        </div>
      } @empty {
        <p class="td-note">{{ t().editor.measure.noSpawns }}</p>
      }
    </div>
    <div class="td-group">
      <h3 class="td-section">{{ t().editor.measure.overlays }}</h3>
      <div class="td-setting">
        <span>{{ t().editor.measure.buildAreas }}</span>
        <input class="td-switch" type="checkbox" [checked]="view().buildAreas" (change)="setBuildAreas($any($event.target).checked)" [attr.aria-label]="t().editor.measure.buildAreas" data-test="build-areas" />
      </div>
      @if (view().buildAreas) {
        <ul class="ms-legend td-note">
          <li><span class="ms-key is-reach"></span>{{ t().editor.measure.reach(range) }}</li>
          <li><span class="ms-key is-far"></span>{{ t().editor.measure.far }}</li>
          <li><span class="ms-key is-blocked"></span>{{ t().editor.measure.blocked }}</li>
        </ul>
        @if (room(); as r) {
          <div class="td-kv"><span>{{ t().editor.measure.inReach }}</span><span class="td-num" data-test="build-room">{{ t().editor.measure.room(r.area, r.spots) }}</span></div>
        } @else {
          <p class="td-note">{{ t().editor.measure.judging }}</p>
        }
      }
      <div class="td-setting">
        <span>{{ t().editor.measure.contoursEvery(view().contourStep) }}</span>
        <input class="td-switch" type="checkbox" [checked]="view().contours" (change)="set('contours', $any($event.target).checked)" [attr.aria-label]="t().editor.measure.contours" data-test="contours" />
      </div>
      <div class="td-seg is-compact is-sm" role="radiogroup" [attr.aria-label]="t().editor.measure.contourStep">
        @for (s of [1, 2, 5, 10]; track s) {
          <button type="button" role="radio" [attr.aria-checked]="view().contourStep === s" (click)="setStep('contourStep', s)">{{ t().editor.measure.metres(s) }}</button>
        }
      </div>
      <div class="td-setting">
        <span>{{ t().editor.measure.gridEvery(view().gridStep) }}</span>
        <input class="td-switch" type="checkbox" [checked]="view().grid" (change)="set('grid', $any($event.target).checked)" [attr.aria-label]="t().editor.measure.grid" />
      </div>
      <div class="td-seg is-compact is-sm" role="radiogroup" [attr.aria-label]="t().editor.measure.gridStep">
        @for (s of [10, 25, 50, 100]; track s) {
          <button type="button" role="radio" [attr.aria-checked]="view().gridStep === s" (click)="setStep('gridStep', s)">{{ t().editor.measure.metres(s) }}</button>
        }
      </div>
    </div>
  `,
})
export class MeasurePanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('markers', 'paths', 'terrain');
  readonly speeds = SPEEDS;
  readonly range = TYPICAL_TOWER_RANGE;
  /** The buildable area in reach of any route, and how many towers fit on it at the least spacing */
  readonly room = computed(() => {
    const a = this.session.check.buildAreas();
    return a ? { area: Math.round(a.inReach), spots: Math.floor(a.inReach / TOWER_SPOT_M2) } : null;
  });
  readonly view = this.session.tools.settings.view;
  readonly result = computed(() => {
    this.rev();
    const pts = this.session.tools.settings.measure();
    const doc = this.session.doc;
    if (!doc || pts.length < 2) return null;
    const r = measureLine(doc.terrain, pts);
    return { flat: Math.round(r.flat), ground: Math.round(r.ground), climb: Math.round(r.climb), drop: Math.round(r.drop) };
  });
  readonly lanes = computed(() => {
    this.rev();
    const doc = this.session.doc;
    if (!doc) return [];
    const routes = this.session.routes.routes();
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
    this.session.check.setBuildAreaOverlay(on);
  }

  set(key: 'contours' | 'grid', on: boolean): void {
    patch(this.session.tools.settings.view, { [key]: on });
  }

  setStep(key: 'contourStep' | 'gridStep', v: number): void {
    patch(this.session.tools.settings.view, { [key]: v, [key === 'contourStep' ? 'contours' : 'grid']: true });
  }

  clear(): void {
    this.session.tools.settings.measure.set([]);
  }
}
