/** The value that would stand at index `n` of `values` sorted ascending; reorders `values` (Hoare's selection) */
export function selectNth(values: Float32Array, n: number): number {
  let lo = 0;
  let hi = values.length - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const t = values[i];
        values[i] = values[j];
        values[j] = t;
        i++;
        j--;
      }
    }
    if (n <= j) hi = j;
    else if (n >= i) lo = i;
    else break;
  }
  return values[n];
}
