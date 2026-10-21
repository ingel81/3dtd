import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TdIconComponent } from '../components/icon/icon.component';
import { PickRowsDirective } from './pick-rows.directive';
import { StageContinueComponent } from './stage-continue.component';
import type { StageMap } from './worlds-stage.service';
import { TRASH_DAYS, type MapSummary } from '../world/custom-map/map-store';
import { WorldsStageService } from './worlds-stage.service';
import { injectT } from '../i18n/i18n.service';
import { shippedMapDescription } from '../i18n/shipped-maps';
import { readJson, writeJson } from '../utils/storage';

/** Whether the trash at the end of the maps' list stands open, kept over a reload */
const TRASH_OPEN_KEY = 'td_maps_trash_open_v1';

/** A map's row as the list shows it: its map, and the quiet words at its end ("OSM", "played today") */
interface MapRow {
  map: StageMap;
  meta: { text: string; hint: string | null }[];
}

/**
 * The maps' menu (docs/WORLDS_NAVIGATION_PLAN.md, 3.1), the one list of
 * maps (docs/WORLDS_STATE_PLAN.md, 3.6): the running game as one block on
 * top, then every map once, in the group of where it comes from (own, from
 * coop hosts, shipped), the maps played lately saying when; New map and
 * Import at the own maps' head, the trash at the end. A row picks, the
 * globe turns to the map's tower, and the row becomes a plate that opens in
 * place: what the map is, Play (or a double click on the row), Edit (a
 * shipped or a host's map as an own copy) and More (Download, Duplicate,
 * Delete).
 */
