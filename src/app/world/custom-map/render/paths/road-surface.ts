import type { Texture } from 'three';
import type { MapPaths } from '../../map-document';
import type { RoadCover } from './path-mask';
import type { MapAssetLibrary } from '../map-asset-library';
import type { HeightField } from '../height-field';
import type { HeightTexture } from '../terrain/height-texture';
import { DrapedMaterial, DrapedTextures, DrapedTiles, type DrapeLook } from '../drape/draped-layer';
import { RoadNetworkBuilder, type RoadTile } from './road-network';
import { MAX_ROAD_SURFACES } from './road-style';

/**
 * The paved roads drawn as a surface over the ground (road-network.ts): crisp
 * straight edges, the material running along each road, and the look of its
 * class (road-style.ts): lane and edge lines, a dashed centre line, a town
 * street's kerb and gutter of setts, and asphalt that wears down the classes,
 * patched, cracked and sealed along its seams, darker where the wheels run.
 * The surfaces' textures are the ground materials of the catalogue, one
 * array of the few the roads use; markings and wear are drawn by the shader
 * from the road's coordinates.
 *
 * Laid over the ground as every draped surface is (drape/draped-layer.ts):
 * one material for all roads, a mesh per tile, heights from the terrain's
 * height texture, drawn a little towards the camera; a road comes before
 * every surface of a square or pitch. The ground under a road keeps its
 * paint (an OSM world's: the road's material, a verge beyond), for where
 * coarse far terrain rises over the surface and so no grass grows through it.
 */

/** How far a road is drawn towards the camera; more per rank, where two roads overlap without meeting */
const ROAD_PULL = { base: 0.03, perMetre: 0.004, rank: 0.004, rankPerMetre: 0.00004 };

export class RoadSurfaceLayer {
  readonly material: RoadSurfaceMaterial;
  private readonly tiles: DrapedTiles;
  private readonly textures: DrapedTextures;
  /** The network as laid, kept between changes (it lays again only what a change reaches) */
  private network = new RoadNetworkBuilder();

  constructor(field: HeightField, heights: HeightTexture, gridNormals: Texture) {
    this.material = new RoadSurfaceMaterial(heights, gridNormals, field);
    this.tiles = new DrapedTiles(field, this.material, 'custom-map-roads');
    this.textures = new DrapedTextures(this.material, MAX_ROAD_SURFACES);
  }

  get group() {
    return this.tiles.group;
  }

  /** Where the surfaces' textures come from; loads those the roads use (nothing when they are in or on the way) */
  setAssets(library: MapAssetLibrary, anisotropy: number): void {
    this.textures.setAssets(library, anisotropy);
  }

  /**
   * The roads of `paths`: after the first build only the tiles a change
   * reaches are built again (RoadNetworkBuilder): a node dragged in the
   * editor lays the ribbons through it and its junctions, not the map
   */
  set(paths: MapPaths): void {
    const net = this.network.update(paths);
    for (const tile of net.tiles) this.tiles.set(drapedRoadTile(tile));
    this.tiles.group.visible = this.tiles.size > 0;
    // The surfaces only ever grow at the end (RoadNetworkBuilder): the layers loaded keep their place, a new one
    // draws its mean colour (layer >= uDrapeLayers) until the textures with it are in
    this.textures.setIds(net.surfaces);
    this.material.sidewalk.value = net.sidewalk;
  }

  /** Where the surface hides the ground, as laid now (the path mask's covers) */
  covers(): RoadCover[] {
    return this.network.covers();
  }

  /** Heights changed inside a map rectangle (all when omitted): the tiles there fit their bounds again */
  refreshBounds(rect?: { minX: number; minY: number; maxX: number; maxY: number }): void {
    this.tiles.refreshBounds(rect);
  }

  dispose(): void {
    this.textures.dispose();
    this.tiles.clear();
    this.material.dispose();
  }
}

/**
 * A road tile as a draped one; per vertex: across, along, distance to the
 * edge, look (encodeRoadStyle) (4), direction along (2), and in a junction
 * the frame of the road it runs into (4)
 */
function drapedRoadTile(tile: RoadTile) {
  return {
    key: tile.key,
    x: tile.x,
    y: tile.y,
    position: tile.position,
    attributes: { aRoad: { array: tile.road, itemSize: 4 }, aDir: { array: tile.dir, itemSize: 2 }, aArm: { array: tile.arm, itemSize: 4 } },
    index: tile.index,
  };
}

