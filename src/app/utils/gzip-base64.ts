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

export async function gunzipBase64(gz: string): Promise<string> {
  const binary = atob(gz);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
