import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AddressAutocompleteComponent } from '../components/address-autocomplete.component';
import { TdIconComponent } from '../components/icon/icon.component';
import { StageContinueComponent } from './stage-continue.component';
import { OsmFrameComponent } from '../components/osm-frame/osm-frame.component';
import { WorldsStageService } from './worlds-stage.service';
import { MAX_RECENT_WORLDS } from './recent-maps';
import { placeLabel } from '../services/location/place-label';
import type { NominatimAddress } from '../services/location/geocoding.service';

/**
 * OpenStreetMap's menu (docs/WORLDS_NAVIGATION_PLAN.md, user decision 5):
 * a world of its own. A real place searched (or the one picked under Real
 * places) opens the frame with its HQ and spawns; the map made there is
 * played or opened in the editor. The maps made here and not changed since
 * are its Recent worlds (docs/WORLDS_STATE_PLAN.md, 3.6); one changed in the
 * editor is a Built World. No map key is needed.
 */
@Component({
  selector: 'app-world-osm',
  standalone: true,
  imports: [AddressAutocompleteComponent, TdIconComponent, OsmFrameComponent, StageContinueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      @if (stage.frame(); as frame) {
        <app-osm-frame [place]="frame.place" [spawnsAt]="frame.spawnsAt" [backLink]="false" (back)="stage.frameBack()"
                       (done)="stage.frameDone($event.summary, $event.then)" />
      } @else {
        <p class="td-note">Maps made from OpenStreetMap streets. No map key needed.</p>
        @if (lock()) {
          <p class="td-banner is-warn">Maps from OpenStreetMap are coming soon in this build.</p>
        }
        <app-stage-continue world="osm" />
        <section class="td-group" aria-labelledby="wm-osm-place">
          <h3 class="td-section" id="wm-osm-place">A map of a real place</h3>
          <app-td-address-autocomplete [placeholder]="'Town, street or address'" [currentValue]="null"
                                       (locationSelected)="frameAt($event.lat, $event.lon, placeName($event))" />
          @if (realPlace(); as place) {
            <div class="td-rows">
              <button type="button" class="td-row wm-row" (click)="frameAt(place.hq.lat, place.hq.lon, place.name, place.spawns)">
                <span class="wm-row-name">
                  <span class="td-name">Use the place from Real places</span>
                  <small class="td-note">{{ place.name }}</small>
                </span>
              </button>
            </div>
          }
        </section>
        <section class="td-group" aria-labelledby="wm-osm-mine">
          <h3 class="td-section" id="wm-osm-mine">Recent worlds</h3>
          @if (mine().length) {
            <div class="td-rows">
              @for (map of mine(); track map.id) {
                <div class="wm-line">
                  <button type="button" class="td-row wm-row" [class.is-selected]="pickedId() === map.id" [attr.data-map]="map.id"
                          (click)="stage.pick('osm', { kind: 'map', id: map.id, name: map.name })">
                    <span class="wm-map">
                      @if (map.picture) {
                        <img class="wm-thumb td-well" [src]="map.picture" alt="" />
                      } @else {
                        <span class="wm-thumb td-well" aria-hidden="true"></span>
                      }
                      <span class="td-name">{{ map.name }}</span>
                    </span>
                    <span class="td-note td-num wm-meta">{{ map.spawns }} {{ map.spawns === 1 ? 'spawn' : 'spawns' }}</span>
                  </button>
                  <button type="button" class="td-tool" data-recent-remove [attr.aria-label]="'Remove ' + map.name + ' from Recent worlds'"
                          title="Remove from Recent worlds" (click)="stage.removeWorld(map)">
                    <td-icon name="close" [size]="12" />
                  </button>
                </div>
              }
            </div>
            <p class="td-note">The last {{ max }} maps made here. Change one in the editor and it becomes a Built World.</p>
          } @else {
            <p class="td-note">None yet. A map you make here shows first.</p>
          }
        </section>
      }
    </div>

    @if (!stage.frame()) {
      <div class="wm-detail td-line-top">
        @if (picked(); as map) {
          <span class="wm-name td-trunc">{{ map.name }}</span>
          @if (map.description) {
            <p class="td-note">{{ map.description }}</p>
          }
          <div class="td-actions is-start wm-actions">
            <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('osm')">
              <td-icon name="play" [size]="14" /><span>{{ playWord() }}</span>
            </button>
            <button type="button" class="td-btn-secondary" [attr.aria-disabled]="stage.whyNot('edit', 'osm') ? true : null"
                    [attr.title]="stage.whyNot('edit', 'osm')" (click)="stage.edit('osm')">Edit in the editor</button>
          </div>
          @if (playWhy(); as why) {
            <p class="td-note is-warn">{{ why }}.</p>
          } @else if (stage.notice(); as notice) {
            <p class="td-note is-warn" role="status">{{ notice }}</p>
          }
        } @else {
          <p class="td-note">Search a place for a new map, or pick one of yours. The globe turns there.</p>
        }
      </div>
    }
  `,
})
export class WorldOsmComponent {
  readonly stage = inject(WorldsStageService);

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
  readonly realPlace = computed(() => {
    const pick = this.stage.picks().real;
    return pick?.kind === 'place' ? pick : null;
  });
  readonly playWhy = computed(() => this.stage.whyNot('play', 'osm'));
  /** Start's word: Continue of a run, Back to the place held, else Play */
  readonly playWord = computed(() => this.stage.playWord('osm', this.stage.picks().osm, 'Play'));

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
