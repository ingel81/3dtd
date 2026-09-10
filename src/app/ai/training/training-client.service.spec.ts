import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrainingClientService, type TrainingDeps } from './training-client.service';
// Durch vi.mock unten ist das der Fake, nicht die echte Session.
import * as mockedSessionModule from './training-session';
import type { ThreeTilesEngine } from '../../three-engine';

// Die echte Session braucht Engine, Store und WebSocket. Hier zählt nur, wann
// der Service sie anlegt und was er an sie weiterreicht.
const sessions = vi.hoisted(() => [] as FakeSession[]);

interface FakeSession {
  enableBot: ReturnType<typeof vi.fn>;
  setEngine: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  connectToBackend: ReturnType<typeof vi.fn>;
}

vi.mock('./training-session', () => ({
  TrainingSession: class {
    readonly enableBot = vi.fn();
    readonly disableBot = vi.fn();
    readonly setEngine = vi.fn();
    readonly connect = vi.fn(async () => true);
    readonly disconnect = vi.fn();
    readonly connectToBackend = vi.fn(async () => undefined);
    constructor() {
      sessions.push(this);
    }
  },
}));

const deps = {} as TrainingDeps;

/** Ersetzt den Chunk-Import des Service, um Ladefehler zu simulieren. */
function setImporter(client: TrainingClientService, importer: () => Promise<unknown>): void {
  (client as unknown as { importSession: () => Promise<unknown> }).importSession = importer;
}

/** Wartet, bis angestoßene dynamische Imports und ihre Folge-Microtasks durch sind. */
async function settle(): Promise<void> {
  await vi.dynamicImportSettled();
  await new Promise(r => setTimeout(r, 0));
}

describe('TrainingClientService', () => {
  let client: TrainingClientService;

  beforeEach(() => {
    sessions.length = 0;
    client = runInInjectionContext(Injector.create({ providers: [] }), () => new TrainingClientService());
  });

  it('loads no session when the game only initialises it', async () => {
    client.initialize(deps);
    await settle();

    expect(sessions).toHaveLength(0);
    expect(client.botEnabled()).toBe(false);
    expect(client.updateBot(() => { throw new Error('no snapshot without a bot'); }, 16)).toBe(false);
  });

  it('keeps a bot requested before initialize() and applies it once the deps arrive', async () => {
    client.enableBot('strategist');
    await settle();
    expect(sessions).toHaveLength(0);

    client.initialize(deps);
    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].enableBot).toHaveBeenCalledWith('strategist');
  });

  it('drops a pending bot request on disableBot()', async () => {
    client.enableBot('casual');
    client.disableBot();
    client.initialize(deps);
    await settle();

    for (const session of sessions) {
      expect(session.enableBot).not.toHaveBeenCalled();
    }
  });

  it('hands an engine set earlier to the session created later', async () => {
    const engine = {} as ThreeTilesEngine;
    client.initialize(deps);
    client.setEngine(engine);
    client.enableBot('strategist');

    await vi.waitFor(() => expect(sessions).toHaveLength(1));
    expect(sessions[0].setEngine).toHaveBeenCalledWith(engine);
  });

  it('rejects wave requests without a session', async () => {
    await expect(client.requestWaveConfig({} as never)).rejects.toThrow('Not connected');
  });

  describe('connection wishes while the chunk loads', () => {
    it('does not connect when disconnect() came during the load', async () => {
      client.initialize(deps);
      const connected = client.connect();
      client.disconnect();

      expect(await connected).toBe(false);
      expect(sessions[0].connect).not.toHaveBeenCalled();
    });

    it('does not run a connectToBackend() cancelled during the load', async () => {
      client.initialize(deps);
      const pending = client.connectToBackend();
      client.disconnect();
      await pending;

      expect(sessions[0].connectToBackend).not.toHaveBeenCalled();
    });

    it('lets the last wish win', async () => {
      client.initialize(deps);
      const first = client.connect();
      client.disconnect();
      const second = client.connect();

      expect(await first).toBe(false);
      expect(await second).toBe(true);
      expect(sessions[0].connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the chunk fails to load', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
      consoleError.mockRestore();
    });

    it('retries and applies the queued bot once a later attempt succeeds', async () => {
      const importer = vi.fn()
        .mockRejectedValueOnce(new Error('chunk 404'))
        .mockResolvedValue(mockedSessionModule);
      setImporter(client, importer);
      client.initialize(deps);
      client.enableBot('strategist');

      await vi.runAllTimersAsync();

      expect(importer).toHaveBeenCalledTimes(2);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].enableBot).toHaveBeenCalledWith('strategist');
      expect(client.sessionError()).toBeNull();
    });

    it('gives up after three attempts, says so, and starts over on the next wish', async () => {
      const importer = vi.fn().mockRejectedValue(new Error('chunk 404'));
      setImporter(client, importer);
      client.initialize(deps);
      client.enableBot('strategist');

      await vi.runAllTimersAsync();

      expect(importer).toHaveBeenCalledTimes(3);
      expect(sessions).toHaveLength(0);
      expect(client.sessionError()).toMatch(/failed to load/);

      importer.mockResolvedValue(mockedSessionModule);
      client.enableBot('strategist');
      await vi.runAllTimersAsync();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].enableBot).toHaveBeenCalledWith('strategist');
      expect(client.sessionError()).toBeNull();
    });
  });
});

// Die Trennung hält nur, solange außerhalb der Session niemand einen Wert aus
// ihr importiert. Ein einziges `import { BOT_CONFIGS }` in einer Facade zieht
// Bots, Strategien und WebSocket-Client wieder in den Spiel-Chunk, und kein
// Build-Budget merkt 35 kB in 1.6 MB.
describe('training chunk boundary', () => {
  const TRAINING_DIR = dirname(fileURLToPath(import.meta.url));
  const APP_DIR = resolve(TRAINING_DIR, '../..');
  const SHELL = join(TRAINING_DIR, 'training-client.service.ts');
  const STATIC_IMPORT = /^\s*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
    });
  }

  it('only the service is imported by value from outside the session tree', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      if (file.startsWith(TRAINING_DIR + sep) && file !== SHELL) continue;
      for (const [, typeOnly, spec] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
        const target = resolve(dirname(file), spec) + '.ts';
        if (typeOnly || !target.startsWith(TRAINING_DIR + sep) || target === SHELL) continue;
        offenders.push(`${relative(APP_DIR, file)} -> ${relative(APP_DIR, target)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
