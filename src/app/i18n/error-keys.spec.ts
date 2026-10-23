import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { en } from './messages/en';
import { de } from './messages/de';
import { MapFileError, MapStoreError } from '../world/custom-map/map-file-kind';
import { OsmError, osmErrorMessage } from '../world/osm/osm-error';
import { mapErrorMessage } from '../world/custom-map/map-text';
import { WorldUnavailableError } from '../world/world-provider-registry';
import { TEST_WORLD_REF } from '../../test/world-context-fake';

/**
 * The errors of map files, the map store and OpenStreetMap carry only their
 * key as `message` (`map-file:notZip`), for the logs (TODO E245). The player
 * and the agents read them worded (osmErrorMessage, mapErrorMessage), also
 * where another error wraps one. No key may reach a screen as it is.
 */
const RAW_KEY = /\b(map-file|map-store|osm):[a-zA-Z]/;

/** A value for every field a sentence reads: a number where one is read, a word where one is joined */
const SAMPLE: unknown = new Proxy({}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 7 : key === 'length' ? 1 : key === 'map' ? (f: (v: unknown) => unknown) => [f(SAMPLE)] : key === 'join' ? () => '7' : SAMPLE),
});

function every(): Error[] {
  const errors: Error[] = [];
  for (const key of Object.keys(en.osm.errors)) errors.push(new OsmError({ key, v: SAMPLE } as never));
  for (const key of Object.keys(en.mapFile.store)) errors.push(new MapStoreError({ key, v: SAMPLE } as never));
  for (const key of [...Object.keys(en.mapFile.errors), 'invalid', 'broken']) errors.push(new MapFileError({ key, v: SAMPLE } as never));
  return errors;
}

describe('error keys never reach the player (TODO E245)', () => {
  it('words every map, store and OpenStreetMap error in every language, also wrapped in another', () => {
    for (const t of [en, de]) {
      for (const error of every()) {
        expect(error.message, 'the message is the key, for the logs').toMatch(RAW_KEY);
        const wrapped = new WorldUnavailableError(TEST_WORLD_REF, error.message, error);
        for (const text of [osmErrorMessage(t, error), osmErrorMessage(t, wrapped)]) {
          expect(text.trim(), error.message).not.toBe('');
          expect(text, error.message).not.toMatch(RAW_KEY);
        }
        if (!(error instanceof OsmError)) expect(mapErrorMessage(t, wrapped), error.message).not.toMatch(RAW_KEY);
      }
    }
  });

  /**
   * Where the code reads a caught error's message as it is. Each place says
   * why no key of these errors can be in it; a new one goes through
   * osmErrorMessage or mapErrorMessage, or into this list with its reason.
   */
  const RAW_READERS: Record<string, string> = {
    'benchmark/benchmark.service.ts': 'developer tool',
    'benchmark/render-benchmark.service.ts': 'developer tool',
    'devworld/devworld.worker.ts': 'DevWorld generation, no map file or store',
    'editor/ops/landscape/template-off-thread.ts': "a worker's ErrorEvent",
    'editor/ops/pour.ts': "a worker's ErrorEvent",
    'editor/services/editor-core.ts': "a worker's ErrorEvent",
    'editor/services/map-lifecycle.ts': 'an EditorHeldError, worded when made',
    'editor/tools/water-tool.ts': 'the pour worker, no map file or store',
    'editor/workers/template.worker.ts': 'a template build, no map file or store',
    'globe/globe-host.ts': "the globe worker's ErrorEvent",
    'globe/globe-runtime.ts': 'the globe, no map file or store',
    'services/debug/corridor-lod-probe.ts': 'developer tool',
    'services/debug/corridor-snapshot.service.ts': 'developer tool',
    'services/facade/map-relocation.service.ts': 'a console line',
    'services/location/geolocation.service.ts': 'a console line',
    'services/location/location-change-coordinator.service.ts': 'debug log lines; the player reads osmErrorMessage',
    'services/location/osm-street.service.ts': 'a test of the message, not shown',
    'services/location/world-dice.service.ts': 'the city list, no map file or store',
    'showreel/game-stage.ts': 'developer tool',
    'sim/client/sim-client.service.ts': "the simulation's failure, no map file or store",
    'sim/worker/sim.worker.ts': "the simulation's failure, no map file or store",
    'three-engine/tile-loading-tracker.ts': 'tile load errors, no map file or store',
    'world/custom-map/map-pack.ts': 'the key goes with its fault; the page builds the MapFileError again',
    'world/custom-map/render/drape/draped-conform-pool.ts': "a worker's ErrorEvent",
    'world/custom-map/map-text.ts': 'mapErrorMessage itself, for any other error',
    'world/custom-map/map-unpack.ts': "a worker's ErrorEvent",
    'world/osm/import-osm.ts': 'a heights or Overpass failure, an English detail inside a worded line',
    'world/osm/overpass-client.ts': "the Overpass servers' own details",
    'world/w3x/jass/jass-parser.ts': "the parser's own warning",
    'world/w3x/jass/lua-parser.ts': "the parser's own warning",
    'world/world-provider-registry.ts': 'kept with its cause, which osmErrorMessage words',
  };

  it('reads a caught error\'s message as it is only where the list says why', () => {
    const app = resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'testing') walk(full);
        } else if (name.endsWith('.ts') && !/\.(spec|scenario|perf|bench)\.ts$/.test(name)) files.push(full);
      }
    };
    walk(app);
    const readers = files
      .filter((f) => /\b(e|err|error|cause|ex|reason)\.message\b/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(app, f).split(sep).join('/'));
    expect(readers.filter((f) => !RAW_READERS[f]), 'word it with osmErrorMessage or mapErrorMessage').toEqual([]);
    expect(Object.keys(RAW_READERS).filter((f) => !readers.includes(f)), 'no longer reads one').toEqual([]);
  });
});
