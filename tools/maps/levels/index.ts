/**
 * The showcase levels (docs/SHOWCASE_LEVELS.md), each built by its script
 * with the editor's operations; tools/maps/shipped-maps.spec.ts packs them.
 */
import type { CustomMapDocument } from '../../../src/app/world/custom-map/map-document';
import { buildArchipelago } from './archipelago';
import { buildAutumnKeep } from './autumn-keep';
import { buildRedCanyon } from './red-canyon';
import { buildFrostHamlet } from './frost-hamlet';
import { buildMountainPass } from './mountain-pass';
import { buildWitchMarsh } from './witch-marsh';

export const SHOWCASE_LEVELS: { id: string; build: () => CustomMapDocument }[] = [
  { id: 'mountain-pass', build: buildMountainPass },
  { id: 'witch-marsh', build: buildWitchMarsh },
  { id: 'autumn-keep', build: buildAutumnKeep },
  { id: 'red-canyon', build: buildRedCanyon },
  { id: 'archipelago', build: buildArchipelago },
  { id: 'frost-hamlet', build: buildFrostHamlet },
];
