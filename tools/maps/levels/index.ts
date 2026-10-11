/**
 * The showcase levels (docs/SHOWCASE_LEVELS.md), each built by its script
 * with the editor's operations; tools/maps/shipped-maps.spec.ts packs them.
 */
import type { CustomMapDocument } from '../../../src/app/world/custom-map/map-document';
import { buildMountainPass } from './mountain-pass';

export const SHOWCASE_LEVELS: { id: string; build: () => CustomMapDocument }[] = [{ id: 'mountain-pass', build: buildMountainPass }];
