import { describe, it, expect } from 'vitest';
import { pcmWav, wavDataUrl } from './pcm-wav';

describe('pcmWav', () => {
  it('writes every sample as 16 bit, clamped to full scale', () => {
    const wav = pcmWav(new Float32Array([0, 0.5, -0.5, 2, -2]), 8000);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(10);
    // Math.round takes halves up: -16383.5 becomes -16383
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16384, -16383, 32767, -32767]);
  });
});

describe('wavDataUrl', () => {
  it('encodes the bytes as a WAV data URL', () => {
    const url = wavDataUrl(pcmWav(new Float32Array(4), 8000));
    expect(url.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
  });
});
