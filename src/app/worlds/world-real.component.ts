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

const LISTS: readonly { id: RealList; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'search', label: 'Search' },
  { id: 'records', label: 'World map' },
  { id: 'tilesets', label: 'Tilesets' },
];

/**
 * The real places' menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.1): the lists of
 * the place picker (recent, favorites, the showcase, a search with the dice,
 * the places defended with their best wave, own tilesets). A row picks, the
 * globe turns there; Start under the list loads it. Without a map key the
 * lists stay, Start is locked with the way to the key beside it.
 */
@Component({
  selector: 'app-world-real',
  standalone: true,
  imports: [AddressAutocompleteComponent, TdIconComponent, RovingGroupDirective, StageContinueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      @if (noKey()) {
        <div class="td-banner is-warn td-stack">
          <p>No map key: the 3D tiles need a Cesium Ion token or a Google Maps key. You can still look around and pick a place.</p>
          <div class="td-actions is-start">
            <button type="button" class="td-btn-secondary td-btn-sm" (click)="stage.openOverlay('key')">Enter map key</button>
            <button type="button" class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="stage.lock('osm') ? true : null"
                    [attr.title]="stage.lock('osm')" (click)="toOsm()">Make an OpenStreetMap map instead</button>
          </div>
        </div>
      }
      <app-stage-continue world="real" />

      <div class="td-seg is-sm wm-tabs" role="tablist" aria-label="Places" tdRovingGroup>
        @for (list of lists; track list.id) {
          <button type="button" role="tab" [attr.aria-selected]="stage.realList() === list.id" (click)="stage.realList.set(list.id)">{{ list.label }}</button>
        }
      </div>

      @switch (stage.realList()) {
        @case ('recent') {
          @if (locations.recents().length) {
            <div class="td-rows" role="group" aria-label="Recent places">
              @for (recent of locations.recents(); track recent.visitedAt) {
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" [class.is-selected]="isPicked(recent.hq)"
                          (click)="pickPlace(recent.hq, recent.spawns.slice(0, 1), recent.name)">
                    <span class="td-name">{{ recent.name }}</span>
                    <span class="td-note td-num wm-meta">{{ age(recent.visitedAt) }}</span>
                  </button>
                  <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="'Remove ' + recent.name + ' from Recent'"
                          title="Remove from Recent" (click)="locations.forgetRecent(recent.hq)">
                    <td-icon name="close" [size]="12" />
                  </button>
                </div>
              }
            </div>
          } @else {
            <p class="td-note">Every place you play shows up here, once its first wave or tower is in.</p>
          }
        }
        @case ('favorites') {
          @if (locations.favorites().length) {
            <div class="td-rows" role="group" aria-label="Favorites">
              @for (fav of locations.favorites(); track fav.id) {
                <button type="button" class="td-row wm-row" [class.is-selected]="isPicked(fav.hq)"
                        (click)="pickPlace(fav.hq, fav.spawns, fav.name ?? coordinates(fav.hq))">
                  <span class="td-name">{{ fav.name ?? coordinates(fav.hq) }}</span>
                  <span class="td-note td-num wm-meta">{{ fav.spawns.length }} {{ fav.spawns.length === 1 ? 'spawn' : 'spawns' }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">No favorites yet. The star in the game's header keeps the place you play.</p>
          }
        }
        @case ('showcase') {
          <div class="td-rows" role="group" aria-label="Showcase">
            @for (place of showcase; track place.id) {
              <button type="button" class="td-row wm-row" [class.is-selected]="isPicked(place)"
                      (click)="pickPlace(place, place.spawn ? [place.spawn] : [], place.name)">
                <span class="wm-row-name">
                  <span class="td-name">{{ place.name }}</span>
                  <small class="td-note">{{ place.hint }}</small>
                </span>
              </button>
            }
          </div>
        }
        @case ('search') {
          <div class="wm-search">
            <app-td-address-autocomplete [placeholder]="'City, street or address'" [currentValue]="null"
                                         (locationSelected)="pickPlace($event, [], $event.name)" />
            <button type="button" class="td-icon-btn" [attr.aria-busy]="stage.rolling() ? true : null"
                    title="Roll a random city" aria-label="Roll a random city" (click)="stage.rollDice()">
              <td-icon name="dice" [size]="16" />
            </button>
          </div>
          <p class="td-note">The dice picks a city with 3D tiles. The globe turns there; Start loads it.</p>
        }
        @case ('records') {
          @if (records().length) {
            <div class="td-rows" role="group" aria-label="Defended places">
              @for (record of records(); track record) {
                <button type="button" class="td-row wm-row" [class.is-selected]="isPicked(record.hq)"
                        (click)="pickPlace(record.hq, record.spawns.slice(0, 1), record.detail)">
                  <span class="td-name">{{ record.name }}</span>
                  <span class="td-note td-num wm-meta">wave {{ record.bestWave }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">Every place you defend shows up here with the best wave you reached.</p>
          }
        }
        @case ('tilesets') {
          @if (worlds.tilesets().length) {
            <div class="td-rows" role="group" aria-label="Own tilesets">
              @for (set of worlds.tilesets(); track set.id) {
                <button type="button" class="td-row wm-row" [class.is-selected]="pick()?.kind === 'tileset' && pick()?.name === set.name"
                        (click)="stage.pick('real', { kind: 'tileset', id: set.id, name: set.name })">
                  <span class="td-name">{{ set.name }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">An own 3D tileset (a tileset.json) plays like a real place. The config lists them (ownTilesets).</p>
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
                    [attr.title]="stage.whyNot('edit', 'osm')" (click)="stage.edit('real')">Make a map of this place</button>
          }
        </div>
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.
            @if (noKey()) {
              <button type="button" class="td-link" (click)="stage.openOverlay('key')">Enter map key</button>
            }
          </p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      } @else {
        <p class="td-note">Pick a place: the globe turns there. Start loads it.</p>
      }
    </div>
  `,
})
export class WorldRealComponent {
  readonly stage = inject(WorldsStageService);
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
  readonly playWord = computed(() => this.stage.playWord('real', this.pick(), 'Start'));
  private readonly openedAt = Date.now();

  readonly spawnLine = computed(() => {
    const pick = this.pick();
    if (pick?.kind === 'tileset') return 'An own 3D tileset: the HQ starts in the middle of its area.';
    if (pick?.kind !== 'place' || pick.spawns.length === 0) return 'A random spawn 500 to 1000 m from the HQ.';
    return pick.spawns.length === 1 ? 'Its spawn as played.' : `Its ${pick.spawns.length} spawns.`;
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
    return formatVisitAge(visitedAt, this.openedAt);
  }

  coordinates(hq: { lat: number; lon: number }): string {
    return `${hq.lat.toFixed(4)}, ${hq.lon.toFixed(4)}`;
  }

  toOsm(): void {
    if (this.stage.lock('osm')) return;
    this.stage.openWorld('osm');
  }
}
