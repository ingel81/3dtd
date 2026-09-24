import { modalDialogCount } from '../components/coop-dialog/open-coop-dialog';
import { Injectable, WritableSignal, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { UIStore } from '../store/ui.store';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './world/map-placement.service';
import { isEscapeForDialog } from '../utils/dialog-key-guard';
import { ownsKey } from '../utils/keyboard-target';
import type { AbilityId } from '../configs/abilities.config';
import { screenRect, type ScreenRect } from './debug/cell-report';

/**
 * Callbacks that the component provides for keyboard actions
 * that require component-level context (e.g., Angular-specific operations).
 */
export interface KeyboardCallbacks {
  /** Called when Escape is pressed in build mode */
  exitBuildMode: () => void;
  /** Called when Escape is pressed in map placement mode */
  exitMapPlacement?: () => void;
}

/** What the pointer does for the hero (HeroControlService). */
export interface HeroInputCallbacks {
  /** He is selected: clicks on the ground send him, pointer moves show where */
  selected: () => boolean;
  /** Whether his model lies under the screen point */
  pick: (screenX: number, screenY: number) => boolean;
  /** A click on him: select him, or let him go */
  toggle: () => void;
  /** A click on the ground while he is selected */
  click: (lat: number, lon: number, height: number) => void;
  /** The pointer over the ground while he is selected */
  move: (lat: number, lon: number, hitPoint: THREE.Vector3) => void;
  /** A short right click while he is selected */
  cancel: () => void;
}

/** What the pointer does while the cell report is on (CellReportService). */
export interface CellReportInputCallbacks {
  /** The report is on: a left click on the ground and a Shift + left drag go to it */
  active: () => boolean;
  /** A left click on the ground */
  click: (hitPoint: THREE.Vector3) => void;
  /** The box of a Shift drag so far, client pixels; null once the drag ends */
  drag: (rect: ScreenRect | null) => void;
  /** A Shift drag let go: the cells in the box */
  select: (rect: ScreenRect) => void;
  /** Escape */
  end: () => void;
}

/**
 * InputHandlerService
 *
 * Manages click, mouse, and keyboard input handling for the Tower Defense game.
 * Distinguishes between clicks and pans, handles tower selection and placement,
 * and processes keyboard shortcuts (WASD panning, build mode keys, debug toggles).
 */
@Injectable({ providedIn: 'root' })
export class InputHandlerService {
  // ========================================
  // CONSTANTS
  // ========================================

  /** Minimum pixel distance to distinguish pan from click */
  private readonly PAN_THRESHOLD_PX = 10;

  // ========================================
  // STATE
  // ========================================

  /** Track mouse position to distinguish clicks from pans */
  private mouseDownPos: { x: number; y: number } | null = null;

  /** Track right-click down position — used by contextmenu to detect drag vs click */
  private rightClickDownPos: { x: number; y: number } | null = null;

  /** Track right-click down timestamp — used to distinguish quick click from camera hold */
  private rightClickDownTime = 0;

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Reference to game state manager */
  private readonly store = inject(TowerDefenseStore);

  /** Photo mode and replay (viewOnly): clicks and hover select nothing, the camera still moves */
  private readonly uiStore = inject(UIStore);

  /** Open dialogs own Escape, see isEscapeForDialog */
  private readonly dialog = inject(MatDialog);
  private gameState: GameStateManager | null = null;

  /** Build mode state signal (from TowerPlacementService) */
  private buildModeSignal: WritableSignal<boolean> | null = null;

  /** Canvas element reference */
  private canvas: HTMLCanvasElement | null = null;

  /** Click callback for placement validation */
  private onClickCallback: ((lat: number, lon: number, height: number) => void) | null = null;

  /** Mouse move callback for build preview updates */
  private onMouseMoveCallback: ((lat: number, lon: number, hitPoint: THREE.Vector3) => void) | null = null;

  /** Enemy placement mode signal (from EnemyDebugService) */
  private enemyPlacementModeSignal: (() => boolean) | null = null;

  /** Enemy placement callback */
  private onEnemyPlacementCallback: ((lat: number, lon: number, height: number) => void) | null = null;

  /** Map placement mode signal (HQ/Spawn placement) */
  private mapPlacementModeSignal: (() => 'hq' | 'spawn' | null) | null = null;

  /** Map placement click callback */
  private onMapPlacementClickCallback: ((lat: number, lon: number, height: number) => void) | null = null;

  /** Map placement mouse move callback */
  private onMapPlacementMoveCallback: ((lat: number, lon: number, hitPoint: THREE.Vector3) => void) | null = null;

  /** One-shot debug pick, see armPick. */
  private pickCallback: ((hitPoint: THREE.Vector3) => void) | null = null;

  /** Ability targeting mode: the ability being aimed, or null (AbilityTargetingService) */
  private abilityTargetingSignal: (() => AbilityId | null) | null = null;
  private onAbilityClickCallback: ((lat: number, lon: number, height: number) => void) | null = null;
  private onAbilityMoveCallback: ((lat: number, lon: number, hitPoint: THREE.Vector3) => void) | null = null;
  private onAbilityCancelCallback: (() => void) | null = null;

  /** The hero: picking him, and while he is selected the move click (HeroControlService) */
  private heroInput: HeroInputCallbacks | null = null;

  /** The cell report: its clicks and its Shift drag (CellReportService) */
  private cellReport: CellReportInputCallbacks | null = null;
  /** Where the cell report's Shift drag went down, null while none runs */
  private reportDragStart: { x: number; y: number } | null = null;

  /** Stored event listeners for cleanup */
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private contextMenuHandler: ((event: MouseEvent) => void) | null = null;

  /** Throttle state for pointer move, see handlePointerMove */
  private lastPointerMoveTime = -Infinity;
  private readonly POINTER_MOVE_THROTTLE_MS = 16; // ~60fps max
  /** Trailing move for the last pointer position a throttled move left behind */
  private pointerMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerX = 0;
  private pointerY = 0;

  /** Tower under the pointer outside build and placement mode; its range shows */
  private hoveredTowerId: string | null = null;
  /** A hover pick tests every tower mesh, so at most this often (ms) */
  private readonly HOVER_PICK_INTERVAL_MS = 100;
  private lastHoverPickTime = -Infinity;
  /** Trailing pick for the last pointer position, so a stop right after a pick is not lost */
  private hoverPickTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverX = 0;
  private hoverY = 0;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize input handler service
   * @param canvas Canvas element for event listeners
   * @param engine ThreeTilesEngine instance
   * @param gameState GameStateManager instance
   * @param buildModeSignal Build mode state signal
   * @param onClickCallback Callback for terrain clicks in build mode
   * @param onMouseMoveCallback Callback for mouse move in build mode (receives hitPoint for preview positioning)
   */
  initialize(
    canvas: HTMLCanvasElement,
    engine: ThreeTilesEngine,
    gameState: GameStateManager,
    buildModeSignal: WritableSignal<boolean>,
    onClickCallback: (lat: number, lon: number, height: number) => void,
    onMouseMoveCallback: (lat: number, lon: number, hitPoint: THREE.Vector3) => void
  ): void {
    // Prevent double-init: clean up existing listeners first
    if (this.pointerDownHandler || this.pointerUpHandler || this.pointerMoveHandler) {
      this.dispose();
    }

    this.canvas = canvas;
    this.engine = engine;
    this.gameState = gameState;
    this.buildModeSignal = buildModeSignal;
    this.onClickCallback = onClickCallback;
    this.onMouseMoveCallback = onMouseMoveCallback;

    this.setupClickHandler();
  }

  /**
   * Set up enemy placement mode callback
   * @param placementModeSignal Signal that returns true when in enemy placement mode
   * @param onPlacementCallback Callback for enemy placement clicks
   */
  setEnemyPlacementCallback(
    placementModeSignal: () => boolean,
    onPlacementCallback: (lat: number, lon: number, height: number) => void
  ): void {
    this.enemyPlacementModeSignal = placementModeSignal;
    this.onEnemyPlacementCallback = onPlacementCallback;
  }

  /**
   * Set up map placement mode callbacks (HQ/Spawn placement)
   * @param modeSignal Signal returning 'hq' | 'spawn' | null
   * @param onClickCallback Callback for placement clicks
   * @param onMoveCallback Callback for mouse move (preview updates)
   */
  setMapPlacementCallback(
    modeSignal: () => 'hq' | 'spawn' | null,
    onClickCallback: (lat: number, lon: number, height: number) => void,
    onMoveCallback: (lat: number, lon: number, hitPoint: THREE.Vector3) => void,
  ): void {
    this.mapPlacementModeSignal = modeSignal;
    this.onMapPlacementClickCallback = onClickCallback;
    this.onMapPlacementMoveCallback = onMoveCallback;
  }

  /**
   * Set up the ability targeting mode. While `modeSignal` names an ability,
   * left clicks on the ground and pointer moves go to the callbacks instead of
   * tower selection and building; Escape and a short right click cancel.
   */
  setAbilityTargetingCallback(
    modeSignal: () => AbilityId | null,
    onClickCallback: (lat: number, lon: number, height: number) => void,
    onMoveCallback: (lat: number, lon: number, hitPoint: THREE.Vector3) => void,
    onCancelCallback: () => void,
  ): void {
    this.abilityTargetingSignal = modeSignal;
    this.onAbilityClickCallback = onClickCallback;
    this.onAbilityMoveCallback = onMoveCallback;
    this.onAbilityCancelCallback = onCancelCallback;
  }

  /**
   * Set up the hero's pointer handling. Outside build mode a click on him
   * selects him or lets him go. While he is selected a left click on the
   * ground sends him and pointer moves show where, a click on a tower still
   * selects the tower, and a short right click lets him go.
   */
  setHeroCallbacks(callbacks: HeroInputCallbacks): void {
    this.heroInput = callbacks;
  }

  /**
   * Set up the cell report's pointer handling. While it is on, a left click
   * on the ground goes to it instead of the game (no selection, no
   * building), Shift + left drag draws a box on the screen instead of
   * turning the camera, and Escape ends it. A plain left drag still pans,
   * the right button still turns, the wheel still zooms.
   */
  setCellReportCallbacks(callbacks: CellReportInputCallbacks): void {
    this.cellReport = callbacks;
  }

  /**
   * Hand the next left click on the ground to `callback` instead of the
   * game, once: no tower selection, no building. For `__corridor.pick()`.
   */
  armPick(callback: (hitPoint: THREE.Vector3) => void): void {
    this.pickCallback = callback;
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  /**
   * Set up click and mouse move handlers for the canvas
   * Handles tower selection and placement
   */
  private setupClickHandler(): void {
    if (!this.engine || !this.canvas) return;

    const canvas = this.canvas;

    // Track pointerdown position - use document with capture to intercept before GlobeControls
    this.pointerDownHandler = (event: PointerEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        // The cell report's Shift + left drag draws its box. The camera
        // controls never see the press, so they do not start to turn.
        if (event.button === 0 && event.shiftKey && this.cellReport?.active()) {
          event.stopPropagation();
          event.preventDefault();
          this.reportDragStart = { x: event.clientX, y: event.clientY };
          this.cellReport.drag(screenRect(event.clientX, event.clientY, event.clientX, event.clientY));
          return;
        }
        this.mouseDownPos = { x: event.clientX, y: event.clientY };
        if (event.button === 2) {
          this.rightClickDownPos = { x: event.clientX, y: event.clientY };
          this.rightClickDownTime = Date.now();
        }
        this.holdHover();
      }
    };
    document.addEventListener('pointerdown', this.pointerDownHandler, { capture: true });

    // Use pointerup with document-level capture (consistent with other handlers)
    // This ensures we get the event before EnvironmentControls can modify scene state
    this.pointerUpHandler = (event: PointerEvent) => {
      // The cell report's Shift drag ends wherever the button comes up, also over a panel
      if (this.reportDragStart && event.button === 0) {
        event.stopPropagation();
        this.endReportDrag(event);
        return;
      }
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        // Right-click release: cancel build/placement mode if it was a short, stationary click
        if (event.button === 2) {
          this.handleRightClickUp(event);
        } else {
          this.handleClick(event);
        }
        this.resumeHover(event);
      }
    };
    document.addEventListener('pointerup', this.pointerUpHandler, { capture: true });

    // Pointer move handler for build preview - use document with capture to intercept before GlobeControls
    this.pointerMoveHandler = (event: PointerEvent) => {
      // The box of the cell report's Shift drag follows the pointer anywhere, also over a panel
      if (this.reportDragStart) {
        event.stopPropagation();
        this.cellReport?.drag(screenRect(this.reportDragStart.x, this.reportDragStart.y, event.clientX, event.clientY));
        return;
      }
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        this.handlePointerMove(event);
      } else if (this.hoveredTowerId) {
        // Over the sidebar or an overlay now, not over the tower any more
        this.setHoveredTower(null);
      }
    };
    document.addEventListener('pointermove', this.pointerMoveHandler, { capture: true });

    // Suppress browser context menu in build/placement/targeting mode
    this.contextMenuHandler = (event: MouseEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        const inPlacementMode = !!this.mapPlacementModeSignal?.();
        const inBuildMode = this.buildModeSignal?.() ?? false;
        const inTargeting = !!this.abilityTargetingSignal?.();
        const heroSelected = !!this.heroInput?.selected();

        if (inPlacementMode || inBuildMode || inTargeting || heroSelected) {
          event.preventDefault();
        }
      }
    };
    document.addEventListener('contextmenu', this.contextMenuHandler, { capture: true });
  }

  /**
   * Handle canvas click event (via pointerup)
   * @param event Pointer event
   */
  private handleClick(event: PointerEvent): void {
    // Only left-click (button 0) triggers actions — right-click is camera rotation / build cancel
    if (event.button !== 0) return;

    if (!this.engine || !this.gameState || !this.buildModeSignal) {
      return;
    }

    // Check if mouse moved significantly (was a pan, not a click)
    if (this.mouseDownPos) {
      const dx = event.clientX - this.mouseDownPos.x;
      const dy = event.clientY - this.mouseDownPos.y;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      this.mouseDownPos = null;

      if (pixelDist > this.PAN_THRESHOLD_PX) {
        return; // Was a pan, ignore
      }
    }

    // Photo mode and replay: a click selects nothing, a selection would draw range and LOS into the picture
    if (this.uiStore.viewOnly()) return;

    // A debug pick takes this click and nothing else: the selected tower
    // and its LOS display stay as they are.
    if (this.pickCallback) {
      const hit = this.engine.picker.raycastTerrain(event.clientX, event.clientY);
      if (!hit) return;
      const pick = this.pickCallback;
      this.pickCallback = null;
      pick(hit);
      return;
    }

    // The cell report takes the click as well: a grid cell in or out of its
    // selection, no tower selection, no building
    if (this.cellReport?.active()) {
      const hit = this.engine.picker.raycastTerrain(event.clientX, event.clientY);
      if (hit) this.cellReport.click(hit);
      return;
    }

    // Ability targeting takes the click too: it aims, it does not select or build
    if (this.abilityTargetingSignal?.() && this.onAbilityClickCallback) {
      const hit = this.engine.picker.raycastTerrain(event.clientX, event.clientY);
      if (!hit) return;
      const aim = this.engine.sync.localToGeo(hit);
      this.onAbilityClickCallback(aim.lat, aim.lon, aim.height);
      return;
    }

    // The hero: a click on him selects him or lets him go. While he is
    // selected a click on the ground sends him, one on a tower selects it
    // (which lets him go, HeroControlService)
    if (this.heroInput && !this.buildModeSignal()) {
      if (this.heroInput.pick(event.clientX, event.clientY)) {
        this.heroInput.toggle();
        return;
      }
      if (this.heroInput.selected()) {
        const towerId = this.gameState.selectableTower(this.engine.picker.raycastTowers(event.clientX, event.clientY));
        if (towerId) {
          this.gameState.towerManager.selectTower(towerId);
          return;
        }
        const ground = this.engine.picker.raycastTerrain(event.clientX, event.clientY);
        if (!ground) return;
        const at = this.engine.sync.localToGeo(ground);
        this.heroInput.click(at.lat, at.lon, at.height);
        return;
      }
    }

    // First: Check tower selection via direct mesh raycast
    if (!this.buildModeSignal()) {
      // Only a tower this player may select (TowerPolicy); a partner's counts as a click beside
      const clickedTowerId = this.gameState.selectableTower(this.engine.picker.raycastTowers(event.clientX, event.clientY));

      if (clickedTowerId) {
        if (this.store.selectedTowerId() === clickedTowerId) {
          this.gameState.towerManager.selectTower(null);
        } else {
          this.gameState.towerManager.selectTower(clickedTowerId);
        }
        return; // Tower handled, done
      } else {
        this.gameState.towerManager.selectTower(null);
      }
    }

    // Raycast to get world position (needed for build mode)
    const hitPoint = this.engine.picker.raycastTerrain(event.clientX, event.clientY);

    if (!hitPoint) {
      return; // No terrain hit, but tower selection already handled above
    }

    // Convert to geo coordinates
    const geo = this.engine.sync.localToGeo(hitPoint);

    // Check enemy placement mode first (takes priority)
    if (this.enemyPlacementModeSignal?.() && this.onEnemyPlacementCallback) {
      this.onEnemyPlacementCallback(geo.lat, geo.lon, geo.height);
      return;
    }

    // Map placement mode (HQ/Spawn)
    if (this.mapPlacementModeSignal?.() && this.onMapPlacementClickCallback) {
      this.onMapPlacementClickCallback(geo.lat, geo.lon, geo.height);
      return;
    }

    // If in build mode, notify callback
    if (this.buildModeSignal() && this.onClickCallback) {
      this.onClickCallback(geo.lat, geo.lon, geo.height);
    }
  }

  /**
   * The cell report's Shift drag let go: a box selects the cells in it, a
   * drag shorter than a pan counts as a click on the ground there.
   */
  private endReportDrag(event: PointerEvent): void {
    const start = this.reportDragStart;
    this.reportDragStart = null;
    const report = this.cellReport;
    if (!start || !report) return;
    report.drag(null);
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > this.PAN_THRESHOLD_PX) {
      report.select(screenRect(start.x, start.y, event.clientX, event.clientY));
      return;
    }
    const hit = this.engine?.picker.raycastTerrain(event.clientX, event.clientY);
    if (hit) report.click(hit);
  }

  /**
   * Handle right-click release (pointerup with button === 2).
   * Exits build or placement mode only if the right-click was a short,
   * stationary click (not a camera drag). Evaluated on pointerup so that
   * duration is measured correctly even on systems where contextmenu fires
   * synchronously on mousedown (e.g. Linux).
   */
  private handleRightClickUp(event: PointerEvent): void {
    if (!this.rightClickDownPos) return;

    const inPlacementMode = !!this.mapPlacementModeSignal?.();
    const inBuildMode = this.buildModeSignal?.() ?? false;
    const inTargeting = !!this.abilityTargetingSignal?.();
    const heroSelected = !!this.heroInput?.selected();

    if (inPlacementMode || inBuildMode || inTargeting || heroSelected) {
      const dx = event.clientX - this.rightClickDownPos.x;
      const dy = event.clientY - this.rightClickDownPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - this.rightClickDownTime;

      if (distance < 5 && duration < 300) {
        if (inTargeting) {
          this.onAbilityCancelCallback?.();
        } else if (inPlacementMode) {
          this.keyboardCallbacks?.exitMapPlacement?.();
        } else if (inBuildMode) {
          this.keyboardCallbacks?.exitBuildMode();
        } else {
          this.heroInput?.cancel();
        }
      }
    }

    this.rightClickDownPos = null;
  }

  /**
   * Handle pointer move event (for build preview)
   * Only tracks when in build mode to avoid expensive raycasts
   * Uses document-level capture to ensure events aren't blocked by GlobeControls
   * Throttled to ~60fps to prevent performance issues
   * @param event Pointer event
   */
  private handlePointerMove(event: PointerEvent): void {
    if (!this.engine) return;

    if (!this.pointerOwnedByMode()) {
      this.scheduleHoverPick(event);
      return;
    }
    if (this.hoveredTowerId) this.setHoveredTower(null);

    // Throttle to prevent excessive raycasts. A move inside the window is not
    // dropped but comes through at its end, at the last pointer position: a
    // preview ends where the pointer stopped, and moves a frame apart that
    // come in a little early are not skipped for the next frame's.
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    const wait = this.lastPointerMoveTime + this.POINTER_MOVE_THROTTLE_MS - performance.now();
    if (wait > 0) {
      this.pointerMoveTimer ??= setTimeout(() => {
        this.pointerMoveTimer = null;
        this.movePointer();
      }, wait);
      return;
    }
    this.movePointer();
  }

  /** Hand the last pointer position to the move callback of the mode that owns the pointer. */
  private movePointer(): void {
    if (this.pointerMoveTimer !== null) {
      clearTimeout(this.pointerMoveTimer);
      this.pointerMoveTimer = null;
    }
    // The mode may have ended while a trailing move waited
    if (!this.engine || !this.pointerOwnedByMode()) return;
    this.lastPointerMoveTime = performance.now();

    const inBuildMode = this.buildModeSignal?.() ?? false;
    const inPlacementMode = !!this.mapPlacementModeSignal?.();
    const inTargeting = !!this.abilityTargetingSignal?.();
    const heroSelected = !!this.heroInput?.selected();

    const hitPoint = this.engine.picker.raycastTerrain(this.pointerX, this.pointerY);

    if (!hitPoint) {
      return;
    }

    // Convert to geo coordinates
    const geo = this.engine.sync.localToGeo(hitPoint);

    // Route to appropriate callback
    if (inTargeting && this.onAbilityMoveCallback) {
      this.onAbilityMoveCallback(geo.lat, geo.lon, hitPoint);
    } else if (inPlacementMode && this.onMapPlacementMoveCallback) {
      this.onMapPlacementMoveCallback(geo.lat, geo.lon, hitPoint);
    } else if (inBuildMode && this.onMouseMoveCallback) {
      this.onMouseMoveCallback(geo.lat, geo.lon, hitPoint);
    } else if (heroSelected) {
      this.heroInput?.move(geo.lat, geo.lon, hitPoint);
    }
  }

  /** Build, placement, ability targeting or the selected hero own the pointer: no hover range then. */
  private pointerOwnedByMode(): boolean {
    return (this.buildModeSignal?.() ?? false)
      || !!this.mapPlacementModeSignal?.()
      || !!this.abilityTargetingSignal?.()
      || !!this.heroInput?.selected();
  }

  /**
   * A button went down on the canvas, a camera drag or a click: the range
   * shown on hover goes, and a pick still pending for the last move is
   * dropped. Until the release no pick runs (scheduleHoverPick skips moves
   * with a button held), resumeHover picks again.
   */
  private holdHover(): void {
    if (this.hoverPickTimer !== null) {
      clearTimeout(this.hoverPickTimer);
      this.hoverPickTimer = null;
    }
    this.setHoveredTower(null);
    // The release may come where the last pick was; it must pick again
    this.lastHoverPickX = NaN;
    this.lastHoverPickY = NaN;
  }

  /**
   * Something else takes the pointer (TowerControlService, getting into a
   * tower): the hover ring and range go, and so does a pick still pending.
   * The next move over a tower after it picks again.
   */
  clearHover(): void {
    this.holdHover();
  }

  /** The button came up over the canvas: the tower under the pointer shows its range again. */
  private resumeHover(event: PointerEvent): void {
    if (!this.pointerOwnedByMode()) this.scheduleHoverPick(event);
  }

  /**
   * Range of the tower under the pointer, outside build and placement mode.
   * Kept cheap: no pick while a button is held (a camera drag, holdHover),
   * at most one per HOVER_PICK_INTERVAL_MS with a trailing one for where the
   * pointer stopped, and none when the pointer has not moved since the last.
   */
  private scheduleHoverPick(event: PointerEvent): void {
    // Photo mode and replay: no range ring in the picture
    if (this.uiStore.viewOnly()) {
      if (this.hoveredTowerId) this.setHoveredTower(null);
      return;
    }
    if (event.buttons !== 0) return;
    this.hoverX = event.clientX;
    this.hoverY = event.clientY;
    if (this.hoverPickTimer !== null) return;
    const wait = Math.max(0, this.lastHoverPickTime + this.HOVER_PICK_INTERVAL_MS - performance.now());
    this.hoverPickTimer = setTimeout(() => {
      this.hoverPickTimer = null;
      this.pickHoveredTower();
    }, wait);
  }

  private lastHoverPickX = NaN;
  private lastHoverPickY = NaN;

  private pickHoveredTower(): void {
    if (!this.engine) return;
    // Build, placement, photo mode or the replay may have started since the move
    if (this.buildModeSignal?.() || this.mapPlacementModeSignal?.() || this.uiStore.viewOnly()) return;
    if (this.hoverX === this.lastHoverPickX && this.hoverY === this.lastHoverPickY) return;
    this.lastHoverPickTime = performance.now();
    this.lastHoverPickX = this.hoverX;
    this.lastHoverPickY = this.hoverY;
    this.setHoveredTower(this.engine.picker.raycastTowers(this.hoverX, this.hoverY));
  }

  private setHoveredTower(id: string | null): void {
    if (id === this.hoveredTowerId) return;
    this.hoveredTowerId = id;
    this.engine?.towers.setHovered(id);
  }

  // ========================================
  // KEYBOARD HANDLING
  // ========================================

  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);

  /** Component-provided callbacks for keyboard actions */
  private keyboardCallbacks: KeyboardCallbacks | null = null;

  /**
   * Initialize keyboard handling with component-specific callbacks.
   * Call this from the component after engine is ready.
   */
  initKeyboard(callbacks: KeyboardCallbacks): void {
    this.keyboardCallbacks = callbacks;
  }

  /**
   * Handle keydown events delegated from the component's @HostListener.
   * Processes: WASD panning, debug toggles (T, Shift+P), build mode keys (R/Escape).
   * Every key handled here is preventDefault()ed; HotkeyService, which runs
   * after this, takes only the keys left alone.
   */
  handleKeyDown(event: KeyboardEvent): void {
    if (ownsKey(event.target, event.key)) {
      return;
    }

    // Escape closes the dialog only, not build or placement mode behind it
    if (isEscapeForDialog(event.key, event.defaultPrevented, modalDialogCount(this.dialog))) {
      return;
    }

    // Camera panning (WASD / Arrow keys) - works always
    if (this.keyboardPan.onKeyDown(event)) {
      event.preventDefault();
      return;
    }

    // Debug: Toggle 3D tiles visibility with 'T' key
    if (event.key === 't' || event.key === 'T') {
      if (this.engine) {
        const currentlyVisible = this.engine.areTilesVisible();
        this.engine.setTilesVisible(!currentlyVisible);
        event.preventDefault();
        return;
      }
    }

    // Debug: Toggle ShaderMaterial for particles with Shift+P (plain P pauses, HotkeyService)
    if (event.shiftKey && (event.key === 'p' || event.key === 'P')) {
      if (this.engine) {
        const currentlyUsingShader = this.engine.effects.isUsingShaderMaterial();
        this.engine.effects.setUseShaderMaterial(!currentlyUsingShader);
        event.preventDefault();
        return;
      }
    }

    // ESC ends the cell report
    if (event.key === 'Escape' && this.cellReport?.active()) {
      event.preventDefault();
      this.cellReport.end();
      return;
    }

    // ESC cancels ability targeting
    if (event.key === 'Escape' && this.abilityTargetingSignal?.()) {
      event.preventDefault();
      this.onAbilityCancelCallback?.();
      return;
    }

    // ESC cancels map placement mode
    if (event.key === 'Escape' && this.mapPlacementModeSignal?.()) {
      event.preventDefault();
      this.keyboardCallbacks?.exitMapPlacement?.();
      return;
    }

    // R held turns the spawn portal while it is being placed
    if ((event.key === 'r' || event.key === 'R') && this.mapPlacement.startRotating()) {
      event.preventDefault();
      return;
    }

    // Build mode keys
    if (!this.towerPlacement.buildMode()) return;

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.towerPlacement.startRotating();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.keyboardCallbacks?.exitBuildMode();
    }
  }

  /**
   * Handle keyup events delegated from the component's @HostListener.
   * A release always counts, also on an element that owns the key: an arrow
   * held over the canvas and let go on a slider that took the focus meanwhile
   * would otherwise keep the camera panning. Releasing a key that was never
   * pressed changes nothing.
   */
  handleKeyUp(event: KeyboardEvent): void {
    // Camera panning key release
    this.keyboardPan.onKeyUp(event);

    if (event.key === 'r' || event.key === 'R') {
      this.towerPlacement.stopRotating();
      this.mapPlacement.stopRotating();
    }
  }

  /**
   * Handle window blur - clear all pressed keys. R let go outside the window
   * sends no keyup here, so the tower or spawn portal stops turning as well.
   */
  handleWindowBlur(): void {
    this.keyboardPan.clearKeys();
    this.towerPlacement.stopRotating();
    this.mapPlacement.stopRotating();
    // The button may come up outside the window: a box under way is dropped
    if (this.reportDragStart) {
      this.reportDragStart = null;
      this.cellReport?.drag(null);
    }
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Cleanup input handlers
   */
  dispose(): void {
    // Remove event listeners
    if (this.pointerDownHandler) {
      document.removeEventListener('pointerdown', this.pointerDownHandler, { capture: true });
      this.pointerDownHandler = null;
    }
    if (this.pointerUpHandler) {
      document.removeEventListener('pointerup', this.pointerUpHandler, { capture: true });
      this.pointerUpHandler = null;
    }
    if (this.pointerMoveHandler) {
      document.removeEventListener('pointermove', this.pointerMoveHandler, { capture: true });
      this.pointerMoveHandler = null;
    }
    if (this.contextMenuHandler) {
      document.removeEventListener('contextmenu', this.contextMenuHandler, { capture: true });
      this.contextMenuHandler = null;
    }
    if (this.hoverPickTimer !== null) {
      clearTimeout(this.hoverPickTimer);
      this.hoverPickTimer = null;
    }
    if (this.pointerMoveTimer !== null) {
      clearTimeout(this.pointerMoveTimer);
      this.pointerMoveTimer = null;
    }
    this.setHoveredTower(null);
    this.lastHoverPickX = NaN;
    this.lastHoverPickY = NaN;

    this.engine = null;
    this.gameState = null;
    this.buildModeSignal = null;
    this.canvas = null;
    this.onClickCallback = null;
    this.onMouseMoveCallback = null;
    this.enemyPlacementModeSignal = null;
    this.onEnemyPlacementCallback = null;
    this.mapPlacementModeSignal = null;
    this.onMapPlacementClickCallback = null;
    this.onMapPlacementMoveCallback = null;
    this.abilityTargetingSignal = null;
    this.onAbilityClickCallback = null;
    this.onAbilityMoveCallback = null;
    this.onAbilityCancelCallback = null;
    this.heroInput = null;
    this.cellReport = null;
    this.reportDragStart = null;
    this.pickCallback = null;
    this.mouseDownPos = null;
    this.keyboardCallbacks = null;
  }
}
