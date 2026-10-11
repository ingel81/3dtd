/**
 * TilesRenderer plugin for an own tileset whose geometric errors read on
 * another scale than Google's: every tile's error times `scale` as it is
 * read. The camera's screen-space error, the route corridor's error targets
 * and the LOD debug then pick the same detail they pick on Google tiles.
 *
 * Kalasatama (ContextCapture 2017) gives its 250 m leaves 4 and halves per
 * level down to 0.03 m. Unscaled, the corridor's resting 5 m held the
 * coarsest 250 m tiles and the route only sharpened when the camera came
 * close. With 10 the corridor loads in a second and the route is sharp from
 * the start; 20 is sharper still but the corridor's load runs into its 30 s
 * timeout (2026-10-11).
 */
export class GeometricErrorScalePlugin {
  readonly name = 'GEOMETRIC_ERROR_SCALE_PLUGIN';

  constructor(private readonly scale: number) {}

  preprocessNode(tile: { geometricError?: number }): void {
    if (typeof tile.geometricError === 'number') tile.geometricError *= this.scale;
  }
}
