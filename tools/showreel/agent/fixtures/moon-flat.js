// The Moon scene's start (w-moon): the south plain and the north band level and clear of rocks, so the
// symmetry's craters stand alone on smooth ground (ACCEPT point 4). Run by the relay before the take.
const bands = [{ y0: -250, y1: -140 }, { y0: 140, y1: 248 }];
const x0 = -172;
const step = 4;
const cols = 87;
for (const b of bands) {
  const rows = Math.round((b.y1 - b.y0) / step) + 1;
  map.heightGrid({ x: x0, y: b.y0 }, step, Array.from({ length: rows }, () => new Array(cols).fill(0)), { blend: 1, edge: 24 });
  const ids = map.objects({ x0: x0 - 10, y0: b.y0 - 10, x1: x0 + (cols - 1) * step + 10, y1: b.y1 + 10 }).map((o) => o.id);
  if (ids.length) map.removeObjects(ids);
  map.paint('regolith', [{ x: -150, y: (b.y0 + b.y1) / 2 }, { x: 150, y: (b.y0 + b.y1) / 2 }], { radius: (b.y1 - b.y0) / 2, falloff: 0.3 }, 1);
}
return map.issues().length;
