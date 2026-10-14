/// <reference lib="webworker" />
/**
 * Encodes the palette pictures as PNG off the page's thread: reading the
 * pixels back from the GPU and the encoding wait here, not in a frame.
 */
addEventListener('message', async (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    postMessage({ id, blob: await canvas.convertToBlob({ type: 'image/png' }) });
  } catch {
    postMessage({ id, blob: null });
  } finally {
    bitmap.close();
  }
});
