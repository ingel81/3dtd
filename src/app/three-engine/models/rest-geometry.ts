import { BufferGeometry } from 'three';

/** Whether `geometry` carries morph targets */
export function hasMorphTargets(geometry: BufferGeometry): boolean {
  return Object.keys(geometry.morphAttributes).length > 0;
}

/**
 * The geometry without its morph targets, as it stands with every weight at
 * 0: the same attributes, index, groups and bounds, their buffers shared
 * (nothing uploaded again). Its owner keeps one per geometry and disposes it
 * with the geometry: three's dispose of either frees the buffers of both.
 */
export function restGeometry(geometry: BufferGeometry): BufferGeometry {
  const rest = new BufferGeometry();
  rest.name = geometry.name;
  for (const [name, attribute] of Object.entries(geometry.attributes)) rest.setAttribute(name, attribute);
  rest.setIndex(geometry.index);
  for (const group of geometry.groups) rest.addGroup(group.start, group.count, group.materialIndex);
  rest.setDrawRange(geometry.drawRange.start, geometry.drawRange.count);
  rest.boundingBox = geometry.boundingBox?.clone() ?? null;
  rest.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  rest.userData = { ...geometry.userData };
  return rest;
}
