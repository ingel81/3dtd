import { describe, it, expect } from 'vitest';
import { toneWav, toneWavDataUrl } from './alert-tone';

const text = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.subarray(from, from + len));

describe('toneWav', () => {
  it('writes a 16-bit mono PCM header', () => {
    const wav = toneWav([{ freq: 440, ms: 100 }], 0.5, 8000);
    const view = new DataView(wav.buffer);
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(wav, 36, 4)).toBe('data');
  });

  it('holds the notes plus one gap between two notes', () => {
    const wav = toneWav([{ freq: 440, ms: 100 }, { freq: 330, ms: 50 }], 0.5, 8000);
    const dataBytes = new DataView(wav.buffer).getUint32(40, true);
    // 800 + 400 samples, 35 ms gap = 280 samples, 2 bytes each
    expect(dataBytes).toBe((800 + 400 + 280) * 2);
    expect(wav.length).toBe(44 + dataBytes);
  });

  it('starts silent and stays below the amplitude', () => {
    const wav = toneWav([{ freq: 440, ms: 100 }], 0.5, 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    let peak = 0;
    for (let o = 44; o < wav.length; o += 2) peak = Math.max(peak, Math.abs(view.getInt16(o, true)));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(Math.round(0.5 * 32767));
  });
});

describe('toneWavDataUrl', () => {
  it('encodes the bytes as a WAV data URL', () => {
    const url = toneWavDataUrl([{ freq: 880, ms: 20 }]);
    expect(url.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
  });
});
