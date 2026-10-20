import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AddressAutocompleteComponent } from '../components/address-autocomplete.component';
import { TdIconComponent } from '../components/icon/icon.component';
import { StageContinueComponent } from './stage-continue.component';
import { RovingGroupDirective } from '../components/roving-group.directive';
import { SHOWCASE_LOCATIONS } from '../configs/showcase-locations.config';
import { BestWaveService } from '../services/location/best-wave.service';
import { byBestWave } from '../services/location/best-waves';
import { LocationManagementService } from '../services/location/location-management.service';
import { formatVisitAge, isSamePlace } from '../services/location/recent-locations';
import { WorldChoiceService } from '../world/world-choice.service';
import type { WorldPick } from './world-rules';
import { WorldsStageService, type RealList } from './worlds-stage.service';
import { injectT } from '../i18n/i18n.service';

const LISTS: readonly RealList[] = ['recent', 'favorites', 'showcase', 'search', 'records', 'tilesets'];

/**
 * The real places' menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): the lists of
 * the place picker (recent, favorites, the showcase, a search with the dice,
 * the places defended with their best wave, own tilesets). A row picks, the
 * globe turns there; Start under the list loads it, as a double click on the
 * row does. Without a map key the lists stay, Start is locked with the way
 * to the key beside it.
 */
