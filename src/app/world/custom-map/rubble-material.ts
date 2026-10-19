import type { MapObject } from './map-document';

/** What a structure is built of, for its rubble, dust and pieces (docs/DESTRUCTION_PLAN.md, Materialklassen) */
export const RUBBLE_MATERIALS = ['plaster', 'concrete', 'metal', 'brick', 'stone', 'wood'] as const;
export type RubbleMaterial = (typeof RUBBLE_MATERIALS)[number];

/** Linear RGB (as the shaders take it) of each class's rubble, its dust lighter */
export const RUBBLE_COLOURS: Record<RubbleMaterial, { grit: readonly [number, number, number]; dust: readonly [number, number, number] }> = {
  plaster: { grit: [0.26, 0.23, 0.19], dust: [0.38, 0.35, 0.3] },
  concrete: { grit: [0.18, 0.18, 0.17], dust: [0.3, 0.29, 0.27] },
  metal: { grit: [0.1, 0.1, 0.11], dust: [0.2, 0.19, 0.17] },
  brick: { grit: [0.2, 0.065, 0.035], dust: [0.3, 0.17, 0.12] },
  stone: { grit: [0.22, 0.2, 0.16], dust: [0.34, 0.31, 0.26] },
  wood: { grit: [0.12, 0.065, 0.032], dust: [0.24, 0.18, 0.12] },
};

/** Words in a catalogue entry's id or tags that tell its class, the first that matches wins */
const CLASS_WORDS: readonly [RegExp, RubbleMaterial][] = [
  [/barn|shed|cabin|hut|wood|log|stable|mill|timber|shack|lodge|dock|pier/, 'wood'],
  [/brick/, 'brick'],
  [/metal|tank|silo|container|hangar|steel|crane/, 'metal'],
  [/office|modern|concrete|bunker|garage|apartment|factory|warehouse|block|tower-block|station|base/, 'concrete'],
  [/castle|stone|church|chapel|keep|fort|wall|ruin|temple|abbey|cathedral|gate/, 'stone'],
];

/**
 * The class of a structure's rubble: a raised building's facade
 * (MapObject.mass), else the words of its catalogue entry, plaster where
 * none tells. A catalogue field can say it outright later; the classes stay
 */
export function rubbleMaterialOf(object: Pick<MapObject, 'asset' | 'mass'>, tags: readonly string[] = []): RubbleMaterial {
  if (object.mass) return object.mass.facade === 'timber' ? 'wood' : object.mass.facade;
  const words = `${object.asset} ${tags.join(' ')}`.toLowerCase();
  for (const [pattern, material] of CLASS_WORDS) if (pattern.test(words)) return material;
  return 'plaster';
}
