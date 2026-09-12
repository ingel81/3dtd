import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { ShakeBenchmark } from './screen-shake-benchmark';

describe('ShakeBenchmark', () => {
  it('runs off, shake and camera-move in turn and reports one row per phase', async () => {
    const shake = vi.fn();
    const camera = { position: new Vector3(10, 400, -145) };
    const bench = new ShakeBenchmark(100, 0, shake);
    const phases: string[] = [];

    // 16 ms frames; the tiles traverse only in the camera-move phase
    let now = 0;
    while (bench.beginFrame(now, camera)) {
      phases.push(bench.phase);
      const moved = !camera.position.equals(new Vector3(10, 400, -145));
      expect(moved).toBe(bench.phase === 'camera-move');
      bench.endFrame(now + 4, camera, bench.phase === 'camera-move' ? 3 : 0.01, bench.phase === 'camera-move');
      expect(camera.position.equals(new Vector3(10, 400, -145))).toBe(true); // always put back
      now += 16;
    }

    expect([...new Set(phases)]).toEqual(['off', 'shake', 'camera-move']);
    expect(shake).toHaveBeenCalledTimes(phases.filter((p) => p === 'shake').length);

    const rows = await bench.done;
    expect(rows.map((r) => r.phase)).toEqual(['off', 'shake', 'camera-move']);
    for (const row of rows) {
      expect(row.frames).toBeGreaterThan(0);
      expect(row.frameMs).toBeCloseTo(16);
      expect(row.renderMs).toBeCloseTo(4);
    }
    expect(rows[0].traversals).toBe(0);
    expect(rows[2].traversals).toBe(rows[2].frames);
    expect(rows[2].tilesUpdateMs).toBeCloseTo(3);
  });
});
