/**
 * Short alert tones synthesised in code, so a UI cue needs no audio asset.
 * The result is a data URL of a 16-bit mono PCM WAV, which the spatial audio
 * loader (three's AudioLoader: fetch, then decodeAudioData) reads like a file.
 */

export interface ToneNote {
  /** Pitch in Hz */
  freq: number;
  /** Length in ms */
  ms: number;
}

const SAMPLE_RATE = 22050;
/** Fade in and out per note, keeps the edges from clicking */
const EDGE_MS = 8;
/** Silence between two notes */
const GAP_MS = 35;
const HEADER_BYTES = 44;

/** Samples of a note of `ms` milliseconds at `sampleRate`. */
function samplesFor(ms: number, sampleRate: number): number {
  return Math.round((sampleRate * ms) / 1000);
}

/**
 * WAV bytes of `notes` played one after the other, sine waves with a soft
 * decay, `amplitude` 0..1 of full scale.
 */
export function toneWav(notes: readonly ToneNote[], amplitude = 0.5, sampleRate = SAMPLE_RATE): Uint8Array {
  const edge = Math.max(1, samplesFor(EDGE_MS, sampleRate));
  const gap = samplesFor(GAP_MS, sampleRate);
  const lengths = notes.map((n) => samplesFor(n.ms, sampleRate));
  const total = lengths.reduce((sum, len) => sum + len, 0) + gap * Math.max(0, notes.length - 1);
  const dataBytes = total * 2;

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
  notes.forEach((note, i) => {
    const len = lengths[i];
    for (let s = 0; s < len; s++) {
      const fade = Math.min(1, s / edge, (len - 1 - s) / edge);
      const decay = Math.exp((-2.5 * s) / len);
      const v = Math.sin((2 * Math.PI * note.freq * s) / sampleRate) * amplitude * fade * decay;
      view.setInt16(offset, Math.round(v * 32767), true);
      offset += 2;
    }
    // The gap stays zero, as the buffer was allocated
    if (i < notes.length - 1) offset += gap * 2;
  });
  return bytes;
}

/** `toneWav` as a `data:audio/wav;base64,...` URL. */
export function toneWavDataUrl(notes: readonly ToneNote[], amplitude?: number): string {
  const bytes = toneWav(notes, amplitude);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}
