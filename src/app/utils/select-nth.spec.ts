import { selectNth } from './select-nth';

describe('selectNth', () => {
  it('finds the value a sort would put at the index, ties and edges too', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const n of [1, 2, 5, 100, 1001]) {
      const values = Float32Array.from({ length: n }, () => Math.round(rnd() * 20) - 10 + 0);
      const sorted = Float32Array.from(values).sort();
      for (const k of [0, Math.floor(n * 0.05), Math.floor(n / 2), n - 1]) expect(selectNth(Float32Array.from(values), k)).toBe(sorted[k]);
    }
  });
});