export class RoadSurfaceMaterial extends DrapedMaterial {
  /** The pavements' layer in the road textures (RoadNetwork.sidewalk), -1 while no road has one */
  readonly sidewalk: { value: number };

  constructor(heights: HeightTexture, gridNormals: Texture, field: HeightField) {
    const sidewalk = { value: -1 };
    super('custom-map-roads', roadLook(sidewalk), MAX_ROAD_SURFACES, heights, gridNormals, field);
    this.sidewalk = sidewalk;
    // Roads take the night's dew: moon and lamps glint on them (height-fog.ts uNightSheen, after ROAD_SAMPLE's roughness)
    this.userData['nightSheen'] = true;
  }
}

const ROAD_VERTEX_PARS = /* glsl */ `
attribute vec4 aRoad;
attribute vec2 aDir;
attribute vec4 aArm;
varying vec4 vRoadArm;
varying vec3 vRoad;
flat varying float vRoadLook;
varying vec2 vRoadDir;
`;

const ROAD_VERTEX = /* glsl */ `
vRoad = aRoad.xyz;
vRoadLook = aRoad.w;
vRoadArm = aArm;
vRoadDir = aDir;
`;

const ROAD_FRAGMENT_PARS = /* glsl */ `
uniform float uRoadSidewalk;
varying vec3 vRoad;
flat varying float vRoadLook;
varying vec4 vRoadArm;
varying vec2 vRoadDir;

// Metres of paint of a dash pattern from 0 to x: its integral, for the share a pixel covers
float roadDashUpTo(float x, float paint, float period) {
  return floor(x / period) * paint + min(mod(x, period), paint);
}

// A dash pattern along: the share of the pixel's footprint (aa either side) on the paint. Up close 1 on the paint
// with an edge a pixel soft; far off, where a pixel spans dashes and gaps, their mean rather than flicker
float roadDash(float along, float paint, float gap, float aa) {
  return (roadDashUpTo(along + aa, paint, paint + gap) - roadDashUpTo(along - aa, paint, paint + gap)) / (2.0 * aa);
}

// A line across at offset c with width w: the share of the pixel's footprint on it. A line narrower than a pixel
// keeps its paint as a fainter line instead of vanishing (the markings of a far road)
float roadLine(float across, float c, float w, float aa) {
  float d = abs(across - c);
  return clamp((min(d + aa, w * 0.5) - max(d - aa, -w * 0.5)) / (2.0 * aa), 0.0, 1.0);
}
`;

