/**
 * Warcraft ground tiles to ground materials of the asset catalogue.
 *
 * Tile ids are a tileset letter plus a three-letter kind ('Ldrt' Lordaeron
 * dirt, 'Xbtl' Dalaran brick tiles); the kind decides the material. Ids not
 * in the table fall back by a looser match, then to dirt. When the importer
 * gets the real catalogue, an id missing there is replaced by a catalogue
 * material of the same category.
 */

export interface CatalogEntryRef {
  id: string;
  category: string;
}

interface GroundRule {
  kind: RegExp;
  material: string;
  category: string;
}

/** First match wins; kinds are the last three letters of the tile id, lowercase */
export const GROUND_RULES: GroundRule[] = [
  { kind: /^(drt|drh|dro|drr)$/, material: 'dirt', category: 'soil' },
  { kind: /^(drd|mud|dmd)$/, material: 'mud', category: 'soil' },
  { kind: /^(dtr|rdt)$/, material: 'rocky-ground', category: 'rock' },
  { kind: /^(drg|grd|dgr)$/, material: 'grass-dry', category: 'grass' },
  { kind: /^(gsb|hdg|lgr|grl)$/, material: 'grass-lush', category: 'grass' },
  { kind: /^(grs|grt|gss|gra)$/, material: 'grass', category: 'grass' },
  { kind: /^(rok|rck|roc|rkd)$/, material: 'rocky-ground', category: 'rock' },
  { kind: /^(flr|blm|wmb|sqd|rtl|stp)$/, material: 'paving', category: 'road' },
  { kind: /^(btl|cbp|cbl|brk|rd.)$/, material: 'cobblestone', category: 'road' },
  { kind: /^(gvl|grv|pbl)$/, material: 'gravel', category: 'rock' },
  { kind: /^(snw|ice|sng|snc)$/, material: 'snow', category: 'snow' },
  { kind: /^(dsr|dsd|snd|sdd|bch)$/, material: 'sand', category: 'sand' },
  { kind: /^(lav|lvr|ash|cnd)$/, material: 'rocky-ground', category: 'rock' },
  { kind: /^(vin|lvd|crp|lea|fdt|frs)$/, material: 'forest-floor', category: 'forest' },
];

/** Looser matches on the kind's letters when no rule fits */
const FALLBACKS: GroundRule[] = [
  { kind: /gr|gs/, material: 'grass', category: 'grass' },
  { kind: /sn|ic/, material: 'snow', category: 'snow' },
  { kind: /sd|ds|sa/, material: 'sand', category: 'sand' },
  { kind: /r[ok]|cl|st/, material: 'rocky-ground', category: 'rock' },
  { kind: /tl|br|pv|cb/, material: 'paving', category: 'road' },
];

export const DEFAULT_GROUND: GroundRule = { kind: /./, material: 'dirt', category: 'soil' };

/** Material for steep faces (cliffs) */
export const CLIFF_MATERIAL: CatalogEntryRef = { id: 'cliff', category: 'rock' };

export function groundRule(tileId: string): GroundRule {
  const kind = tileId.slice(1).toLowerCase();
  return GROUND_RULES.find((r) => r.kind.test(kind)) ?? FALLBACKS.find((r) => r.kind.test(kind)) ?? DEFAULT_GROUND;
}

/**
 * Material id for a tile; with `catalog`, guaranteed to be one of its
 * materials (same category first, else the first material).
 */
export function groundMaterial(tileId: string, catalog?: CatalogEntryRef[]): string {
  const rule = groundRule(tileId);
  return resolveMaterial({ id: rule.material, category: rule.category }, catalog);
}

export function resolveMaterial(want: CatalogEntryRef, catalog?: CatalogEntryRef[]): string {
  if (!catalog?.length || catalog.some((m) => m.id === want.id)) return want.id;
  return (catalog.find((m) => m.category === want.category) ?? catalog[0]).id;
}
