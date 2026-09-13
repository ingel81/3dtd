/**
 * 16-bit mono PCM WAV files built in memory, for sounds synthesised in code
 * (alert tones, the ooze). As a data URL the spatial audio loader (three's
 * AudioLoader: fetch, then decodeAudioData) reads them like a file.
 */

const HEADER_BYTES = 44;

/** WAV bytes of `samples` (-1..1, clamped) at `sampleRate`. */
export function pcmWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (const sample of samples) {
    const v = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, Math.round(v * 32767), true);
    offset += 2;
  }
  return bytes;
}

/** WAV `bytes` as a `data:audio/wav;base64,...` URL. */
export function wavDataUrl(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}
