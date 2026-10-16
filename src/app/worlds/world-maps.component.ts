import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import { WorldChoiceService } from '../world/world-choice.service';
import type { StageMap } from './worlds-stage.service';
import { WorldsStageService } from './worlds-stage.service';

/**
 * The maps' menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): every map with
 * where it comes from (own, OpenStreetMap, from coop hosts, shipped). A
 * row picks, the globe turns to the map's tower; Play loads it, Edit opens
 * it in the editor (a shipped or a host's map as an own copy).
 */
@Component({
  selector: 'app-world-maps',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      <p class="td-note">Shipped maps and your own: the same game in the engine's own look.</p>
      @if (lock()) {
        <p class="td-banner is-warn">Maps and the editor are coming soon in this build.</p>
      }
      @if (run(); as run) {
        <div class="td-rows">
          <button type="button" class="td-row wm-row" (click)="stage.continueRun(run)">
            <span class="td-name">Continue</span>
            <span class="td-note td-num wm-meta">{{ run.name }} | wave {{ run.wave }}</span>
          </button>
        </div>
      }
      @for (group of groups(); track group.title) {
        <section class="td-group" [attr.aria-labelledby]="'wm-maps-' + $index">
          <h3 class="td-section" [id]="'wm-maps-' + $index">{{ group.title }}</h3>
          @if (group.maps.length) {
            <div class="td-rows">
              @for (map of group.maps; track map.id) {
                <button type="button" class="td-row wm-row" [class.is-selected]="pickedId() === map.id"
                        (click)="stage.pick('maps', { kind: 'map', id: map.id, name: map.name })">
                  <span class="td-name">{{ map.name }}@if (map.osm) {<span class="td-tag is-caps">OSM</span>}</span>
                  <span class="td-note td-num wm-meta">{{ map.spawns }} {{ map.spawns === 1 ? 'spawn' : 'spawns' }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">{{ group.empty }}</p>
          }
        </section>
      }
      <div class="td-actions is-start">
        <button type="button" class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="stage.whyNot('edit', 'maps') ? true : null"
                [attr.title]="stage.whyNot('edit', 'maps')" (click)="newMap()">New map</button>
      </div>
    </div>

    <div class="wm-detail td-line-top">
      @if (picked(); as map) {
        <span class="wm-name td-trunc">{{ map.name }}</span>
        @if (map.description) {
          <p class="td-note">{{ map.description }}</p>
        }
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('maps')">
            <td-icon name="play" [size]="14" /><span>{{ continues() ? 'Continue' : 'Play' }}</span>
          </button>
          <span>
            <button type="button" class="td-btn-secondary" [attr.aria-disabled]="stage.whyNot('edit', 'maps') ? true : null"
                    [attr.title]="stage.whyNot('edit', 'maps')" (click)="stage.edit('maps')">Edit in the editor</button>
            @if (map.origin === 'shipped' || map.origin === 'shared') {
              <small class="td-note wm-sub">Opens as your copy</small>
            }
          </span>
        </div>
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.</p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      } @else {
        <p class="td-note">Pick a map: its tower turns to the front. Play loads it.</p>
      }
    </div>
  `,
})
export class WorldMapsComponent {
  readonly stage = inject(WorldsStageService);
  private readonly worlds = inject(WorldChoiceService);

  readonly lock = computed(() => this.stage.lock('maps'));
  readonly groups = computed(() => {
    const maps = this.stage.maps();
    const of = (origins: readonly StageMap['origin'][]) => maps.filter((m) => origins.includes(m.origin));
    return [
      { title: 'Your maps', maps: of(['own']), empty: 'None yet: New map opens the editor, or make one from a real place under OpenStreetMap.' },
      { title: 'From coop hosts', maps: of(['shared']), empty: 'Maps a coop host played with you land here.' },
      { title: 'Shipped maps', maps: of(['shipped']), empty: 'The shipped maps did not load.' },
    ];
  });
  readonly pickedId = computed(() => {
    const pick = this.stage.picks().maps;
    return pick?.kind === 'map' ? pick.id : null;
  });
  readonly picked = computed(() => {
    const id = this.pickedId();
    const pick = this.stage.picks().maps;
    if (!id || !pick) return null;
    return this.stage.maps().find((m) => m.id === id) ?? { id, name: pick.name, description: '', spawns: 0, origin: 'own' as const };
  });
  readonly run = computed(() => this.stage.autosaveOf('maps'));
  readonly playWhy = computed(() => this.stage.whyNot('play', 'maps'));
  readonly continues = computed(() => this.stage.runHere('maps', this.stage.picks().maps) !== null);

  /** The editor with its list of maps, where a new map starts, in this window */
  newMap(): void {
    if (this.stage.whyNot('edit', 'maps')) return;
    this.worlds.editMap(null);
  }
}
