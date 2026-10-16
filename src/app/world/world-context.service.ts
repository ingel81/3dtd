import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import type { WorldCapabilities, WorldLogo, WorldProvider, WorldStreetSource } from './world-provider';
import { WorldProviderRegistry } from './world-provider-registry';
import type { WorldRef } from './world-ref';
import { WorldStartService } from './world-start';
import { DEFAULT_RUN_RULES, type RunRules } from '../sim/protocol/run-rules';
import type { WorldCoverage } from './world-coverage';

/** Capabilities of a kind this build has no factory for: nothing; opening it fails with a clear message */
const NO_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: false,
  destructible: false,
  ownEnvironment: false,
  enemyRimLight: false,
  groundShadows: false,
  controls: 'environment',
};

/**
 * The world the game plays on: its WorldRef (the start order's,
 * WorldStartService: `?devworld…`, `?world=map:<id>` at the page's start,
 * else the 3D tiles of the configured source), what it can do, and once the engine is made, its provider. The
 * one place services reach the world through; nothing else asks which
 * world it is (docs/WORLD_PROVIDER_PLAN.md).
 */
@Injectable({ providedIn: 'root' })
export class WorldContext {
  private readonly registry = inject(WorldProviderRegistry);
  private readonly config = inject(ConfigService);
  private readonly start = inject(WorldStartService);

  /** A world other than the tiles, the start order's; null: the tiles. A new order sets it anew */
  private readonly chosen = linkedSignal<WorldRef | null>(() => this.start.current().world);
  private readonly active = signal<WorldProvider | null>(null);

  /** Which world the run plays on; the tiles follow the configured source */
  readonly ref = computed<WorldRef>(() => this.chosen() ?? { kind: 'tiles', source: this.config.tileProvider() });

  /** What the world can do, known before it is made */
  readonly capabilities = computed<WorldCapabilities>(() => this.registry.capabilities(this.ref().kind) ?? NO_CAPABILITIES);

  /** Logos shown beside the map and on photos (tiles: Google, Cesium ion) */
  readonly logos = computed<readonly WorldLogo[]>(() => this.registry.logos(this.ref()));

  /** The area the world has ground in, where HQ and spawns may stand; null: anywhere (world-coverage.ts) */
  readonly coverage = computed<WorldCoverage | null>(() => this.registry.coverage(this.ref()));

  /** The run rules of the open world (start credits, HQ health, tower types), the game's without one */
  readonly runRules = computed<RunRules>(() => this.active()?.runRules() ?? DEFAULT_RUN_RULES);

  /** The world's provider while an engine shows it, null before and after */
  readonly provider = this.active.asReadonly();

  /** The streets of the open world; throws before one is open */
  get streets(): WorldStreetSource {
    const provider = this.active();
    if (!provider) throw new Error('No world is open');
    return provider.streets;
  }

  /** The HQ the world brings along, null where the player picks the place (WorldFactory.startHq) */
  startHq(): Promise<{ lat: number; lon: number }> | null {
    return this.registry.startHq(this.ref());
  }

  /**
   * Make the provider of the current ref around `origin`, for a new engine.
   * Throws WorldUnavailableError when the world cannot be made here.
   */
  open(origin: { lat: number; lon: number; height: number }): WorldProvider {
    const provider = this.registry.create(this.ref(), origin);
    this.active.set(provider);
    // A map's ref gets its content hash and name from the opened map
    this.refreshRef();
    return provider;
  }

  /** The engine went away and disposed its world */
  close(): void {
    this.active.set(null);
  }

  /** The open world's ref changed in place (a DevWorld regeneration): take it over */
  refreshRef(): void {
    const provider = this.active();
    if (provider && provider.ref.kind !== 'tiles') this.chosen.set(provider.ref);
  }
}
