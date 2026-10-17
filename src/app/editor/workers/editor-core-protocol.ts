/**
 * What the editor's worker (editor-core.worker.ts) and the main thread
 * (services/editor-core.ts) say to each other. Every job comes with the
 * mirror's sync of the changes since the last one (doc-mirror.ts), so the
 * worker works on the map as it was when the job was asked for, and every
 * result goes back with the parts' versions it was worked out on.
 */
import type { MapAssetCatalog } from '../../map-ops/asset-catalog';
import type { PackOptions } from '../../world/custom-map/map-file';
import type { PackedMap, PackError } from '../../world/custom-map/map-pack';
import type { MirrorSync, PartVersions } from '../model/doc-mirror';

/** The jobs the worker takes, what each gets and gives */
export interface CoreJobs {
  /** The `.3dtdmap` of the map, its fingerprint and summary (with the content hash when asked) */
  pack: { input: { options: PackOptions; hash: boolean }; output: PackedMap };
}

export type CoreJobKind = keyof CoreJobs;
export type CoreInput<K extends CoreJobKind> = CoreJobs[K]['input'];
export type CoreOutput<K extends CoreJobKind> = CoreJobs[K]['output'];

export type CoreRequest =
  /** The worker's start: the asset catalogue the checks read */
  | { type: 'start'; catalog: MapAssetCatalog }
  | { type: 'job'; id: number; kind: CoreJobKind; input: CoreInput<CoreJobKind>; sync: MirrorSync }
  /** Jobs of `kind` waiting are dropped */
  | { type: 'cancel'; kind: CoreJobKind };

export type CoreReply =
  | { id: number; value: CoreOutput<CoreJobKind>; state: number; versions: PartVersions }
  /** `lost`: the sync did not fit the mirror, the next job brings the whole map */
  | { id: number; error: PackError; lost?: true }
  /** A newer job of the same kind came first, or the kind was cancelled */
  | { id: number; dropped: true };
