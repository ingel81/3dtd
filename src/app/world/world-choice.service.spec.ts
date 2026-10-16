import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { createMapDocument } from './custom-map/map-create';
import { MapStore, MemoryMapBackend, type ShippedMapIndex } from './custom-map/map-store';
import { parseOwnTilesets } from './tileset/own-tileset';
import { MAP_STORE, WorldChoiceService } from './world-choice.service';
import { AppScreen } from './app-screen.service';
import { WorldContext } from './world-context.service';
import type { WorldRef } from './world-ref';
import { WorldSession } from './world-session.service';
import { PLAIN_START, type WorldStart } from './world-start';

const INDEX: ShippedMapIndex = {
  maps: [
    { id: 'demo-valley', name: 'Demo Valley', file: 'demo-valley.3dtdmap', preview: 'demo-valley.png', author: '3DTD', width: 512, depth: 512, spawns: 2, biome: 'temperate' },
    { id: 'bay', name: 'Shipped bay', file: 'bay.3dtdmap' },
  ],
};
const TILESET = parseOwnTilesets([{ id: 'synth', url: 'http://localhost:4311/synth/tileset.json', center: { lat: 48.7784, lon: 9.18 }, radiusM: 950 }])[0];

describe('WorldChoiceService', () => {
  let service: WorldChoiceService;
  let screens: AppScreen;
  /** The worlds opened in the page (WorldSession.open) */
  let opened: WorldStart[];
  let current: ReturnType<typeof signal<WorldRef>>;
  let store: MapStore;

  beforeEach(() => {
    screens = new AppScreen();
    opened = [];
    current = signal<WorldRef>({ kind: 'tiles', source: 'cesium' });
    store = new MapStore({
      backend: new MemoryMapBackend(),
      fetch: async (url) => (url.endsWith('index.json') ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 })),
      baseUrl: 'http://x/game/',
    });
    const injector = Injector.create({
      providers: [
        { provide: MAP_STORE, useValue: store },
        { provide: AppScreen, useValue: screens },
        { provide: WorldSession, useValue: { open: (order: WorldStart) => opened.push(order) } },
        { provide: ConfigService, useValue: { ownTilesets: signal([TILESET]) } },
        { provide: WorldContext, useValue: { ref: current.asReadonly() } },
      ],
    });
    service = runInInjectionContext(injector, () => new WorldChoiceService());
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picture');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists own maps with their pictures first, then the shipped ones an own map does not hide', async () => {
    const bay = createMapDocument({ id: 'bay', name: 'My bay', width: 64, depth: 32 });
    await store.save(bay, new Uint8Array([1, 2, 3]));
    const hosted = createMapDocument({ id: 'hosted', name: "Ann's map", width: 64, depth: 64 });
    await store.saveShared(hosted, null, new Uint8Array([1]));
    const maps = await service.listMaps();
    expect(maps.own.map((m) => [m.summary.name, m.picture])).toEqual([['My bay', 'blob:picture']]);
    // A map a coop host sent is kept apart from the own ones
    expect(maps.shared.map((m) => [m.summary.name, m.picture])).toEqual([["Ann's map", null]]);
    expect(maps.own[0].summary).toMatchObject({ width: 64, depth: 32, spawns: 1, biome: 'temperate' });
    expect(maps.shipped.map((m) => [m.summary.id, m.picture])).toEqual([['demo-valley', 'http://x/game/maps/demo-valley.png']]);
    expect(maps.shipped[0].summary).toMatchObject({ author: '3DTD', spawns: 2, biome: 'temperate' });
  });

  it('opens the chosen map or set in the page, and the real places again, without loading a page', () => {
    service.playMap('demo-valley');
    service.playTileset(TILESET);
    service.playRealPlaces();
    const [map, tileset, places] = opened;
    expect(map).toEqual({ ...PLAIN_START, world: { kind: 'custom-map', mapId: 'demo-valley', contentHash: '' } });
    // A set starts at the middle of its area
    expect(tileset.world).toEqual({ kind: 'tileset', id: 'synth' });
    expect(tileset.place).toEqual({ hq: { lat: 48.7784, lon: 9.18 }, spawns: [] });
    expect(places).toEqual(PLAIN_START);
    // The editor opens in the window too
    service.editMap('demo-valley');
    expect(screens.screen()).toBe('editor');
    expect(screens.takeEditorMap()).toBe('demo-valley');
  });

  it("opens a save's world in the page and loads the save there", () => {
    service.openSave({ id: 'slot-2', map: { id: 'bay' } });
    service.openSave({ id: 'slot-3', map: null });
    expect(opened).toEqual([
      { ...PLAIN_START, world: { kind: 'custom-map', mapId: 'bay', contentHash: '' }, resume: 'slot-2' },
      { ...PLAIN_START, resume: 'slot-3' },
    ]);
  });

  it('knows the world the page plays on', () => {
    current.set({ kind: 'custom-map', mapId: 'demo-valley', contentHash: 'abc' });
    expect(service.isCurrent({ kind: 'custom-map', mapId: 'demo-valley', contentHash: '' })).toBe(true);
    expect(service.isCurrent({ kind: 'custom-map', mapId: 'bay', contentHash: '' })).toBe(false);
    expect(service.isCurrent({ kind: 'tileset', id: 'synth' })).toBe(false);
    expect(service.tilesets()).toEqual([TILESET]);
  });

  it('plays a map double-clicked in the desktop app, under the id of its file in the map folder', async () => {
    let listener: ((name: string) => void) | null = null;
    const desktop = {
      version: '0.7.0',
      onUpdateReady: () => () => undefined,
      installUpdateNow: vi.fn(),
      saveRun: async () => true,
      maps: { onOpen: (listen: (name: string) => void) => ((listener = listen), () => (listener = null)), reveal: vi.fn() },
    };
    (window as unknown as { desktop?: unknown }).desktop = desktop;
    try {
      const injector = Injector.create({
        providers: [
          { provide: MAP_STORE, useValue: store },
          { provide: AppScreen, useValue: screens },
          { provide: WorldSession, useValue: { open: (order: WorldStart) => opened.push(order) } },
          { provide: ConfigService, useValue: { ownTilesets: signal([]) } },
          { provide: WorldContext, useValue: { ref: current.asReadonly() } },
        ],
      });
      const onDesktop = runInInjectionContext(injector, () => new WorldChoiceService());
      const stop = onDesktop.playOpenedMaps();
      listener!('Witch Marsh.3dtdmap');
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0].world).toEqual({ kind: 'custom-map', mapId: 'witch-marsh', contentHash: '' });
      onDesktop.revealMapFolder();
      expect(desktop.maps.reveal).toHaveBeenCalledOnce();
      stop();
      expect(listener).toBeNull();
      // In a browser there is no folder: nothing to listen to
      expect(service.mapFolder).toBeNull();
    } finally {
      delete (window as unknown as { desktop?: unknown }).desktop;
    }
  });
});
