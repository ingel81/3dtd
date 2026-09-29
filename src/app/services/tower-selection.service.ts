import { Injectable, inject } from '@angular/core';
import { Vector3 } from 'three';
import { SimMirror, type TowerChange } from '../sim/client/mirror/sim-mirror';
import { SimClient } from '../sim/client/sim-client.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EngineInitializationService } from './infrastructure/engine-initialization.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { TowerLosViz } from '../utils/tower-los-viz';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import type { Tower } from '../entities/tower.entity';
import type { TowerTypeId } from '../configs/tower-types.config';

/**
 * The selected tower (docs/SIM_WORKER.md: selection is main-thread UI
 * state): the id in the store, the shadow tower the panels read, the ring on
 * the tower renderer and the selection's line-of-sight view. The store's
 * `selectedTower` is the only path; nothing goes through the simulation.
 *
 * The view is built from the shadow tower and the main thread's grid, and
 * rebuilt when the mirror reports the tower changed (line of sight resolved,
 * range upgrade, retrofit); a sold tower drops the selection, and so does a
 * new run, whose cleared mirror reports no tower gone.
 */
@Injectable({ providedIn: 'root' })
export class TowerSelectionService {
  private readonly store = inject(TowerDefenseStore);
  private readonly mirror = inject(SimMirror);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly grid = inject(GlobalRouteGridService);
  private readonly sim = inject(SimClient);

  private viz: TowerLosViz | null = null;
  /** Per-tower LOS filter of the view (UIStore.perTowerLosFilter), kept for the next one built */
  private losFilterMode: 'both' | 'ground' | 'air' = 'both';

  constructor() {
    this.mirror.onTowerChange((change) => this.onTowerChange(change));
    // The store may have dropped the selection on this reset already (resetGameState), the view is still here
    this.sim.bus.onLive('game:reset', () => {
      this.select(null);
      this.disposeViz();
    });
  }

  /** The selected tower's id, null for none */
  get selectedId(): string | null {
    return this.store.selectedTowerId();
  }

  /**
   * Select tower `id`, or none. The caller checks the policy
   * (SimMirror.selectableTower); an id the mirror does not have selects none.
   */
  select(id: string | null): void {
    const current = this.store.selectedTower();
    const next = id ? this.mirror.tower(id) : null;
    if (current === next) return;
    const engine = this.engineInit.getEngine();
    if (current) {
      current.deselect();
      engine?.towers.deselect(current.id);
    }
    this.disposeViz();
    this.store.selectedTower.set(next);
    if (next) {
      next.select();
      engine?.towers.select(next.id);
      if (next.losReady) this.buildViz(next);
    }
  }

  /** The selection's line-of-sight view, null without one (LOS debug picking) */
  getViz(): TowerLosViz | null {
    return this.viz;
  }

  /** Per frame: the view's pulse */
  tick(timeSeconds: number): void {
    this.viz?.tick(timeSeconds);
  }

  /** The per-tower LOS filter for the view now and the ones built later */
  applyLosFilter(mode: 'both' | 'ground' | 'air'): void {
    this.losFilterMode = mode;
    this.viz?.setFilterMode(mode);
  }

  private onTowerChange(change: TowerChange): void {
    const selected = this.store.selectedTower();
    if (!selected || change.tower.id !== selected.id) return;
    if (change.kind === 'removed') {
      this.select(null);
      return;
    }
    // The same id may come as a new shadow (a replay seeks back)
    if (change.tower !== selected) {
      selected.deselect();
      change.tower.select();
      this.store.selectedTower.set(change.tower);
    }
    this.store.selectedTowerRevision.update((n) => n + 1);
    this.disposeViz();
    if (change.tower.losReady) this.buildViz(change.tower);
  }

  private buildViz(tower: Tower): void {
    const engine = this.engineInit.getEngine();
    if (!engine || !this.grid.isInitialized()) return;
    const config = tower.typeConfig;
    const local = engine.sync.geoToLocalSimple(tower.position.lat, tower.position.lon, tower.position.height ?? 0);
    const towerTip = new Vector3(local.x, local.y + config.heightOffset + config.shootHeight, local.z);
    const range = tower.combat.range;
    const blockerGroup = engine.getLosBlockerGroup();
    if (!blockerGroup) return;
    const cells = this.grid.getCellsInRange(local.x, local.z, range);
    if (cells.length === 0) return;
    this.viz = new TowerLosViz({
      cells,
      towerTip,
      groundRange: range,
      airRange: range,
      canTargetGround: config.canTargetGround ?? true,
      canTargetAir: canTargetAirEffective(
        config.id as TowerTypeId,
        this.mirror.researchOf(tower.ownerId).airTargetingUnlocked,
      ),
      gridCellSize: this.grid.getCellSize(),
      shadowMapper: engine.getTowerShadowMapper(),
      blockerGroup,
    });
    this.viz.setFilterMode(this.losFilterMode);
    this.viz.addTo(engine.getScene());
  }

  private disposeViz(): void {
    this.viz?.dispose();
    this.viz = null;
  }
}
