import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { LibraryTiles } from '../../test/library-tiles-fixture';
import type { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { corridorConfig, probeLowWall } from '../utils/route-corridor';
import { instrumentRaycasts, raycastStats } from '../utils/raycast-stats';
import type { EllipsoidSync } from './ellipsoid-sync';
import { TerrainQueries, columnCacheKey } from './terrain-queries';

/** Was TerrainQueries von einer aktiven Tile liest. */
interface FakeTile {
  internal: { depth: number };
  geometricError: number;
  engineData: { scene: Mesh };
}

const material = new MeshBasicMaterial({ side: DoubleSide });

/** Waagerechtes Quadrat mit Kantenlänge `size` in Höhe `y`, mittig über (cx, cz). */
function floor(y: number, size = 40, cx = 0, cz = 0): Mesh {
  const mesh = new Mesh(new PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  return mesh;
}

/** Senkrechte Wand quer zur X-Achse bei `x`, von z -20 bis 20 und y `bottom` bis `top`. */
function wall(x: number, top = 30, bottom = 0): Mesh {
  const mesh = new Mesh(new PlaneGeometry(40, top - bottom), material);
  mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, (top + bottom) / 2, 0);
  return mesh;
}

/** Geo → lokal wie EllipsoidSync.geoToLocalSimple, Origin (0, 0): -X = Ost, +Z = Nord. */
const sync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3(-lon * METERS_PER_DEGREE_LAT, height, lat * METERS_PER_DEGREE_LAT),
} as unknown as EllipsoidSync;

/** Breite und Länge eines lokalen Punkts für den Fake-Sync oben. */
function geo(x: number, z: number): { lat: number; lon: number } {
  return { lat: z / METERS_PER_DEGREE_LAT, lon: -x / METERS_PER_DEGREE_LAT };
}

function fakeDevTerrain(): TerrainProvider {
  return {
    getHeightAtGeo: vi.fn(() => 11),
    getHeightAtLocal: vi.fn(() => 7),
    hasLineOfSightBlocked: vi.fn(() => true),
  } as unknown as TerrainProvider;
}

function setup() {
  const group = new Group();
  const activeTiles = new Set<FakeTile>();
  const tilesRenderer = { group, activeTiles } as unknown as TilesRenderer;
  let tiles: TilesRenderer | null = tilesRenderer;
  let devTerrain: TerrainProvider | null = null;
  const queries = new TerrainQueries(sync, { tiles: () => tiles, devTerrain: () => devTerrain });

  /** Hängt `mesh` als aktive Tile der Tiefe `depth` in die Tiles-Gruppe. */
  const addTile = (mesh: Mesh, depth: number, geometricError: number): FakeTile => {
    const tile: FakeTile = { internal: { depth }, geometricError, engineData: { scene: mesh } };
    mesh.userData['tile'] = tile;
    group.add(mesh);
    group.updateMatrixWorld(true);
    activeTiles.add(tile);
    return tile;
  };

  // Jeder intersectObject() auf die Gruppe ruft genau einmal group.raycast.
  const rays = vi.spyOn(group, 'raycast');

  return {
    queries, group, activeTiles, addTile, rays,
    useDevWorld: () => {
      tiles = null;
      devTerrain = fakeDevTerrain();
      return devTerrain;
    },
    dropTiles: () => { tiles = null; },
  };
}

