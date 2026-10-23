import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { SimClient } from '../../sim/client/sim-client.service';
import { PresentationService } from '../../presentation/presentation.service';
import type { StructureHp } from '../../presentation/world-damage-presenter';
import { clampDebugBlastRadius, DEBUG_BLAST_UP_DM, DEBUG_RADIUS_BLASTS, type DebugBlast, type StructureStage } from '../../configs/destruction.config';
import { ABILITIES } from '../../configs/abilities.config';
import { COLLAPSE_VARIANTS, collapseVariant, setCollapseVariant, type CollapseVariant } from '../../world/custom-map/render/objects/ruin-damage';

/** What a click on the map does while the tool is on: set off a blast there, or pick the structure there */
export type DestructionToolMode = 'blast' | 'pick';

/** The picked structure: its index (run rules' order), the point it was picked at, its HP as last mirrored */
export interface PickedStructure {
  index: number;
  lat: number;
  lon: number;
  hp: StructureHp | null;
}

/**
 * The dev tools' destruction tool (docs/DESTRUCTION_PLAN.md, E261), behind
 * the Destruction window of the developer options on a destructible world.
 * While a mode is on, a left click on the map goes here instead of the game
 * (InputHandlerService): in `blast` it sets off the chosen blast there, in
 * `pick` it picks the structure there, whose stage the window then sets.
 *
 * Everything goes through the simulation as a command (`debug:blast`,
 * `debug:set-structure-stage`), so a coop partner, a replay and a save see
 * the same; the damage is the real one (WorldDamage). The picked
 * structure's HP come from the main thread's mirror (WorldDamagePresenter).
 * A stage is always set from the point the structure was picked at, so
 * "mend, fell" again falls the same way: the hit's heading is from that
 * point to the structure's middle.
 */
@Injectable({ providedIn: 'root' })
export class DestructionToolService {
  private readonly sim = inject(SimClient);
  private readonly presentation = inject(PresentationService);
  private readonly uiStore = inject(UIStore);

  /** What a click does; null: the clicks go to the game */
  readonly mode = signal<DestructionToolMode | null>(null);
  readonly blast = signal<DebugBlast>('rocket');
  /** The radius of a blast that takes one (DEBUG_RADIUS_BLASTS, E284), m; the real strike's to begin with */
  readonly radius = signal(ABILITIES['nuclear-strike'].radiusM);
  readonly picked = signal<PickedStructure | null>(null);
  /** The pick missed: no structure under the click */
  readonly missed = signal(false);
  /** How a building falls (E259, to choose from): every view draws it, `?collapse=sag` in the address starts with one */
  readonly collapse = signal<CollapseVariant>(collapseVariant());

  private unsubscribe: (() => void) | null = null;
  private presenter: unknown = null;

  constructor() {
    const asked = new URLSearchParams(globalThis.location?.search ?? '').get('collapse');
    if (asked && (COLLAPSE_VARIANTS as readonly string[]).includes(asked)) this.setCollapse(asked as CollapseVariant);
    // Build mode takes over the pointer: a blast or a pick on the way lets go, the click places the tower
    effect(() => {
      if (this.uiStore.buildMode() && untracked(() => this.active())) this.setMode(null);
    });
  }

  /** The collapse variant of every fall from now on, the one under way too: a uniform, no program changes */
  setCollapse(v: CollapseVariant): void {
    setCollapseVariant(v);
    this.collapse.set(v);
  }

  /** The chosen blast takes a radius (the window shows its slider) */
  takesRadius(blast: DebugBlast = this.blast()): boolean {
    return DEBUG_RADIUS_BLASTS.includes(blast);
  }

  /** The radius from the slider or its number field, whole metres within DEBUG_BLAST_RADIUS */
  setRadius(radius: number): void {
    this.radius.set(clampDebugBlastRadius(radius));
  }

  /** The tool takes the clicks */
  active(): boolean {
    return this.mode() !== null;
  }

  setMode(mode: DestructionToolMode | null): void {
    this.mode.set(this.mode() === mode ? null : mode);
    this.missed.set(false);
  }

  /**
   * A left click on the map at (`lat`, `lon`, geo `height`) while a mode is on, `up` m over the ground where it
   * struck a wall, a roof or a tree: a projectile's hole goes there (whole dm, debug:blast `up`)
   */
  click(lat: number, lon: number, height: number, up?: number): void {
    const mode = this.mode();
    if (mode === 'blast') {
      const blast = this.blast();
      if (this.takesRadius(blast)) this.sim.bus.emit({ type: 'debug:blast', lat, lon, height, blast, radius: this.radius() });
      else if (up === undefined) this.sim.bus.emit({ type: 'debug:blast', lat, lon, height, blast });
      else this.sim.bus.emit({ type: 'debug:blast', lat, lon, height, blast, up: Math.min(DEBUG_BLAST_UP_DM, Math.max(0, Math.round(up * 10))) });
      return;
    }
    if (mode !== 'pick') return;
    const damage = this.listen();
    const index = damage?.structureAt(lat, lon) ?? -1;
    this.missed.set(index < 0);
    if (index < 0) return;
    this.picked.set({ index, lat, lon, hp: damage?.hpOf(index) ?? null });
  }

  /** The picked structure to `stage` (3: it falls now, 0: mended to full), pushed from where it was picked */
  setStage(stage: StructureStage): void {
    const picked = this.picked();
    if (!picked) return;
    this.sim.bus.emit({ type: 'debug:set-structure-stage', index: picked.index, stage, lat: picked.lat, lon: picked.lon });
  }

  /** Off: the clicks go back to the game, the pick is let go */
  stop(): void {
    this.mode.set(null);
    this.picked.set(null);
    this.missed.set(false);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.presenter = null;
  }

  /** The world's damage presenter, listened to for the picked structure's HP (a new world brings a new one) */
  private listen() {
    const damage = this.presentation.host?.worldDamage ?? null;
    if (damage !== this.presenter) {
      this.unsubscribe?.();
      this.presenter = damage;
      this.unsubscribe = damage?.onHpChanged(() => {
        const picked = this.picked();
        if (picked) this.picked.set({ ...picked, hp: damage.hpOf(picked.index) });
      }) ?? null;
    }
    return damage;
  }
}