@Component({
  selector: 'app-world-real',
  standalone: true,
  imports: [AddressAutocompleteComponent, TdIconComponent, RovingGroupDirective, StageContinueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    @let w = t().worlds;
    <div class="wm-body">
      @if (noKey()) {
        <div class="td-banner is-warn td-stack">
          <p>{{ w.noKeyBanner }}</p>
          <div class="td-actions is-start">
            <button type="button" class="td-btn-secondary td-btn-sm" (click)="stage.openOverlay('key')">{{ w.enterKey }}</button>
            <button type="button" class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="stage.lock('osm') ? true : null"
                    [attr.title]="stage.lock('osm')" (click)="toOsm()">{{ w.osmInstead }}</button>
          </div>
        </div>
      }
      <app-stage-continue world="real" />

      <div class="td-seg is-sm wm-tabs" role="tablist" [attr.aria-label]="w.places" tdRovingGroup>
        @for (list of lists; track list) {
          <button type="button" role="tab" [attr.aria-selected]="stage.realList() === list" (click)="stage.realList.set(list)">{{ w.realLists[list] }}</button>
        }
      </div>

      @switch (stage.realList()) {
        @case ('recent') {
          @if (locations.recents().length) {
            <div class="td-rows" role="group" [attr.aria-label]="w.recentPlaces">
              @for (recent of locations.recents(); track recent.visitedAt) {
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" (dblclick)="stage.start('real')" [class.is-selected]="isPicked(recent.hq)"
                          (click)="pickPlace(recent.hq, recent.spawns.slice(0, 1), recent.name)">
                    <span class="td-name">{{ recent.name }}</span>
                    <span class="td-note td-num wm-meta">{{ age(recent.visitedAt) }}</span>
                  </button>
                  <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="w.removeRecent(recent.name)"
                          [attr.title]="w.removeFromRecent" (click)="locations.forgetRecent(recent.hq)">
                    <td-icon name="close" [size]="12" />
                  </button>
                </div>
              }
            </div>
          } @else {
            <p class="td-note">{{ w.recentEmpty }}</p>
          }
        }
        @case ('favorites') {
          @if (locations.favorites().length) {
            <div class="td-rows" role="group" [attr.aria-label]="w.realLists.favorites">
              @for (fav of locations.favorites(); track fav.id) {
                <button type="button" class="td-row wm-row" (dblclick)="stage.start('real')" [class.is-selected]="isPicked(fav.hq)"
                        (click)="pickPlace(fav.hq, fav.spawns, fav.name ?? coordinates(fav.hq))">
                  <span class="td-name">{{ fav.name ?? coordinates(fav.hq) }}</span>
                  <span class="td-note td-num wm-meta">{{ w.spawns(fav.spawns.length) }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">{{ w.favoritesEmpty }}</p>
          }
        }
        @case ('showcase') {
          <div class="td-rows" role="group" [attr.aria-label]="w.realLists.showcase">
            @for (place of showcase; track place.id) {
              <button type="button" class="td-row wm-row" (dblclick)="stage.start('real')" [class.is-selected]="isPicked(place)"
                      (click)="pickPlace(place, place.spawn ? [place.spawn] : [], place.name)">
                <span class="wm-row-name">
                  <span class="td-name">{{ t().showcase[place.id].name }}</span>
                  <small class="td-note">{{ t().showcase[place.id].hint }}</small>
                </span>
              </button>
            }
          </div>
        }
        @case ('search') {
          <div class="wm-search">
            <app-td-address-autocomplete [placeholder]="w.searchPlaceholder" [currentValue]="null"
                                         (locationSelected)="pickPlace($event, [], $event.name)" />
            <button type="button" class="td-icon-btn" [attr.aria-busy]="stage.rolling() ? true : null"
                    [attr.title]="w.rollCity" [attr.aria-label]="w.rollCity" (click)="stage.rollDice()">
              <td-icon name="dice" [size]="16" />
            </button>
          </div>
          <p class="td-note">{{ w.diceNote }}</p>
        }
        @case ('records') {
          @if (records().length) {
            <div class="td-rows" role="group" [attr.aria-label]="w.defendedPlaces">
              @for (record of records(); track record) {
                <button type="button" class="td-row wm-row" (dblclick)="stage.start('real')" [class.is-selected]="isPicked(record.hq)"
                        (click)="pickPlace(record.hq, record.spawns.slice(0, 1), record.detail)">
                  <span class="td-name">{{ record.name }}</span>
                  <span class="td-note td-num wm-meta">{{ w.wave(record.bestWave) }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">{{ w.recordsEmpty }}</p>
          }
        }
        @case ('tilesets') {
          @if (worlds.tilesets().length) {
            <div class="td-rows" role="group" [attr.aria-label]="w.ownTilesets">
              @for (set of worlds.tilesets(); track set.id) {
                <button type="button" class="td-row wm-row" (dblclick)="stage.start('real')" [class.is-selected]="pick()?.kind === 'tileset' && pick()?.name === set.name"
                        (click)="stage.pick('real', { kind: 'tileset', id: set.id, name: set.name })">
                  <span class="td-name">{{ set.name }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">{{ w.tilesetsEmpty }}</p>
          }
        }
      }
    </div>

    <div class="wm-detail td-line-top">
      @if (pick(); as pick) {
        <span class="wm-name td-trunc">{{ pick.name }}</span>
        <p class="td-note">{{ spawnLine() }}</p>
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('real')">
            <td-icon name="play" [size]="14" /><span>{{ playWord() }}</span>
          </button>
          @if (pick.kind === 'place') {
            <button type="button" class="td-btn-secondary" [attr.aria-disabled]="stage.whyNot('edit', 'osm') ? true : null"
                    [attr.title]="stage.whyNot('edit', 'osm')" (click)="stage.edit('real')">{{ w.mapOfPlace }}</button>
          }
        </div>
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.
            @if (noKey()) {
              <button type="button" class="td-link" (click)="stage.openOverlay('key')">{{ w.enterKey }}</button>
            }
          </p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      } @else {
        <p class="td-note">{{ w.pickPlace }}</p>
      }
    </div>
  `,
})
export class WorldRealComponent {
  readonly stage = inject(WorldsStageService);
  protected readonly t = injectT();
  readonly locations = inject(LocationManagementService);
  readonly worlds = inject(WorldChoiceService);
  private readonly bestWaves = inject(BestWaveService);

  readonly lists = LISTS;
  readonly showcase = SHOWCASE_LOCATIONS;
  readonly records = computed(() => [...this.bestWaves.records()].sort(byBestWave));
  readonly pick = computed(() => this.stage.picks().real);
  readonly noKey = computed(() => this.stage.lock('real') !== null);
  readonly playWhy = computed(() => this.stage.whyNot('play', 'real'));
  /** Start's word: Continue of a run, Back to the place held, else Start */
  readonly playWord = computed(() => this.stage.playWord('real', this.pick(), this.t().worlds.start));
  private readonly openedAt = Date.now();

  readonly spawnLine = computed(() => {
    const pick = this.pick();
    const w = this.t().worlds;
    if (pick?.kind === 'tileset') return w.tilesetSpawn;
    if (pick?.kind !== 'place' || pick.spawns.length === 0) return w.randomSpawn;
    return pick.spawns.length === 1 ? w.oneSpawn : w.manySpawns(pick.spawns.length);
  });

  constructor() {
    // An empty Recent list is no start: the showcase then
    if (this.stage.realList() === 'recent' && this.locations.recents().length === 0) this.stage.realList.set('showcase');
  }

  pickPlace(hq: { lat: number; lon: number }, spawns: readonly { lat: number; lon: number; portalBearing?: number }[], name: string): void {
    const pick: WorldPick = {
      kind: 'place',
      hq: { lat: hq.lat, lon: hq.lon },
      spawns: spawns.map(({ lat, lon, portalBearing }) => (portalBearing === undefined ? { lat, lon } : { lat, lon, portalBearing })),
      name,
    };
    this.stage.pick('real', pick);
  }

  isPicked(hq: { lat: number; lon: number }): boolean {
    const pick = this.pick();
    return pick?.kind === 'place' && isSamePlace(pick.hq, hq);
  }

  age(visitedAt: number): string {
    return formatVisitAge(this.t(), visitedAt, this.openedAt);
  }

  coordinates(hq: { lat: number; lon: number }): string {
    return `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`;
  }

  toOsm(): void {
    if (this.stage.lock('osm')) return;
    this.stage.openWorld('osm');
  }
}
