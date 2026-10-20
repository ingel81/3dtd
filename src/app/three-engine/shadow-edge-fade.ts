import { ShaderChunk } from 'three';

/** Share of the shadow map's half width at its border over which a shadow fades out (E268) */
export const SHADOW_EDGE_FADE = 0.3;

const RETURN = 'return mix( 1.0, shadow, shadowIntensity );';

/**
 * Fades a light's shadow out towards the border of its shadow map instead of
 * cutting it off there: every receiver, every material, through three's own
 * shadow chunk (the getShadow of directional and spot lights, each shadow map
 * type; point shadows have no border). The map's sun keeps its shadow in a
 * box round the ground the camera sees (map-environment.ts), capped from a
 * high camera: there its border lay in the picture, and each time the box
 * moved on a zoom, the buildings at its border lost or took their shadow at
 * once. A shader-only change, a few instructions per receiver fragment.
 * Installed once before any program is built (renderer-host.ts); three keys
 * programs by their parameters, not by the chunk's text, so a later install
 * would leave programs built before it as they were.
 */
export function installShadowEdgeFade(): void {
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  if (chunk.includes('shadowEdgeFade')) return;
  // getShadow comes before getPointShadow in the chunk: only its returns
  const split = chunk.indexOf('getPointShadow');
  const head = split < 0 ? chunk : chunk.slice(0, split);
  const tail = split < 0 ? '' : chunk.slice(split);
  if (!head.includes(RETURN)) throw new Error('shadow-edge-fade: three\'s getShadow changed, the fade found no return');
  const faded = head.replaceAll(
    RETURN,
    `float shadowEdgeFade = 1.0 - smoothstep( ${(1 - SHADOW_EDGE_FADE).toFixed(3)}, 1.0, 2.0 * max( abs( shadowCoord.x - 0.5 ), abs( shadowCoord.y - 0.5 ) ) );
			return mix( 1.0, shadow, shadowIntensity * shadowEdgeFade );`,
  );
  (ShaderChunk as Record<string, string>)['shadowmap_pars_fragment'] = faded + tail;
}
