import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the right-click behavior in InputHandlerService.
 *
 * The exit logic now lives in pointerup (button === 2) instead of contextmenu,
 * so that duration is measured correctly even when contextmenu fires on mousedown.
 * The contextmenu handler only suppresses the browser context menu.
 */

// Minimal mock for the service's dependencies
function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'contains').mockReturnValue(false);
  return canvas;
}

/**
 * Helper that creates a minimal replica of InputHandlerService's
 * right-click handling logic and returns the handlers for direct invocation.
 */
function setupService(options: { buildMode: boolean; placementMode?: 'hq' | 'spawn' | null }) {
  const exitBuildMode = vi.fn();
  const exitMapPlacement = vi.fn();

  const canvas = createMockCanvas();

  // --- Replicate the handler logic from InputHandlerService ---
  let rightClickDownPos: { x: number; y: number } | null = null;
  let rightClickDownTime = 0;
  const buildModeSignal = () => options.buildMode;
  const mapPlacementModeSignal = () => options.placementMode ?? null;

  const pointerDownHandler = (event: PointerEvent) => {
    if (event.target === canvas || canvas.contains(event.target as Node)) {
      if (event.button === 2) {
        rightClickDownPos = { x: event.clientX, y: event.clientY };
        rightClickDownTime = Date.now();
      }
    }
  };

  // Right-click exit logic now lives in pointerup (button === 2)
  const pointerUpHandler = (event: PointerEvent) => {
    if (event.target === canvas || canvas.contains(event.target as Node)) {
      if (event.button === 2 && rightClickDownPos) {
        const inPlacementMode = !!mapPlacementModeSignal();
        const inBuildMode = buildModeSignal();

        if (inPlacementMode || inBuildMode) {
          const dx = event.clientX - rightClickDownPos.x;
          const dy = event.clientY - rightClickDownPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const duration = Date.now() - rightClickDownTime;

          if (distance < 5 && duration < 300) {
            if (inPlacementMode) {
              exitMapPlacement();
            } else {
              exitBuildMode();
            }
          }
        }
        rightClickDownPos = null;
      }
    }
  };

  // contextmenu handler only prevents the browser menu — no exit logic
  const contextMenuHandler = (event: MouseEvent) => {
    if (event.target === canvas || canvas.contains(event.target as Node)) {
      const inPlacementMode = !!mapPlacementModeSignal();
      const inBuildMode = buildModeSignal();

      if (inPlacementMode || inBuildMode) {
        event.preventDefault();
      }
    }
  };

  return {
    canvas,
    exitBuildMode,
    exitMapPlacement,
    pointerDownHandler,
    pointerUpHandler,
    contextMenuHandler,
  };
}

function createPointerEvent(type: string, canvas: HTMLCanvasElement, x: number, y: number, button = 2): PointerEvent {
  return new PointerEvent(type, {
    clientX: x,
    clientY: y,
    button,
    bubbles: true,
  });
}

function createMouseEvent(type: string, canvas: HTMLCanvasElement, x: number, y: number): MouseEvent {
  return new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
  });
}

// ============================================================

describe('InputHandlerService – right-click in build mode', () => {
  describe('build mode', () => {
    it('short stationary right-click (< 5px, < 300ms) should exit build mode on pointerup', () => {
      const { canvas, exitBuildMode, pointerDownHandler, pointerUpHandler } = setupService({ buildMode: true });

      // Simulate right-click down at (100, 100)
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // Simulate pointerup at nearly the same position (moved 2px)
      const upEvent = createPointerEvent('pointerup', canvas, 101, 101, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitBuildMode).toHaveBeenCalledTimes(1);
    });

    it('right-click with movement > 5px should NOT exit build mode (camera drag)', () => {
      const { canvas, exitBuildMode, pointerDownHandler, pointerUpHandler } = setupService({ buildMode: true });

      // Right-click down
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // pointerup at far position (moved 20px)
      const upEvent = createPointerEvent('pointerup', canvas, 120, 100, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
    });

    it('right-click held > 300ms without movement should NOT exit build mode (camera hold)', async () => {
      const { canvas, exitBuildMode, pointerDownHandler, pointerUpHandler } = setupService({ buildMode: true });

      // Right-click down
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // Wait 350ms to simulate a held click
      await new Promise((resolve) => setTimeout(resolve, 350));

      // pointerup at same position (no movement)
      const upEvent = createPointerEvent('pointerup', canvas, 100, 100, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
    });
  });

  describe('contextmenu handler', () => {
    it('should preventDefault in build mode but NOT exit', () => {
      const { canvas, exitBuildMode, pointerDownHandler, contextMenuHandler } = setupService({ buildMode: true });

      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const ctxEvent = createMouseEvent('contextmenu', canvas, 100, 100);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      const preventSpy = vi.spyOn(ctxEvent, 'preventDefault');
      contextMenuHandler(ctxEvent);

      expect(preventSpy).toHaveBeenCalled();
      expect(exitBuildMode).not.toHaveBeenCalled();
    });

    it('should NOT preventDefault outside build/placement mode', () => {
      const { canvas, contextMenuHandler } = setupService({ buildMode: false, placementMode: null });

      const ctxEvent = createMouseEvent('contextmenu', canvas, 100, 100);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      const preventSpy = vi.spyOn(ctxEvent, 'preventDefault');
      contextMenuHandler(ctxEvent);

      expect(preventSpy).not.toHaveBeenCalled();
    });
  });

  describe('map placement mode', () => {
    it('short stationary right-click should exit map placement mode on pointerup', () => {
      const { canvas, exitMapPlacement, exitBuildMode, pointerDownHandler, pointerUpHandler } = setupService({
        buildMode: false,
        placementMode: 'hq',
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 200, 200, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const upEvent = createPointerEvent('pointerup', canvas, 201, 200, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitMapPlacement).toHaveBeenCalledTimes(1);
      expect(exitBuildMode).not.toHaveBeenCalled();
    });

    it('right-click drag should NOT exit map placement mode', () => {
      const { canvas, exitMapPlacement, pointerDownHandler, pointerUpHandler } = setupService({
        buildMode: false,
        placementMode: 'spawn',
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 200, 200, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const upEvent = createPointerEvent('pointerup', canvas, 215, 210, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitMapPlacement).not.toHaveBeenCalled();
    });
  });

  describe('no active mode', () => {
    it('right-click outside build/placement mode should not call any exit', () => {
      const { canvas, exitBuildMode, exitMapPlacement, pointerDownHandler, pointerUpHandler } = setupService({
        buildMode: false,
        placementMode: null,
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const upEvent = createPointerEvent('pointerup', canvas, 100, 100, 2);
      Object.defineProperty(upEvent, 'target', { value: canvas });
      pointerUpHandler(upEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
      expect(exitMapPlacement).not.toHaveBeenCalled();
    });
  });
});
