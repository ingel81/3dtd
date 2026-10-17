import type { CustomMapDocument } from './map-document';
import type { MapOrigin, MapSummary } from './map-store';

/**
 * The map list's entry for a document (MapStore). Its own module, without
 * the store's backends, so the pack worker sums up the copy it packs
 */
export function summarize(doc: CustomMapDocument, origin: MapOrigin, hash: string): MapSummary {
  return {
    id: doc.meta.id,
    name: doc.meta.name,
    author: doc.meta.author,
    description: doc.meta.description,
    width: doc.terrain.width,
    depth: doc.terrain.depth,
    updatedAt: doc.meta.updatedAt,
    origin,
    contentHash: hash,
    objects: doc.objects.length,
    spawns: doc.spawns.length,
    biome: doc.environment.biome ?? 'temperate',
    importedFrom: doc.meta.source?.kind === 'w3x' ? doc.meta.source.file : undefined,
    ...(doc.meta.source?.kind === 'osm' ? { osm: { lat: doc.meta.source.lat, lon: doc.meta.source.lon } } : {}),
    ...(doc.meta.uid ? { uid: doc.meta.uid } : {}),
    ...(doc.meta.copyOf ? { copyOf: { ...doc.meta.copyOf } } : {}),
    ...(doc.meta.generated ? { generated: true } : {}),
  };
}
