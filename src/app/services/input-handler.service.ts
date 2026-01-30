import { Injectable, WritableSignal, inject } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { KeyboardPanService } from './keyboard-pan.service';
import { TowerPlacementService } from './tower-placement.service';

/**
 * Callbacks that the component provides for keyboard actions
 * that require component-level context (e.g., Angular-specific operations).
 */
export interface KeyboardCallbacks {
  /** Called when Escape is pressed in build mode */
  exitBuildMode: () => void;
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

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Reference to game state manager */
  private readonly store = inject(TowerDefenseStore);
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

  /** Stored event listeners for cleanup */
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;

  /** Throttle state for pointer move */
  private lastPointerMoveTime = 0;
  private readonly POINTER_MOVE_THROTTLE_MS = 16; // ~60fps max

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
      }
    };
    document.addEventListener('pointerdown', this.pointerDownHandler, { capture: true });

    // Use pointerup with document-level capture (consistent with other handlers)
    // This ensures we get the event before EnvironmentControls can modify scene state
    this.pointerUpHandler = (event: PointerEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        this.handleClick(event);
      }
    };
    document.addEventListener('pointerup', this.pointerUpHandler, { capture: true });

    // Pointer move handler for build preview - use document with capture to intercept before GlobeControls
    this.pointerMoveHandler = (event: PointerEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        this.handlePointerMove(event);
      }
    };
    document.addEventListener('pointermove', this.pointerMoveHandler, { capture: true });
  }

  /**
   * Handle canvas click event (via pointerup)
   * @param event Pointer event
   */
  private handleClick(event: PointerEvent): void {
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

    // First: Check tower selection via direct mesh raycast
    if (!this.buildModeSignal()) {
      const clickedTowerId = this.engine.raycastTowers(event.clientX, event.clientY);

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
    const hitPoint = this.engine.raycastTerrain(event.clientX, event.clientY);

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

    // If in build mode, notify callback
    if (this.buildModeSignal() && this.onClickCallback) {
      this.onClickCallback(geo.lat, geo.lon, geo.height);
    }
  }

  /**
   * Handle pointer move event (for build preview)
   * Only tracks when in build mode to avoid expensive raycasts
   * Uses document-level capture to ensure events aren't blocked by GlobeControls
   * Throttled to ~60fps to prevent performance issues
   * @param event Pointer event
   */
  private handlePointerMove(event: PointerEvent): void {
    if (!this.engine || !this.buildModeSignal || !this.buildModeSignal() || !this.onMouseMoveCallback) return;

    // Throttle to prevent excessive raycasts
    const now = performance.now();
    if (now - this.lastPointerMoveTime < this.POINTER_MOVE_THROTTLE_MS) {
      return;
    }
    this.lastPointerMoveTime = now;

    const hitPoint = this.engine.raycastTerrain(event.clientX, event.clientY);

    if (!hitPoint) {
      return;
    }

    // Convert to geo coordinates
    const geo = this.engine.sync.localToGeo(hitPoint);

    // Notify callback with hitPoint for preview positioning
    this.onMouseMoveCallback(geo.lat, geo.lon, hitPoint);
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
   * Processes: WASD panning, debug toggles (T/P), build mode keys (R/Escape).
   */
  handleKeyDown(event: KeyboardEvent): void {
    if (this.isTypingInInputField(event)) {
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

    // Debug: Toggle ShaderMaterial for particles with 'P' key
    if (event.key === 'p' || event.key === 'P') {
      if (this.engine) {
        const currentlyUsingShader = this.engine.effects.isUsingShaderMaterial();
        this.engine.effects.setUseShaderMaterial(!currentlyUsingShader);
        event.preventDefault();
        return;
      }
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
    if (this.isTypingInInputField(event)) {
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

  /**
   * Check if the user is typing in an input field.
   * Game keyboard shortcuts should not interfere with text input.
   */
  private isTypingInInputField(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    if (!target) return false;

    const tagName = target.tagName.toLowerCase();
    const isInputField = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    const isContentEditable = target.isContentEditable;

    return isInputField || isContentEditable;
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

    this.engine = null;
    this.gameState = null;
    this.buildModeSignal = null;
    this.canvas = null;
    this.onClickCallback = null;
    this.onMouseMoveCallback = null;
    this.enemyPlacementModeSignal = null;
    this.onEnemyPlacementCallback = null;
    this.mouseDownPos = null;
    this.keyboardCallbacks = null;
  }
}
