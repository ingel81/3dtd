import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AddressAutocompleteComponent } from '../components/address-autocomplete.component';
import { NgTemplateOutlet } from '@angular/common';
import { TdIconComponent } from '../components/icon/icon.component';
import { PickRowsDirective } from './pick-rows.directive';
import { StageContinueComponent } from './stage-continue.component';
import { OsmFrameComponent } from '../components/osm-frame/osm-frame.component';
import { WorldsStageService } from './worlds-stage.service';
import { MAX_RECENT_WORLDS } from './recent-maps';
import { placeLabel } from '../services/location/place-label';
import type { NominatimAddress } from '../services/location/geocoding.service';
import { injectT } from '../i18n/i18n.service';

/**
 * OpenStreetMap's menu (docs/WORLDS_NAVIGATION_PLAN.md, user decision 5):
 * a world of its own. A real place searched (or the one picked under Real
 * places) opens the frame with its HQ and spawns; the map made there is
 * played or opened in the editor. The maps made here and not changed since
 * are its Recent worlds (docs/WORLDS_STATE_PLAN.md, 3.6); one changed in the
 * editor is a Built World. A double click on one plays it. No map key is needed.
 */
@Component({
  selector: 'app-world-osm',
  standalone: true,
  imports: [NgTemplateOutlet, AddressAutocompleteComponent, TdIconComponent, OsmFrameComponent, StageContinueComponent, PickRowsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    @let w = t().worlds;
    <div class="wm-body" appPickRows (pickRowsPlay)="stage.start('osm')">
      @if (stage.frame(); as frame) {
        <app-osm-frame [place]="frame.place" [spawnsAt]="frame.spawnsAt" [backLink]="false" (back)="stage.frameBack()"
                       (done)="stage.frameDone($event.summary, $event.then)" />
      } @else {
        @if (lock()) {
          <p class="td-banner is-warn">{{ w.osmSoon }}</p>
        }
        <app-stage-continue world="osm" />
        @if (!picked()) {
          @if (stage.notice(); as notice) {
            <p class="td-note" role="status">{{ notice }}</p>
          } @else {
            <p class="td-note">{{ w.osmPick }}</p>
          }
        } @else if (!pickListed()) {
          <!-- A pick the Recent worlds do not list: it opens on its own -->
          <div class="wm-item">
            <div class="td-row wm-row is-selected"><span class="td-name">{{ picked()!.name }}</span></div>
            <div class="wm-open"><ng-container [ngTemplateOutlet]="open" /></div>
          </div>
        }
        <section class="td-group" aria-labelledby="wm-osm-place">
          <h3 class="td-section" id="wm-osm-place">{{ w.osmPlace }}</h3>
          <app-td-address-autocomplete [placeholder]="w.townPlaceholder" [currentValue]="null"
                                       (locationSelected)="frameAt($event.lat, $event.lon, placeName($event))" />
          @if (realPlace(); as place) {
            <div class="td-rows">
              <button type="button" class="td-row wm-row" (click)="frameAt(place.hq.lat, place.hq.lon, place.name, place.spawns)">
                <span class="wm-row-name">
                  <span class="td-name">{{ w.useRealPlace }}</span>
                  <small class="td-note">{{ w.realPlaceFrom(place.name) }}</small>
                </span>
              </button>
            </div>
          }
        </section>
        <section class="td-group" aria-labelledby="wm-osm-mine">
          <h3 class="td-section" id="wm-osm-mine">{{ w.recentWorlds }}</h3>
          @if (mine().length) {
            <div class="td-rows">
              @for (map of mine(); track map.id) {
                @let opened = pickedId() === map.id;
                <div class="wm-item">
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" data-pick-row (dblclick)="stage.start('osm')" [class.is-selected]="opened" [attr.data-map]="map.id"
                          [attr.aria-expanded]="opened" [attr.aria-controls]="opened ? 'wm-osm-open' : null"
                          (click)="stage.pick('osm', { kind: 'map', id: map.id, name: map.name })">
                    <span class="wm-map">
                      @if (map.picture) {
                        <img class="wm-thumb td-well" [src]="map.picture" alt="" />
                      } @else {
                        <span class="wm-thumb td-well" aria-hidden="true"></span>
                      }
                      <span class="td-name">{{ map.name }}</span>
                    </span>
                    <span class="td-note td-num wm-meta">{{ w.spawns(map.spawns) }}</span>
                  </button>
                  <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="w.removeRecentWorld(map.name)"
                          [attr.title]="w.removeFromRecentWorlds" (click)="stage.removeWorld(map)">
                    <td-icon name="close" [size]="12" />
                  </button>
                </div>
                @if (opened) {
                  <div class="wm-open" id="wm-osm-open"><ng-container [ngTemplateOutlet]="open" /></div>
                }
                </div>
              }
            </div>
            <p class="td-note">{{ w.recentWorldsNote(max) }}</p>
          } @else {
            <p class="td-note">{{ w.recentWorldsEmpty }}</p>
          }
        </section>
      }
    </div>

    <!-- The picked map's part, open under its row: what it is, Play, Edit -->
    <ng-template #open>
      @if (picked(); as map) {
        @if (map.description) {
          <p class="td-note">{{ map.description }}</p>
        }
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary td-btn-sm" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('osm')">
            <td-icon name="play" [size]="12" /><span>{{ playWord() }}</span>
          </button>
          <button type="button" class="td-btn-secondary td-btn-sm" [attr.aria-disabled]="stage.whyNot('edit', 'osm') ? true : null"
                  [attr.title]="stage.whyNot('edit', 'osm')" (click)="stage.edit('osm')">{{ w.editInEditor }}</button>
        </div>
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.</p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      }
    </ng-template>
  `,
})
export class WorldOsmComponent {
  readonly stage = inject(WorldsStageService);
  protected readonly t = injectT();

  readonly lock = computed(() => this.stage.lock('osm'));
  /** The maps made here and not changed since, newest first (Recent worlds) */
  readonly mine = this.stage.recentWorlds;
  readonly max = MAX_RECENT_WORLDS;
  readonly pickedId = computed(() => {
    const pick = this.stage.picks().osm;
    return pick?.kind === 'map' ? pick.id : null;
  });
  readonly picked = computed(() => {
    const id = this.pickedId();
    const pick = this.stage.picks().osm;
    if (!id || !pick) return null;
    return this.stage.maps().find((m) => m.id === id) ?? { id, name: pick.name, description: '', spawns: 0 };
  });
  /** The pick is one of the Recent worlds, which open it under its row */
  readonly pickListed = computed(() => this.mine().some((m) => m.id === this.pickedId()));
  /** The real places' place, offered only when the last world loaded on this visit was theirs (back from its game) */
  readonly realPlace = computed(() => {
    if (this.stage.openedLast() !== 'real') return null;
    const pick = this.stage.picks().real;
    return pick?.kind === 'place' ? pick : null;
  });
  readonly playWhy = computed(() => this.stage.whyNot('play', 'osm'));
  /** Start's word: Continue of a run, Back to the place held, else Play */
  readonly playWord = computed(() => this.stage.playWord('osm', this.stage.picks().osm, this.t().worlds.play));

  /** A searched place's name as the search list showed it */
  placeName(found: { name: string; address?: NominatimAddress }): string {
    return placeLabel(found.name, found.address);
  }

  /** The frame on a place, its spawns drawn there (none: the frame rolls them) */
  frameAt(lat: number, lon: number, name: string, spawns: readonly { lat: number; lon: number }[] = []): void {
    if (this.stage.whyNot('edit', 'osm')) {
      this.stage.notice.set(this.stage.whyNot('edit', 'osm'));
      return;
    }
    this.stage.makeMapOf({ kind: 'place', hq: { lat, lon }, spawns: [...spawns], name }, 'osm');
  }
}
