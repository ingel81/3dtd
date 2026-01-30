/**
 * Procedural Sprite Atlas Generator
 *
 * Generates NxN texture atlas images at runtime using Canvas2D.
 * Each cell contains one animation frame (e.g., explosion sequence).
 *
 * This avoids shipping extra PNG assets and ensures pixel-perfect
 * alignment with the shader's UV math.
 */

import { CanvasTexture, NearestFilter, LinearFilter, ClampToEdgeWrapping } from 'three';

/** Atlas grid configuration */
export interface SpriteAtlasConfig {
  /** Number of columns in the grid */
  cols: number;
  /** Number of rows in the grid */
  rows: number;
  /** Pixel size of each cell (square) */
  cellSize: number;
  /** Use nearest-neighbor filtering (pixel art style) */
  pixelArt?: boolean;
}

/**
 * Generate a 4×4 explosion sprite atlas (16 frames).
 *
 * Frame sequence:
 *  0-3:   Bright flash expanding (white → yellow core)
 *  4-7:   Fireball expanding (orange → red, growing)
 *  8-11:  Fireball dissipating (darker red, breaking apart)
 *  12-15: Smoke wisps fading out (dark grey, transparent)
 */
export function generateExplosionAtlas(config: SpriteAtlasConfig = { cols: 4, rows: 4, cellSize: 64 }): CanvasTexture {
  const { cols, rows, cellSize } = config;
  const width = cols * cellSize;
  const height = rows * cellSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Clear to fully transparent
  ctx.clearRect(0, 0, width, height);

  const totalFrames = cols * rows;

  for (let frame = 0; frame < totalFrames; frame++) {
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const cx = col * cellSize + cellSize / 2;
    const cy = row * cellSize + cellSize / 2;
    const maxR = cellSize * 0.45; // Leave a small margin

    const progress = frame / (totalFrames - 1); // 0..1

    if (progress < 0.25) {
      // Phase 1: Bright flash (frames 0-3)
      const t = progress / 0.25; // 0..1 within phase
      const radius = maxR * (0.3 + t * 0.5);

      // Hot white/yellow core
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(255, 255, 240, ${1.0})`);
      grad.addColorStop(0.3, `rgba(255, 240, 100, ${0.95})`);
      grad.addColorStop(0.7, `rgba(255, 180, 30, ${0.7})`);
      grad.addColorStop(1.0, `rgba(255, 100, 0, ${0.0})`);

      ctx.fillStyle = grad;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

    } else if (progress < 0.5) {
      // Phase 2: Fireball expanding (frames 4-7)
      const t = (progress - 0.25) / 0.25;
      const radius = maxR * (0.6 + t * 0.4);

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(255, 200, 50, ${0.9 - t * 0.1})`);
      grad.addColorStop(0.3, `rgba(255, 130, 20, ${0.85 - t * 0.1})`);
      grad.addColorStop(0.6, `rgba(220, 60, 10, ${0.6})`);
      grad.addColorStop(1.0, `rgba(150, 30, 0, ${0.0})`);

      ctx.fillStyle = grad;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

      // Add some irregularity with small hot spots
      for (let s = 0; s < 3; s++) {
        const angle = (s / 3) * Math.PI * 2 + t * 1.5;
        const dist = radius * 0.3 * (0.5 + t * 0.5);
        const sx = cx + Math.cos(angle) * dist;
        const sy = cy + Math.sin(angle) * dist;
        const sr = maxR * 0.2;

        const spotGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        spotGrad.addColorStop(0, `rgba(255, 220, 100, ${0.4})`);
        spotGrad.addColorStop(1.0, `rgba(255, 150, 20, ${0.0})`);
        ctx.fillStyle = spotGrad;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }

    } else if (progress < 0.75) {
      // Phase 3: Dissipating fireball (frames 8-11)
      const t = (progress - 0.5) / 0.25;
      const radius = maxR * (0.8 + t * 0.2);
      const alpha = 0.7 - t * 0.3;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(200, 80, 20, ${alpha})`);
      grad.addColorStop(0.4, `rgba(150, 40, 10, ${alpha * 0.7})`);
      grad.addColorStop(0.7, `rgba(80, 30, 10, ${alpha * 0.4})`);
      grad.addColorStop(1.0, `rgba(40, 20, 10, ${0.0})`);

      ctx.fillStyle = grad;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

      // Wispy edges breaking apart
      for (let w = 0; w < 5; w++) {
        const angle = (w / 5) * Math.PI * 2 + frame * 0.8;
        const dist = radius * (0.5 + t * 0.4);
        const wx = cx + Math.cos(angle) * dist;
        const wy = cy + Math.sin(angle) * dist;
        const wr = maxR * (0.15 - t * 0.05);

        if (wr > 0) {
          const wispGrad = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
          wispGrad.addColorStop(0, `rgba(120, 50, 15, ${alpha * 0.5})`);
          wispGrad.addColorStop(1.0, `rgba(60, 30, 10, ${0.0})`);
          ctx.fillStyle = wispGrad;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }

    } else {
      // Phase 4: Smoke wisps fading (frames 12-15)
      const t = (progress - 0.75) / 0.25;
      const radius = maxR * (0.7 + t * 0.3);
      const alpha = 0.4 - t * 0.35;

      if (alpha > 0.01) {
        const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
        grad.addColorStop(0, `rgba(60, 50, 45, ${alpha})`);
        grad.addColorStop(0.5, `rgba(50, 45, 40, ${alpha * 0.6})`);
        grad.addColorStop(1.0, `rgba(40, 35, 30, ${0.0})`);

        ctx.fillStyle = grad;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);

        // Scattered smoke puffs
        for (let p = 0; p < 3; p++) {
          const angle = (p / 3) * Math.PI * 2 + frame * 1.2;
          const dist = radius * 0.4;
          const px = cx + Math.cos(angle) * dist;
          const py = cy + Math.sin(angle) * dist;
          const pr = maxR * 0.2 * (1 - t);

          if (pr > 1) {
            const puffGrad = ctx.createRadialGradient(px, py, 0, px, py, pr);
            puffGrad.addColorStop(0, `rgba(70, 60, 55, ${alpha * 0.5})`);
            puffGrad.addColorStop(1.0, `rgba(50, 45, 40, ${0.0})`);
            ctx.fillStyle = puffGrad;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = config.pixelArt ? NearestFilter : LinearFilter;
  texture.magFilter = config.pixelArt ? NearestFilter : LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}

/**
 * Generate a simple smoke puff atlas (4×4, 16 frames).
 * Lighter, greyer particles suitable for normal blending.
 */
export function generateSmokeAtlas(config: SpriteAtlasConfig = { cols: 4, rows: 4, cellSize: 64 }): CanvasTexture {
  const { cols, rows, cellSize } = config;
  const width = cols * cellSize;
  const height = rows * cellSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, width, height);

  const totalFrames = cols * rows;

  for (let frame = 0; frame < totalFrames; frame++) {
    const col = frame % cols;
    const row = Math.floor(frame / cols);
    const cx = col * cellSize + cellSize / 2;
    const cy = row * cellSize + cellSize / 2;
    const maxR = cellSize * 0.45;

    const progress = frame / (totalFrames - 1);

    // Smoke: starts small and dense, expands and fades
    const radius = maxR * (0.3 + progress * 0.7);
    const alpha = 0.6 * (1 - progress * 0.8);

    if (alpha > 0.01) {
      const grey = 160 + Math.floor(progress * 60); // Gets lighter as it fades
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(${grey}, ${grey}, ${grey - 10}, ${alpha})`);
      grad.addColorStop(0.5, `rgba(${grey - 20}, ${grey - 20}, ${grey - 30}, ${alpha * 0.6})`);
      grad.addColorStop(1.0, `rgba(${grey - 40}, ${grey - 40}, ${grey - 50}, ${0.0})`);

      ctx.fillStyle = grad;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return texture;
}
