/**
 * The custom map from straight above for the game's minimap: one render of
 * the map's own scene objects (ground, water, objects, light) through an
 * orthographic camera into a canvas, north up.
 */

import { Fog, FogExp2, OrthographicCamera, SRGBColorSpace, WebGLRenderTarget } from 'three';
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

/** Something the renderer draws (not a light, a group or a camera) */
function isDrawn(o: Object3D): boolean {
  const k = o as Partial<Record<'isMesh' | 'isLine' | 'isPoints' | 'isSprite', boolean>>;
  return k.isMesh === true || k.isLine === true || k.isPoints === true || k.isSprite === true;
}

/**
 * Renders only `shown` of the scene's direct children (the map's group, its
 * sight blockers, its lights) from above over `area`, without fog. Towers,
 * enemies, route lines and effects stay out of the picture.
 *
 * The programs are the ones the map compiled for the screen (prepare): the
 * fog stays on the scene with no reach, the game's lights stay on (fog and
 * the number of lights are part of a program) and the target counts as the
 * screen. A program of its own per material would link on the main thread,
 * some 250 ms each with a cold driver cache.
 */
export function renderMinimapPicture(
  renderer: WebGLRenderer,
  scene: Scene,
  shown: ReadonlySet<Object3D>,
  area: MinimapArea,
  topHeight: number,
  /** The map's own fog density uniform (HEIGHT_FOG_UNIFORMS.uFogDensity), cleared for the render */
  mapFog: { value: number } | null = null,
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

  // What draws outside the map hides; every light stays, their count is part of each program
  const hidden: Object3D[] = [];
  for (const child of scene.children) {
    if (shown.has(child)) continue;
    child.traverse((o) => {
      if (o.visible && isDrawn(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
  }
  const fog = scene.fog;
  const density = fog instanceof FogExp2 ? fog.density : 0;
  const reach = fog instanceof Fog ? [fog.near, fog.far] : [0, 0];
  const mapDensity = mapFog?.value ?? 0;
  if (mapFog) mapFog.value = 0;
  if (fog instanceof FogExp2) fog.density = 0;
  if (fog instanceof Fog) {
    fog.near = 1e9;
    fog.far = 2e9;
  }
  const before = renderer.getRenderTarget();
  const target = new WebGLRenderTarget(width, height, { colorSpace: SRGBColorSpace });
  // Drawn like the screen: sRGB out (stored as is), the renderer's tone mapping. A plain target gets
  // linear colour and every material a program of its own for it; three treats an XR target as the screen.
  (target as WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  const pixels = new Uint8Array(width * height * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(before);
    if (mapFog) mapFog.value = mapDensity;
    if (fog instanceof FogExp2) fog.density = density;
    if (fog instanceof Fog) [fog.near, fog.far] = reach;
    for (const child of hidden) child.visible = true;
    target.dispose();
  }

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
