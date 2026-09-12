// One-screen summary of GLB files from their JSON chunk: materials (alpha
// mode, factors, which textures), embedded images, animations with channel
// count and length, node and mesh counts. Handy to check what a Blender round
// trip changed in a model.
//
// usage (from the repo root, Node 24):
//   node tools/model-budget/glb-summary.mjs <a.glb> [<b.glb> ...]
import { readFileSync } from 'node:fs';

function readJson(path) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

function summary(path) {
  const j = readJson(path);
  const lines = [];
  const tex = (t) => (t ? `img${j.textures[t.index].source}` : '-');
  for (const m of j.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    lines.push(`mat ${m.name}: alpha=${m.alphaMode ?? 'OPAQUE'}${m.alphaCutoff !== undefined ? '/' + m.alphaCutoff : ''}`
      + ` double=${!!m.doubleSided} base=${JSON.stringify(p.baseColorFactor ?? [1, 1, 1, 1])} map=${tex(p.baseColorTexture)}`
      + ` mr=${tex(p.metallicRoughnessTexture)} metal=${p.metallicFactor ?? 1} rough=${p.roughnessFactor ?? 1}`
      + ` normal=${tex(m.normalTexture)} occl=${tex(m.occlusionTexture)}`
      + ` emissive=${JSON.stringify(m.emissiveFactor ?? [0, 0, 0])}/${tex(m.emissiveTexture)}`
      + ` ext=${Object.keys(m.extensions ?? {}).join('+')}`);
  }
  (j.images ?? []).forEach((im, i) => {
    const size = im.bufferView !== undefined ? j.bufferViews[im.bufferView].byteLength + ' B' : im.uri;
    lines.push(`img${i} ${im.name ?? ''} ${im.mimeType ?? ''} ${size}`);
  });
  for (const a of j.animations ?? []) {
    let end = 0;
    for (const s of a.samplers) end = Math.max(end, j.accessors[s.input].max?.[0] ?? 0);
    lines.push(`anim ${a.name}: ${a.channels.length} channels, ${end.toFixed(4)} s`);
  }
  const meshNodes = (j.nodes ?? []).filter((n) => n.mesh !== undefined).length;
  const primitives = (j.meshes ?? []).reduce((s, m) => s + m.primitives.length, 0);
  lines.push(`nodes ${j.nodes?.length ?? 0}, mesh nodes ${meshNodes}, skins ${j.skins?.length ?? 0}, `
    + `meshes ${j.meshes?.length ?? 0}, primitives ${primitives}`);
  lines.push(`extensionsUsed ${JSON.stringify(j.extensionsUsed ?? [])}`);
  return lines;
}

for (const path of process.argv.slice(2)) {
  console.log(`== ${path}`);
  for (const line of summary(path)) console.log('  ' + line);
}
