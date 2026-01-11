import { Injectable, WritableSignal } from '@angular/core';
import * as THREE from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';

/**
 * InputHandlerService
 *
 * Manages click and mouse input handling for the Tower Defense game.
 * Distinguishes between clicks and pans, handles tower selection and placement.
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
  private gameState: GameStateManager | null = null;

  /** Build mode state signal (from TowerPlacementService) */
  private buildModeSignal: WritableSignal<boolean> | null = null;

  /** Canvas element reference */
  private canvas: HTMLCanvasElement | null = null;

  /** Click callback for placement validation */
  private onClickCallback: ((lat: number, lon: number, height: number) => void) | null = null;

  /** Mouse move callback for build preview updates */
  private onMouseMoveCallback: ((lat: number, lon: number, hitPoint: THREE.Vector3) => void) | null = null;

  /** Stored event listeners for cleanup */
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private clickHandler: ((event: MouseEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;

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
    this.canvas = canvas;
    this.engine = engine;
    this.gameState = gameState;
    this.buildModeSignal = buildModeSignal;
    this.onClickCallback = onClickCallback;
    this.onMouseMoveCallback = onMouseMoveCallback;

    this.setupClickHandler();
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

    // Click handler
    this.clickHandler = (event: MouseEvent) => {
      this.handleClick(event);
    };
    canvas.addEventListener('click', this.clickHandler);

    // Pointer move handler for build preview - use document with capture to intercept before GlobeControls
    this.pointerMoveHandler = (event: PointerEvent) => {
      if (event.target === canvas || canvas.contains(event.target as Node)) {
        this.handlePointerMove(event);
      }
    };
    document.addEventListener('pointermove', this.pointerMoveHandler, { capture: true });
  }

  /**
   * Handle canvas click event
   * @param event Mouse event
   */
  private handleClick(event: MouseEvent): void {
    if (!this.engine || !this.gameState || !this.buildModeSignal) return;

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
        if (this.gameState.selectedTowerId() === clickedTowerId) {
          this.gameState.deselectAll();
        } else {
          this.gameState.selectTower(clickedTowerId);
        }
        return; // Tower handled, done
      } else {
        this.gameState.deselectAll();
      }
    }

    // Raycast to get world position (needed for build mode)
    const hitPoint = this.engine.raycastTerrain(event.clientX, event.clientY);

    if (!hitPoint) {
      return; // No terrain hit, but tower selection already handled above
    }

    // Convert to geo coordinates
    const geo = this.engine.sync.localToGeo(hitPoint);

    // If in build mode, notify callback
    if (this.buildModeSignal() && this.onClickCallback) {
      this.onClickCallback(geo.lat, geo.lon, geo.height);
    }
  }

  /**
   * Handle pointer move event (for build preview)
   * Only tracks when in build mode to avoid expensive raycasts
   * Uses document-level capture to ensure events aren't blocked by GlobeControls
   * @param event Pointer event
   */
  private handlePointerMove(event: PointerEvent): void {
    if (!this.engine || !this.buildModeSignal || !this.buildModeSignal() || !this.onMouseMoveCallback) return;

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
    if (this.canvas && this.clickHandler) {
      this.canvas.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
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
    this.mouseDownPos = null;
  }
}
