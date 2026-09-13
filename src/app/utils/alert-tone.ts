/**
 * Short alert tones synthesised in code, so a UI cue needs no audio asset.
 * The result is a 16-bit mono PCM WAV (utils/pcm-wav.ts), as a data URL
 * read by the spatial audio loader like a file.
 */
import { pcmWav, wavDataUrl } from './pcm-wav';

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

  const samples = new Float32Array(total);
  let offset = 0;
  notes.forEach((note, i) => {
    const len = lengths[i];
    for (let s = 0; s < len; s++) {
      const fade = Math.min(1, s / edge, (len - 1 - s) / edge);
      const decay = Math.exp((-2.5 * s) / len);
      samples[offset++] = Math.sin((2 * Math.PI * note.freq * s) / sampleRate) * amplitude * fade * decay;
    }
    // The gap stays zero, as the buffer was allocated
    if (i < notes.length - 1) offset += gap;
  });
  return pcmWav(samples, sampleRate);
}

/** `toneWav` as a `data:audio/wav;base64,...` URL. */
export function toneWavDataUrl(notes: readonly ToneNote[], amplitude?: number): string {
  return wavDataUrl(toneWav(notes, amplitude));
}
