/**
 * The custom map from straight above for the game's minimap: one render of
 * the map's own scene objects (ground, water, objects, light) through an
 * orthographic camera into a canvas, north up.
 */

import { OrthographicCamera, SRGBColorSpace, WebGLRenderTarget } from 'three';
import type { Object3D, Scene, WebGLRenderer } from 'three';
import type { WorldMinimap } from '../world-provider';

/** The picture's longer side in pixels */
export const MINIMAP_PICTURE_PX = 512;

export type MinimapArea = Omit<WorldMinimap, 'picture'>;

/** Picture size for an area: the longer side MINIMAP_PICTURE_PX, the other in proportion */
export function minimapPictureSize(area: MinimapArea, longest = MINIMAP_PICTURE_PX): { width: number; height: number } {
  const w = Math.abs(area.right - area.left);
  const h = Math.abs(area.bottom - area.top);
  const k = longest / Math.max(w, h, 1e-6);
  return { width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(h * k)) };
}

let srgbTable: Uint8Array | null = null;

/**
 * Linear bytes to sRGB in place (alpha untouched): a render target gets the
 * scene in linear colour, the screen in sRGB
 */
export function linearToSrgb(pixels: Uint8Array): void {
  if (!srgbTable) {
    srgbTable = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      srgbTable[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
    }
  }
  const t = srgbTable;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = t[pixels[i]];
    pixels[i + 1] = t[pixels[i + 1]];
    pixels[i + 2] = t[pixels[i + 2]];
  }
}

/**
 * Renders only `shown` of the scene's direct children (the map's group, its
 * sight blockers, its lights) from above over `area`, without fog. Towers,
 * enemies, route lines and effects stay out of the picture.
 */
export function renderMinimapPicture(
  renderer: WebGLRenderer,
  scene: Scene,
  shown: ReadonlySet<Object3D>,
  area: MinimapArea,
  topHeight: number,
): HTMLCanvasElement {
  const { width, height } = minimapPictureSize(area);
  const hw = Math.abs(area.right - area.left) / 2;
  const hd = Math.abs(area.bottom - area.top) / 2;
  const cx = (area.left + area.right) / 2;
  const cz = (area.top + area.bottom) / 2;
  const cam = new OrthographicCamera(-hw, hw, hd, -hd, 1, topHeight + 20000);
  cam.position.set(cx, topHeight + 1000, cz);
  // North (+z) at the top, east (-x) to the right
  cam.up.set(0, 0, 1);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();

  const hidden: Object3D[] = [];
  for (const child of scene.children) {
    if (!shown.has(child) && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  }
  const fog = scene.fog;
  scene.fog = null;
  const before = renderer.getRenderTarget();
  const target = new WebGLRenderTarget(width, height, { colorSpace: SRGBColorSpace });
  const pixels = new Uint8Array(width * height * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(before);
    scene.fog = fog;
    for (const child of hidden) child.visible = true;
    target.dispose();
  }
  linearToSrgb(pixels);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c2d = canvas.getContext('2d');
  if (c2d) {
    const image = c2d.createImageData(width, height);
    // Render targets read bottom row first
    for (let row = 0; row < height; row++) {
      image.data.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    c2d.putImageData(image, 0, 0);
  }
  return canvas;
}
