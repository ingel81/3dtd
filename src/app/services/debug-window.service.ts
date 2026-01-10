import { Injectable, signal, computed } from '@angular/core';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface DebugWindowState {
  isOpen: boolean;
  position: WindowPosition;
  zIndex: number;
}

export type DebugWindowId = 'camera' | 'wave';

const STORAGE_KEY = 'td_debug_windows_v1';
const BASE_Z_INDEX = 100;

const DEFAULT_POSITIONS: Record<DebugWindowId, WindowPosition> = {
  camera: { x: 20, y: 80 },
  wave: { x: 20, y: 400 },
};

@Injectable({ providedIn: 'root' })
export class DebugWindowService {
  private readonly windowStates = signal<Record<DebugWindowId, DebugWindowState>>(
    this.loadFromStorage()
  );

  private highestZIndex = BASE_Z_INDEX;

  // Computed selectors for individual windows
  readonly cameraWindow = computed(() => this.windowStates()['camera']);
  readonly waveWindow = computed(() => this.windowStates()['wave']);

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
   * Bring window to front (called on click)
   */
  bringToFront(windowId: DebugWindowId): void {
    const current = this.windowStates()[windowId];
    if (current.zIndex < this.highestZIndex) {
      this.updateWindow(windowId, { zIndex: ++this.highestZIndex });
    }
  }

  /**
   * Get the current z-index for a window
   */
  getZIndex(windowId: DebugWindowId): number {
    return this.windowStates()[windowId].zIndex;
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
    const defaults: Record<DebugWindowId, DebugWindowState> = {
      camera: {
        isOpen: false,
        position: DEFAULT_POSITIONS.camera,
        zIndex: BASE_Z_INDEX,
      },
      wave: {
        isOpen: false,
        position: DEFAULT_POSITIONS.wave,
        zIndex: BASE_Z_INDEX + 1,
      },
    };

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<
          Record<DebugWindowId, Partial<DebugWindowState>>
        >;

        // Merge stored values with defaults
        for (const key of Object.keys(defaults) as DebugWindowId[]) {
          if (parsed[key]) {
            defaults[key] = { ...defaults[key], ...parsed[key] };
          }
        }
      }
    } catch {
      // Ignore storage errors, use defaults
    }

    return defaults;
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.windowStates()));
    } catch {
      // Ignore storage errors
    }
  }
}