@Component({
  selector: 'app-world-maps',
  standalone: true,
  imports: [NgTemplateOutlet, TdIconComponent, StageContinueComponent, PickRowsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './world-menu.scss',
  host: { '(document:click)': 'closeMoreBeside($event)', '(keydown)': 'moreKey($event)' },
  template: `
    @let w = t().worlds;
    <div class="wm-body" appPickRows (pickRowsPlay)="stage.start('maps')">
      @if (lock()) {
        <p class="td-banner is-warn">{{ w.mapsSoon }}</p>
      }
      <app-stage-continue world="maps" block />
      @if (!picked()) {
        @if (stage.notice(); as notice) {
          <p class="td-note" role="status">{{ notice }}</p>
        } @else {
          <p class="td-note">{{ w.pickMap }}</p>
        }
      } @else if (!listedInGroup()) {
        <!-- A pick no group lists (a map made under OpenStreetMap): it opens on its own -->
        <div class="wm-item td-plate">
          <div class="td-row wm-row is-selected"><span class="td-name">{{ picked()!.name }}</span></div>
          <div class="wm-open"><ng-container [ngTemplateOutlet]="open" /></div>
        </div>
      }
      @for (group of groups(); track group.id) {
        <section class="td-group" [attr.aria-labelledby]="'wm-maps-' + group.id" [attr.data-group]="group.id">
          @if (group.id === 'own') {
            <!-- New map and Import beside the own maps' head: the ways to a new map stand where the own maps are -->
            <div class="wm-group-head">
              <h3 class="td-section" [id]="'wm-maps-' + group.id">{{ group.title }}</h3>
              <span class="td-inline wm-head-tools">
                <button type="button" class="td-btn-ghost td-btn-sm" data-new-map data-test="new-map" [attr.aria-disabled]="editWhy() ? true : null"
                        [attr.title]="editWhy()" (click)="newMap()"><td-icon name="plus" [size]="14" /><span>{{ w.newMap }}</span></button>
                <label class="td-btn-ghost td-btn-sm" [attr.aria-disabled]="editWhy() ? true : null"
                       [attr.title]="editWhy() ?? w.importHint">
                  <td-icon name="upload" [size]="14" /><span>{{ w.importFile }}</span>
                  <input class="td-sr-only" type="file" accept=".3dtdmap,.w3x,.w3m" multiple [disabled]="!!editWhy()" (change)="importFiles($event)" data-test="import-input" />
                </label>
                @if (stage.mapFolder) {
                  <button type="button" class="td-btn-ghost td-btn-sm" (click)="stage.revealMapFolder()"
                          [attr.title]="w.mapFolderHint" data-test="map-folder">{{ w.mapFolder }}</button>
                }
              </span>
            </div>
          } @else {
            <h3 class="td-section" [id]="'wm-maps-' + group.id">{{ group.title }}</h3>
          }
          @if (group.rows.length) {
            <div class="td-rows">
              @for (row of group.rows; track row.map.id) {
                @let map = row.map;
                @let opened = pickedId() === map.id;
                <div class="wm-item" [class.td-plate]="opened">
                  <button type="button" class="td-row wm-row" data-pick-row (dblclick)="stage.start('maps')" [class.is-selected]="opened" [attr.data-map]="map.id"
                          [attr.aria-expanded]="opened" [attr.aria-controls]="opened ? 'wm-maps-open' : null"
                          (click)="pickMap(map)">
                    <span class="wm-map">
                      @if (map.picture) {
                        <img class="wm-thumb td-well" [src]="map.picture" alt="" />
                      } @else {
                        <span class="wm-thumb td-well" aria-hidden="true"></span>
                      }
                      <span class="td-name td-trunc">{{ map.name }}</span>
                    </span>
                    @if (row.meta.length) {
                      <span class="td-note wm-meta">
                        @for (m of row.meta; track m.text; let first = $first) {
                          @if (!first) { <span aria-hidden="true"> | </span> }<span [attr.title]="m.hint">{{ m.text }}</span>
                        }
                      </span>
                    }
                  </button>
                  @if (opened) {
                    <div class="wm-open" id="wm-maps-open"><ng-container [ngTemplateOutlet]="open" /></div>
                  }
                </div>
              }
            </div>
          } @else {
            <p class="td-note">{{ group.empty }}</p>
          }
        </section>
      }
      @if (stage.trash().length) {
        <section class="td-group" aria-labelledby="wm-maps-trash" data-test="trash">
          <!-- Folded by default: its head says how many wait there -->
          <h3 class="td-section wm-fold-head">
            <button type="button" class="wm-fold" id="wm-maps-trash" aria-controls="wm-maps-trash-rows" [attr.aria-expanded]="trashOpen()"
                    (click)="toggleTrash()" data-test="trash-toggle">
              <span>{{ w.trash }} ({{ stage.trash().length }})</span>
              <td-icon [name]="trashOpen() ? 'caretU' : 'caret'" [size]="12" />
            </button>
            <span class="td-note">{{ w.trashWait(trashDays) }}</span>
          </h3>
          <div class="td-rows" id="wm-maps-trash-rows" [hidden]="!trashOpen()">
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

    <!-- The picked map's plate, open under its row: what it is, Play, Edit, More with the file's ways -->
    <ng-template #open>
      @if (picked(); as map) {
        @if (detailLine(map); as line) {
          <p class="td-note td-num" data-test="map-detail">{{ line }}</p>
        }
        @if (map.origin !== 'shipped' && map.description) {
          <p class="td-note">{{ map.description }}</p>
        }
        <div class="td-actions is-start wm-actions">
          <button type="button" class="td-btn-primary" data-stage-start [attr.aria-disabled]="playWhy() ? true : null" (click)="stage.start('maps')">
            <td-icon name="play" [size]="12" /><span>{{ playWord() }}</span>
          </button>
          <button type="button" class="td-btn-secondary" data-test="open-map" [attr.aria-disabled]="editWhy() ? true : null"
                  [attr.title]="editWhy() ?? w.editInEditor" (click)="stage.edit('maps')">{{ w.edit }}</button>
          @if (listed(); as m) {
            <div class="wm-more">
              <button type="button" class="td-icon-btn" data-test="map-more" aria-haspopup="menu" [attr.aria-expanded]="moreOpen()"
                      [attr.aria-label]="w.more" [attr.title]="w.more" (click)="toggleMore()">
                <td-icon name="more" [size]="16" />
              </button>
              @if (moreOpen()) {
                <div class="wm-more-menu td-popup td-rows" role="menu" [attr.aria-label]="w.more">
                  <button type="button" class="td-row" role="menuitem" (click)="fromMore('download', m)">{{ w.download }}</button>
                  @if (m.origin === 'own') {
                    <button type="button" class="td-row" role="menuitem" (click)="fromMore('duplicate', m)">{{ w.duplicate }}</button>
                  }
                  @if (m.origin !== 'shipped') {
                    <button type="button" class="td-row" role="menuitem" data-test="delete-map" (click)="fromMore('delete', m)">{{ t().common.delete }}</button>
                  }
                </div>
              }
            </div>
          }
        </div>
        @if (map.origin === 'shipped' || map.origin === 'shared') {
          <small class="td-note">{{ w.copyComesLater }}</small>
        }
        @if (playWhy(); as why) {
          <p class="td-note is-warn">{{ why }}.</p>
        } @else if (stage.notice(); as notice) {
          <p class="td-note is-warn" role="status">{{ notice }}</p>
        }
      }
    </ng-template>
  `,
})
export class WorldMapsComponent {
  readonly stage = inject(WorldsStageService);
  protected readonly t = injectT();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  readonly lock = computed(() => this.stage.lock('maps'));
  /**
   * The own maps, the coop hosts' (only when there are some) and the
   * shipped, each map once; an OpenStreetMap map not changed since it was
   * made is OpenStreetMap's, not listed here (docs/WORLDS_STATE_PLAN.md, 3.6)
   */
  readonly groups = computed(() => {
    const maps = this.stage.maps().filter((m) => !m.generated);
    const played = new Map(this.stage.recentMaps().map((r) => [r.id, r.at]));
    const w = this.t().worlds;
    const rows = (origin: StageMap['origin']): MapRow[] =>
      maps.filter((m) => m.origin === origin).map((map) => {
        const meta: MapRow['meta'] = [];
        if (map.osm) meta.push({ text: w.osm, hint: w.osmHint });
        const at = played.get(map.id);
        if (at) meta.push({ text: w.lastPlayed(at), hint: w.playedAt(at) });
        return { map, meta };
      });
    const g = w.groups;
    const shared = rows('shared');
    return [
      { id: 'own', title: g.own, rows: rows('own'), empty: g.ownEmpty },
      ...(shared.length ? [{ id: 'shared', title: g.shared, rows: shared, empty: null }] : []),
      { id: 'shipped', title: g.shipped, rows: rows('shipped'), empty: g.shippedEmpty },
    ];
  });

  /** "4 spawns | copy of Demo Valley | changed today 9:30 AM" of an own or a host's map; a shipped map's words */
  detailLine(map: StageMap): string {
    const w = this.t().worlds;
    if (map.origin === 'shipped') return shippedMapDescription(this.t(), map.id) ?? map.description;
    const parts = [w.spawns(map.spawns)];
    if (map.copyOf) parts.push(w.copyOf(map.copyOf));
    if (map.updatedAt) parts.push(w.changed(w.playedAt(map.updatedAt)));
    return parts.join(' | ');
  }

  readonly pickedId = computed(() => {
    const pick = this.stage.picks().maps;
    return pick?.kind === 'map' ? pick.id : null;
  });
  readonly picked = computed<StageMap | null>(() => {
    const id = this.pickedId();
    const pick = this.stage.picks().maps;
    if (!id || !pick) return null;
    return this.stage.maps().find((m) => m.id === id)
      ?? { id, name: pick.name, description: '', spawns: 0, origin: 'own', osm: null, generated: false, copyOf: null, updatedAt: '', picture: null };
  });
  /** Whether a group lists the pick (else it opens on its own above them) */
  readonly listedInGroup = computed(() => {
    const id = this.pickedId();
    return !!id && this.groups().some((g) => g.rows.some((r) => r.map.id === id));
  });
  readonly playWhy = computed(() => this.stage.whyNot('play', 'maps'));
  /** Start's word: Continue of a run, Back to the place held, else Play */
  readonly playWord = computed(() => this.stage.playWord('maps', this.stage.picks().maps, this.t().worlds.play));

  /** Why New map, Import and Edit are locked; null when open */
  readonly editWhy = computed(() => this.stage.whyNot('edit', 'maps'));
  /** The picked map as the list has it (Download, Duplicate, Delete need it listed) */
  readonly listed = computed(() => {
    const id = this.pickedId();
    return id ? (this.stage.maps().find((m) => m.id === id) ?? null) : null;
  });
  readonly trashDays = TRASH_DAYS;
  /** The trash folded or open (folded at first); a map just deleted opens it, so Undo's line shows where it went */
  readonly trashOpen = signal(readJson(TRASH_OPEN_KEY) === true);
  /** The More menu of the picked map, open for that map's id; another pick closes it */
  private readonly moreFor = signal<string | null>(null);
  readonly moreOpen = computed(() => this.moreFor() !== null && this.moreFor() === this.pickedId());

  constructor() {
    effect(() => {
      if (this.stage.trashed()) untracked(() => this.setTrashOpen(true));
    });
  }

  toggleTrash(): void {
    this.setTrashOpen(!this.trashOpen());
  }

  private setTrashOpen(open: boolean): void {
    this.trashOpen.set(open);
    writeJson(TRASH_OPEN_KEY, open);
  }

  pickMap(map: { id: string; name: string }): void {
    this.stage.pick('maps', { kind: 'map', id: map.id, name: map.name });
  }

  /** More opens its menu with the focus on its first entry, whole in the list's view */
  toggleMore(): void {
    if (this.moreOpen()) {
      this.moreFor.set(null);
      return;
    }
    this.moreFor.set(this.pickedId());
    afterNextRender(() => {
      const menu = this.host.querySelector<HTMLElement>('.wm-more-menu');
      menu?.scrollIntoView?.({ block: 'nearest' });
      menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, { injector: this.injector });
  }

  /** An entry of More: the menu closes, then it runs */
  fromMore(what: 'download' | 'duplicate' | 'delete', map: StageMap): void {
    this.moreFor.set(null);
    if (what === 'download') this.stage.downloadMap(map);
    else if (what === 'duplicate') void this.stage.duplicateMap(map);
    else void this.stage.deleteMap(map);
  }

  /**
   * Keys at More and in its menu: Esc closes the menu (not the world's
   * menu), the focus back on More; Up and Down move between its entries, round
   */
  moreKey(event: KeyboardEvent): void {
    const more = this.host.querySelector<HTMLElement>('.wm-more');
    if (!this.moreOpen() || !more || !(event.target instanceof Node) || !more.contains(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.moreFor.set(null);
      more.querySelector<HTMLElement>('[data-test="map-more"]')?.focus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const items = [...more.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[to]?.focus();
  }

  /** A click beside the More menu closes it */
  closeMoreBeside(event: MouseEvent): void {
    if (!this.moreOpen()) return;
    const more = this.host.querySelector('.wm-more');
    if (more && !event.composedPath().includes(more)) this.moreFor.set(null);
  }

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
