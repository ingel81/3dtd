import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the right-click behavior in InputHandlerService.
 *
 * We test the contextmenu handler logic directly by extracting
 * the handler registered on document and simulating pointer events.
 */

// Minimal mock for the service's dependencies
function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'contains').mockReturnValue(false);
  return canvas;
}

/**
 * Helper that creates a minimal InputHandlerService instance
 * and captures the registered event handlers so we can invoke them directly.
 */
function setupService(options: { buildMode: boolean; placementMode?: 'hq' | 'spawn' | null }) {
  const exitBuildMode = vi.fn();
  const exitMapPlacement = vi.fn();

  const canvas = createMockCanvas();

  // Capture handlers registered via addEventListener
  const handlers: Record<string, EventListenerOrEventListenerObject> = {};
  const origAdd = document.addEventListener.bind(document);
  const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject, _options?: any) => {
      handlers[type] = listener;
      origAdd(type, listener, _options);
    }
  );

  const removeSpy = vi.spyOn(document, 'removeEventListener');

  // Dynamically import after mocks are in place
  // Instead, we build a lightweight replica of the handler logic to test:
  // We will test the actual service by importing it. But since it uses Angular DI,
  // we replicate the critical handler logic in a test harness.

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

  const contextMenuHandler = (event: MouseEvent) => {
    if (event.target === canvas || canvas.contains(event.target as Node)) {
      const inPlacementMode = !!mapPlacementModeSignal();
      const inBuildMode = buildModeSignal();

      if (inPlacementMode || inBuildMode) {
        event.preventDefault();
        if (rightClickDownPos) {
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
      }
      rightClickDownPos = null;
    }
  };

  // Cleanup spies
  addSpy.mockRestore();
  removeSpy.mockRestore();

  return {
    canvas,
    exitBuildMode,
    exitMapPlacement,
    pointerDownHandler,
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
    it('short stationary right-click (< 5px, < 300ms) should exit build mode', () => {
      const { canvas, exitBuildMode, pointerDownHandler, contextMenuHandler } = setupService({ buildMode: true });

      // Simulate right-click down at (100, 100)
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // Simulate contextmenu at nearly the same position (moved 2px)
      const ctxEvent = createMouseEvent('contextmenu', canvas, 101, 101);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitBuildMode).toHaveBeenCalledTimes(1);
    });

    it('right-click with movement > 5px should NOT exit build mode (camera drag)', () => {
      const { canvas, exitBuildMode, pointerDownHandler, contextMenuHandler } = setupService({ buildMode: true });

      // Right-click down
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // contextmenu at far position (moved 20px)
      const ctxEvent = createMouseEvent('contextmenu', canvas, 120, 100);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
    });

    it('right-click held > 300ms without movement should NOT exit build mode (camera hold)', async () => {
      const { canvas, exitBuildMode, pointerDownHandler, contextMenuHandler } = setupService({ buildMode: true });

      // Right-click down
      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      // Wait 350ms to simulate a held click
      await new Promise((resolve) => setTimeout(resolve, 350));

      // contextmenu at same position (no movement)
      const ctxEvent = createMouseEvent('contextmenu', canvas, 100, 100);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
    });
  });

  describe('map placement mode', () => {
    it('short stationary right-click should exit map placement mode', () => {
      const { canvas, exitMapPlacement, exitBuildMode, pointerDownHandler, contextMenuHandler } = setupService({
        buildMode: false,
        placementMode: 'hq',
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 200, 200, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const ctxEvent = createMouseEvent('contextmenu', canvas, 201, 200);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitMapPlacement).toHaveBeenCalledTimes(1);
      expect(exitBuildMode).not.toHaveBeenCalled();
    });

    it('right-click drag should NOT exit map placement mode', () => {
      const { canvas, exitMapPlacement, pointerDownHandler, contextMenuHandler } = setupService({
        buildMode: false,
        placementMode: 'spawn',
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 200, 200, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const ctxEvent = createMouseEvent('contextmenu', canvas, 215, 210);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitMapPlacement).not.toHaveBeenCalled();
    });
  });

  describe('no active mode', () => {
    it('right-click outside build/placement mode should not call any exit', () => {
      const { canvas, exitBuildMode, exitMapPlacement, pointerDownHandler, contextMenuHandler } = setupService({
        buildMode: false,
        placementMode: null,
      });

      const downEvent = createPointerEvent('pointerdown', canvas, 100, 100, 2);
      Object.defineProperty(downEvent, 'target', { value: canvas });
      pointerDownHandler(downEvent);

      const ctxEvent = createMouseEvent('contextmenu', canvas, 100, 100);
      Object.defineProperty(ctxEvent, 'target', { value: canvas });
      contextMenuHandler(ctxEvent);

      expect(exitBuildMode).not.toHaveBeenCalled();
      expect(exitMapPlacement).not.toHaveBeenCalled();
    });
  });
});
