// Reading and writing the packed GLBs with glTF Transform.
import { Format, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** glTF Transform's IO with every extension and the meshopt codec */
export async function createIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** The JSON chunk of a GLB file */
export function glbJson(bytes) {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

/**
 * A GLB whose images keep their URIs: glTF Transform embeds every image in a
 * GLB, so the document is written as glTF and its one binary buffer becomes
 * the GLB's BIN chunk. Images with a URI (shared KTX2 files) stay outside,
 * the others are embedded as buffer views by the caller beforehand.
 */
export async function writeGlbKeepingUris(io, doc) {
  const { json, resources } = await io.writeJSON(doc, { format: Format.GLTF });
  const withUri = (json.buffers ?? []).filter((b) => b.uri !== undefined);
  if (withUri.length > 1) throw new Error('more than one binary buffer');
  let bin = Buffer.alloc(0);
  if (withUri.length === 1) {
    bin = Buffer.from(resources[withUri[0].uri]);
    delete withUri[0].uri;
    // The GLB buffer is the first one
    const index = json.buffers.indexOf(withUri[0]);
    if (index !== 0) throw new Error('the binary buffer is not the first');
  }
  const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = pad(bin, 0);
  const chunks = [chunk(jsonChunk, 0x4e4f534a)];
  if (binChunk.length) chunks.push(chunk(binChunk, 0x004e4942));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + chunks.reduce((n, c) => n + c.length, 0), 8);
  return Buffer.concat([header, ...chunks]);
}

function chunk(data, type) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(data.length, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
}
