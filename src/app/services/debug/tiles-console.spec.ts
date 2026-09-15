import { afterEach, describe, expect, it, vi } from 'vitest';
import { TilesConsole, type TilesConsoleDeps } from './tiles-console';

/** `__tiles.stats()`: the tiles' LOD handle's snapshot and the column cache's lodVersion, as a table. */
describe('TilesConsole', () => {
  const api = () => (globalThis as Record<string, unknown>)['__tiles'] as { stats: () => unknown } | undefined;

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__tiles'];
    vi.restoreAllMocks();
  });

  it('prints the snapshot with the lodVersion, and says so without tiles', () => {
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    let engine: object | null = {
      tilesLodDebug: () => ({ snapshot: () => ({ regionErrorTarget: 5, cameraErrorTarget: 20 }) }),
      terrain: { lodVersion: 7 },
    };
    const tiles = new TilesConsole({ engineInit: { getEngine: () => engine } } as unknown as TilesConsoleDeps);
    tiles.install();

    expect(api()!.stats()).toEqual({ regionErrorTarget: 5, cameraErrorTarget: 20, lodVersion: 7 });
    expect(console.table).toHaveBeenCalledWith({ regionErrorTarget: 5, cameraErrorTarget: 20, lodVersion: 7 });

    engine = null;
    expect(api()!.stats()).toBe('No 3D tiles: no location loaded, or DevWorld.');
  });

  it('removes its own __tiles, not the one of a newer instance', () => {
    const deps = { engineInit: { getEngine: () => null } } as unknown as TilesConsoleDeps;
    const first = new TilesConsole(deps);
    first.install();
    const next = new TilesConsole(deps);
    next.install();
    const newer = api();

    first.uninstall();
    expect(api()).toBe(newer);
    next.uninstall();
    expect(api()).toBeUndefined();
  });
});
