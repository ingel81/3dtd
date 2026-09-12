import { Injectable, WritableSignal, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';
import { isEscapeForDialog } from '../utils/dialog-key-guard';
import { isTypingTarget } from '../utils/keyboard-target';
import type { AbilityId } from '../configs/abilities.config';

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

  /** Stored event listeners for cleanup */
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private contextMenuHandler: ((event: MouseEvent) => void) | null = null;

  /** Throttle state for pointer move */
  private lastPointerMoveTime = 0;
  private readonly POINTER_MOVE_THROTTLE_MS = 16; // ~60fps max

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
        this.mouseDownPos = { x: event.clientX, y: event.clientY };
        if (event.button === 2) {
          this.rightClickDownPos = { x: event.clientX, y: event.clientY };
          this.rightClickDownTime = Date.now();
        }
      }
    };
    document.addEventListener('pointerdown', this.pointerDownHandler, { capture: true });

    // Use pointerup with document-level capture (consistent with other handlers)
    // This ensures we get the event before EnvironmentControls can modify scene state
    this.pointerUpHandler = (event: PointerEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        // Right-click release: cancel build/placement mode if it was a short, stationary click
        if (event.button === 2) {
          this.handleRightClickUp(event);
          return;
        }
        this.handleClick(event);
      }
    };
    document.addEventListener('pointerup', this.pointerUpHandler, { capture: true });

    // Pointer move handler for build preview - use document with capture to intercept before GlobeControls
    this.pointerMoveHandler = (event: PointerEvent) => {
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

        if (inPlacementMode || inBuildMode || inTargeting) {
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

    // Ability targeting takes the click too: it aims, it does not select or build
    if (this.abilityTargetingSignal?.() && this.onAbilityClickCallback) {
      const hit = this.engine.picker.raycastTerrain(event.clientX, event.clientY);
      if (!hit) return;
      const aim = this.engine.sync.localToGeo(hit);
      this.onAbilityClickCallback(aim.lat, aim.lon, aim.height);
      return;
    }

    // First: Check tower selection via direct mesh raycast
    if (!this.buildModeSignal()) {
      const clickedTowerId = this.engine.picker.raycastTowers(event.clientX, event.clientY);

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

    if (inPlacementMode || inBuildMode || inTargeting) {
      const dx = event.clientX - this.rightClickDownPos.x;
      const dy = event.clientY - this.rightClickDownPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - this.rightClickDownTime;

      if (distance < 5 && duration < 300) {
        if (inTargeting) {
          this.onAbilityCancelCallback?.();
        } else if (inPlacementMode) {
          this.keyboardCallbacks?.exitMapPlacement?.();
        } else {
          this.keyboardCallbacks?.exitBuildMode();
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

    const inBuildMode = this.buildModeSignal?.() ?? false;
    const inPlacementMode = !!this.mapPlacementModeSignal?.();
    const inTargeting = !!this.abilityTargetingSignal?.();

    if (!inBuildMode && !inPlacementMode && !inTargeting) {
      this.scheduleHoverPick(event);
      return;
    }
    if (this.hoveredTowerId) this.setHoveredTower(null);

    // Throttle to prevent excessive raycasts
    const now = performance.now();
    if (now - this.lastPointerMoveTime < this.POINTER_MOVE_THROTTLE_MS) {
      return;
    }
    this.lastPointerMoveTime = now;

    const hitPoint = this.engine.picker.raycastTerrain(event.clientX, event.clientY);

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
    }
  }

  /**
   * Range of the tower under the pointer, outside build and placement mode.
   * Kept cheap: no pick while a button is held (a camera drag), at most one
   * per HOVER_PICK_INTERVAL_MS with a trailing one for where the pointer
   * stopped, and none when the pointer has not moved since the last.
   */
  private scheduleHoverPick(event: PointerEvent): void {
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
    // Build or placement mode may have started since the move
    if (this.buildModeSignal?.() || this.mapPlacementModeSignal?.()) return;
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
    if (isTypingTarget(event.target)) {
      return;
    }

    // Escape closes the dialog only, not build or placement mode behind it
    if (isEscapeForDialog(event.key, event.defaultPrevented, this.dialog.openDialogs.length)) {
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
   */
  handleKeyUp(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) {
      return;
    }

    // Camera panning key release
    this.keyboardPan.onKeyUp(event);

    if (event.key === 'r' || event.key === 'R') {
      this.towerPlacement.stopRotating();
    }
  }

  /**
   * Handle window blur - clear all pressed keys.
   */
  handleWindowBlur(): void {
    this.keyboardPan.clearKeys();
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
    this.pickCallback = null;
    this.mouseDownPos = null;
    this.keyboardCallbacks = null;
  }
}
