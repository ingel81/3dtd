import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AddressAutocompleteComponent } from '../components/address-autocomplete.component';
import { TdIconComponent } from '../components/icon/icon.component';
import { OsmFrameComponent } from '../components/osm-frame/osm-frame.component';
import { WorldsStageService } from './worlds-stage.service';
import { placeLabel } from '../services/location/place-label';
import type { NominatimAddress } from '../services/location/geocoding.service';

/**
 * OpenStreetMap's menu (docs/WORLDS_NAVIGATION_PLAN.md, user decision 5):
 * a world of its own. A real place searched (or the one picked under Real
 * places) opens the frame with its HQ and spawns; the map made there is
 * played or opened in the editor, and it stands under Maps too. No map key
 * is needed.
 */
@Component({
  selector: 'app-world-osm',
  standalone: true,
  imports: [AddressAutocompleteComponent, TdIconComponent, OsmFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  template: `
    <div class="wm-body">
      @if (stage.frame(); as frame) {
        <app-osm-frame [place]="frame.place" [spawnsAt]="frame.spawnsAt" (back)="stage.frameBack()"
                       (done)="stage.frameDone($event.summary, $event.then)" />
      } @else {
        <p class="td-note">Maps made from OpenStreetMap streets. No map key needed.</p>
        @if (lock()) {
          <p class="td-banner is-warn">Maps from OpenStreetMap are coming soon in this build.</p>
        }
        @if (run(); as run) {
          <div class="td-rows">
            <button type="button" class="td-row wm-row" (click)="stage.continueRun(run)">
              <span class="td-name">Continue</span>
              <span class="td-note td-num wm-meta">{{ run.name }} | wave {{ run.wave }}</span>
            </button>
          </div>
        }
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
          <h3 class="td-section" id="wm-osm-mine">Your OpenStreetMap maps</h3>
          @if (mine().length) {
            <div class="td-rows">
              @for (map of mine(); track map.id) {
                <button type="button" class="td-row wm-row" [class.is-selected]="pickedId() === map.id"
                        (click)="stage.pick('osm', { kind: 'map', id: map.id, name: map.name })">
                  <span class="td-name">{{ map.name }}</span>
                  <span class="td-note td-num wm-meta">{{ map.spawns }} {{ map.spawns === 1 ? 'spawn' : 'spawns' }}</span>
                </button>
              }
            </div>
          } @else {
            <p class="td-note">None yet. A map made here stands under Maps too.</p>
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
              <td-icon name="play" [size]="14" /><span>{{ continues() ? 'Continue' : 'Play' }}</span>
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
  readonly mine = computed(() => this.stage.maps().filter((m) => m.osm !== null));
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
  readonly run = computed(() => this.stage.autosaveOf('osm'));
  readonly playWhy = computed(() => this.stage.whyNot('play', 'osm'));
  readonly continues = computed(() => this.stage.runHere('osm', this.stage.picks().osm) !== null);

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
