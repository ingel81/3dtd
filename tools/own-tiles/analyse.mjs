// Reads a 3D Tiles tileset (with external tilesets) from disk and prints what
// the game needs to know about it: version, where it sits on the WGS84
// ellipsoid, the geometricError chain, bytes per level, glTF versions, and the
// height of the lowest surfaces (water, streets) to judge the height datum.
//
//   node tools/own-tiles/analyse.mjs <path to root tileset.json> [--samples N]
//
// Heights are sampled from the vertices of the first N b3dm tiles that sit
// directly under an external tileset root (coarsest LOD), default 40.
// No dependencies.

import fs from 'node:fs';
import path from 'node:path';

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, h };
}

const args = process.argv.slice(2);
const samplesFlag = args.indexOf('--samples');
const sampleCount = samplesFlag >= 0 ? Number(args.splice(samplesFlag, 2)[1]) : 40;
const rootFile = path.resolve(args[0] ?? '');
if (!args[0] || !fs.existsSync(rootFile)) {
  console.error('usage: node tools/own-tiles/analyse.mjs <tileset.json> [--samples N]');
  process.exit(2);
}

const rootJson = JSON.parse(fs.readFileSync(rootFile, 'utf8'));
const levels = new Map(); // geometricError -> { tiles, bytes, files }
const gltfVersions = new Map();
const spheres = [];
const coarsest = [];
let tilesetFiles = 0;
let maxDepth = 0;

function contentUri(tile) {
  return tile.content?.uri ?? tile.content?.url;
}

function readGltfVersion(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(64);
  fs.readSync(fd, head, 0, 64, 0);
  fs.closeSync(fd);
  const glbAt = 28 + head.readUInt32LE(12) + head.readUInt32LE(16) + head.readUInt32LE(20) + head.readUInt32LE(24);
  const fd2 = fs.openSync(file, 'r');
  const glb = Buffer.alloc(8);
  fs.readSync(fd2, glb, 0, 8, glbAt);
  fs.closeSync(fd2);
  return glb.toString('latin1', 0, 4) === 'glTF' ? glb.readUInt32LE(4) : 'none';
}

function visitTileset(json, dir, depth, underExternalRoot) {
  tilesetFiles++;
  const visit = (tile, d, isRoot) => {
    maxDepth = Math.max(maxDepth, d);
    const sphere = tile.boundingVolume?.sphere;
    if (sphere && !tile.children?.length) spheres.push(sphere);
    const uri = contentUri(tile);
    if (uri) {
      const file = path.join(dir, uri);
      if (uri.endsWith('.json')) {
        visitTileset(JSON.parse(fs.readFileSync(file, 'utf8')), path.dirname(file), d + 1, true);
      } else {
        const bytes = fs.statSync(file).size;
        const key = tile.geometricError;
        const lvl = levels.get(key) ?? { tiles: 0, bytes: 0, depth: d };
        lvl.tiles++;
        lvl.bytes += bytes;
        levels.set(key, lvl);
        if (lvl.tiles <= 3) {
          const v = readGltfVersion(file);
          gltfVersions.set(v, (gltfVersions.get(v) ?? 0) + 1);
        }
        if (isRoot && underExternalRoot) coarsest.push(file);
      }
    }
    for (const child of tile.children ?? []) visit(child, d + 1, false);
  };
  visit(json.root, depth, true);
}

visitTileset(rootJson, path.dirname(rootFile), 0, false);

// Footprint from the leaf bounding spheres.
let minLat = Infinity;
let maxLat = -Infinity;
let minLon = Infinity;
let maxLon = -Infinity;
for (const [x, y, z] of spheres) {
  const g = ecefToGeodetic(x, y, z);
  minLat = Math.min(minLat, g.lat);
  maxLat = Math.max(maxLat, g.lat);
  minLon = Math.min(minLon, g.lon);
  maxLon = Math.max(maxLon, g.lon);
}
const centerLat = (minLat + maxLat) / 2;
const centerLon = (minLon + maxLon) / 2;
const mPerDegLat = 111132.92 - 559.82 * Math.cos((2 * centerLat * Math.PI) / 180);
const mPerDegLon = 111412.84 * Math.cos((centerLat * Math.PI) / 180);
const widthM = (maxLon - minLon) * mPerDegLon;
const heightM = (maxLat - minLat) * mPerDegLat;

