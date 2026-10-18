/**
 * The start of the game on the globes (docs/WORLDS_NAVIGATION_PLAN.md,
 * phase 6): nothing loads until Start; without a map key the real places'
 * globe is grey and the way to the key stands beside it, its world menu
 * still lists the places and says why Start is locked; Esc goes one step
 * up; a map picked plays with the Start order; an autosave is Continue at
 * the top and a start elsewhere in its world asks first. Real template read
 * from disk, globes off (the discs), the overlays and the session stand in.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { WorldPathComponent } from '../components/world-path/world-path.component';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, computed, input, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog } from '@angular/material/dialog';
import { ConfigService } from '../core/services/config.service';
import { GlobeDirectorService } from '../services/world/globe-director.service';
import { GeocodingService } from '../services/location/geocoding.service';
import { WorldDiceService } from '../services/location/world-dice.service';
import { LocationManagementService } from '../services/location/location-management.service';
import { BestWaveService } from '../services/location/best-wave.service';
import { AUTOSAVE_SLOT, FILE_SLOT, type SaveSlotInfo } from '../services/save-game/save-game.port';
import { SaveGame } from '../services/save-game/save-game';
import { SAVE_SLOT_STORE, type StoredSlotMeta } from '../services/save-game/save-slot.store';
import { MemorySlotStore } from '../../test/memory-slot-store';
import { StageContinueComponent } from './stage-continue.component';
import { CUSTOM_MAPS_OPEN } from '../world/custom-maps-open';
import type { MapSummary } from '../world/custom-map/map-store';
import { WorldChoiceService } from '../world/world-choice.service';
import { WorldSession, type ParkedWorld } from '../world/world-session.service';
import { AppScreen } from '../world/app-screen.service';
import { PLAIN_START, WorldStartService, type WorldStart } from '../world/world-start';
import { SettingsSectionsComponent } from '../components/main-menu/pages/settings/settings-sections.component';
import { ExtrasListComponent } from '../components/main-menu/pages/extras/extras-list.component';
import { SaveSlotsComponent } from '../components/main-menu/pages/save-load/save-slots.component';
import { TokenSetupComponent } from '../components/token-setup/token-setup.component';
import { TdIconComponent } from '../components/icon/icon.component';
import { RovingGroupDirective } from '../components/roving-group.directive';
import { AddressAutocompleteComponent } from '../components/address-autocomplete.component';
import { StageCoopComponent } from './stage-coop.component';
import { WorldMapsComponent } from './world-maps.component';
import { WorldOsmComponent } from './world-osm.component';
import { WorldRealComponent } from './world-real.component';
import { WorldsStageComponent } from './worlds-stage.component';
import { WorldsStageService } from './worlds-stage.service';

const template = readFileSync(resolve('src/app/worlds/worlds-stage.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);

@Component({ selector: 'td-token-setup', standalone: true, template: '<p class="token-stub">Map key</p>' })
class TokenStub {
  readonly fromWorlds = input(false);
  readonly tokenSaved = output<void>();
  readonly toMaps = output<void>();
}
for (const name of ['fromWorlds']) Input({ alias: name, isSignal: true } as Input)(TokenStub.prototype, name);

@Component({ selector: 'app-td-address-autocomplete', standalone: true, template: '' })
class SearchStub {}
@Component({ selector: 'app-osm-frame', standalone: true, template: '' })
class FrameStub {
  readonly place = input<unknown>(null);
  readonly spawnsAt = input<unknown>([]);
  readonly backLink = input(true);
  readonly back = output<void>();
  readonly done = output<unknown>();
}
for (const name of ['place', 'spawnsAt', 'backLink']) Input({ alias: name, isSignal: true } as Input)(FrameStub.prototype, name);
@Component({ selector: 'app-settings-sections', standalone: true, template: '' })
class SettingsStub {}
@Component({ selector: 'app-extras-list', standalone: true, template: '' })
class ExtrasStub {}
@Component({ selector: 'app-save-slots', standalone: true, template: '' })
class SlotsStub {
  readonly mode = input('load');
}
for (const name of ['mode']) Input({ alias: name, isSignal: true } as Input)(SlotsStub.prototype, name);
// The shared path bar (components/world-path) as the JIT transform would annotate it
for (const name of ['world', 'worldHere', 'mode', 'modes', 'playLabel', 'editLabel', 'playWhy', 'editWhy', 'playHint', 'editHint', 'worldsHint', 'worldHint', 'chips']) {
  Input({ alias: name, isSignal: true } as Input)(WorldPathComponent.prototype, name);
}

Input({ alias: 'world', isSignal: true } as Input)(StageContinueComponent.prototype, 'world');

const summary = (s: Partial<MapSummary> & { id: string; name: string }): MapSummary => ({
  author: '', description: '', width: 0, depth: 0, updatedAt: '', origin: 'shipped', contentHash: '', objects: 0, spawns: 2, ...s,
});

describe('Worlds stage', () => {
  let opened: WorldStart[];
  let session: {
    isOpen: ReturnType<typeof signal<boolean>>;
    parked: ReturnType<typeof signal<ParkedWorld | null>>;
    open: (order: WorldStart) => void;
    close: ReturnType<typeof vi.fn>;
    park: (held: ParkedWorld) => void;
    unpark: () => void;
    leaveParked: ReturnType<typeof vi.fn>;
  };
  let config: { cesiumIonToken: ReturnType<typeof signal<string>>; needsCredentials: () => boolean; setupRequested: ReturnType<typeof signal<boolean>> };

  beforeAll(() => {
    try {
      getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
    } catch {
      // Another spec of this worker set it up
    }
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    own = [];
  });

  let store: MemorySlotStore;
  const shipped = () => [{ summary: summary({ id: 'demo-valley', name: 'Demo Valley', description: 'River valley.' }), picture: 'maps/demo-valley.png' }];
  let own: { summary: MapSummary; picture: string | null }[] = [];
  let trashMap: ReturnType<typeof vi.fn<(id: string) => Promise<boolean>>>;

  async function open(setup: { key?: boolean; slots?: StoredSlotMeta[] } = {}): Promise<ComponentFixture<WorldsStageComponent>> {
    opened = [];
    store = new MemorySlotStore(setup.slots ?? []);
    trashMap = vi.fn(async (id: string) => {
      own = own.filter((m) => m.summary.id !== id);
      return true;
    });
    const parked = signal<ParkedWorld | null>(null);
    session = {
      isOpen: signal(false),
      parked,
      open: (order) => opened.push(order),
      close: vi.fn(),
      park: (held) => parked.set(held),
      unpark: () => parked.set(null),
      leaveParked: vi.fn(async () => parked.set(null)),
    };
    const token = signal(setup.key ? 'ion-token' : '');
    config = { cesiumIonToken: token, needsCredentials: computed(() => !token()), setupRequested: signal(false) };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldSession, useValue: session },
        { provide: WorldStartService, useValue: { current: () => PLAIN_START } },
        { provide: ConfigService, useValue: config },
        { provide: CUSTOM_MAPS_OPEN, useValue: true },
        { provide: SAVE_SLOT_STORE, useValue: store },
        { provide: MatDialog, useValue: { openDialogs: [] } },
        // The menu globe is off: the squares show discs, no WebGL in the spec
        { provide: GlobeDirectorService, useValue: { setting: signal('off') } },
        { provide: GeocodingService, useValue: { reverseGeocodeDetailed: async () => null } },
        { provide: WorldDiceService, useValue: { rollRandomCity: async () => null } },
        { provide: LocationManagementService, useValue: { recents: signal([]), favorites: signal([]) } },
        { provide: BestWaveService, useValue: { records: signal([]) } },
        {
          provide: WorldChoiceService,
          useValue: {
            listMaps: async () => ({ own: [...own], shared: [], shipped: shipped() }),
            tilesets: signal([]),
            editMap: vi.fn(),
            newMap: vi.fn(),
            importMaps: vi.fn(),
            listTrash: async () => [],
            downloadMap: vi.fn(async () => undefined),
            duplicateMap: vi.fn(async () => 'bay-2'),
            deleteShared: vi.fn(async () => undefined),
            mapFolder: null,
            revealMapFolder: vi.fn(),
            trashMap: (id: string) => trashMap(id),
          },
        },
      ],
    });
    TestBed.overrideComponent(WorldsStageComponent, {
      set: {
        template,
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [IconStub, RovingGroupDirective, TokenStub, SettingsStub, ExtrasStub, SlotsStub, StageCoopComponent, WorldRealComponent, WorldOsmComponent, WorldMapsComponent, WorldPathComponent],
      },
    });
    TestBed.overrideComponent(WorldsStageComponent, { remove: { imports: [TdIconComponent, SettingsSectionsComponent, ExtrasListComponent, SaveSlotsComponent, TokenSetupComponent] } });
    for (const world of [WorldRealComponent, WorldOsmComponent, WorldMapsComponent]) {
      TestBed.overrideComponent(world, { set: { styleUrl: undefined, styles: [] } });
    }
    TestBed.overrideComponent(WorldRealComponent, { set: { imports: [IconStub, SearchStub, RovingGroupDirective, StageContinueComponent] } });
    TestBed.overrideComponent(WorldRealComponent, { remove: { imports: [AddressAutocompleteComponent, TdIconComponent] } });
    TestBed.overrideComponent(WorldMapsComponent, { set: { imports: [IconStub, StageContinueComponent] } });
    // The coop page (CoopWaysComponent, a templateUrl) has its own spec; the stage only holds it
    TestBed.overrideComponent(StageCoopComponent, { set: { imports: [], template: '' } });
    TestBed.overrideComponent(WorldOsmComponent, { set: { imports: [IconStub, SearchStub, FrameStub, StageContinueComponent] } });
    TestBed.overrideComponent(StageContinueComponent, { set: { imports: [IconStub] } });
    const fixture = TestBed.createComponent(WorldsStageComponent);
    await settle(fixture);
    return fixture;
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  /** The words of a node, its text pieces apart as they show (the template drops the space between tags) */
  const text = (node: Element | null): string => {
    if (!node) return '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) parts.push(t.textContent ?? '');
    return parts.join(' ').replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1').trim();
  };
  const card = (f: ComponentFixture<unknown>, world: string) => el(f).querySelector<HTMLElement>(`.ws-card[data-world="${world}"]`)!;
  const button = (f: ComponentFixture<unknown>, label: string | RegExp) =>
    [...el(f).querySelectorAll<HTMLElement>('button')].find((b) => (typeof label === 'string' ? text(b) === label : label.test(text(b))))!;
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  it('without a map key: the real places stand grey with the way to the key, nothing loads', async () => {
    const f = await open();
    expect(card(f, 'real').querySelector('.td-world-disc')!.classList).toContain('is-grey');
    expect(card(f, 'maps').querySelector('.td-world-disc')!.classList).not.toContain('is-grey');
    expect(text(card(f, 'real'))).toContain('No map key: the 3D tiles need a Cesium Ion token or a Google Maps key');
    expect(text(el(f).querySelector('.ws-hint'))).toBe('Pick a world. Nothing loads until you start.');
    // The first entry has the focus, as in the start menu
    expect((document.activeElement as HTMLElement).dataset['entry']).toBe('coop');

    button(f, 'Enter map key').click();
    await settle(f);
    expect(config.setupRequested()).toBe(true);
    expect(el(f).querySelector('.token-stub')).not.toBeNull();
    esc();
    await settle(f);
    expect(config.setupRequested()).toBe(false);
    expect(el(f).querySelector('.token-stub')).toBeNull();
    expect(opened).toEqual([]);
  });

  it('without a map key the real places\' menu lists places, Start says why and leads to the key; Esc goes back up', async () => {
    const f = await open();
    card(f, 'real').click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-panel .td-dlg-title'))).toBe('Real places');
    expect(text(el(f).querySelector('.ws-panel .td-banner'))).toContain('No map key');
    // An empty Recent list starts on the showcase; a row picks, the path names it
    const row = el(f).querySelector<HTMLElement>('.wm-body .td-row')!;
    row.click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-path'))).toBe('Worlds › Real places › New York Start Make map');
    const start = el(f).querySelector<HTMLElement>('[data-stage-start]')!;
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(text(el(f).querySelector('.wm-detail .td-note.is-warn'))).toBe('Needs a map key (Cesium Ion or Google). Enter map key');
    start.click();
    await settle(f);
    expect(opened).toEqual([]);
    el(f).querySelector<HTMLElement>('.wm-detail .td-link')!.click();
    await settle(f);
    expect(config.setupRequested()).toBe(true);

    // Esc: the key screen, then the world menu, then on the globes nothing
    esc();
    await settle(f);
    expect(el(f).querySelector('.ws-panel')).not.toBeNull();
    esc();
    await settle(f);
    expect(el(f).querySelector('.ws-panel')).toBeNull();
    expect(el(f).querySelector('.ws-cards')).not.toBeNull();
    esc();
    await settle(f);
    expect(el(f).querySelector('.ws-cards')).not.toBeNull();
  });

  it('a map picked under Maps plays with the Start order: its world, played once it stands, named in the loading', async () => {
    const f = await open();
    card(f, 'maps').click();
    await settle(f);
    button(f, /^Demo Valley/).click();
    await settle(f);
    expect(text(el(f).querySelector('.wm-detail'))).toContain('River valley.');
    el(f).querySelector<HTMLElement>('[data-stage-start]')!.click();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ world: { kind: 'custom-map', mapId: 'demo-valley' }, play: true, label: 'Demo Valley', resume: null });
    expect(localStorage.getItem('td_last_world_v1')).toBe('"maps"');
  });

  it('an autosave is Continue at the top; a start at another place of its world asks first', async () => {
    const slots: StoredSlotMeta[] = [{
      id: AUTOSAVE_SLOT, name: 'Heilbronn, wave 12', wave: 12, location: 'Heilbronn, Germany', savedAt: '2026-10-16T08:00:00Z',
      gameVersion: 'test', configHash: 'x', hq: { lat: 49.14, lon: 9.22 },
    }];
    const f = await open({ key: true, slots });
    const first = el(f).querySelector<HTMLElement>('.ws-menu [role="menuitem"]')!;
    expect(text(first)).toBe('Continue Heilbronn | wave 12');
    expect(text(card(f, 'real'))).toContain('Heilbronn | wave 12 | autosave');
    expect(card(f, 'real').classList).toContain('is-hero');

    card(f, 'real').click();
    await settle(f);
    el(f).querySelector<HTMLElement>('.wm-body .td-row:not([data-stage-continue])')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-stage-start]')!.click();
    await settle(f);
    expect(opened).toEqual([]);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('Heilbronn | wave 12 waits in Real places.');
    button(f, 'Continue Heilbronn').click();
    expect(opened[0]).toMatchObject({ world: null, resume: AUTOSAVE_SLOT, play: true, label: 'Heilbronn' });
  });

  const heilbronn = (): StoredSlotMeta => ({
    id: AUTOSAVE_SLOT, name: 'Heilbronn, wave 12', wave: 12, location: 'Heilbronn, Germany', savedAt: '2026-10-16T08:00:00Z',
    gameVersion: 'test', configHash: 'x', hq: { lat: 49.14, lon: 9.22 },
  });

  it('a start elsewhere in the world ends its run at once when the player says so (decision 2)', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    card(f, 'real').click();
    await settle(f);
    el(f).querySelector<HTMLElement>('.wm-body .td-row:not([data-stage-continue])')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-stage-start]')!.click();
    await settle(f);
    button(f, 'End it and start').click();
    await settle(f);
    expect(store.ids()).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ resume: null, play: true });
  });

  it('the world menu discards its Continue after asking; the globes forget it at once', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    card(f, 'real').click();
    await settle(f);
    expect(text(el(f).querySelector('[data-stage-continue]'))).toBe('Continue Heilbronn | wave 12');
    el(f).querySelector<HTMLElement>('[data-stage-discard]')!.click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('Discard Heilbronn | wave 12? It cannot be continued.');
    button(f, 'Cancel').click();
    await settle(f);
    expect(store.ids()).toEqual([AUTOSAVE_SLOT]);
    el(f).querySelector<HTMLElement>('[data-stage-discard]')!.click();
    await settle(f);
    button(f, 'Discard').click();
    await settle(f);
    expect(store.ids()).toEqual([]);
    expect(el(f).querySelector('[data-stage-continue]')).toBeNull();
    esc();
    await settle(f);
    expect(text(el(f).querySelector('.ws-menu'))).not.toContain('Continue');
  });

  it('an autosave written while the globes stand shows at once: Continue, chip and the line under its globe', async () => {
    const f = await open({ key: true });
    expect(text(el(f).querySelector('.ws-menu'))).not.toContain('Continue');
    await store.write({ ...heilbronn(), id: 'autosave-built', name: 'Demo Valley, wave 4', wave: 4, location: 'Demo Valley', map: { id: 'demo-valley', name: 'Demo Valley' }, world: 'maps' }, 'save');
    await settle(f);
    expect(text(el(f).querySelector('.ws-menu [role="menuitem"]'))).toBe('Continue Demo Valley | wave 4');
    expect(text(el(f).querySelector('.ws-chip'))).toBe('Demo Valley | wave 4 | autosave');
    expect(text(card(f, 'maps'))).toContain('Demo Valley | wave 4 | autosave');
    expect(card(f, 'maps').classList).toContain('is-hero');
  });

  it('a link only picks: its map stands chosen in its world, nothing loads', async () => {
    TestBed.overrideProvider(WorldStartService, { useValue: { current: () => ({ ...PLAIN_START, world: { kind: 'custom-map', mapId: 'demo-valley', contentHash: '' } }) } });
    const f = await open();
    expect(TestBed.inject(WorldsStageService).view()).toBe('world');
    expect(text(el(f).querySelector('.ws-path'))).toBe('Worlds › Built Worlds › Demo Valley Play Edit');
    expect(opened).toEqual([]);
  });

  const ownMap = (id: string, name: string, extra: Partial<MapSummary> = {}) =>
    ({ summary: summary({ id, name, origin: 'own', updatedAt: '2026-10-16T08:00:00Z', ...extra }), picture: `blob:${id}` });

  it('OpenStreetMap lists its unchanged maps as Recent worlds; Remove asks, then the map goes to the trash', async () => {
    own = [
      ownMap('miltenberg', 'Miltenberg', { generated: true, osm: { lat: 49.7, lon: 9.26 } }),
      ownMap('binswangen', 'Binswangen', { osm: { lat: 48.5, lon: 10.6 } }),
    ];
    const f = await open({ key: true });
    card(f, 'osm').click();
    await settle(f);
    const rows = () => [...el(f).querySelectorAll<HTMLElement>('[data-map]')].map((r) => r.dataset['map']);
    expect(text(el(f).querySelector('#wm-osm-mine'))).toBe('Recent worlds');
    expect(rows()).toEqual(['miltenberg']);
    expect(el(f).querySelector<HTMLImageElement>('[data-map="miltenberg"] img')!.getAttribute('src')).toBe('blob:miltenberg');
    el(f).querySelector<HTMLElement>('[data-recent-remove]')!.click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('Remove Miltenberg from Recent worlds?');
    button(f, 'Remove').click();
    await settle(f);
    expect(trashMap).toHaveBeenCalledWith('miltenberg');
    expect(rows()).toEqual([]);
  });

  it('Built Worlds lists every other map with its picture and where it comes from; Recent shows the maps played lately', async () => {
    own = [
      ownMap('miltenberg', 'Miltenberg', { generated: true, osm: { lat: 49.7, lon: 9.26 } }),
      ownMap('binswangen', 'Binswangen', { osm: { lat: 48.5, lon: 10.6 } }),
      ownMap('demo-valley-copy', 'Demo Valley (copy)', { copyOf: { id: 'demo-valley', hash: 'h' } }),
    ];
    localStorage.setItem('td_recent_maps_v1', JSON.stringify(['demo-valley']));
    const f = await open({ key: true });
    card(f, 'maps').click();
    await settle(f);
    const sections = [...el(f).querySelectorAll('.wm-body .td-group')].map((g) => [text(g.querySelector('.td-section')), [...g.querySelectorAll<HTMLElement>('[data-map]')].map((r) => r.dataset['map'])]);
    expect(sections).toEqual([
      ['Recent', ['demo-valley']],
      ['Your built worlds', ['binswangen', 'demo-valley-copy']],
      ['From coop hosts', []],
      ['Shipped', ['demo-valley']],
    ]);
    expect(text(el(f).querySelector('[data-map="binswangen"]'))).toContain('from OpenStreetMap');
    expect(text(el(f).querySelector('[data-map="demo-valley-copy"]'))).toContain('copy of Demo Valley');
    expect(el(f).querySelector<HTMLImageElement>('[data-map="demo-valley"] img')!.getAttribute('src')).toBe('maps/demo-valley.png');
    el(f).querySelector<HTMLElement>('[data-recent-remove]')!.click();
    await settle(f);
    expect(text(el(f).querySelector('.wm-body .td-group .td-section'))).toBe('Your built worlds');
    expect(localStorage.getItem('td_recent_maps_v1')).toBe('[]');
  });

  it('each world menu keeps its pick over a reload; a map that is gone is no pick', async () => {
    let f = await open({ key: true });
    card(f, 'maps').click();
    await settle(f);
    button(f, /^Demo Valley/).click();
    await settle(f);
    TestBed.inject(WorldsStageService).pick('real', { kind: 'place', hq: { lat: 49.14, lon: 9.22 }, spawns: [], name: 'Heilbronn' });
    TestBed.resetTestingModule();

    f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    expect(stage.picks().maps).toMatchObject({ kind: 'map', id: 'demo-valley' });
    expect(stage.picks().real).toMatchObject({ kind: 'place', name: 'Heilbronn' });
    card(f, 'maps').click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-path'))).toBe('Worlds › Built Worlds › Demo Valley Play Edit');

    stage.pick('osm', { kind: 'map', id: 'gone', name: 'Gone' });
    await stage.refreshMaps();
    expect(stage.picks().osm).toBeNull();
  });

  const held = (run: boolean): ParkedWorld => ({
    world: 'real', pick: { kind: 'place', hq: { lat: 49.14, lon: 9.22 }, spawns: [], name: 'Heilbronn, Germany' }, label: 'Heilbronn', wave: 4, run,
  });

  it('a place held behind the globes without a run is Back to it: at once, nothing loads (point 7)', async () => {
    const f = await open({ key: true });
    session.park(held(false));
    await settle(f);
    expect(text(el(f).querySelector('.ws-menu [role="menuitem"]'))).toBe('Back to Heilbronn Still loaded, no run yet');
    expect(text(el(f).querySelector('.ws-chip'))).toBe('Back to Heilbronn');
    expect(card(f, 'real').classList).toContain('is-hero');
    // Its world menu offers the same, its pick says Back to
    card(f, 'real').click();
    await settle(f);
    expect(text(el(f).querySelector('[data-stage-continue]'))).toBe('Back to Heilbronn Still loaded, no run yet');
    expect(el(f).querySelector('[data-stage-discard]')).toBeNull();
    TestBed.inject(WorldsStageService).pick('real', held(false).pick);
    await settle(f);
    expect(text(el(f).querySelector('[data-stage-start]'))).toBe('Back to Heilbronn');
    el(f).querySelector<HTMLElement>('[data-stage-start]')!.click();
    await settle(f);
    expect(session.parked()).toBeNull();
    expect(opened).toEqual([]);
  });

  it('a run held is Continue, ready at once; a start elsewhere in its world asks and ends it without keeping it', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    session.park(held(true));
    await settle(f);
    expect(text(el(f).querySelector('.ws-menu [role="menuitem"]'))).toBe('Continue Heilbronn | wave 4');
    expect(text(el(f).querySelector('.ws-chip'))).toBe('Heilbronn | wave 4 | ready');
    card(f, 'real').click();
    await settle(f);
    el(f).querySelector<HTMLElement>('.wm-body .td-row:not([data-stage-continue])')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-stage-start]')!.click();
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('Heilbronn | wave 4 waits in Real places.');
    button(f, 'End it and start').click();
    await settle(f);
    expect(session.leaveParked).toHaveBeenCalledWith(false);
    expect(store.ids()).toEqual([]);
    expect(opened).toHaveLength(1);
  });

  it('Continue of a run held shows it at once; Discard ends it and its autosave', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    session.park(held(true));
    await settle(f);
    el(f).querySelector<HTMLElement>('.ws-menu [role="menuitem"]')!.click();
    await settle(f);
    expect(session.parked()).toBeNull();
    expect(opened).toEqual([]);

    session.park(held(true));
    card(f, 'real').click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-stage-discard]')!.click();
    await settle(f);
    button(f, 'Discard').click();
    await settle(f);
    expect(session.leaveParked).toHaveBeenCalledWith(false);
    expect(store.ids()).toEqual([]);
  });

  it('a run held in a wave asks before anything else starts (editor, a world, a coop room): Go on, Back to it, Cancel', async () => {
    const f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    const editMap = TestBed.inject(WorldChoiceService).editMap as ReturnType<typeof vi.fn>;
    session.park({ ...held(true), keeps: 'wave-start' });
    await settle(f);

    // The map editor: asked, Cancel leaves everything as it was
    stage.editMap('demo-valley');
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toBe(
      'Heilbronn | wave 4 is in the middle of its wave. Going on keeps it as it stood at the start of wave 4. Go on Back to Heilbronn Cancel');
    button(f, 'Cancel').click();
    await settle(f);
    expect(editMap).not.toHaveBeenCalled();
    expect(session.parked()).not.toBeNull();
    // Go on: the editor opens (WorldChoiceService.editMap lets the held world go)
    stage.editMap('demo-valley');
    await settle(f);
    button(f, 'Go on').click();
    await settle(f);
    expect(editMap).toHaveBeenCalledWith('demo-valley');

    // Another world: a map of Built Worlds, a run with no autosave yet ends; Back to shows the held game
    session.park({ ...held(true), keeps: 'nothing' });
    stage.pick('maps', { kind: 'map', id: 'demo-valley', name: 'Demo Valley' });
    stage.start('maps');
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('It has no autosave yet: going on ends it.');
    button(f, 'Back to Heilbronn').click();
    await settle(f);
    expect(session.parked()).toBeNull();
    expect(opened).toEqual([]);

    // A coop room by its code, the same question
    session.park({ ...held(true), keeps: 'wave-start' });
    stage.joinRoom('ABC123');
    await settle(f);
    button(f, 'Go on').click();
    await settle(f);
    expect(opened).toEqual([expect.objectContaining({ room: { code: 'ABC123', lane: null } })]);

    // Between the waves the run stays as autosave: nothing to ask
    opened.length = 0;
    session.park({ ...held(true), keeps: 'all' });
    stage.start('maps');
    await settle(f);
    expect(el(f).querySelector('.ws-confirm')).toBeNull();
    expect(opened).toHaveLength(1);
  });

  it('a world held after its game over says so; Make map from the game goes back into it', async () => {
    const f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    session.park({ ...held(false), over: true });
    await settle(f);
    expect(text(el(f).querySelector('.ws-menu [role="menuitem"]'))).toBe('Back to Heilbronn Still loaded, the run is over');

    // The frame of a map of the place, opened from the game (Make map): Back, Esc too, shows the game again
    session.park(held(true));
    stage.makeMapOf({ kind: 'place', hq: { lat: 49.14, lon: 9.22 }, spawns: [], name: 'Heilbronn' }, 'game');
    await settle(f);
    expect(stage.world()).toBe('osm');
    esc();
    await settle(f);
    expect(stage.frame()).toBeNull();
    expect(session.parked()).toBeNull();
    expect(opened).toEqual([]);
  });

  it('keyboard: a world menu takes the focus on its first entry, Esc gives it back to that world\'s globe', async () => {
    const f = await open({ key: true });
    card(f, 'maps').focus();
    card(f, 'maps').click();
    await settle(f);
    expect(el(f).querySelector('.ws-panel .wm-body')!.contains(document.activeElement)).toBe(true);
    esc();
    await settle(f);
    expect(document.activeElement).toBe(card(f, 'maps'));
  });

  it('a world menu has its own Continue as first row, not again as a chip; the other worlds\' stay', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    session.park({ world: 'maps', pick: { kind: 'map', id: 'demo-valley', name: 'Demo Valley' }, label: 'Demo Valley', wave: 3, run: true });
    await settle(f);
    card(f, 'maps').click();
    await settle(f);
    expect(text(el(f).querySelector('[data-stage-continue]'))).toBe('Continue Demo Valley | wave 3');
    expect([...el(f).querySelectorAll('.ws-chip')].map((c) => c.getAttribute('data-chip'))).toEqual(['continue-real']);
  });

  it('a save file on the globes: kept as the file slot, its world opens and loads it, the world of its map by the list', async () => {
    const f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    const slot: SaveSlotInfo = {
      id: FILE_SLOT, world: 'maps', name: 'Demo Valley, wave 3', autosave: false, wave: 3, location: 'Demo Valley', hq: null,
      map: { id: 'demo-valley', name: 'Demo Valley' }, savedAt: '', gameVersion: 'test', note: null,
    };
    const kept = vi.spyOn(SaveGame.prototype, 'storeFile').mockResolvedValue({ ok: true, slot });
    expect(await stage.saves.importFile(new File(['x'], 'save.json.gz'))).toEqual({ ok: true, note: null });
    expect(kept.mock.calls[0][1]).toBe(FILE_SLOT);
    expect(kept.mock.calls[0][2]('demo-valley')).toBe('maps');
    await settle(f);
    expect(opened).toEqual([expect.objectContaining({ resume: FILE_SLOT, play: true, label: 'Demo Valley', world: expect.objectContaining({ mapId: 'demo-valley' }) })]);
    kept.mockRestore();
  });

  it('a coop code without a map key asks first: Join goes on, Enter map key opens the key screen', async () => {
    const f = await open();
    const stage = TestBed.inject(WorldsStageService);
    stage.joinRoom('ABC123');
    await settle(f);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('No map key in this browser.');
    button(f, 'Enter map key').click();
    await settle(f);
    expect(stage.overlay()).toBe('key');
    expect(opened).toEqual([]);
    stage.closeOverlay();
    stage.joinRoom('ABC123');
    await settle(f);
    button(f, 'Join').click();
    await settle(f);
    expect(opened).toEqual([expect.objectContaining({ room: { code: 'ABC123', lane: null } })]);
  });

  it('a double click on a map plays it: pick and Play in one', async () => {
    const f = await open({ key: true });
    card(f, 'maps').click();
    await settle(f);
    const row = el(f).querySelector<HTMLElement>('[data-map="demo-valley"]')!;
    row.click();
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle(f);
    expect(opened).toEqual([expect.objectContaining({ world: expect.objectContaining({ mapId: 'demo-valley' }), play: true })]);
  });

  it('New map in the menu of Built Worlds opens the editor on the form of a new map, not its list', async () => {
    const f = await open({ key: true });
    card(f, 'maps').click();
    await settle(f);
    button(f, 'New map').click();
    await settle(f);
    expect(TestBed.inject(WorldChoiceService).newMap).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(WorldChoiceService).editMap).not.toHaveBeenCalled();
  });

  it('the key screen\'s "Play the maps" over the globes opens the Built Worlds\' menu, a map picked, nothing loaded', async () => {
    const f = await open();
    const stage = TestBed.inject(WorldsStageService);
    stage.openOverlay('key');
    await settle(f);
    stage.openMaps();
    await settle(f);
    expect(stage.overlay()).toBeNull();
    expect(stage.view()).toBe('world');
    expect(stage.world()).toBe('maps');
    expect(stage.picks().maps).toMatchObject({ kind: 'map', id: 'mountain-pass' });
    expect(opened).toEqual([]);
  });

  it('out of the editor: the Built Worlds\u2019 menu with the map closed picked there, a world left open behind it closes', async () => {
    const f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    session.isOpen.set(true);
    stage.leaveEditorTo({ pick: { kind: 'map', id: 'demo-valley', name: 'Demo Valley' } });
    await settle(f);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(stage.view()).toBe('world');
    expect(stage.world()).toBe('maps');
    expect(stage.picks().maps).toMatchObject({ kind: 'map', id: 'demo-valley' });
    expect(opened).toEqual([]);
    // To all worlds: the globes
    stage.leaveEditorTo(null);
    await settle(f);
    expect(stage.view()).toBe('globes');
  });

  it('Map editor on the globes opens the Built Worlds\u2019 menu, the one list of maps; Import file hands its files to the editor', async () => {
    const f = await open({ key: true });
    const worlds = TestBed.inject(WorldChoiceService) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    el(f).querySelector<HTMLElement>('[data-entry="editor"]')!.click();
    await settle(f);
    expect(TestBed.inject(WorldsStageService).world()).toBe('maps');
    expect(worlds['editMap']).not.toHaveBeenCalled();
    const input = el(f).querySelector<HTMLInputElement>('[data-test="import-input"]')!;
    const file = new File(['x'], 'bay.3dtdmap');
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle(f);
    expect(worlds['importMaps']).toHaveBeenCalledWith([file]);
  });

  it('the picked map: Download, Duplicate (picked after), Delete to the trash with Restore; the trash lists it at the end', async () => {
    own = [{ summary: summary({ id: 'bay', name: 'Bay', origin: 'own', updatedAt: '2026-10-16T08:00:00Z' }), picture: null }];
    const f = await open({ key: true });
    const stage = TestBed.inject(WorldsStageService);
    const worlds = TestBed.inject(WorldChoiceService) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const library = { deleteMap: vi.fn(async () => 'bay~1'), restoreMap: vi.fn(async () => 'bay'), deleteForGood: vi.fn(async () => undefined) };
    (stage as unknown as { library: Promise<unknown> }).library = Promise.resolve({ library, error: () => null });
    card(f, 'maps').click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-map="bay"]')!.click();
    await settle(f);
    button(f, 'Download').click();
    expect(worlds['downloadMap']).toHaveBeenCalledWith('bay', 'own');
    button(f, 'Duplicate').click();
    await settle(f);
    expect(worlds['duplicateMap']).toHaveBeenCalledWith('bay', 'own');
    expect(stage.picks().maps).toMatchObject({ id: 'bay-2' });
    el(f).querySelector<HTMLElement>('[data-map="bay"]')!.click();
    await settle(f);
    el(f).querySelector<HTMLElement>('[data-test="delete-map"]')!.click();
    await vi.waitFor(() => expect(library.deleteMap).toHaveBeenCalledWith('bay', 'Bay'));
    await settle(f);
    expect(stage.notice()).toBe('Bay is in the trash at the end of the list.');
    expect(stage.picks().maps).toBeNull();
    stage.restoreMap('bay~1');
    await vi.waitFor(() => expect(library.restoreMap).toHaveBeenCalledWith('bay~1'));
  });

  it('one source of chips for the globes, the game and the editor: the other worlds, the map in the editor', async () => {
    const f = await open({ key: true, slots: [heilbronn()] });
    session.park({ world: 'maps', pick: { kind: 'map', id: 'demo-valley', name: 'Demo Valley' }, label: 'Demo Valley', wave: 3, run: true });
    TestBed.inject(AppScreen).draft.set({ mapId: 'bay', name: 'Bay', unsaved: true });
    await settle(f);
    const stage = TestBed.inject(WorldsStageService);
    expect([...el(f).querySelectorAll('.ws-chip')].map((c) => text(c))).toEqual(['Demo Valley | wave 3 | ready', 'Heilbronn | wave 12 | autosave', 'Editor: Bay | unsaved']);
    // Over the game of the real places: its own world is on screen
    expect(stage.pathChips('real', true).map((c) => c.id)).toEqual(['continue-maps', 'editor']);
    // In the editor: no chip of the editor
    expect(stage.pathChips(null, false).map((c) => c.id)).toEqual(['continue-maps', 'continue-real']);
    el(f).querySelector<HTMLElement>('.ws-chip[data-chip="continue-real"]')!.click();
    expect(opened[0]).toMatchObject({ resume: AUTOSAVE_SLOT, play: true });
  });

  it('a save loaded from the globes is a start in its world: its run there ends after the question', async () => {
    const slot = { ...heilbronn(), id: 'slot-1', name: 'Paris, wave 3', wave: 3, location: 'Paris', hq: { lat: 48.86, lon: 2.29 }, world: 'real' as const };
    const f = await open({ key: true, slots: [heilbronn(), slot] });
    const stage = TestBed.inject(WorldsStageService);
    const info = stage.saves.slots().find((s) => s.id === 'slot-1')!;
    // The rule the game's Load page asks by too (MainMenuService.loadAsk); its own Continue ends nothing
    expect(stage.loadAsk(info)).toMatchObject({ text: 'Heilbronn | wave 12 waits in Real places.', run: { slotId: AUTOSAVE_SLOT } });
    expect(stage.loadAsk(stage.saves.slots().find((s) => s.id === AUTOSAVE_SLOT)!)).toBeNull();
    expect(stage.continueSlot(info)).toBeNull();
    await settle(f);
    expect(opened).toEqual([]);
    expect(text(el(f).querySelector('.ws-confirm'))).toContain('Heilbronn | wave 12 waits in Real places. Each world keeps one run. Loading this save ends it now.');
    button(f, 'End it and load').click();
    await settle(f);
    expect(store.ids()).toEqual(['slot-1']);
    expect(opened[0]).toMatchObject({ resume: 'slot-1', play: true, label: 'Paris' });
    // The autosave of the world itself loads at once
    opened.length = 0;
    await store.write({ ...heilbronn() }, 'save');
    await settle(f);
    stage.continueSlot(stage.saves.slots().find((s) => s.id === AUTOSAVE_SLOT)!);
    expect(opened[0]).toMatchObject({ resume: AUTOSAVE_SLOT });
  });
});
