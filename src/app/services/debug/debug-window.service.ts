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
  size?: WindowSize;
}

export type DebugWindowId = 'camera' | 'wave' | 'sound' | 'events' | 'devworld' | 'training' | 'tower' | 'enemy' | 'display' | 'performance' | 'los';

const STORAGE_KEY = 'td_debug_windows_v6';
const BASE_Z_INDEX = 100;

const DEFAULT_POSITIONS: Record<DebugWindowId, WindowPosition> = {
  camera: { x: 20, y: 80 },
  wave: { x: 20, y: 400 },
  sound: { x: 20, y: 200 },
  events: { x: 380, y: 80 },
  devworld: { x: 20, y: 80 },
  training: { x: 380, y: 300 },
  tower: { x: 20, y: 80 },
  enemy: { x: 340, y: 80 },
  display: { x: 20, y: 300 },
  performance: { x: 380, y: 80 },
  los: { x: 340, y: 80 },
};

const DEFAULT_SIZES: Partial<Record<DebugWindowId, WindowSize>> = {
  events: { width: 450, height: 400 },
  tower: { width: 300, height: 550 },
  enemy: { width: 320, height: 600 },
  los: { width: 440, height: 540 },
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
  readonly soundWindow = computed(() => this.windowStates()['sound']);
  readonly eventsWindow = computed(() => this.windowStates()['events']);
  readonly devworldWindow = computed(() => this.windowStates()['devworld']);
  readonly trainingWindow = computed(() => this.windowStates()['training']);
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
   * Update window size (called during resize)
   */
  updateSize(windowId: DebugWindowId, size: WindowSize): void {
    this.updateWindow(windowId, { size });
  }

  /**
   * Get the current size for a window
   */
  getSize(windowId: DebugWindowId): WindowSize | undefined {
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
      sound: {
        isOpen: false,
        position: DEFAULT_POSITIONS.sound,
        zIndex: BASE_Z_INDEX + 2,
      },
      events: {
        isOpen: false,
        position: DEFAULT_POSITIONS.events,
        zIndex: BASE_Z_INDEX + 3,
        size: DEFAULT_SIZES.events,
      },
      devworld: {
        isOpen: false,
        position: DEFAULT_POSITIONS.devworld,
        zIndex: BASE_Z_INDEX + 4,
      },
      training: {
        isOpen: false,
        position: DEFAULT_POSITIONS.training,
        zIndex: BASE_Z_INDEX + 5,
      },
      tower: {
        isOpen: false,
        position: DEFAULT_POSITIONS.tower,
        zIndex: BASE_Z_INDEX + 6,
        size: DEFAULT_SIZES.tower,
      },
      enemy: {
        isOpen: false,
        position: DEFAULT_POSITIONS.enemy,
        zIndex: BASE_Z_INDEX + 7,
        size: DEFAULT_SIZES.enemy,
      },
      display: {
        isOpen: false,
        position: DEFAULT_POSITIONS.display,
        zIndex: BASE_Z_INDEX + 8,
      },
      performance: {
        isOpen: false,
        position: DEFAULT_POSITIONS.performance,
        zIndex: BASE_Z_INDEX + 9,
      },
      los: {
        isOpen: false,
        position: DEFAULT_POSITIONS.los,
        zIndex: BASE_Z_INDEX + 10,
        size: DEFAULT_SIZES.los,
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
