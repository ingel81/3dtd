import { describe, it, expect } from 'vitest';
import {
  benchmarkUrl, browserOf, formatBenchmark, isBenchmarkSearch, osOf, shortGpu, type BenchmarkEnv, type BenchmarkRow,
} from './benchmark-report';

const env: BenchmarkEnv = {
  date: '2026-09-30T01:23:45.000Z',
  version: 'v0.5.1',
  commit: '5f12875b',
  dirty: false,
  browser: 'Chrome 141',
  os: 'Windows',
  threads: 32,
  memoryGb: 8,
  gpu: 'NVIDIA GeForce RTX 5080',
  devicePixelRatio: 1,
  viewport: [1600, 900],
  sharedMemory: true,
  towers: 40,
};

const row = (enemies: number, speedSet: number, settled = true): BenchmarkRow => ({
  enemiesAsked: enemies, enemies, speedSet, fps: 143.6, p05: 120.2, speed: speedSet * 0.97, ticksPerS: 143.6,
  workerLoad: 0.372, applyPerPacketMs: 1.234, settled,
});

describe('benchmark report', () => {
  it('sends the page into the DevWorld with the flag and the bot off, and knows the flag again', () => {
    const url = benchmarkUrl('https://3dtd.example/?l=48.7,9.1#x');
    expect(url).toBe('https://3dtd.example/?devworld=&bot=manual&benchmark=');
    expect(isBenchmarkSearch(new URL(url).search)).toBe(true);
    expect(isBenchmarkSearch('?benchmark')).toBe(false);
    expect(isBenchmarkSearch('?devworld')).toBe(false);
  });

  it('writes a head and one line per measurement with the machine in every line', () => {
    const text = formatBenchmark(env, [row(2000, 4), row(2000, 1, false)]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('3DTD benchmark 2026-09-30 01:23');
    expect(text).toContain('cannot read the CPU model');
    expect(text).toContain('memory shared (SharedArrayBuffer)');
    expect(text).toContain('* frame rate had not settled');
    const table = lines.slice(lines.indexOf('') + 1);
    expect(table).toHaveLength(3);
    expect(table[0]).toMatch(/^Version +Commit +Browser +OS +Threads +Memory +GPU +DPR +Viewport +Enemies +Speed +FPS +p05 +Reached +Ticks\/s +Worker +Apply\/packet$/);
    expect(table[1]).toMatch(/^v0\.5\.1 +5f12875b +Chrome 141 +Windows +32 +8 GB +NVIDIA GeForce RTX 5080 +1 +1600x900 +2000 +4x +144 +120 +3\.88 +144 +37 % +1\.23 ms$/);
    expect(table[2]).toContain('0.97*');
    // Columns line up
    expect(table[1].indexOf('2000')).toBe(table[0].indexOf('Enemies'));
  });

  it('marks unknown memory and a build with changes', () => {
    const text = formatBenchmark({ ...env, memoryGb: null, dirty: true, sharedMemory: false }, [row(5000, 4)]);
    expect(text).toContain('5f12875b+');
    expect(text).toMatch(/ \? +NVIDIA/);
    expect(text).toContain('copied per frame');
  });

  it('names the browser, the system and the GPU from what the page can read', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.37 Safari/537.36';
    expect(browserOf(chrome)).toBe('Chrome 141');
    expect(osOf(chrome)).toBe('Windows');
    expect(browserOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0')).toBe('Firefox 142.0');
    expect(browserOf(chrome + ' Edg/141.0.0.0')).toBe('Edge 141');
    expect(shortGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 5080');
    expect(shortGpu('Apple M2')).toBe('Apple M2');
  });
});
