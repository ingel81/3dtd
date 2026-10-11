import { vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { DEV_WORLD_CAPABILITIES } from '../app/devworld/dev-world-provider';
import { TILES_CAPABILITIES } from '../app/world/tiles/tiles-world';
import { CUSTOM_MAP_CAPABILITIES } from '../app/world/custom-map/custom-map-world';
import type { WorldContext } from '../app/world/world-context.service';
import type { WorldProvider, WorldStreetSource } from '../app/world/world-provider';
import type { WorldRef } from '../app/world/world-ref';
import type { WorldCoverage } from '../app/world/world-coverage';
import { DEFAULT_RUN_RULES } from '../app/sim/protocol/run-rules';

/** The DevWorld ref the fakes use */
export const FAKE_DEV_WORLD_REF: WorldRef = { kind: 'devworld', terrain: 'flat', seed: 42, buildings: 'dense', spawns: 1 };

/**
 * A WorldContext for specs: the tiles by default, `useDevWorld()` switches
 * to DevWorld (ref, capabilities, its HQ at the origin), `useCustomMap()` to
 * a custom map, `streets` is the
 * mock handed in, `provider` what `setProvider` set (a partial is enough).
 */
export function fakeWorldContext(streets: Partial<WorldStreetSource> = {}) {
  const ref = signal<WorldRef>({ kind: 'tiles', source: 'cesium' });
  const provider = signal<WorldProvider | null>(null);
  const coverage = signal<WorldCoverage | null>(null);
  const fake = {
    ref: ref.asReadonly(),
    capabilities: computed(() => {
      const kind = ref().kind;
      return kind === 'tiles' ? TILES_CAPABILITIES : kind === 'custom-map' ? CUSTOM_MAP_CAPABILITIES : DEV_WORLD_CAPABILITIES;
    }),
    logos: computed(() => []),
    runRules: computed(() => DEFAULT_RUN_RULES),
    coverage: coverage.asReadonly(),
    provider: provider.asReadonly(),
    get streets(): WorldStreetSource {
      return streets as WorldStreetSource;
    },
    startHq: vi.fn(() => (ref().kind === 'tiles' ? null : Promise.resolve({ lat: 0, lon: 0 }))),
    open: vi.fn(),
    close: vi.fn(),
    refreshRef: vi.fn(),
    /** Play DevWorld from here on */
    useDevWorld(): void {
      ref.set(FAKE_DEV_WORLD_REF);
    },
    /** Play the custom map `mapId` from here on */
    useCustomMap(mapId: string, name?: string): void {
      ref.set({ kind: 'custom-map', mapId, contentHash: '', ...(name ? { name } : {}) });
    },
    useTiles(): void {
      ref.set({ kind: 'tiles', source: 'cesium' });
    },
    /** Give the world one area (an own tileset's), null: anywhere */
    setCoverage(next: WorldCoverage | null): void {
      coverage.set(next);
    },
    setProvider(next: Partial<WorldProvider> | null): void {
      provider.set(next as WorldProvider | null);
    },
  };
  return fake;
}

export type FakeWorldContext = ReturnType<typeof fakeWorldContext>;

/** The fake as the WorldContext a provider list wants */
export function asWorldContext(fake: FakeWorldContext): WorldContext {
  return fake as unknown as WorldContext;
}

/** The world the specs' saves, replays and packages are played on */
export const TEST_WORLD_REF: WorldRef = { kind: 'tiles', source: 'cesium' };
