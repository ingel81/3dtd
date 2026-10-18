import type { WebGLRenderer } from 'three';

/**
 * Tells three's state cache the unpack parameters WebGL starts with (all 0). three reads them before a
 * texture's partial upload (update ranges) or a sub-image copy to set them back afterwards, and reading
 * one it has not cached yet asks the GPU process, which first works off everything queued: the first
 * brush stroke of the editor waited 40 ms for it. With the values cached it never asks.
 */
export function primePixelStore(renderer: WebGLRenderer): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const name of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_IMAGES]) {
    renderer.state.pixelStorei(name, 0);
  }
}
