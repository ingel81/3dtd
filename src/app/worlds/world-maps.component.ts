import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import { StageContinueComponent } from './stage-continue.component';
import type { StageMap } from './worlds-stage.service';
import { TRASH_DAYS, type MapSummary } from '../world/custom-map/map-store';
import { WorldsStageService } from './worlds-stage.service';
import { injectT } from '../i18n/i18n.service';
import { shippedMapDescription } from '../i18n/shipped-maps';

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
    @let w = t().worlds;
    <div class="wm-body">
      @if (lock()) {
        <p class="td-banner is-warn">{{ w.mapsSoon }}</p>
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
                        [attr.title]="editWhy()" (click)="newMap()">{{ w.newMap }}</button>
                <label class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="editWhy() ? true : null"
                       [attr.title]="editWhy() ?? w.importHint">
                  {{ w.importFile }}
                  <input class="td-sr-only" type="file" accept=".3dtdmap,.w3x,.w3m" multiple [disabled]="!!editWhy()" (change)="importFiles($event)" data-test="import-input" />
                </label>
                @if (stage.mapFolder) {
                  <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.revealMapFolder()"
                          [attr.title]="w.mapFolderHint" data-test="map-folder">{{ w.mapFolder }}</button>
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
                    <span class="td-note td-num wm-meta">{{ w.spawns(map.spawns) }}</span>
                  </button>
                  @if (group.recent) {
                    <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="w.removeRecent(map.name)"
                            [attr.title]="w.removeFromRecent" (click)="stage.forgetMap(map.id)">
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
      @if (stage.trash().length) {
        <section class="td-group" aria-labelledby="wm-maps-trash" data-test="trash">
          <h3 class="td-section" id="wm-maps-trash">{{ w.trash }} <span class="td-note">{{ w.trashWait(trashDays) }}</span></h3>
          <div class="td-rows">
            @for (m of stage.trash(); track m.id) {
              <!-- A row with its tools, as the save slots stand: the row brings the map back, the bin ends it -->
              <div class="td-row wm-trash" [attr.data-trash]="m.trash?.from" [class.is-fresh]="stage.trashed()?.key === m.id">
                <button class="td-row-main" type="button" [attr.title]="w.restore" (click)="stage.restoreMap(m.id)">
                  <span class="wm-row-name">
                    <span class="td-name td-trunc">{{ m.name }}</span>
                    <small class="td-note">{{ deletedLine(m) }}</small>
                  </span>
                </button>
                <button class="td-tool" type="button" [attr.aria-label]="w.restore" [attr.title]="w.restore" (click)="stage.restoreMap(m.id)" data-test="trash-restore">
                  <td-icon name="undo" [size]="16" />
                </button>
                <button class="td-tool" type="button" [attr.aria-label]="w.deleteForGood" [attr.title]="w.deleteForGood" (click)="stage.purgeMap(m)">
                  <td-icon name="trash" [size]="16" />
                </button>
              </div>
            }
          </div>
        </section>
      }
    </div>

    <div class="wm-detail td-line-top">
      @if (picked(); as map) {
        <span class="wm-name td-trunc">{{ map.name }}</span>
        @if (mapDescription(map); as description) {
          <p class="td-note">{{ description }}</p>
        }
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('maps')">
            <td-icon name="play" [size]="14" /><span>{{ playWord() }}</span>
          </button>
          <span>
            <button type="button" class="td-btn-secondary" data-test="open-map" [attr.aria-disabled]="editWhy() ? true : null"
                    [attr.title]="editWhy()" (click)="stage.edit('maps')">{{ w.editInEditor }}</button>
            @if (map.origin === 'shipped' || map.origin === 'shared') {
              <small class="td-note wm-sub">{{ w.copyComesLater }}</small>
            }
          </span>
        </div>
        @if (listed(); as m) {
          <div class="td-actions is-start">
            <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.downloadMap(m)">{{ w.download }}</button>
            @if (m.origin === 'own') {
              <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.duplicateMap(m)">{{ w.duplicate }}</button>
            }
            @if (m.origin !== 'shipped') {
              <button type="button" class="td-btn-ghost td-btn-sm" data-test="delete-map" (click)="stage.deleteMap(m)">{{ t().common.delete }}</button>
            }
          </div>
        }
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.</p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      } @else if (stage.notice(); as notice) {
        <p class="td-note" role="status">{{ notice }}</p>
      } @else {
        <p class="td-note">{{ w.pickMap }}</p>
      }
    </div>
  `,
})
export class WorldMapsComponent {
  readonly stage = inject(WorldsStageService);
  protected readonly t = injectT();

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
    const g = this.t().worlds.groups;
    return [
      { title: g.recent, maps: recent, empty: null, recent: true, own: false },
      { title: g.own, maps: of(['own']), empty: g.ownEmpty, recent: false, own: true },
      { title: g.shared, maps: of(['shared']), empty: g.sharedEmpty, recent: false, own: false },
      { title: g.shipped, maps: of(['shipped']), empty: g.shippedEmpty, recent: false, own: false },
    ];
  });

  /** Where an own map comes from: made from OpenStreetMap, or a copy of a shipped or a host's map */
  badge(map: StageMap): string | null {
    if (map.osm) return this.t().worlds.fromOsm;
    return map.copyOf ? this.t().worlds.copyOf(map.copyOf) : null;
  }

  mapDescription(map: { id: string; description: string; origin?: StageMap['origin'] }): string {
    return map.origin === 'shipped' ? shippedMapDescription(this.t(), map.id) ?? map.description : map.description;
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
  readonly playWord = computed(() => this.stage.playWord('maps', this.stage.picks().maps, this.t().worlds.play));

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
    return this.t().worlds.deleted(days, Math.max(0, TRASH_DAYS - days));
  }
}
