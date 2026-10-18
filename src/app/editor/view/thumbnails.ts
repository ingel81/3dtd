/**
 * Small pictures for the palettes when the catalogue brings none: a ground
 * material as its colour with some grain, an object as its stand-in shape
 * in its colour, a biome as a small scene. Written as SVG text: no canvas
 * and no PNG to encode (toDataURL held the frame the object palette first
 * showed in by some 230 ms). Each picture is written once per look and kept.
 */
import type { CatalogIndex, GroundMaterialEntry, ObjectAssetEntry } from '../../map-ops/asset-catalog';
import type { BiomeDef } from '../ops/landscape/biomes';

const SIZE = 64;
const cache = new Map<string, string>();

/** A picture once per key */
function kept(key: string, draw: () => string): string {
  let url = cache.get(key);
  if (!url) cache.set(key, (url = svgUrl(draw())));
  return url;
}

function svgUrl(body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`)}`;
}

/** A fixed series of numbers in 0..1 from a text */
function series(text: string, start: number): () => number {
  let seed = [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, start);
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

const n1 = (v: number) => Math.round(v * 10) / 10;

/** Lighter and darker square specks over the whole picture, `count` of them, sized `min` to `min + spread` */
function grain(rnd: () => number, count: number, light: string, dark: string, min: number, spread: number): string {
  let lights = '';
  let darks = '';
  for (let k = 0; k < count; k++) {
    const isLight = rnd() > 0.5;
    const s = spread ? n1(min + rnd() * spread) : min;
    const square = `M${n1(rnd() * SIZE)} ${n1(rnd() * SIZE)}h${s}v${s}h-${s}z`;
    if (isLight) lights += square;
    else darks += square;
  }
  return `<path fill="${light}" d="${lights}"/><path fill="${dark}" d="${darks}"/>`;
}

/** An ellipse at a random spot, `rx0 + rnd * rxs` by `ry0 + rnd * rys`, turned at random */
function patch(rnd: () => number, rx0: number, rxs: number, ry0: number, rys: number): string {
  const x = n1(rnd() * SIZE);
  const y = n1(rnd() * SIZE);
  const rx = n1(rx0 + rnd() * rxs);
  const ry = n1(ry0 + rnd() * rys);
  const turn = n1((rnd() * 3 * 180) / Math.PI);
  return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${turn} ${x} ${y})"/>`;
}

export function materialThumbnail(m: GroundMaterialEntry): string {
  if (m.thumbnail) return m.thumbnail;
  return kept(`m:${m.id}:${m.color}`, () => `<rect width="${SIZE}" height="${SIZE}" fill="${m.color}"/>${grain(series(m.id, 7), 420, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.16)', 1, 3)}`);
}

export function objectThumbnail(o: ObjectAssetEntry): string {
  if (o.thumbnail) return o.thumbnail;
  // By look, not by asset: many entries share a shape and a colour
  return kept(`o:${o.color}:${o.shape}`, () => {
    const ground = SIZE - 8;
    const mid = SIZE / 2;
    const trunk = `<rect x="${mid - 3}" y="${ground - 16}" width="6" height="16" fill="#5a4532" stroke="none"/>`;
    let shape: string;
    switch (o.shape) {
      case 'tree':
        shape = `${trunk}<circle cx="${mid}" cy="${ground - 30}" r="18"/>`;
        break;
      case 'pine':
        shape = `${trunk}<path d="M${mid} 6L${mid + 18} ${ground - 12}L${mid - 18} ${ground - 12}Z"/>`;
        break;
      case 'bush':
        shape = `<ellipse cx="${mid}" cy="${ground - 10}" rx="22" ry="13"/>`;
        break;
      case 'rock':
        shape = `<path d="M12 ${ground}L18 ${ground - 20}L34 ${ground - 28}L50 ${ground - 16}L54 ${ground}Z"/>`;
        break;
      case 'house':
        shape = `<path d="M14 ${ground - 22}h36v22h-36zM10 ${ground - 22}L${mid} ${ground - 42}L54 ${ground - 22}Z"/>`;
        break;
      case 'tower':
        shape = `<rect x="20" y="8" width="24" height="${ground - 8}"/>`;
        break;
      case 'wall':
        shape = `<rect x="6" y="${ground - 14}" width="${SIZE - 12}" height="14"/>`;
        break;
      default:
        shape = `<rect x="16" y="${ground - 26}" width="32" height="26"/>`;
    }
    return `<g fill="${o.color}" stroke="rgba(0,0,0,0.45)" stroke-width="1.5">${shape}</g>`;
  });
}

/** A biome as a small scene: its ground colours as patches with grain, its plants as dots in their colours */
export function biomeThumbnail(b: BiomeDef, catalog: CatalogIndex): string {
  return kept(`b:${b.id}:${catalog.catalog.materials.length}:${catalog.catalog.objects.length}`, () => {
    const rnd = series(b.id, 3);
    const grounds = b.ground.map((g) => catalog.material(g.material.find((m) => catalog.materials.has(m)) ?? g.material[0]).color);
    let out = `<rect width="${SIZE}" height="${SIZE}" fill="${grounds[0]}"/>`;
    for (let k = 1; k < grounds.length; k++) {
      out += `<g fill="${grounds[k]}">`;
      for (let n = 0; n < 6; n++) out += patch(rnd, 6, 10, 4, 6);
      out += '</g>';
    }
    if (b.pools) {
      out += '<g fill="#2f5f6f">';
      for (let n = 0; n < 3; n++) out += patch(rnd, 6, 6, 3, 4);
      out += '</g>';
    }
    out += grain(rnd, 300, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)', 2, 0);
    for (const o of b.objects) {
      const asset = o.assets.find((a) => catalog.objects.has(a)) ?? o.assets[0];
      const entry = catalog.object(asset);
      const count = Math.min(14, Math.max(1, Math.round(o.perHectare / 10)));
      const r = n1(Math.max(1.5, Math.min(6, entry.radius * 1.4)));
      out += `<g fill="${entry.color}" stroke="rgba(0,0,0,0.4)">`;
      for (let n = 0; n < count; n++) out += `<circle cx="${n1(4 + rnd() * (SIZE - 8))}" cy="${n1(4 + rnd() * (SIZE - 8))}" r="${r}"/>`;
      out += '</g>';
    }
    return out;
  });
}
