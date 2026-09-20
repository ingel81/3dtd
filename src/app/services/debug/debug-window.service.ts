import { Injectable, signal, computed } from '@angular/core';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface DebugWindowState {
  isOpen: boolean;
  position: WindowPosition;
  zIndex: number;
  size: WindowSize;
}

export type DebugWindowId = 'camera' | 'wave' | 'sound' | 'events' | 'devworld' | 'bots' | 'tower' | 'enemy' | 'display' | 'performance' | 'los';

/** Shared lower bound for every debug panel, used by CSS, resize and storage. */
export const DEBUG_PANEL_MIN_SIZE: Readonly<WindowSize> = { width: 300, height: 200 };

const STORAGE_KEY = 'td_debug_windows_v6';
const BASE_Z_INDEX = 100;

// Key order doubles as the initial stacking order.
const DEFAULT_POSITIONS: Record<DebugWindowId, WindowPosition> = {
  camera: { x: 20, y: 80 },
  wave: { x: 20, y: 400 },
  sound: { x: 20, y: 200 },
  events: { x: 380, y: 80 },
  devworld: { x: 20, y: 80 },
  bots: { x: 380, y: 300 },
  tower: { x: 20, y: 80 },
  enemy: { x: 340, y: 80 },
  display: { x: 20, y: 300 },
  performance: { x: 380, y: 80 },
  los: { x: 340, y: 80 },
};

// Sized so the content fits without horizontal scrolling, including room
// for the vertical scrollbar where the content is taller than the panel.
const DEFAULT_SIZES: Record<DebugWindowId, WindowSize> = {
  camera: { width: 300, height: 300 },
  wave: { width: 380, height: 520 },
  sound: { width: 320, height: 400 },
  events: { width: 450, height: 400 },
  devworld: { width: 300, height: 400 },
  bots: { width: 320, height: 540 },
  tower: { width: 320, height: 550 },
  enemy: { width: 340, height: 600 },
  display: { width: 300, height: 520 },
  performance: { width: 320, height: 700 },
  los: { width: 460, height: 540 },
};

/**
 * Clamp a panel size to the available space, but never below the shared
 * minimum. When the space is smaller than the minimum, the minimum wins.
 */
export function clampPanelSize(
  size: WindowSize,
  maxWidth = Infinity,
  maxHeight = Infinity
): WindowSize {
  return {
    width: Math.max(DEBUG_PANEL_MIN_SIZE.width, Math.min(size.width, maxWidth)),
    height: Math.max(DEBUG_PANEL_MIN_SIZE.height, Math.min(size.height, maxHeight)),
  };
}

@Injectable({ providedIn: 'root' })
export class DebugWindowService {
  private readonly windowStates = signal<Record<DebugWindowId, DebugWindowState>>(
    this.loadFromStorage()
  );

  private highestZIndex = BASE_Z_INDEX;

  // Computed selectors for individual windows
  readonly cameraWindow = computed(() => this.windowStates()['camera']);
  readonly waveWindow = computed(() => this.windowStates()['wave']);
  readonly soundWindow = computed(() => this.windowStates()['sound']);
  readonly eventsWindow = computed(() => this.windowStates()['events']);
  readonly devworldWindow = computed(() => this.windowStates()['devworld']);
  readonly botWindow = computed(() => this.windowStates()['bots']);
  readonly towerWindow = computed(() => this.windowStates()['tower']);
  readonly enemyWindow = computed(() => this.windowStates()['enemy']);
  readonly displayWindow = computed(() => this.windowStates()['display']);
  readonly performanceWindow = computed(() => this.windowStates()['performance']);
  readonly losWindow = computed(() => this.windowStates()['los']);

  // Check if any window is open
  readonly hasOpenWindows = computed(() =>
    Object.values(this.windowStates()).some((w) => w.isOpen)
  );

  constructor() {
    // Find the highest z-index on init
    const states = this.windowStates();
    this.highestZIndex = Math.max(
      BASE_Z_INDEX,
      ...Object.values(states).map((s) => s.zIndex)
    );
  }

  /**
   * Open a debug window
   */
  open(windowId: DebugWindowId): void {
    this.updateWindow(windowId, { isOpen: true, zIndex: ++this.highestZIndex });
  }

  /**
   * Close a debug window
   */
  close(windowId: DebugWindowId): void {
    this.updateWindow(windowId, { isOpen: false });
  }

  /**
   * Toggle a debug window
   */
  toggle(windowId: DebugWindowId): void {
    const current = this.windowStates()[windowId];
    if (current.isOpen) {
      this.close(windowId);
    } else {
      this.open(windowId);
    }
  }

  /**
   * Check if a window is open
   */
  isOpen(windowId: DebugWindowId): boolean {
    return this.windowStates()[windowId].isOpen;
  }

  /**
   * Update window position (called during drag)
   */
  updatePosition(windowId: DebugWindowId, position: WindowPosition): void {
    this.updateWindow(windowId, { position });
  }

  /**
   * Update window size (called during resize), never below the shared minimum
   */
  updateSize(windowId: DebugWindowId, size: WindowSize): void {
    this.updateWindow(windowId, { size: clampPanelSize(size) });
  }

  /**
   * Get the current size for a window
   */
  getSize(windowId: DebugWindowId): WindowSize {
    return this.windowStates()[windowId].size;
  }

  /**
   * Bring window to front (called on click)
   */
  bringToFront(windowId: DebugWindowId): void {
    const current = this.windowStates()[windowId];
    if (current.zIndex < this.highestZIndex) {
      this.updateWindow(windowId, { zIndex: ++this.highestZIndex });
    }
  }

  /**
   * Get the current position for a window
   */
  getPosition(windowId: DebugWindowId): WindowPosition {
    return this.windowStates()[windowId].position;
  }

  private updateWindow(
    windowId: DebugWindowId,
    updates: Partial<DebugWindowState>
  ): void {
    this.windowStates.update((states) => ({
      ...states,
      [windowId]: { ...states[windowId], ...updates },
    }));
    this.saveToStorage();
  }

  private loadFromStorage(): Record<DebugWindowId, DebugWindowState> {
    const ids = Object.keys(DEFAULT_POSITIONS) as DebugWindowId[];
    const defaults = {} as Record<DebugWindowId, DebugWindowState>;
    ids.forEach((id, index) => {
      defaults[id] = {
        isOpen: false,
        position: DEFAULT_POSITIONS[id],
        zIndex: BASE_Z_INDEX + index,
        size: DEFAULT_SIZES[id],
      };
    });

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<
          Record<DebugWindowId, Partial<DebugWindowState>>
        >;

        // Merge stored values with defaults. Panels that were not resizable
        // before have no stored size and fall back to their default.
        for (const key of ids) {
          const entry = parsed[key];
          if (entry) {
            defaults[key] = {
              ...defaults[key],
              ...entry,
              size: this.parseStoredSize(entry.size, DEFAULT_SIZES[key]),
            };
          }
        }
      }
    } catch {
      // Ignore storage errors, use defaults
    }

    return defaults;
  }

  private parseStoredSize(value: unknown, fallback: WindowSize): WindowSize {
    const size = value as Partial<WindowSize> | null | undefined;
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
      return clampPanelSize({ width: size.width!, height: size.height! });
    }
    return fallback;
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.windowStates()));
    } catch {
      // Ignore storage errors
    }
  }
}
