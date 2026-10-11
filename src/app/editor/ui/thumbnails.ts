/**
 * Small pictures for the palettes when the catalogue brings none: a ground
 * material as its colour with some grain, an object as its stand-in shape
 * in its colour. Drawn once per entry into a data URL.
 */
import type { CatalogIndex, GroundMaterialEntry, ObjectAssetEntry } from '../catalog/asset-catalog';
import type { BiomeDef } from '../ops/landscape/biomes';

const SIZE = 64;
const cache = new Map<string, string>();

export function materialThumbnail(m: GroundMaterialEntry): string {
  if (m.thumbnail) return m.thumbnail;
  const key = `m:${m.id}:${m.color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, c } = surface();
  c.fillStyle = m.color;
  c.fillRect(0, 0, SIZE, SIZE);
  // Grain: a fixed pattern from the id, lighter and darker specks
  let seed = [...m.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 420; k++) {
    c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.16)';
    const s = 1 + rnd() * 3;
    c.fillRect(rnd() * SIZE, rnd() * SIZE, s, s);
  }
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function objectThumbnail(o: ObjectAssetEntry): string {
  if (o.thumbnail) return o.thumbnail;
  const key = `o:${o.id}:${o.color}:${o.shape}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, c } = surface();
  c.fillStyle = o.color;
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = 1.5;
  const ground = SIZE - 8;
  const trunk = () => {
    c.save();
    c.fillStyle = '#5a4532';
    c.fillRect(SIZE / 2 - 3, ground - 16, 6, 16);
    c.restore();
  };
  c.beginPath();
  switch (o.shape) {
    case 'tree':
      trunk();
      c.arc(SIZE / 2, ground - 30, 18, 0, Math.PI * 2);
      break;
    case 'pine':
      trunk();
      c.moveTo(SIZE / 2, 6);
      c.lineTo(SIZE / 2 + 18, ground - 12);
      c.lineTo(SIZE / 2 - 18, ground - 12);
      c.closePath();
      break;
    case 'bush':
      c.ellipse(SIZE / 2, ground - 10, 22, 13, 0, 0, Math.PI * 2);
      break;
    case 'rock':
      c.moveTo(12, ground);
      c.lineTo(18, ground - 20);
      c.lineTo(34, ground - 28);
      c.lineTo(50, ground - 16);
      c.lineTo(54, ground);
      c.closePath();
      break;
    case 'house':
      c.rect(14, ground - 22, 36, 22);
      c.moveTo(10, ground - 22);
      c.lineTo(SIZE / 2, ground - 42);
      c.lineTo(54, ground - 22);
      c.closePath();
      break;
    case 'tower':
      c.rect(20, 8, 24, ground - 8);
      break;
    case 'wall':
      c.rect(6, ground - 14, SIZE - 12, 14);
      break;
    default:
      c.rect(16, ground - 26, 32, 26);
  }
  c.fill();
  c.stroke();
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

function surface(): { canvas: HTMLCanvasElement; c: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  return { canvas, c: canvas.getContext('2d')! };
}

/** A biome as a small scene: its ground colours as bands with grain, its plants as dots in their colours */
export function biomeThumbnail(b: BiomeDef, catalog: CatalogIndex): string {
  const key = `b:${b.id}:${catalog.catalog.materials.length}:${catalog.catalog.objects.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { canvas, c } = surface();
  let seed = [...b.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 3);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const grounds = b.ground.map((g) => catalog.material(g.material.find((m) => catalog.materials.has(m)) ?? g.material[0]).color);
  c.fillStyle = grounds[0];
  c.fillRect(0, 0, SIZE, SIZE);
  for (let k = 1; k < grounds.length; k++) {
    c.fillStyle = grounds[k];
    for (let n = 0; n < 6; n++) {
      c.beginPath();
      c.ellipse(rnd() * SIZE, rnd() * SIZE, 6 + rnd() * 10, 4 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (b.pools) {
    c.fillStyle = '#2f5f6f';
    for (let n = 0; n < 3; n++) {
      c.beginPath();
      c.ellipse(rnd() * SIZE, rnd() * SIZE, 6 + rnd() * 6, 3 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
  }
  for (let k = 0; k < 300; k++) {
    c.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
    c.fillRect(rnd() * SIZE, rnd() * SIZE, 2, 2);
  }
  for (const o of b.objects) {
    const asset = o.assets.find((a) => catalog.objects.has(a)) ?? o.assets[0];
    const entry = catalog.object(asset);
    const count = Math.min(14, Math.max(1, Math.round(o.perHectare / 10)));
    const r = Math.max(1.5, Math.min(6, entry.radius * 1.4));
    for (let n = 0; n < count; n++) {
      c.fillStyle = entry.color;
      c.strokeStyle = 'rgba(0,0,0,0.4)';
      c.beginPath();
      c.arc(4 + rnd() * (SIZE - 8), 4 + rnd() * (SIZE - 8), r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
