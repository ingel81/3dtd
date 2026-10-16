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
import { AUTOSAVE_SLOT } from '../services/save-game/save-game.port';
import { SAVE_SLOT_STORE, type StoredSlotMeta } from '../services/save-game/save-slot.store';
import { MemorySlotStore } from '../../test/memory-slot-store';
import { StageContinueComponent } from './stage-continue.component';
import { CUSTOM_MAPS_OPEN } from '../world/custom-maps-open';
import type { MapSummary } from '../world/custom-map/map-store';
import { WorldChoiceService } from '../world/world-choice.service';
import { WorldSession } from '../world/world-session.service';
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
}
for (const name of ['fromWorlds']) Input({ alias: name, isSignal: true } as Input)(TokenStub.prototype, name);

@Component({ selector: 'app-td-address-autocomplete', standalone: true, template: '' })
class SearchStub {}
@Component({ selector: 'app-osm-frame', standalone: true, template: '' })
class FrameStub {
  readonly place = input<unknown>(null);
  readonly spawnsAt = input<unknown>([]);
  readonly back = output<void>();
  readonly done = output<unknown>();
}
for (const name of ['place', 'spawnsAt']) Input({ alias: name, isSignal: true } as Input)(FrameStub.prototype, name);
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
  let session: { isOpen: ReturnType<typeof signal<boolean>>; open: (order: WorldStart) => void; close: ReturnType<typeof vi.fn> };
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
    session = { isOpen: signal(false), open: (order) => opened.push(order), close: vi.fn() };
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
});
