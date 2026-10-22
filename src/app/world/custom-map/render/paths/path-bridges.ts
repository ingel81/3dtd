import type { MapBridgeStyle, MapPaths, MapTerrain } from '../../map-document';
import { bridgeDecks, deckHeight } from '../../bridge-decks';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import type { LaidObject, MapObjectLayer } from '../objects/object-layer';

/** Catalogue model of one bridge piece: 4 m along local +X, 1 m wide, deck top at 0 */
export const BRIDGE_ASSET = 'bridge-deck';
/** Deck pieces by bridge style; a style whose piece the catalogue lacks falls back to wood */
export const BRIDGE_STYLE_ASSETS: Record<MapBridgeStyle, string> = {
  wood: BRIDGE_ASSET,
  stone: 'bridge-deck-stone',
  concrete: 'bridge-deck-concrete',
  lava: 'bridge-deck-lava',
};
const PIECE_LENGTH = 4;
/** Who lays the decks in the object layer (MapObjectLayer.setLaid) */
const LAID_KEY = 'bridges';

/**
 * Bridges: path edges of kind `bridge` get a deck of bridge pieces from end
 * to end, stretched to the edge's width. The deck (bridgeDecks, the one the
 * game and the editor walk on) runs from the terrain height at each end (at
 * least a little over the water) with a slight arch, so roads on both banks
 * meet it. The edge's `style` picks the piece (wood, stone, concrete with a
 * railing, basalt for lava maps).
 *
 * The pieces are laid in the map's object layer (LaidObject), one line per
 * bridge: drawn like the pieces of a wall, each at the level its size on
 * screen asks for, the whole bridge to the pixel limit, shadows near the
 * focus only, and in the towers' LOS cube as their full models where the
 * catalogue lets them block sight. A deck keeps its height where a crater
 * sinks the ground at its end; the editor picks the path edge, not a piece.
 */
export class BridgeLayer {
  private generation = 0;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly objects: MapObjectLayer,
  ) {}

  /** The decks of `paths` laid anew; resolves when they show */
  async set(paths: MapPaths, terrain: MapTerrain): Promise<void> {
    const generation = ++this.generation;
    const decks = bridgeDecks(paths, terrain, this.field);
    const catalog = decks.length > 0 ? await this.assets.catalog() : null;
    if (generation !== this.generation) return;
    // A style without its own model joins the wooden deck
    const known = new Set(catalog?.objects.map((o) => o.id));
    const assetOf = (style: MapBridgeStyle): string => {
      const wanted = BRIDGE_STYLE_ASSETS[style] ?? BRIDGE_ASSET;
      return known.has(wanted) ? wanted : BRIDGE_ASSET;
    };
    const pieces: LaidObject[] = [];
    for (const bridge of decks) {
      const { edge, line, total } = bridge;
      const asset = assetOf(edge.style ?? 'wood');
      let walked = 0;
      let k = 0;
      for (let s = 0; s < line.length - 1; s++) {
        const p = line[s];
        const r = line[s + 1];
        const dx = r.x - p.x;
        const dy = r.y - p.y;
        const len = Math.hypot(dx, dy);
        const n = Math.max(1, Math.round(len / PIECE_LENGTH));
        const piece = len / n;
        // Model +X along the edge: after the turn it points to map (-cos r, -sin r)
        const rotation = Math.atan2(-dy, -dx);
        for (let q = 0; q < n; q++) {
          const t0 = (walked + q * piece) / total;
          const t1 = (walked + (q + 1) * piece) / total;
          const h0 = deckHeight(bridge, t0);
          const h1 = deckHeight(bridge, t1);
          pieces.push({
            id: `bridge:${edge.id}:${k++}`,
            asset,
            x: p.x + dx * ((q + 0.5) / n),
            y: p.y + dy * ((q + 0.5) / n),
            z: 0,
            at: (h0 + h1) / 2,
            rotation,
            // About model z: each piece follows the arch
            roll: Math.atan2(h1 - h0, piece),
            scale: 1,
            stretch: piece / PIECE_LENGTH,
            breadth: edge.width,
            line: `bridge:${edge.id}`,
          });
        }
        walked += len;
      }
    }
    await this.objects.setLaid(LAID_KEY, pieces);
  }

  /** No more decks laid; those laid go with the object layer */
  dispose(): void {
    this.generation++;
  }
}