// Vertex heights of the coarsest tiles (glTF 2 only, as written by convert-gltf1).
function vertexHeights(file) {
  const buf = fs.readFileSync(file);
  const ftLen = buf.readUInt32LE(12);
  const ft = ftLen ? JSON.parse(buf.toString('utf8', 28, 28 + ftLen)) : {};
  const glbAt = 28 + ftLen + buf.readUInt32LE(16) + buf.readUInt32LE(20) + buf.readUInt32LE(24);
  const glb = buf.subarray(glbAt);
  if (glb.readUInt32LE(4) !== 2) return null;
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen));
  const bin = glb.subarray(20 + jsonLen + 8);
  const rtc = ft.RTC_CENTER ?? gltf.extensions?.CESIUM_RTC?.center ?? [0, 0, 0];
  const up = rootJson.asset?.gltfUpAxis ?? 'Y';
  const out = [];
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      const acc = gltf.accessors[prim.attributes.POSITION];
      const view = gltf.bufferViews[acc.bufferView];
      const off = bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const f = new Float32Array(bin.buffer.slice(off, off + acc.count * 12));
      for (let i = 0; i < f.length; i += 3) {
        // Y-up glTF to Z-up ECEF: rotate +90 degrees about X, as Cesium does.
        const [x, y, z] = up.toUpperCase() === 'Y' ? [f[i], -f[i + 2], f[i + 1]] : [f[i], f[i + 1], f[i + 2]];
        out.push(ecefToGeodetic(x + rtc[0], y + rtc[1], z + rtc[2]).h);
      }
    }
  }
  return out;
}

const heights = [];
for (const file of coarsest.slice(0, sampleCount)) {
  const h = vertexHeights(file);
  if (h) heights.push(...h);
}
heights.sort((a, b) => a - b);
const pct = (p) => (heights.length ? heights[Math.floor((heights.length - 1) * p)].toFixed(1) : 'n/a');

const mb = (n) => (n / 1e6).toFixed(1);
console.log(`asset: ${JSON.stringify(rootJson.asset)}`);
console.log(`root transform: ${rootJson.root.transform ? JSON.stringify(rootJson.root.transform) : 'none (content in ECEF)'}`);
console.log(`tileset files: ${tilesetFiles}, max depth ${maxDepth}, leaf spheres ${spheres.length}`);
console.log(`glTF versions (sampled): ${JSON.stringify(Object.fromEntries(gltfVersions))}`);
console.log(`footprint lat ${minLat.toFixed(5)}..${maxLat.toFixed(5)}, lon ${minLon.toFixed(5)}..${maxLon.toFixed(5)}`);
console.log(`center ${centerLat.toFixed(5)}, ${centerLon.toFixed(5)}; ${widthM.toFixed(0)} m x ${heightM.toFixed(0)} m (leaf centers)`);
console.log('levels (geometricError: tiles, MB, depth):');
const sorted = [...levels.entries()].sort((a, b) => b[0] - a[0]);
let total = 0;
for (const [ge, l] of sorted) {
  total += l.bytes;
  console.log(`  ${ge}: ${l.tiles} tiles, ${mb(l.bytes)} MB, ${(l.bytes / l.tiles / 1e3).toFixed(0)} kB avg, depth ${l.depth}`);
}
console.log(`  total ${mb(total)} MB`);
console.log(`ellipsoid heights of ${coarsest.slice(0, sampleCount).length} coarsest tiles (${heights.length} vertices):`);
console.log(`  min ${pct(0)}, p1 ${pct(0.01)}, p5 ${pct(0.05)}, p25 ${pct(0.25)}, median ${pct(0.5)}, p95 ${pct(0.95)}, max ${pct(1)}`);
