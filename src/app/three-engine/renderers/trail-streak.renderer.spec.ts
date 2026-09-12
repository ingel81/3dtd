import { describe, it, expect } from 'vitest';
import { BufferAttribute, Mesh, Scene, Vector3 } from 'three';
import { TrailStreakRenderer, getTrailStyle } from './trail-streak.renderer';

/**
 * Flies a rocket straight along +x, `step` metres between two pushes (one
 * push per rendered frame), and measures the streak drawn behind it along
 * its centre line.
 */
function rocketStreak(step: number, pushes: number): { length: number; head: Vector3 } {
  const trails = new TrailStreakRenderer(new Scene());
  trails.create('p1', 'rocket');
  const pos = new Vector3();
  for (let i = 0; i < pushes; i++) {
    pos.set(i * step, 10, 0);
    trails.pushPosition('p1', pos);
  }
  trails.updateAll();

  const { mesh } = (trails as unknown as { active: Map<string, { mesh: Mesh }> }).active.get('p1')!;
  const quads = mesh.geometry.drawRange.count / 6;
  const position = mesh.geometry.getAttribute('position') as BufferAttribute;
  // Each point is a vertex pair, one either side of the centre line
  const centre = (i: number) => new Vector3(
    (position.getX(2 * i) + position.getX(2 * i + 1)) / 2,
    (position.getY(2 * i) + position.getY(2 * i + 1)) / 2,
    (position.getZ(2 * i) + position.getZ(2 * i + 1)) / 2,
  );
  let length = 0;
  for (let i = 0; i < quads; i++) length += centre(i).distanceTo(centre(i + 1));
  const head = centre(0);
  trails.dispose();
  return { length, head };
}

describe('TrailStreakRenderer', () => {
  it('draws the rocket glow equally long at any frame rate and game speed', () => {
    const { length } = getTrailStyle('rocket');
    // A rocket (120 m/s) flies 2 m per frame at 60 FPS, 4 m at 30 FPS or
    // 2x speed, 8 m at 4x. The old four points drew 6, 12 and 24 m.
    for (const step of [2, 4, 8]) {
      const streak = rocketStreak(step, 20);
      expect(streak.length).toBeCloseTo(length, 5);
      expect(streak.head.x).toBeCloseTo(19 * step, 5); // starts at the newest position
    }
  });

  it('grows to its length as the projectile flies off', () => {
    expect(rocketStreak(2, 2).length).toBeCloseTo(2, 5);
    expect(rocketStreak(2, 3).length).toBeCloseTo(4, 5);
  });

  it('reaches its length with positions at the minimum spacing', () => {
    const { length, minSegmentDistSq } = getTrailStyle('rocket');
    expect(rocketStreak(Math.sqrt(minSegmentDistSq), 100).length).toBeCloseTo(length, 5);
  });
});