describe('TerrainQueries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('columnCacheKey()', () => {
    it('fasst Punkte derselben 0,5-m-Säule zusammen', () => {
      expect(columnCacheKey(0.1, 0.1)).toBe(columnCacheKey(0.2, 0.2));
      expect(columnCacheKey(10.1, -3.9)).toBe(columnCacheKey(10.2, -4.2));
    });

    it('trennt Nachbarsäulen und Vorzeichen', () => {
      expect(columnCacheKey(0.3, 0)).not.toBe(columnCacheKey(0, 0));
      expect(columnCacheKey(-1, 0)).not.toBe(columnCacheKey(1, 0));
      expect(columnCacheKey(1, -1)).not.toBe(columnCacheKey(-1, 1));
    });

    it('ist auf einem Raster von -20 m bis 20 m eindeutig', () => {
      const keys = new Set<number>();
      for (let xi = -40; xi <= 40; xi++) {
        for (let zi = -40; zi <= 40; zi++) keys.add(columnCacheKey(xi / 2, zi / 2));
      }
      expect(keys.size).toBe(81 * 81);
    });
  });

  describe('sampleColumn()', () => {
    it('liest Boden und Oberkante aus der feinsten LOD, nicht aus der groben Hülle', () => {
      const { queries, addTile } = setup();
      addTile(floor(25, 100), 1, 40);
      addTile(floor(2), 3, 2);
      addTile(floor(12, 4), 3, 2);

      const sample = queries.sampleColumn(0, 0);
      expect(sample?.groundY).toBeCloseTo(2, 6);
      expect(sample?.topY).toBeCloseTo(12, 6);
      expect(sample?.tileDepth).toBe(3);
      expect(sample?.tileGeometricError).toBe(2);
    });

    it('kostet pro 0,5-m-Säule nur einen Strahl', () => {
      const { queries, addTile, rays } = setup();
      addTile(floor(2), 3, 2);

      const first = queries.sampleColumn(1, 1);
      expect(queries.sampleColumn(1.1, 0.9)).toBe(first);
      expect(rays).toHaveBeenCalledTimes(1);

      queries.sampleColumn(3, 3);
      expect(rays).toHaveBeenCalledTimes(2);
    });

    it('stempelt nach einem Tile-Wechsel ohne feinere Daten nur um, ohne neuen Strahl', () => {
      const { queries, addTile, rays } = setup();
      addTile(floor(2), 3, 2);
      const first = queries.sampleColumn(0, 0);

      queries.markTileSetChanged();
      expect(queries.lodVersion).toBe(1);
      expect(queries.sampleColumn(0, 0)).toBe(first);
      expect(rays).toHaveBeenCalledTimes(1);
    });

    it('raycastet erst nach dem Tile-Wechsel neu, und nur wenn feinere Daten da sind', () => {
      const { queries, addTile, rays } = setup();
      addTile(floor(5), 2, 8);
      expect(queries.sampleColumn(0, 0)?.groundY).toBeCloseTo(5, 6);

      addTile(floor(3), 4, 1);
      // Ohne gemeldeten Tile-Wechsel bleibt der Cache.
      expect(queries.sampleColumn(0, 0)?.groundY).toBeCloseTo(5, 6);
      expect(rays).toHaveBeenCalledTimes(1);

      queries.markTileSetChanged();
      const refined = queries.sampleColumn(0, 0);
      expect(rays).toHaveBeenCalledTimes(2);
      expect(refined?.groundY).toBeCloseTo(3, 6);
      expect(refined?.tileDepth).toBe(4);
    });

    it('clearHeightCache() erzwingt den nächsten Strahl', () => {
      const { queries, addTile, rays } = setup();
      addTile(floor(2), 3, 2);
      queries.sampleColumn(0, 0);

      queries.clearHeightCache();
      queries.sampleColumn(0, 0);
      expect(rays).toHaveBeenCalledTimes(2);
      expect(queries.lodVersion).toBe(0);
    });

    it('cacht keinen Fehlschlag', () => {
      const { queries, addTile, rays, dropTiles } = setup();
      addTile(floor(2, 10), 3, 2);

      expect(queries.sampleColumn(50, 50)).toBeNull();
      expect(queries.sampleColumn(50, 50)).toBeNull();
      expect(rays).toHaveBeenCalledTimes(2);

      dropTiles();
      expect(queries.sampleColumn(1, 1)).toBeNull();
      expect(rays).toHaveBeenCalledTimes(2);
    });

    it('schießt ohne aktive Tiles keinen Strahl', () => {
      const { queries, rays } = setup();
      expect(queries.sampleColumn(0, 0)).toBeNull();
      expect(rays).not.toHaveBeenCalled();
    });

    it('fragt in DevWorld den DevTerrainProvider', () => {
      const { queries, useDevWorld } = setup();
      const devTerrain = useDevWorld();

      expect(queries.sampleColumn(4, 5)).toEqual({ groundY: 7, topY: 7, tileDepth: 99, tileGeometricError: 0 });
      expect(devTerrain.getHeightAtLocal).toHaveBeenCalledWith(4, 5);
    });
  });

  describe('peekBestTileLODAtLocal()', () => {
    it('meldet die feinste aktive Tile über dem Punkt, ohne Strahl', () => {
      const { queries, addTile, rays } = setup();
      addTile(floor(0, 100), 1, 30);
      addTile(floor(0, 10, 20, 0), 3, 3);

      expect(queries.peekBestTileLODAtLocal(20, 0)).toEqual({ depth: 3, geometricError: 3 });
      expect(queries.peekBestTileLODAtLocal(0, 0)).toEqual({ depth: 1, geometricError: 30 });
      expect(queries.peekBestTileLODAtLocal(500, 0)).toBeNull();
      expect(rays).not.toHaveBeenCalled();
    });

    it('übergeht Tiles, die nicht mehr aktiv sind', () => {
      const { queries, addTile, activeTiles } = setup();
      addTile(floor(0, 100), 1, 30);
      const fine = addTile(floor(0, 10, 20, 0), 3, 3);

      activeTiles.delete(fine);
      expect(queries.peekBestTileLODAtLocal(20, 0)).toEqual({ depth: 1, geometricError: 30 });
    });

    it('nimmt die Bounds neu, wenn die Tiles-Gruppe verschoben wurde', () => {
      const { queries, addTile, group } = setup();
      addTile(floor(0, 100), 1, 30);
      addTile(floor(0, 10, 20, 0), 3, 3);
      expect(queries.peekBestTileLODAtLocal(20, 0)).toEqual({ depth: 3, geometricError: 3 });

      group.position.x = 100;
      group.updateMatrixWorld(true);
      expect(queries.peekBestTileLODAtLocal(20, 0)).toBeNull();
      expect(queries.peekBestTileLODAtLocal(120, 0)).toEqual({ depth: 3, geometricError: 3 });
    });

    it('meldet in DevWorld eine synthetische Top-LOD', () => {
      const { queries, useDevWorld } = setup();
      useDevWorld();
      expect(queries.peekBestTileLODAtLocal(0, 0)).toEqual({ depth: 99, geometricError: 0 });
    });
  });

  describe('measureStreetClearance()', () => {
    const FINE = 2;

    /** Straße bei y=0 zwischen einer Wand 3 m links und einer 4 m rechts (Fahrtrichtung -Z). */
    function street() {
      const world = setup();
      world.addTile(floor(0), 3, FINE);
      world.addTile(wall(-3), 3, FINE);
      world.addTile(wall(4), 3, FINE);
      return world;
    }

    it('misst pro Strahlhöhe den Abstand zur ersten feinen Wand auf beiden Seiten', () => {
      const { queries } = street();
      const probe = queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10);

      expect(probe?.unmeasured).toBeNull();
      expect(probe?.tileError).toBe(FINE);
      expect(probe?.left.map((d) => +d.toFixed(6))).toEqual([3, 3]);
      expect(probe?.right.map((d) => +d.toFixed(6))).toEqual([4, 4]);
    });

    it('meldet ein niedriges Hindernis nur am unteren Strahl', () => {
      const { queries, addTile } = street();
      addTile(wall(2, 2), 3, FINE);
      const probe = queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10);
      expect(probe?.right.map((d) => +d.toFixed(6))).toEqual([2, 4]);
    });

    it('misst hinter einem Treffer nur des unteren Strahls, wie hoch der Boden dort liegt', () => {
      // Straße bei y=0 bis x=3, dort die Flanke eines Autos (1,5 m), sein Dach bis x=5, ohne Boden darunter.
      const car = setup();
      car.addTile(floor(0, 6), 3, FINE);
      car.addTile(wall(3, 1.5), 3, FINE);
      car.addTile(floor(1.5, 2, 4, 0), 3, FINE);
      const probe = car.queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10)!;
      expect(probe.right.map((d) => +d.toFixed(6))).toEqual([3, 10]);
      expect(probe.lowRise?.right).toBeCloseTo(1.5, 6);
      // Links trifft kein Strahl: nichts zu beurteilen.
      expect(probe.lowRise?.left).toBeNaN();

      // Ein Zaun 1,2 m hoch, dahinter Boden auf Straßenhöhe.
      const fence = setup();
      fence.addTile(floor(0), 3, FINE);
      fence.addTile(wall(3, 1.2), 3, FINE);
      expect(fence.queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10)!.lowRise?.right).toBeCloseTo(0, 6);
    });

    it('zählt hinter dem Treffer das Dach eines Autos, das das Mesh hohl gemacht hat, nicht die Straße darunter (Playtest 727)', () => {
      // Wie oben, aber die Straße läuft unter dem Auto durch: die Säule dahinter trifft Dach (1,5 m) und Straße (0).
      const car = setup();
      car.addTile(floor(0), 3, FINE);
      car.addTile(wall(3, 1.5), 3, FINE);
      car.addTile(floor(1.5, 2, 4, 0), 3, FINE);
      const probe = car.queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10)!;
      expect(probe.right.map((d) => +d.toFixed(6))).toEqual([3, 10]);
      expect(probe.lowRise?.right).toBeCloseTo(1.5, 6);
      expect(probeLowWall(probe, 'right')).toBe(true);

      // Ein Zaun vor einem Vordach 3,2 m über dem Boden dahinter: das Vordach zählt nicht.
      const awning = setup();
      awning.addTile(floor(0), 3, FINE);
      awning.addTile(wall(3, 1.2), 3, FINE);
      awning.addTile(floor(3.2, 2, 4, 0), 3, FINE);
      expect(awning.queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10)!.lowRise?.right).toBeCloseTo(0, 6);
    });

    it('beurteilt nichts, wo beide Strahlen treffen, und nichts auf einem Deck', () => {
      expect(street().queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10)!.lowRise).toEqual({ left: NaN, right: NaN });

      // Auf dem Deck (y=6) ein Hindernis 1,5 m hoch, 1,5 m rechts: die Säule dahinter träfe den Boden unter der Brücke.
      const { queries, addTile } = street();
      addTile(floor(6, 4), 3, FINE);
      addTile(wall(1.5, 7.5, 6), 3, FINE);
      const onDeck = queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10, true)!;
      expect(onDeck.right.map((d) => +d.toFixed(6))).toEqual([1.5, 4]);
      expect(onDeck.lowRise).toEqual({ left: NaN, right: NaN });
    });

    it('beurteilt ein Auto auf der Strecke hinter dem Brückenende mit dem Boden der Station (deckEnd)', () => {
      const car = setup();
      car.addTile(floor(0, 6), 3, FINE);
      car.addTile(wall(3, 1.5), 3, FINE);
      car.addTile(floor(1.5, 2, 4, 0), 3, FINE);
      const probe = car.queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10, false, { path: [{ x: 0, z: 1 }, { x: 0, z: 0 }], m: 1 })!;
      expect(probe.right.map((d) => +d.toFixed(6))).toEqual([3, 10]);
      expect(probe.lowRise?.right).toBeCloseTo(1.5, 6);
      expect(probe.lowRise?.left).toBeNaN();
      expect(probeLowWall(probe, 'right')).toBe(true);
    });

    it('misst hinter dem Brückenende über einem Hohlraum unter der Straße von der Straße aus (Place de Varsovie, Pick A)', () => {
      // Die Straße auf 3 m; unter der Station im selben Tile eine Fläche auf 0 m bis x = 2, dort ihre Kante bis 3 m hoch.
      const world = setup();
      world.addTile(floor(3), 3, FINE);
      world.addTile(floor(0, 4), 3, FINE);
      world.addTile(wall(2, 3), 3, FINE);
      // Als Bodenstation vom Hohlraum aus: der untere Strahl trifft dessen Kante, dahinter liegt die Straße 3 m höher, eine niedrige Wand.
      const ground = world.queries.measureStreetClearance(0, 0, 1, 0, [1, 3.5], 10)!;
      expect(ground.right.map((d) => +d.toFixed(6))).toEqual([2, 10]);
      expect(probeLowWall(ground, 'right')).toBe(true);
      // Auf der Strecke hinter dem Brückenende von der Straße aus: frei.
      const off = world.queries.measureStreetClearance(0, 0, 1, 0, [1, 3.5], 10, false, { path: [{ x: 0, z: 1.5 }, { x: 0, z: 0 }], m: 1.5 })!;
      expect(off.right.map((d) => +d.toFixed(6))).toEqual([10, 10]);
      expect(probeLowWall(off, 'right')).toBe(false);
    });

    it('misst auf der Fortsetzung eines Decks von der Höhe, auf der ihre Zellen stehen (surfaceY)', () => {
      // Deck (y=6) über der Straße, auf ihm eine Wand 2 m rechts; darunter rechts die Wand bei 4 m.
      const { queries, addTile } = street();
      addTile(floor(6, 4), 3, FINE);
      addTile(wall(2, 10, 5), 3, FINE);
      // Das Brückenende auf dem Deck: die Route trägt das Deck bis hier, die Strahlen gehen über das Deck.
      const onDeck = queries.measureStreetClearance(0, 0, 1, 0, [1], 10, false, { path: [{ x: 0, z: 1.5 }, { x: 0, z: 0 }], m: 1.5 });
      expect(onDeck?.right.map((d) => +d.toFixed(6))).toEqual([2]);
      // Das Brückenende 6 m tiefer, die Route von dort auf der Straße: die Säule behält ihren Boden.
      const below = queries.measureStreetClearance(0, 0, 1, 0, [1], 10, false, { path: [{ x: 0, z: 10 }, { x: 0, z: 0 }], m: 10 });
      expect(below?.right.map((d) => +d.toFixed(6))).toEqual([4]);
    });

    it('lässt eine Station auf der Fortsetzung ungemessen, solange das Brückenende keine feine Säule hat', () => {
      const { queries } = street();
      expect(queries.measureStreetClearance(0, 0, 1, 0, [1], 10, false, { path: [{ x: 100, z: 100 }, { x: 0, z: 0 }], m: 141 })).toEqual({
        unmeasured: 'no bridge end', tileError: FINE, left: [], right: [],
      });
    });

    it('kostet für ein Hindernis nur am unteren Strahl eine Säule mehr', () => {
      const { queries, addTile, group } = street();
      addTile(wall(2, 2), 3, FINE);
      instrumentRaycasts(group);
      raycastStats.reset();

      queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10);
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'routeCorridor', calls: 6 },
      ]);
    });

    it('übergeht Treffer grober Tiles und Treffer ohne Tile-Tiefe', () => {
      const { queries, addTile } = street();
      addTile(wall(1), 1, corridorConfig.maxTileError + 15);
      addTile(wall(1.5), 0, FINE);
      const probe = queries.measureStreetClearance(0, 0, 1, 0, [1], 10);
      expect(probe?.right.map((d) => +d.toFixed(6))).toEqual([4]);
    });

    it('deckelt auf maxDistance', () => {
      const { queries } = street();
      const probe = queries.measureStreetClearance(0, 0, 1, 0, [1], 2.5);
      expect(probe?.left).toEqual([2.5]);
      expect(probe?.right).toEqual([2.5]);
    });

    it('misst auf einer Brücke von der Oberkante der Säule aus (onDeck)', () => {
      const { queries, addTile } = street();
      addTile(floor(6, 4), 3, FINE);
      addTile(wall(2, 10, 5), 3, FINE);

      const below = queries.measureStreetClearance(0, 0, 1, 0, [1], 10, false);
      const onDeck = queries.measureStreetClearance(0, 0, 1, 0, [1], 10, true);
      expect(below?.right.map((d) => +d.toFixed(6))).toEqual([4]);
      expect(onDeck?.right.map((d) => +d.toFixed(6))).toEqual([2]);
    });

    it('meldet eine Station ohne Tile als ungemessen', () => {
      const { queries } = street();
      expect(queries.measureStreetClearance(100, 100, 1, 0, [1], 10)).toEqual({
        unmeasured: 'no tile', tileError: Infinity, left: [], right: [],
      });
    });

    it('misst eine Station auf einer Naht zwischen zwei Tiles aus der Säule einen halben Meter weiter', () => {
      // Zwei Boden-Tiles mit 10 cm Fuge bei z = 0, quer zur Fahrtrichtung -Z.
      const world = setup();
      world.addTile(floor(0, 19.9, 0, -10), 3, FINE);
      world.addTile(floor(0, 19.9, 0, 10), 3, FINE);
      world.addTile(wall(-3), 3, FINE);
      world.addTile(wall(4), 3, FINE);
      expect(world.queries.sampleColumn(0, 0)).toBeNull();

      const probe = world.queries.measureStreetClearance(0, 0, 1, 0, [1], 10);
      expect(probe?.unmeasured).toBeNull();
      expect(probe?.shiftM).toBe(0.5);
      expect(probe?.left.map((d) => +d.toFixed(6))).toEqual([3]);
      expect(probe?.right.map((d) => +d.toFixed(6))).toEqual([4]);
      // Ohne Fuge bleibt die Station, wo sie ist.
      expect(street().queries.measureStreetClearance(0, 0, 1, 0, [1], 10)).not.toHaveProperty('shiftM');
    });

    it('probiert ohne Tile höchstens zwei weitere Säulen', () => {
      const { queries, group } = street();
      instrumentRaycasts(group);
      raycastStats.reset();
      expect(queries.measureStreetClearance(100, 100, 1, 0, [1], 10)?.unmeasured).toBe('no tile');
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'routeCorridor', calls: 3 },
      ]);
    });

    it('meldet eine Station über einer zu groben Tile als ungemessen', () => {
      const { queries, addTile } = setup();
      const coarse = corridorConfig.maxTileError + 15;
      addTile(floor(0), 3, coarse);
      expect(queries.measureStreetClearance(0, 0, 1, 0, [1], 10)).toEqual({
        unmeasured: 'coarse tile', tileError: coarse, left: [], right: [],
      });
    });

    it('liefert null ohne Querrichtung, ohne Tiles und in DevWorld', () => {
      const world = street();
      expect(world.queries.measureStreetClearance(0, 0, 0, 0, [1], 10)).toBeNull();

      world.dropTiles();
      expect(world.queries.measureStreetClearance(0, 0, 1, 0, [1], 10)).toBeNull();

      const dev = street();
      dev.useDevWorld();
      expect(dev.queries.measureStreetClearance(0, 0, 1, 0, [1], 10)).toBeNull();
    });

    it('bucht Säule und Seitenstrahlen einer Station auf routeCorridor', () => {
      const { queries, group } = street();
      instrumentRaycasts(group);
      raycastStats.reset();

      queries.measureStreetClearance(0, 0, 1, 0, [1, 3], 10);
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'routeCorridor', calls: 5 },
      ]);
    });
  });

  describe('Höhenabfragen', () => {
    it('getTerrainHeightAtGeo() liest den Boden unter dem Geo-Punkt und bucht auf heightAtGeo', () => {
      const { queries, addTile, group } = setup();
      addTile(floor(4, 10, 15, -8), 3, 2);
      instrumentRaycasts(group);
      raycastStats.reset();

      const { lat, lon } = geo(15, -8);
      expect(queries.getTerrainHeightAtGeo(lat, lon)).toBeCloseTo(4, 6);
      expect(queries.getTerrainHeightAtGeo(0, 0)).toBeNull();
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'heightAtGeo', calls: 2 },
      ]);
    });

    it('raycastTerrainHeight() bucht auf den übergebenen Aufrufer', () => {
      const { queries, addTile, group } = setup();
      addTile(floor(4), 3, 2);
      instrumentRaycasts(group);
      raycastStats.reset();

      expect(queries.raycastTerrainHeight(1, 1, 'towerRange')).toBeCloseTo(4, 6);
      expect(raycastStats.rows().map(({ caller }) => caller)).toEqual(['towerRange']);
    });

    it('raycastColumnSample() liefert Boden und oberste Fläche der Säule und bucht auf den Aufrufer', () => {
      const { queries, addTile, group } = setup();
      addTile(floor(4), 3, 2);
      addTile(floor(9, 10), 3, 2);
      instrumentRaycasts(group);
      raycastStats.reset();

      const underDeck = queries.raycastColumnSample(1, 1, 'towerFootprint')!;
      expect(underDeck.groundY).toBeCloseTo(4, 6);
      expect(underDeck.topY).toBeCloseTo(9, 6);
      const open = queries.raycastColumnSample(8, 8, 'towerFootprint')!;
      expect(open.groundY).toBeCloseTo(4, 6);
      expect(open.topY).toBeCloseTo(4, 6);
      expect(queries.raycastColumnSample(30, 30, 'towerFootprint')).toBeNull();
      expect(raycastStats.rows().map(({ caller }) => caller)).toEqual(['towerFootprint']);
    });

    it('fragt in DevWorld den DevTerrainProvider nach der Geo-Höhe', () => {
      const { queries, useDevWorld } = setup();
      const devTerrain = useDevWorld();
      expect(queries.getTerrainHeightAtGeo(1, 2)).toBe(11);
      expect(devTerrain.getHeightAtGeo).toHaveBeenCalledWith(1, 2);
    });

    describe('getGroundHeightEstimate()', () => {
      // Weg nach Norden durch den Origin, die Querproben liegen auf der X-Achse.
      const prev = geo(0, -10);
      const next = geo(0, 10);

      it('nimmt das seitliche Minimum, wenn die Mitte mehr als 3 m über ihm liegt', () => {
        const { queries, addTile } = setup();
        // Boden links und rechts, in der Mitte nur ein Dach 8 m hoch.
        addTile(floor(0, 19, -10.5, 0), 3, 2);
        addTile(floor(0, 19, 10.5, 0), 3, 2);
        addTile(floor(8, 2), 3, 2);

        expect(queries.getTerrainHeightAtGeo(0, 0)).toBeCloseTo(8, 6);
        expect(queries.getGroundHeightEstimate(0, 0, prev.lat, prev.lon, next.lat, next.lon)).toBeCloseTo(0, 6);
      });

      it('behält die Mitte, wenn die Querproben auf gleicher Höhe liegen (Brückendeck)', () => {
        const { queries, addTile } = setup();
        addTile(floor(5), 3, 2);
        expect(queries.getGroundHeightEstimate(0, 0, prev.lat, prev.lon, next.lat, next.lon)).toBeCloseTo(5, 6);
      });

      it('behält die Mitte ohne Wegrichtung und in DevWorld', () => {
        const world = setup();
        world.addTile(floor(0, 19, -10.5, 0), 3, 2);
        world.addTile(floor(0, 19, 10.5, 0), 3, 2);
        world.addTile(floor(8, 2), 3, 2);
        expect(world.queries.getGroundHeightEstimate(0, 0, 0, 0, 0, 0)).toBeCloseTo(8, 6);

        const dev = setup();
        dev.useDevWorld();
        expect(dev.queries.getGroundHeightEstimate(0, 0, prev.lat, prev.lon, next.lat, next.lon)).toBe(11);
      });
    });

    describe('getStreetHeightEstimate()', () => {
      // Weg nach Norden, die Querproben liegen auf der X-Achse.
      const prev = geo(0, -10);
      const next = geo(0, 10);
      const at = (x: number, z: number, deck: Parameters<TerrainQueries['getStreetHeightEstimate']>[6]) => {
        const { lat, lon } = geo(x, z);
        return (queries: TerrainQueries) => queries.getStreetHeightEstimate(lat, lon, prev.lat, prev.lon, next.lat, next.lon, deck);
      };

      /** Kai auf 0 m, darüber ein Deck auf 9 m von x -5 bis 5 und z -5 bis 5. */
      function quay() {
        const world = setup();
        world.addTile(floor(0, 40), 3, 2);
        world.addTile(floor(9, 10), 3, 2);
        return world;
      }

      it('nimmt auf einem Brücken-Way das Deck statt des Kais darunter', () => {
        const { queries } = quay();
        expect(at(0, 0, 'bridge')(queries)).toBeCloseTo(9, 6);
        expect(at(0, 0, null)(queries)).toBeCloseTo(0, 6);
      });

      /** Der Weg vom Brückenende (x0, z0) gerade zum Punkt (x, z). */
      const from = (x0: number, z0: number, x: number, z: number) => ({ path: [geo(x0, z0), geo(x, z)], m: Math.hypot(x - x0, z - z0) });

      it('nimmt hinter dem Brückenende die Höhe, die der Weg von dort trägt', () => {
        const { queries } = quay();
        // Brückenende bei z = -4, der Punkt 7 m weiter nördlich noch über dem Kai.
        expect(at(0, 3, from(0, -4, 0, 3))(queries)).toBeCloseTo(9, 6);
        // Um die Ecke, noch über dem Kai.
        expect(at(4, 0, { path: [geo(0, -4), geo(0, 0), geo(4, 0)], m: 8 })(queries)).toBeCloseTo(9, 6);
        // Über dem offenen Kai hinter dem Deck: kein Deck, der Boden.
        expect(at(0, 8, from(0, -4, 0, 8))(queries)).toBeCloseTo(0, 6);
        // Ohne Säule am Brückenende: wie überall.
        expect(at(0, 3, from(90, 90, 0, 3))(queries)).toBeCloseTo(0, 6);
      });

      it('lässt eine Straße auf Deckhöhe unter einer Krone am Boden', () => {
        const { queries, addTile } = setup();
        addTile(floor(0, 40), 3, 2);
        // Krone 8 m über der Straße bei x = 10; das Brückenende auf der Straße.
        addTile(floor(8, 2, 10, 0), 3, 2);
        expect(at(10, 0, from(10, -10, 10, 0))(queries)).toBeCloseTo(0, 6);
      });

      it('nimmt unter einem Schild weit über dem Deck die getragene Höhe, wie eine Zelle auf der Mittellinie', () => {
        const { queries, addTile } = quay();
        // Ein Schild 8 m über dem Deck bei z = 2; der Kai liegt 9 m unter dem Deck, weiter weg als das Schild.
        addTile(floor(17, 1, 0, 2), 3, 2);
        expect(at(0, 2, from(0, -4, 0, 2))(queries)).toBeCloseTo(9, 6);
      });

      // Playtest 2026-09-15, Erlenbach (D2): eine Straße unter einem Autobahndeck, das die Photogrammetrie bis zum Boden füllt.
      it('nimmt unter einem anderen Way die Höhe zwischen dem Boden an den beiden Portalen', () => {
        const { queries, addTile } = setup();
        // Portal bei z = -10 auf 0 m, Portal bei z = 10 auf 2 m, dazwischen ein Deck auf 6 m ohne Boden darunter.
        addTile(floor(0, 10, 0, -10), 3, 2);
        addTile(floor(2, 10, 0, 10), 3, 2);
        addTile(floor(6, 10), 3, 2);
        const under = { portals: [geo(0, -10), geo(0, 10)] as const, f: 0.5, wayId: 900 };
        expect(at(0, 0, under)(queries)).toBeCloseTo(1, 6);
        expect(at(0, 0, null)(queries)).toBeCloseTo(6, 6);
      });
    });

    // Playtest 2026-09-14, Erlenbach: Zellen auf einem Autobahndeck über der
    // Straße, auf der die Route läuft, obwohl Zellen den untersten Treffer nehmen.
    describe('inspectColumn()', () => {
      it('zeigt eine Straße, die nur in einem gröberen Tile als das Deck darüber liegt: die Säule verwirft sie', () => {
        const { queries, addTile } = setup();
        addTile(floor(0), 21, 2);
        addTile(floor(10, 10), 22, 1);
        // Neben der Diagonale der Planes, sonst trifft der Strahl beide Dreiecke.
        queries.sampleColumn(1, 3);

        const column = queries.inspectColumn(1, 3)!;
        expect(column.hits.map((hit) => `${Math.round(hit.y)}@${hit.depth}`)).toEqual(['10@22', '0@21']);
        expect(column.fresh!.groundY).toBeCloseTo(10, 6);
        expect(column.cached!.groundY).toBeCloseTo(10, 6);
      });

      it('zeigt einen Cache, der die Straße aus einem später geladenen Tile gleicher Tiefe nicht kennt', () => {
        const { queries, addTile } = setup();
        addTile(floor(10, 10), 21, 2);
        queries.sampleColumn(1, 3);
        addTile(floor(0), 21, 2);
        queries.markTileSetChanged();

        // Der Cache prüft nur, ob ein besseres LOD da ist.
        expect(queries.sampleColumn(1, 3)!.groundY).toBeCloseTo(10, 6);
        const column = queries.inspectColumn(1, 3)!;
        expect(column.fresh!.groundY).toBeCloseTo(0, 6);
        expect(column.cached!.groundY).toBeCloseTo(10, 6);
      });

      it('gibt ohne Treffer keine, und in DevWorld nichts', () => {
        const world = setup();
        world.addTile(floor(0, 4), 21, 2);
        expect(world.queries.inspectColumn(30, 30)).toEqual({ hits: [], fresh: null, cached: null });
        const dev = setup();
        dev.useDevWorld();
        expect(dev.queries.inspectColumn(0, 0)).toBeNull();
      });
    });
  });

  /**
   * The rays on the ray path of 3d-tiles-renderer itself (LibraryTiles): a
   * real TilesRenderer, its TilesGroup and raycastTraverse. Playtest
   * 2026-09-16, Tokyo (PLAYTEST 745): a cold load, a location change in game
   * and `__corridor.reset()` gave three corridors with the same stations,
   * cells and tile depth and error under every column, and different heights.
   * Two things the library already rules out as the cause are pinned here.
   */
  describe('on the library ray path', () => {
    const queriesOver = (tiles: LibraryTiles) => new TerrainQueries(sync, { tiles: () => tiles.renderer, devTerrain: () => null });

    // What makes the filter on `activeTiles` planned after the playtest a
    // no-op: TilesGroup.raycast ends three's recursion into the group, and
    // raycastTraverse meets active tiles only.
    it('meets no tile that is no longer active, while its scene still fades out in the group', () => {
      const tiles = new LibraryTiles();
      tiles.add(floor(7, 100), 3, 2);
      const leaving = tiles.add(floor(3, 100), 3, 2);
      // TilesFadePlugin holds back setTileVisible(false) until its fade ends:
      // the renderer has deactivated the tile, its scene is still a child.
      tiles.setActive(leaving, false);
      expect(tiles.renderer.group.children).toContain(leaving.engineData.scene);

      const queries = queriesOver(tiles);
      expect(queries.sampleColumn(1, 3)?.groundY).toBeCloseTo(7, 6);
      expect(queries.inspectColumn(1, 3)?.hits.map((hit) => Math.round(hit.y))).toEqual([7]);
      // Through the active floor blocked, through the fading one not.
      expect(queries.raycastLineOfSight(1, 8, 3, 1, 6, 3)).toBe(true);
      expect(queries.raycastLineOfSight(1, 5, 3, 1, 1, 3)).toBe(false);
    });

    // An active tile off screen is parented to the group but not a child of
    // it; TilesGroup.updateMatrixWorld moves it along with the group anyway.
    it('meets a tile active off screen where it is after the group moved, as a new origin moves it', () => {
      const tiles = new LibraryTiles();
      const offScreen = tiles.add(floor(7, 100), 3, 2, { visible: false });
      expect(tiles.renderer.group.children).not.toContain(offScreen.engineData.scene);

      tiles.renderer.group.position.y = -5;
      tiles.renderer.group.updateMatrixWorld();
      expect(queriesOver(tiles).sampleColumn(1, 3)?.groundY).toBeCloseTo(2, 6);
    });
  });

  describe('raycastLineOfSight()', () => {
    it('meldet eine Wand zwischen Turm und Ziel als Blockade und bucht auf lineOfSight', () => {
      const { queries, addTile, group } = setup();
      addTile(wall(5), 3, 2);
      instrumentRaycasts(group);
      raycastStats.reset();

      expect(queries.raycastLineOfSight(0, 2, 0, 10, 2, 0)).toBe(true);
      expect(queries.raycastLineOfSight(0, 2, 0, 4, 2, 0)).toBe(false);
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'lineOfSight', calls: 2 },
      ]);
    });

    it('hält 0,5 m vor dem Ziel an', () => {
      const near = setup();
      near.addTile(wall(9.7), 3, 2);
      expect(near.queries.raycastLineOfSight(0, 2, 0, 10, 2, 0)).toBe(false);

      const far = setup();
      far.addTile(wall(9.4), 3, 2);
      expect(far.queries.raycastLineOfSight(0, 2, 0, 10, 2, 0)).toBe(true);
    });

    it('ist ohne Tiles frei und fragt in DevWorld den Provider', () => {
      const world = setup();
      world.addTile(wall(5), 3, 2);
      world.dropTiles();
      expect(world.queries.raycastLineOfSight(0, 2, 0, 10, 2, 0)).toBe(false);

      const dev = setup();
      const devTerrain = dev.useDevWorld();
      expect(dev.queries.raycastLineOfSight(1, 2, 3, 4, 5, 6)).toBe(true);
      expect(devTerrain.hasLineOfSightBlocked).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6);
    });
  });
});