const ROAD_SAMPLE = /* glsl */ `
// The look (road-style.ts encodeRoadStyle): layer, markings, lanes, gutter, sealed, junction, wear
float code = floor(vRoadLook + 0.5);
float layer = mod(code, 16.0);
code = floor(code / 16.0);
float markings = mod(code, 4.0);
code = floor(code / 4.0);
float lanes = mod(code, 8.0);
code = floor(code / 8.0);
bool gutterOn = mod(code, 2.0) > 0.5;
code = floor(code / 2.0);
bool sealed = mod(code, 2.0) > 0.5;
code = floor(code / 2.0);
// Lanes, patches and cracks follow a ribbon's lanes; a junction has none of its own
bool ribbon = mod(code, 2.0) < 0.5;
code = floor(code / 2.0);
float wear = mod(code, 32.0) / 31.0;
// In a junction, the road this point runs into: its texture takes over towards its end
float armWeight = fract(vRoadArm.w) / 0.99;
wear = mix(wear, floor(vRoadArm.w) / 31.0, armWeight);
int li = min(int(layer), ${MAX_ROAD_SURFACES - 1});
float across = vRoad.x;
float along = vRoad.y;
float edgeDist = vRoad.z;
// Pixel size in metres for the soft edges of paint, seams and setts; the fine detail fades out once a pixel
// covers more than a few centimetres (far roads pay for one texture lookup and their markings)
float aa = max(length(vec2(dFdx(along), dFdy(along))), length(vec2(dFdx(across), dFdy(across)))) * 0.75 + 1e-4;
float near = 1.0 - smoothstep(0.04, 0.12, aa);
// Far off (a pixel some decimetres and more) a road reads as aerial photographs show one: dark asphalt between
// pale edges of kerb and pavement or verge (below)
float farness = smoothstep(0.08, 0.45, aa);

// The material along the road: u across, v along
vec4 rc;
vec4 rd;
if (layer < uDrapeLayers) {
  drapeLookup(vec2(across, along), layer, uDrapeInvScale[li], near, rc, rd);
  if (armWeight > 0.001) {
    // The road's own frame, its normal turned into the junction's
    vec4 ac;
    vec4 ad;
    drapeLookup(vRoadArm.xy, layer, uDrapeInvScale[li], near, ac, ad);
    float c = cos(vRoadArm.z);
    float s = sin(vRoadArm.z);
    vec2 an = ad.xy * 2.0 - 1.0;
    ad.xy = vec2(an.x * c - an.y * s, an.x * s + an.y * c) * 0.5 + 0.5;
    rc = mix(rc, ac, armWeight);
    rd = mix(rd, ad, armWeight);
  }
} else {
  rc = vec4(uDrapeAverage[li], 0.5);
  rd = vec4(0.5, 0.5, 0.8, 1.0);
}
vec3 roadAlbedo = rc.rgb;
float roadRough = rd.b;
float roadAO = mix(1.0, rd.a, 0.8);
vec2 roadNxy = (rd.xy * 2.0 - 1.0) * vec2(1.2, -1.2);

// Broad tone: wear pales and greys the surface, slow blots of older and newer patches of it
float blot = valueNoise(vDrapeMap * 0.045 + layer) * 0.6 + valueNoise(vDrapeMap * 0.17) * 0.4;
roadAlbedo *= mix(0.9, 1.1, blot);
// Asphalt carries the warm grey of its stone, not the texture's blue
if (sealed) roadAlbedo *= vec3(1.04, 1.0, 0.93);
float grey = dot(roadAlbedo, vec3(0.299, 0.587, 0.114));
roadAlbedo = mix(roadAlbedo, vec3(grey) * 1.08, wear * 0.35);
// Far off asphalt darkens, as it reads from above against the paler kerbs, pavements and verges (below)
if (sealed) roadAlbedo *= mix(1.0, 0.72, farness);

float halfW = abs(across) + edgeDist;
// Lane width: a motorway's by its lanes, else a half of the road
float lane = markings > 2.5 ? (2.0 * halfW) / max(lanes, 1.0) : halfW;
if (sealed) {
  if (ribbon && near > 0.0) {
    // Wheel tracks: darker, smoother bands where the tyres run, two per lane
    float inLane = mod(across + halfW, lane) / lane;
    float tracks = exp(-pow((inLane - 0.27) / 0.07, 2.0)) + exp(-pow((inLane - 0.73) / 0.07, 2.0));
    tracks *= (0.6 + 0.4 * valueNoise(vec2(along * 0.08, across))) * near;
    roadAlbedo *= 1.0 - tracks * mix(0.1, 0.18, wear);
    roadRough -= tracks * 0.12;
    // Repair patches: rectangles over a lane, newer and darker asphalt with a sealed seam round them
    float cell = floor(along / 11.0);
    float laneIndex = floor((across + halfW) / max(lane, 1.0));
    float pick = hash12(vec2(cell, laneIndex + 0.37));
    if (pick < (wear - 0.25) * 0.5) {
      float a0 = cell * 11.0 + hash12(vec2(cell, 3.1)) * 5.0;
      float len = 2.0 + hash12(vec2(cell, 7.7)) * 6.0;
      float laneStart = laneIndex * lane - halfW;
      float inside = smoothstep(a0 - aa, a0 + aa, along) * (1.0 - smoothstep(a0 + len - aa, a0 + len + aa, along))
        * smoothstep(laneStart + 0.15 - aa, laneStart + 0.15 + aa, across) * (1.0 - smoothstep(laneStart + lane - 0.15 - aa, laneStart + lane - 0.15 + aa, across));
      float rim = inside * (1.0 - smoothstep(0.0, 0.06 + aa, min(min(along - a0, a0 + len - along), min(across - laneStart - 0.15, laneStart + lane - 0.15 - across))));
      // Newer asphalt: darker and a touch bluer, a grain of its own
      float own = valueNoise(vec2(along, across) * 0.7 + pick * 40.0);
      roadAlbedo = mix(roadAlbedo, roadAlbedo * vec3(0.8, 0.81, 0.84) * mix(0.92, 1.05, own), inside * 0.8 * near);
      roadAlbedo = mix(roadAlbedo, vec3(0.03), rim * 0.65 * near);
      roadRough = mix(roadRough, 0.45, rim * near);
    }
    // Cracks: across the road every few metres where it is worn, a hair wide
    float crackAt = along / 7.0 + valueNoise(vec2(across * 0.6, along * 0.2)) * 0.9;
    float crackCell = floor(crackAt + 0.5);
    float crackDist = (0.5 - abs(fract(crackAt) - 0.5)) * 7.0;
    float crack = (1.0 - smoothstep(0.008, 0.008 + aa, crackDist)) * step(hash12(vec2(crackCell, 5.3)), wear * 0.8);
    crack *= smoothstep(0.35, 0.75, valueNoise(vec2(across * 1.3, crackCell * 3.7))) * near;
    // A sealed seam along the middle of a marked road, where its two halves were laid
    float seam = markings > 0.5 ? roadLine(across + (valueNoise(vec2(along * 0.15, 1.0)) - 0.5) * 0.12, 0.0, 0.05, aa) * smoothstep(0.2, 0.6, wear + 0.2) * near : 0.0;
    roadAlbedo = mix(roadAlbedo, vec3(0.025), max(crack * 0.75, seam * 0.6));
    roadRough = mix(roadRough, 0.4, seam);
  }
  // The edge: the asphalt breaks off ragged and pale on a country road (a kerb in town, below)
  if (!gutterOn) {
    float ragged = (valueNoise(vec2(along * 0.9, 2.0)) - 0.5) * 0.12 * near;
    roadAlbedo *= mix(1.0, 0.82, 1.0 - smoothstep(0.0, 0.08 + aa, edgeDist + ragged));
    roadAlbedo = mix(roadAlbedo, roadAlbedo * 1.08 + 0.015, (1.0 - smoothstep(0.1, 0.5, edgeDist)) * 0.5 * wear);
  }

  // Markings: paint a little worn by traffic, more so on worn roads
  if (markings > 0.5 && ribbon) {
    float paint = roadLine(across, 0.0, 0.12, aa) * roadDash(along, 3.0, 6.0, aa) * step(markings, 2.5);
    if (markings > 1.5) {
      float off = markings > 2.5 ? 0.3 : 0.15;
      paint = max(paint, roadLine(edgeDist, 0.25 + off * 0.5, off, aa));
    }
    if (markings > 2.5) {
      for (int k = 1; k < 6; k++) {
        if (float(k) >= lanes) break;
        paint = max(paint, roadLine(across, -halfW + lane * float(k), 0.15, aa) * roadDash(along, 6.0, 12.0, aa));
      }
    }
    float worn = valueNoise(vec2(along * 1.7, across * 2.3)) * 0.7 + 0.15;
    if (near > 0.0) worn += (valueNoise(vDrapeMap * 9.0) - 0.5) * 0.3 * near;
    paint *= smoothstep(0.25, 0.75, worn + 0.3 - wear * 0.6);
    roadAlbedo = mix(roadAlbedo, vec3(0.78, 0.77, 0.72), paint * 0.92);
    roadRough = mix(roadRough, 0.55, paint);
    roadNxy *= 1.0 - paint * 0.7;
  }
} else {
  // Setts and slabs: joints darker along the edge, worn paler in the middle
  roadAlbedo *= mix(0.85, 1.0, smoothstep(0.0, 0.25 + aa, edgeDist));
  roadAlbedo = mix(roadAlbedo, roadAlbedo * 1.06, exp(-pow(across / max(halfW, 0.5) / 0.5, 2.0)) * wear * 0.6);
}

// A town street's kerb stone and its gutter of setts along both edges
if (gutterOn) {
  float kerb = 1.0 - smoothstep(0.15 - aa, 0.15 + aa, edgeDist);
  float gutter = (1.0 - smoothstep(0.55 - aa, 0.55 + aa, edgeDist)) * (1.0 - kerb);
  vec3 settColour = vec3(0.34, 0.33, 0.31);
  if (gutter > 0.0 && near > 0.0) {
    vec2 sett = vec2((edgeDist - 0.15) / 0.2, along / 0.16 + floor((edgeDist - 0.15) / 0.2) * 0.5);
    vec2 sf = abs(fract(sett) - 0.5);
    float joint = smoothstep(0.38, 0.47, max(sf.x, sf.y)) * near;
    settColour = mix(vec3(0.36, 0.35, 0.33) * mix(0.8, 1.15, hash12(floor(sett) + 3.0)), vec3(0.08), joint * 0.8);
    roadNxy = mix(roadNxy, vec2(sf.x > sf.y ? sign(fract(sett.x) - 0.5) : 0.0, sf.y >= sf.x ? sign(fract(sett.y) - 0.5) : 0.0) * joint * 0.6, gutter);
  }
  roadAlbedo = mix(roadAlbedo, settColour, gutter);
  roadAlbedo = mix(roadAlbedo, vec3(0.55, 0.54, 0.5) * mix(0.9, 1.05, valueNoise(vec2(along * 0.9, 4.0))), kerb);
  roadAlbedo *= 1.0 - (1.0 - smoothstep(0.15, 0.2 + aa, edgeDist)) * (1.0 - kerb) * 0.45;
  roadRough = mix(roadRough, 0.8, max(kerb, gutter));
}

// The pavement beyond the kerb (MapPathEdge.sidewalk: the distance to the edge is the kerb's, negative over it), its
// own slabs read across from the kerb, their tone drifting as the asphalt's
if (edgeDist < aa) {
  int si = clamp(int(uRoadSidewalk), 0, ${MAX_ROAD_SURFACES - 1});
  vec4 sc = vec4(uDrapeAverage[si], 0.5);
  vec4 sd = vec4(0.5, 0.5, 0.8, 1.0);
  if (uRoadSidewalk >= 0.0 && uRoadSidewalk < uDrapeLayers) drapeLookup(vec2(-edgeDist, along), uRoadSidewalk, uDrapeInvScale[si], near, sc, sd);
  float pave = 1.0 - smoothstep(-aa, aa, edgeDist);
  roadAlbedo = mix(roadAlbedo, sc.rgb * mix(0.92, 1.06, blot), pave);
  roadRough = mix(roadRough, sd.b, pave);
  roadAO = mix(roadAO, mix(1.0, sd.a, 0.8), pave);
  roadNxy = mix(roadNxy, (sd.xy * 2.0 - 1.0) * vec2(1.2, -1.2), pave);
}

// Far off the edges turn pale (the asphalt darkened above), at least a pixel and a half wide however thin the kerb, so
// the street keeps its light-dark-light against the ground around it
if (farness > 0.0) {
  float band = max(gutterOn ? 0.55 : 0.3, aa * 2.0);
  float edgeBand = 1.0 - smoothstep(band - aa, band + aa, edgeDist);
  roadAlbedo = mix(roadAlbedo, vec3(0.52, 0.51, 0.47), edgeBand * farness * (gutterOn ? 0.85 : 0.55));
}

diffuseColor.rgb *= roadAlbedo;
// The road's frame: along and across in the scene (x = -map x), the normal from the terrain's grid
vec3 roadUp = normalize(vDrapeNormal);
vec3 roadT = normalize(vec3(-vRoadDir.x, 0.0, vRoadDir.y));
vec3 roadB = normalize(cross(roadUp, roadT));
roadT = cross(roadB, roadUp);
vec3 roadNormal = normalize(roadUp + roadB * roadNxy.x + roadT * roadNxy.y);
float drapeRough = roadRough;
float drapeAO = roadAO;
vec3 drapeNormal = roadNormal;
`;

/** The roads' part of their draped material: attributes, rank from the look's top bits, the look */
function roadLook(sidewalk: { value: number }): DrapeLook {
  return {
    key: 'custom-map-roads-3',
    uniforms: { uRoadSidewalk: sidewalk },
    vertexPars: ROAD_VERTEX_PARS,
    vertex: ROAD_VERTEX,
    // A higher road a little more than a lower one where two overlap without meeting (RoadStyle.rank, the code's top bits)
    rank: 'floor((aRoad.w + 0.5) / 131072.0)',
    pull: ROAD_PULL,
    fragmentPars: ROAD_FRAGMENT_PARS,
    fragment: ROAD_SAMPLE,
  };
}
