import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import { StageContinueComponent } from './stage-continue.component';
import type { StageMap } from './worlds-stage.service';
import { TRASH_DAYS, type MapSummary } from '../world/custom-map/map-store';
import { WorldsStageService } from './worlds-stage.service';

/**
 * The maps' menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.1), the one list of
 * maps (docs/WORLDS_STATE_PLAN.md): every map with where it comes from
 * (own, OpenStreetMap, from coop hosts, shipped), New map and Import file at
 * the own maps, Download, Duplicate and Delete at the pick, the trash at the
 * end. A
 * row picks, the globe turns to the map's tower; Play (or a double click on
 * the row) loads it, Edit opens it in the editor (a shipped or a host's map
 * as an own copy).
 */
@Component({
  selector: 'app-world-maps',
  standalone: true,
  imports: [TdIconComponent, StageContinueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      @if (lock()) {
        <p class="td-banner is-warn">Built worlds and the editor are coming soon in this build.</p>
      }
      <app-stage-continue world="maps" />
      @for (group of groups(); track group.title) {
        @if (group.maps.length || group.empty) {
        <section class="td-group" [attr.aria-labelledby]="'wm-maps-' + $index">
          @if (group.own) {
            <!-- New map and Import file beside the own maps' head: the ways to a new map stand where the own maps are -->
            <div class="wm-group-head">
              <h3 class="td-section" [id]="'wm-maps-' + $index">{{ group.title }}</h3>
              <span class="td-inline">
                <button type="button" class="td-btn-secondary td-btn-sm" data-new-map data-test="new-map" [attr.aria-disabled]="editWhy() ? true : null"
                        [attr.title]="editWhy()" (click)="newMap()">New map</button>
                <label class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="editWhy() ? true : null"
                       [attr.title]="editWhy() ?? 'A 3DTD map (.3dtdmap) or a Warcraft 3 map (.w3x, beta)'">
                  Import file
                  <input class="td-sr-only" type="file" accept=".3dtdmap,.w3x,.w3m" multiple [disabled]="!!editWhy()" (change)="importFiles($event)" data-test="import-input" />
                </label>
                @if (stage.mapFolder) {
                  <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.revealMapFolder()"
                          title="Your maps as .3dtdmap files in Documents/3DTD/Maps; put files there to add them" data-test="map-folder">Map folder</button>
                }
              </span>
            </div>
          } @else {
            <h3 class="td-section" [id]="'wm-maps-' + $index">{{ group.title }}</h3>
          }
          @if (group.maps.length) {
            <div class="td-rows">
              @for (map of group.maps; track map.id) {
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" (dblclick)="stage.start('maps')" [class.is-selected]="pickedId() === map.id" [attr.data-map]="map.id"
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
      @if (stage.trashed(); as t) {
        <p class="td-banner is-row" role="status" data-test="trashed">
          <span>{{ t.name }} is in the trash.</span>
          <button class="td-btn-secondary td-btn-sm" type="button" (click)="stage.restoreMap(t.key)">Restore</button>
        </p>
      }
      @if (stage.trash().length) {
        <section class="td-group" aria-labelledby="wm-maps-trash" data-test="trash">
          <h3 class="td-section" id="wm-maps-trash">Trash <span class="td-note">deleted maps wait {{ trashDays }} days</span></h3>
          <div class="td-rows">
            @for (m of stage.trash(); track m.id) {
              <div class="td-inline" [attr.data-trash]="m.trash?.from">
                <span class="wm-row-name wm-trash">
                  <span class="td-name">{{ m.name }}</span>
                  <small class="td-note">{{ deletedLine(m) }}</small>
                </span>
                <button class="td-btn-secondary td-btn-sm" type="button" (click)="stage.restoreMap(m.id)" data-test="trash-restore">Restore</button>
                <button class="td-btn-ghost td-btn-sm" type="button" (click)="stage.purgeMap(m)">Delete for good</button>
              </div>
            }
          </div>
        </section>
      }
    </div>

    <div class="wm-detail td-line-top">
      @if (picked(); as map) {
        <span class="wm-name td-trunc">{{ map.name }}</span>
        @if (map.description) {
          <p class="td-note">{{ map.description }}</p>
        }
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('maps')">
            <td-icon name="play" [size]="14" /><span>{{ playWord() }}</span>
          </button>
          <span>
            <button type="button" class="td-btn-secondary" data-test="open-map" [attr.aria-disabled]="editWhy() ? true : null"
                    [attr.title]="editWhy()" (click)="stage.edit('maps')">Edit in the editor</button>
            @if (map.origin === 'shipped' || map.origin === 'shared') {
              <small class="td-note wm-sub">Your copy comes with the first change</small>
            }
          </span>
        </div>
        @if (listed(); as m) {
          <div class="td-actions is-start">
            <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.downloadMap(m)">Download</button>
            @if (m.origin === 'own') {
              <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.duplicateMap(m)">Duplicate</button>
            }
            @if (m.origin !== 'shipped') {
              <button type="button" class="td-btn-ghost td-btn-sm" data-test="delete-map" (click)="stage.deleteMap(m)">Delete</button>
            }
          </div>
        }
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
      { title: 'Recent', maps: recent, empty: null, recent: true, own: false },
      { title: 'Your built worlds', maps: of(['own']), empty: 'None yet: New map starts one, or change a map made under OpenStreetMap.', recent: false, own: true },
      { title: 'From coop hosts', maps: of(['shared']), empty: 'Maps a coop host played with you land here.', recent: false, own: false },
      { title: 'Shipped', maps: of(['shipped']), empty: 'The shipped maps did not load.', recent: false, own: false },
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
  /** Start's word: Continue of a run, Back to the place held, else Play */
  readonly playWord = computed(() => this.stage.playWord('maps', this.stage.picks().maps, 'Play'));

  /** Why New map, Import file and Edit are locked; null when open */
  readonly editWhy = computed(() => this.stage.whyNot('edit', 'maps'));
  /** The picked map as the list has it (Download, Duplicate, Delete need it listed) */
  readonly listed = computed(() => {
    const id = this.pickedId();
    return id ? (this.stage.maps().find((m) => m.id === id) ?? null) : null;
  });
  readonly trashDays = TRASH_DAYS;

  /** The editor on a new map's form, in this window: one click, not its list and then New map again */
  newMap(): void {
    if (this.editWhy()) return;
    this.stage.newMap();
  }

  /** Files picked: the editor reads them in (its import), then opens the map */
  importFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!this.editWhy()) this.stage.importMaps(files);
  }

  /** "Deleted today | goes for good in 30 days" */
  deletedLine(m: MapSummary): string {
    const days = Math.floor((Date.now() - Date.parse(m.trash?.at ?? '')) / 86_400_000);
    const left = Math.max(0, TRASH_DAYS - days);
    const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    return `Deleted ${when} | goes for good in ${left} ${left === 1 ? 'day' : 'days'}`;
  }
}
