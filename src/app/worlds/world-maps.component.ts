import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import { StageContinueComponent } from './stage-continue.component';
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
  imports: [TdIconComponent, StageContinueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      <p class="td-note">Every map that exists as a file: shipped, from coop hosts and yours, in the engine's own look.</p>
      @if (lock()) {
        <p class="td-banner is-warn">Built worlds and the editor are coming soon in this build.</p>
      }
      <app-stage-continue world="maps" />
      @for (group of groups(); track group.title) {
        @if (group.maps.length || group.empty) {
        <section class="td-group" [attr.aria-labelledby]="'wm-maps-' + $index">
          <h3 class="td-section" [id]="'wm-maps-' + $index">{{ group.title }}</h3>
          @if (group.maps.length) {
            <div class="td-rows">
              @for (map of group.maps; track map.id) {
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" [class.is-selected]="pickedId() === map.id" [attr.data-map]="map.id"
                          (click)="stage.pick('maps', { kind: 'map', id: map.id, name: map.name })">
                    <span class="wm-map">
                      @if (map.picture) {
                        <img class="wm-thumb td-well" [src]="map.picture" alt="" />
                      } @else {
                        <span class="wm-thumb td-well" aria-hidden="true"></span>
                      }
                      <span class="wm-row-name">
                        <span class="td-name">{{ map.name }}</span>
                        @if (badge(map); as b) {
                          <small class="td-tag wm-badge">{{ b }}</small>
                        }
                      </span>
                    </span>
                    <span class="td-note td-num wm-meta">{{ map.spawns }} {{ map.spawns === 1 ? 'spawn' : 'spawns' }}</span>
                  </button>
                  @if (group.recent) {
                    <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="'Remove ' + map.name + ' from Recent'"
                            title="Remove from Recent" (click)="stage.forgetMap(map.id)">
                      <td-icon name="close" [size]="12" />
                    </button>
                  }
                </div>
              }
            </div>
          } @else {
            <p class="td-note">{{ group.empty }}</p>
          }
        </section>
        }
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
              <small class="td-note wm-sub">Your copy comes with the first change</small>
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
  /**
   * Recent (the maps played lately), the own ones, the coop hosts' and the
   * shipped; an OpenStreetMap map not changed since it was made is
   * OpenStreetMap's, not listed here (docs/WORLDS_STATE_PLAN.md, 3.6)
   */
  readonly groups = computed(() => {
    const maps = this.stage.maps().filter((m) => !m.generated);
    const of = (origins: readonly StageMap['origin'][]) => maps.filter((m) => origins.includes(m.origin));
    const recent = this.stage.recentMaps().map((id) => maps.find((m) => m.id === id)).filter((m): m is StageMap => !!m);
    return [
      { title: 'Recent', maps: recent, empty: null, recent: true },
      { title: 'Your built worlds', maps: of(['own']), empty: 'None yet: New map opens the editor, or make one of a real place under OpenStreetMap and change it there.', recent: false },
      { title: 'From coop hosts', maps: of(['shared']), empty: 'Maps a coop host played with you land here.', recent: false },
      { title: 'Shipped', maps: of(['shipped']), empty: 'The shipped maps did not load.', recent: false },
    ];
  });

  /** Where an own map comes from: made from OpenStreetMap, or a copy of a shipped or a host's map */
  badge(map: StageMap): string | null {
    if (map.osm) return 'from OpenStreetMap';
    return map.copyOf ? `copy of ${map.copyOf}` : null;
  }
  readonly pickedId = computed(() => {
    const pick = this.stage.picks().maps;
    return pick?.kind === 'map' ? pick.id : null;
  });
  readonly picked = computed(() => {
    const id = this.pickedId();
    const pick = this.stage.picks().maps;
    if (!id || !pick) return null;
    return this.stage.maps().find((m) => m.id === id) ?? { id, name: pick.name, description: '', spawns: 0, origin: 'own' as const, picture: null };
  });
  readonly playWhy = computed(() => this.stage.whyNot('play', 'maps'));
  readonly continues = computed(() => this.stage.runHere('maps', this.stage.picks().maps) !== null);

  /** The editor with its list of maps, where a new map starts, in this window */
  newMap(): void {
    if (this.stage.whyNot('edit', 'maps')) return;
    this.worlds.editMap(null);
  }
}
