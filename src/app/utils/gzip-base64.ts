/** Text as gzip in base64, and back: for what goes through the relay as a string (run logs, resync states) */
export async function gzipBase64(text: string): Promise<string> {
  const stream = new Response(new TextEncoder().encode(text)).body!.pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The text back from gzip in base64. `maxBytes` bounds what it unpacks to:
 * a few MB of gzip can unpack to gigabytes (a changed client's resync state),
 * and the tab would die on it; past the bound it throws.
 */
export async function gunzipBase64(gz: string, maxBytes = Infinity): Promise<string> {
  const binary = atob(gz);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  if (maxBytes === Infinity) return new Response(stream).text();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`unpacks to more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}
