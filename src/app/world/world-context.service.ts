import { Injectable, computed, inject, signal } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { devWorldRef } from '../devworld/dev-world-provider';
import { DevWorldService } from '../devworld/devworld.service';
import type { WorldCapabilities, WorldLogo, WorldProvider, WorldStreetSource } from './world-provider';
import { WorldProviderRegistry } from './world-provider-registry';
import { customMapRefFromSearch, type WorldRef } from './world-ref';
import { DEFAULT_RUN_RULES, type RunRules } from '../sim/protocol/run-rules';

/** Capabilities of a kind this build has no factory for: nothing; opening it fails with a clear message */
const NO_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: false,
  destructible: false,
  ownEnvironment: false,
  controls: 'environment',
};

/**
 * The world the game plays on: its WorldRef (from the link at the start:
 * `?devworld…`, `?world=map:<id>`, else the 3D tiles of the configured
 * source), what it can do, and once the engine is made, its provider. The
 * one place services reach the world through; nothing else asks which
 * world it is (docs/WORLD_PROVIDER_PLAN.md).
 */
@Injectable({ providedIn: 'root' })
export class WorldContext {
  private readonly registry = inject(WorldProviderRegistry);
  private readonly config = inject(ConfigService);
  private readonly devWorld = inject(DevWorldService);

  /** A world other than the tiles, chosen by the link or later; null: the tiles */
  private readonly chosen = signal<WorldRef | null>(this.refFromUrl());
  private readonly active = signal<WorldProvider | null>(null);

  /** Which world the run plays on; the tiles follow the configured source */
  readonly ref = computed<WorldRef>(() => this.chosen() ?? { kind: 'tiles', source: this.config.tileProvider() });

  /** What the world can do, known before it is made */
  readonly capabilities = computed<WorldCapabilities>(() => this.registry.capabilities(this.ref().kind) ?? NO_CAPABILITIES);

  /** Logos shown beside the map and on photos (tiles: Google, Cesium ion) */
  readonly logos = computed<readonly WorldLogo[]>(() => this.registry.logos(this.ref()));

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

  /** Play another world from the next start on (a coop host's map, the editor's "test map") */
  select(ref: WorldRef): void {
    this.chosen.set(ref.kind === 'tiles' ? null : ref);
  }

  /** The open world's ref changed in place (a DevWorld regeneration): take it over */
  refreshRef(): void {
    const provider = this.active();
    if (provider && provider.ref.kind !== 'tiles') this.chosen.set(provider.ref);
  }

  private refFromUrl(): WorldRef | null {
    if (this.devWorld.inUrl) return devWorldRef(this.devWorld);
    return typeof window === 'undefined' ? null : customMapRefFromSearch(window.location.search);
  }
}
