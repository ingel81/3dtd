import { CanvasTexture, LinearFilter } from 'three';

/** Atlas configuration */
const ATLAS_SIZE = 2048;
const SLOT_WIDTH = 256;
const SLOT_HEIGHT = 64;
const ATLAS_COLS = ATLAS_SIZE / SLOT_WIDTH;   // 8
const ATLAS_ROWS = ATLAS_SIZE / SLOT_HEIGHT;  // 32
const MAX_SLOTS = ATLAS_COLS * ATLAS_ROWS;    // 256

export interface AtlasSlot {
  key: string;
  uvRect: [number, number, number, number]; // u, v, w, h (normalized 0..1) — tight around rendered text
  textAspect: number;  // rendered text width / slot height (quad aspect ratio)
  refCount: number;
  index: number;
}

/**
 * Dynamic texture atlas for floating text.
 *
 * Manages a 2048x2048 canvas divided into 256x64 slots (256 total).
 * Text strings are rendered into slots and cached by key (text+color+fontSize+outline).
 * Multiple instances can reference the same slot via refCount tracking.
 * Only slots with refCount=0 are eligible for eviction when the atlas is full.
 */
export class FloatingTextAtlas {
  readonly texture: CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private cache = new Map<string, AtlasSlot>();
  private slots: (AtlasSlot | null)[] = new Array(MAX_SLOTS).fill(null);
  private freeSlotIndices: number[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.premultiplyAlpha = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;

    // Fill free indices (reversed so pop() gives lowest index first)
    for (let i = MAX_SLOTS - 1; i >= 0; i--) {
      this.freeSlotIndices.push(i);
    }
  }

  /**
   * Get or create an atlas slot for the given text configuration.
   * Cache hit: no canvas rendering, just returns existing slot with incremented refCount.
   * Cache miss: renders text into a new slot, marks texture dirty.
   */
  getOrCreate(
    text: string,
    color: string,
    fontSize: number,
    outlineColor: string,
    outlineWidth: number,
  ): AtlasSlot {
    const key = `${text}|${color}|${fontSize}|${outlineColor}`;

    // Cache hit
    const existing = this.cache.get(key);
    if (existing) {
      existing.refCount++;
      return existing;
    }

    // Cache miss — allocate a slot
    let slotIndex: number;
    if (this.freeSlotIndices.length > 0) {
      slotIndex = this.freeSlotIndices.pop()!;
    } else {
      // Atlas full — evict a slot with refCount === 0
      slotIndex = this.evictUnreferencedSlot();
      if (slotIndex === -1) {
        // All 256 slots actively used; overwrite slot 0 as last resort
        slotIndex = 0;
        const evicted = this.slots[0];
        if (evicted) this.cache.delete(evicted.key);
      }
    }

    // Compute canvas region for this slot
    const col = slotIndex % ATLAS_COLS;
    const row = Math.floor(slotIndex / ATLAS_COLS);
    const x = col * SLOT_WIDTH;
    const y = row * SLOT_HEIGHT;

    // Render text and measure actual pixel width
    const renderedWidth = this.renderTextToSlot(x, y, text, color, fontSize, outlineColor, outlineWidth);
    this.texture.needsUpdate = true;

    // Compute tight UV rect centered on the rendered text (not full slot width)
    const tightWidth = Math.min(renderedWidth, SLOT_WIDTH);
    const uvRect: [number, number, number, number] = [
      (x + (SLOT_WIDTH - tightWidth) / 2) / ATLAS_SIZE,
      y / ATLAS_SIZE,
      tightWidth / ATLAS_SIZE,
      SLOT_HEIGHT / ATLAS_SIZE,
    ];
    const textAspect = tightWidth / SLOT_HEIGHT;

    const slot: AtlasSlot = { key, uvRect, textAspect, refCount: 1, index: slotIndex };
    this.slots[slotIndex] = slot;
    this.cache.set(key, slot);

    return slot;
  }

  /** Decrement reference count for a slot. */
  release(slot: AtlasSlot): void {
    slot.refCount = Math.max(0, slot.refCount - 1);
  }

  /** Clear all slots and cache (round reset). */
  clear(): void {
    this.cache.clear();
    this.slots.fill(null);
    this.freeSlotIndices = [];
    for (let i = MAX_SLOTS - 1; i >= 0; i--) {
      this.freeSlotIndices.push(i);
    }
    this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  // --- Private ---

  /**
   * Render text into a slot region on the atlas canvas.
   * Returns the actual rendered pixel width (clamped to SLOT_WIDTH).
   */
  private renderTextToSlot(
    x: number, y: number,
    text: string, color: string, fontSize: number,
    outlineColor: string, outlineWidth: number,
  ): number {
    this.ctx.clearRect(x, y, SLOT_WIDTH, SLOT_HEIGHT);

    // Clamp fontSize to fit in slot height
    let effectiveFontSize = Math.min(fontSize, SLOT_HEIGHT - outlineWidth * 2 - 4);

    // Auto-shrink fontSize when the text would overflow slot width.
    // Without this, long names like real-world OSM street labels get
    // truncated on both sides by the centred fillText. We measure first,
    // then scale fontSize down so the entire string fits — long labels
    // simply render smaller, never cropped.
    const maxTextWidth = SLOT_WIDTH - outlineWidth * 2 - 4;
    this.ctx.font = `bold ${effectiveFontSize}px Arial, sans-serif`;
    const measured = this.ctx.measureText(text).width;
    if (measured > maxTextWidth) {
      const scale = maxTextWidth / measured;
      effectiveFontSize = Math.max(10, Math.floor(effectiveFontSize * scale));
      this.ctx.font = `bold ${effectiveFontSize}px Arial, sans-serif`;
    }

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const cx = x + SLOT_WIDTH / 2;
    const cy = y + SLOT_HEIGHT / 2;

    // Outline
    if (outlineWidth > 0) {
      this.ctx.strokeStyle = outlineColor;
      this.ctx.lineWidth = outlineWidth;
      this.ctx.lineJoin = 'round';
      this.ctx.strokeText(text, cx, cy);
    }

    // Fill
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, cx, cy);

    // Measure actual text width in pixels
    const metrics = this.ctx.measureText(text);
    return Math.min(metrics.width + outlineWidth * 2 + 4, SLOT_WIDTH);
  }

  /** Find and evict a slot with refCount === 0. Returns slot index or -1. */
  private evictUnreferencedSlot(): number {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = this.slots[i];
      if (slot && slot.refCount === 0) {
        this.cache.delete(slot.key);
        this.slots[i] = null;
        return i;
      }
    }
    return -1;
  }
}
