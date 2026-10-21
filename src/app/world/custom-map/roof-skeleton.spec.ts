import { cleanRings, straightSkeleton, type Skeleton } from './roof-skeleton';

/** The ridge's length of a skeleton: the arcs between nodes off the rings */
function innerArcs(sk: Skeleton): [number, number][] {
  const corners = sk.rings.reduce((s, r) => s + r.length / 2, 0);
  const out: [number, number][] = [];
  sk.links.forEach((around, a) => {
    for (const b of around) if (a < b && a >= corners && b >= corners) out.push([a, b]);
  });
  return out;
}

function node(sk: Skeleton, k: number): [number, number, number] {
  return [sk.nodes[3 * k], sk.nodes[3 * k + 1], sk.nodes[3 * k + 2]];
}

describe('straightSkeleton', () => {
  it('runs a rectangle up to a ridge along its longer side', () => {
    const sk = straightSkeleton([[0, 0, 20, 0, 20, 10, 0, 10]])!;
    expect(sk).not.toBeNull();
    expect(sk.faces.length).toBe(4);
    expect(sk.maxT).toBeCloseTo(5, 6);
    const ridge = innerArcs(sk);
    expect(ridge.length).toBe(1);
    const [a, b] = ridge[0].map((k) => node(sk, k));
    expect(Math.abs(a[0] - b[0])).toBeCloseTo(10, 3);
    expect(a[1]).toBeCloseTo(5, 6);
    // The long sides trapezoids, the ends triangles
    expect(sk.faces.map((f) => f.length).sort()).toEqual([3, 3, 4, 4]);
  });

  it('takes either way round and leaves out straight corners', () => {
    const sk = straightSkeleton([[0, 10, 10, 10, 20, 10, 20, 0, 0, 0]])!;
    expect(sk.rings[0].length).toBe(8);
    expect(sk.maxT).toBeCloseTo(5, 6);
  });

  it('runs an L into two ridges meeting over the valley', () => {
    // Two wings 8 m wide: 30 m along x, 24 m along z
    const sk = straightSkeleton([[0, 0, 30, 0, 30, 8, 8, 8, 8, 24, 0, 24]])!;
    expect(sk).not.toBeNull();
    expect(sk.faces.length).toBe(6);
    expect(sk.maxT).toBeCloseTo(4, 3);
    // The valley from the inner corner (8, 8) to the ridges' meeting point (4, 4)
    const inner = 3;
    const up = sk.links[inner].filter((k) => k >= 6).map((k) => node(sk, k));
    expect(up.length).toBe(1);
    expect(up[0][0]).toBeCloseTo(4, 3);
    expect(up[0][1]).toBeCloseTo(4, 3);
  });

  it('runs a T and a U', () => {
    const t = straightSkeleton([[0, 0, 10, 0, 10, 20, 25, 20, 25, 30, -15, 30, -15, 20, 0, 20]]);
    expect(t).not.toBeNull();
    expect(t!.maxT).toBeCloseTo(5, 3);
    const u = straightSkeleton([[0, 0, 30, 0, 30, 25, 22, 25, 22, 8, 8, 8, 8, 25, 0, 25]]);
    expect(u).not.toBeNull();
    expect(u!.maxT).toBeCloseTo(4, 3);
  });

  it('runs wings round a courtyard', () => {
    const sk = straightSkeleton([
      [0, 0, 40, 0, 40, 40, 0, 40],
      [10, 10, 30, 10, 30, 30, 10, 30],
    ])!;
    expect(sk).not.toBeNull();
    expect(sk.faces.length).toBe(8);
    expect(sk.maxT).toBeCloseTo(5, 3);
  });

  it('runs a skewed wing and a crooked outline', () => {
    const skew = straightSkeleton([[0, 0, 22, 3, 21, 13, -2, 11]]);
    expect(skew).not.toBeNull();
    const crooked = straightSkeleton([[0, 0, 14, 0.5, 15, 7, 11, 8, 12, 15, 1, 14, -0.5, 6]]);
    expect(crooked).not.toBeNull();
  });

  it('runs a wing that narrows and widens again', () => {
    const sk = straightSkeleton([[0, 0, 12, 0, 12, 4, 30, 4, 30, 0, 42, 0, 42, 12, 0, 12]]);
    expect(sk).not.toBeNull();
    expect(sk!.maxT).toBeCloseTo(6, 3);
  });

  it('runs a cross of equal arms (the meeting in one point)', () => {
    const sk = straightSkeleton([[10, 0, 20, 0, 20, 10, 30, 10, 30, 20, 20, 20, 20, 30, 10, 30, 10, 20, 0, 20, 0, 10, 10, 10]]);
    expect(sk).not.toBeNull();
  });

  it('runs many-cornered outlines', () => {
    // A round tower and a star
    const round: number[] = [];
    const star: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      round.push(8 * Math.cos(a), 8 * Math.sin(a));
      const r = i % 2 ? 6 : 14;
      star.push(r * Math.cos(a), r * Math.sin(a));
    }
    expect(straightSkeleton([round])).not.toBeNull();
    expect(straightSkeleton([star])).not.toBeNull();
  });

  it('lets walls stand still: the slopes beside run on up to them, their gables the nodes along them', () => {
    // A rectangle whose two ends stand: a gable roof, the ridge from end to end
    const sk = straightSkeleton([[0, 0, 20, 0, 20, 10, 0, 10]], [1, 3])!;
    expect(sk).not.toBeNull();
    expect(sk.maxT).toBeCloseTo(5, 6);
    expect(sk.faces[1]).toEqual([]);
    const chain = sk.chains[1].map((k) => node(sk, k));
    expect(chain.length).toBe(3);
    expect(chain[1][0]).toBeCloseTo(20, 6);
    expect(chain[1][1]).toBeCloseTo(5, 6);
    expect(chain[1][2]).toBeCloseTo(5, 6);
    // The long sides' faces reach the ends: rectangles, no hips
    expect(sk.faces[0].length).toBe(4);
    // A narrow house between two others (its long sides stand): sloped front and back, the ridge across it
    const party = straightSkeleton([[0, 0, 8, 0, 8, 14, 0, 14]], [1, 3])!;
    expect(party.maxT).toBeCloseTo(7, 6);
    expect(party.chains[1].length).toBe(3);
  });

  it('stands a wing\'s mitred end against its neighbour: both walls of the end still, the slopes up to them', () => {
    // A wing 10 m wide, its east end a short wall and a mitre at 45 degrees
    const sk = straightSkeleton([[0, 0, 30, 0, 36, 6, 36, 10, 0, 10]], [1, 2, 4])!;
    expect(sk).not.toBeNull();
    expect(sk.maxT).toBeCloseTo(5, 3);
    // The mitre's gable rises towards the corner between the two still walls
    expect(Math.max(...sk.chains[1].map((k) => node(sk, k)[2]))).toBeGreaterThan(4);
  });

  it('makes a lean-to round a courtyard: the outer walls stand, the slopes rise from the courtyard', () => {
    const sk = straightSkeleton([[0, 0, 30, 0, 30, 30, 0, 30], [6, 6, 24, 6, 24, 24, 6, 24]], [0, 1, 2, 3])!;
    expect(sk).not.toBeNull();
    // The courtyard's walls sweep the whole wing's width up to the outer walls (the corners a few mm off where events coincide)
    expect(sk.maxT).toBeCloseTo(6, 1);
  });

  it('gives up nothing it cannot make: an outline with no area', () => {
    expect(cleanRings([[0, 0, 10, 0, 20, 0]])).toBeNull();
    expect(straightSkeleton([[0, 0, 10, 0, 20, 0]])).toBeNull();
  });
});
