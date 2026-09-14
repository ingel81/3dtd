/**
 * Playtest 169 and 180 of night 1 (docs/REVIEW_SPRINT_2026-09-13.md) replayed.
 *
 * 169: Dev, Dump: the file name carries the place's name instead of
 *      "unknown". The real DebugStateDumpService; the name comes from
 *      LocationManagementService.getLocationDisplayName(), the one the header
 *      shows (TowerDefenseComponent.currentLocationName). The services around
 *      it are stubs, the browser download is a spy on triggerDownload.
 * 180: `__corridor.get()`, then leave the game page: `__corridor` is gone; at
 *      a new place it answers again. The visualization facade is provided by
 *      the game component (tower-defense.component.ts:166), so every game page
 *      has its own facade and CorridorConsole; it installs the console in
 *      initialize() and uninstalls it in dispose() (visualization-facade
 *      .service.ts:191 and :200, both in visualization-facade.service.spec.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { Injector, runInInjectionContext } from '@angular/core';
import { DebugStateDumpService } from './debug-state-dump.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { LocationStore } from '../../store/location.store';
import { UIStore } from '../../store/ui.store';
import {
  LOADING_NAME,
  LocationManagementService,
  NO_LOCATION_NAME,
} from '../location/location-management.service';
import { CameraControlService } from '../camera-control.service';
import { CameraFramingService } from '../camera-framing.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { CorridorConsole, type CorridorConsoleDeps } from './corridor-console';
import { corridorConfig } from '../../utils/route-corridor';

/** The dump service at a place the header names `name`, its download caught */
function dumpAt(name: string) {
  const everyFlagOff = new Proxy({}, { get: () => () => false });
  const injector = Injector.create({
    providers: [
      {
        provide: GlobalRouteGridService,
        useValue: {
          getGrid: () => ({ dumpStats: () => ({}), dumpOutliers: () => [] }),
          isInitialized: () => true,
          getStats: () => ({ totalCells: 0, trackedEnemies: 0, occupiedCells: 0 }),
        },
      },
      {
        provide: LocationStore,
        useValue: {
          baseCoords: () => ({ lat: 49.1427, lon: 9.2109 }),
          centerCoords: () => ({ lat: 49.1427, lon: 9.2109, height: 0 }),
          streetCount: () => 120,
          spawnPoints: () => [{ id: 'spawn-1' }],
        },
      },
      { provide: LocationManagementService, useValue: { getLocationDisplayName: () => name } },
      { provide: UIStore, useValue: everyFlagOff },
      { provide: CameraControlService, useValue: { getInitialView: () => null } },
      { provide: CameraFramingService, useValue: { getLastFrame: () => null } },
      { provide: IntroCameraFlightService, useValue: { debugState: () => ({}), traceCsv: () => '' } },
    ],
  });
  const service = runInInjectionContext(injector, () => new DebugStateDumpService());
  const download = vi
    .spyOn(service as unknown as { triggerDownload(filename: string, content: string): void }, 'triggerDownload')
    .mockImplementation(() => undefined);
  service.dumpAndDownload();
  const [filename, content] = download.mock.calls[0];
  return { filename, snapshot: JSON.parse(content) as { meta: { location: { name: string } } } };
}

describe('Debug tools, playtest 169 and 180 (night 1) replayed', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__corridor'];
    vi.restoreAllMocks();
  });

  it('169: the dump file is named after the place the header shows', () => {
    const { filename, snapshot } = dumpAt('Marktplatz 1, 74072 Heilbronn, Deutschland');
    // Letters, digits, _ and - kept, the rest as _, cut at 40 characters, then the time
    expect(filename).toMatch(/^3dtd-state-Marktplatz_1__74072_Heilbronn__Deutschla-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
    expect(snapshot.meta.location.name).toBe('Marktplatz 1, 74072 Heilbronn, Deutschland');
  });

  it('169: before the name is there the file says what the header says; "unknown" only for an empty name', () => {
    expect(dumpAt(LOADING_NAME).filename).toMatch(/^3dtd-state-Loading___-/);
    expect(dumpAt(NO_LOCATION_NAME).filename).toMatch(/^3dtd-state-No_location-/);
    // getLocationDisplayName() hands out one of the above or an address, never ''
    expect(dumpAt('').filename).toMatch(/^3dtd-state-unknown-/);
  });

  it('180: __corridor goes with the game page and answers again on the next one', () => {
    const api = () => (globalThis as Record<string, unknown>)['__corridor'] as { get: () => Record<string, unknown> } | undefined;
    const deps = { change: vi.fn() } as unknown as CorridorConsoleDeps;

    // The first game page: its facade's initialize()
    const firstPage = new CorridorConsole(deps);
    firstPage.install();
    expect(api()!.get()['maxHalfWidth']).toBe(corridorConfig.maxHalfWidth);

    // Leaving the page disposes the facade
    firstPage.uninstall();
    expect(api()).toBeUndefined();
    expect('__corridor' in globalThis).toBe(false);

    // A new place on a new game page: a new facade, a new console
    const nextPage = new CorridorConsole(deps);
    nextPage.install();
    expect(api()!.get()['maxHalfWidth']).toBe(corridorConfig.maxHalfWidth);
    // A late dispose of the old page leaves it alone
    firstPage.uninstall();
    expect(api()).toBeDefined();
  });
});
