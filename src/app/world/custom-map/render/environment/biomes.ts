import type { MapBiome, MapEnvironment } from '../../map-document';

/**
 * Looks of the environment per biome, on top of the sky preset (day, dusk,
 * night, overcast): sky and light colours, cloud cover, haze, grade, sky
 * features (stars, aurora; the moon's planet is a map setting, planetOf) and ambient particles around the
 * camera's focus.
 */

export interface SkyPreset {
  zenith: number;
  horizon: number;
  ground: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  envIntensity: number;
  /** Strength of the glow around the sun in the sky */
  glow: number;
  /** Cloud threshold: lower = more clouds, above 1.3 none */
  cover: number;
  cloudColor: number;
  cloudShadow: number;
  /** Grade: contrast, saturation, tint */
  grade: [number, number, number];
  /** 0..1 how much the night's light floor and moon rim show on the map's surfaces (height-fog.ts) */
  nightLight: number;
}

export type AmbientParticles = 'embers' | 'ash' | 'dust' | 'snow' | null;

export interface BiomeLook extends SkyPreset {
  /** Multiplies the map's fog density */
  fogScale: number;
  /** Height fog falloff per metre: higher hugs the ground (swamp), lower is thin haze everywhere */
  fogFalloff: number;
  /** 0..1 stars in the sky */
  stars: number;
  /** 0..1 aurora bands */
  aurora: number;
  particles: AmbientParticles;
  /** Tone mapping exposure of the map (Khronos PBR Neutral) */
  exposure: number;
  /** Split toning: tints for the shadows and for the lights (sRGB hex), the look's mood */
  split: [number, number];
  /**
   * Colour of the glow around the sun in the sky and of the haze towards it,
   * when it is not the sun's light (Mars: a blue halo round a setting sun)
   */
  glowColor?: number;
  /**
   * The ground haze's own colour (sRGB hex) and how far it replaces the sky's, 0..1: a swamp's pale mist, a
   * ruined city's dust (height-fog.ts uFogMist)
   */
  mist?: number;
  mistAmount?: number;
}

export const SKY_PRESETS: Record<MapEnvironment['sky'], SkyPreset> = {
  day: {
    zenith: 0x3f78c4,
    horizon: 0xc4d8e6,
    ground: 0x6b6a5c,
    sun: 0xfff0dc,
    sunIntensity: 3.8,
    hemiSky: 0xc8d8f0,
    hemiGround: 0x5a5236,
    hemiIntensity: 0.75,
    ambient: 0.08,
    envIntensity: 0.35,
    glow: 0.6,
    cover: 0.52,
    cloudColor: 0xffffff,
    cloudShadow: 0x9aa6b4,
    grade: [1.1, 1.02, 0xfffaf4],
    nightLight: 0,
  },
  dusk: {
    zenith: 0x2a3c6e,
    horizon: 0xf0a070,
    ground: 0x403530,
    sun: 0xffb070,
    sunIntensity: 2.2,
    hemiSky: 0xa0a8d0,
    hemiGround: 0x503828,
    hemiIntensity: 0.95,
    ambient: 0.12,
    envIntensity: 0.5,
    glow: 1.2,
    cover: 0.5,
    cloudColor: 0xffd2b0,
    cloudShadow: 0x6a5a68,
    grade: [1.1, 1.0, 0xffe8d8],
    nightLight: 0.3,
  },
  night: {
    zenith: 0x060b1c,
    horizon: 0x1c2a44,
    ground: 0x10141a,
    sun: 0x9fb4ff,
    sunIntensity: 0.7,
    hemiSky: 0x40508a,
    hemiGround: 0x101418,
    hemiIntensity: 0.6,
    ambient: 0.1,
    envIntensity: 0.35,
    glow: 0.3,
    cover: 0.55,
    cloudColor: 0x3a4460,
    cloudShadow: 0x141a28,
    grade: [1.1, 0.8, 0xdfe6ff],
    nightLight: 1,
  },
  overcast: {
    zenith: 0x8a96a2,
    horizon: 0xc2c8cc,
    ground: 0x5e6058,
    sun: 0xf0f0ee,
    sunIntensity: 1.0,
    hemiSky: 0xdde4ea,
    hemiGround: 0x5a5a4c,
    hemiIntensity: 1.6,
    ambient: 0.2,
    envIntensity: 0.7,
    glow: 0.15,
    cover: 0.22,
    cloudColor: 0xd8dde2,
    cloudShadow: 0x7d858e,
    grade: [1.04, 0.85, 0xf4f6f8],
    nightLight: 0,
  },
};

const PLAIN = { fogScale: 1, fogFalloff: 1 / 70, stars: 0, aurora: 0, particles: null as AmbientParticles, exposure: 1, split: [0xe6edff, 0xfffaf3] as [number, number] };

/**
 * Tone mapping exposure per sky (Khronos PBR Neutral rolls off the
 * highlights and pulls the darkest values down): the lights were tuned
 * without tone mapping, these bring a map back to its brightness, darker
 * skies a little more, so dusk and night keep their shapes
 */
const SKY_EXPOSURE: Record<MapEnvironment['sky'], number> = { day: 1.4, overcast: 1.4, dusk: 1.55, night: 1.7 };
/** Looks whose ground is bright on its own (snow, sand) need less */
const BIOME_EXPOSURE: Partial<Record<MapBiome, number>> = { arctic: 0.82, desert: 0.9 };
/** Looks whose night ground is dark on its own (black swamp water, dark reeds) need more at night to read from the game camera */
const NIGHT_EXPOSURE: Partial<Record<MapBiome, number>> = { swamp: 1.35 };

/** The look of a biome under a sky preset */
export function biomeLook(biome: MapBiome | undefined, sky: MapEnvironment['sky']): BiomeLook {
  const look = biomeLookUnclamped(biome, sky);
  look.exposure = (SKY_EXPOSURE[sky] ?? 1.4) * (BIOME_EXPOSURE[biome ?? 'temperate'] ?? 1) * (sky === 'night' ? (NIGHT_EXPOSURE[biome ?? 'temperate'] ?? 1) : 1);
  // Biomes colour their clouds and sky light by day; at night those must not outshine the night
  // preset, or the sky glows (a swamp's pale green clouds over a black marsh). Hell and the moon
  // set their own dark skies
  if (sky !== 'night' || biome === 'hell' || biome === 'moon') return look;
  const p = SKY_PRESETS.night;
  for (const key of ['cloudColor', 'cloudShadow', 'hemiSky', 'horizon', 'zenith'] as const) {
    look[key] = noBrighterThan(look[key], p[key]);
  }
  return look;
}

/** `a` and `b` (sRGB hex) mixed by `t` per channel */
function mixHex(a: number, b: number, t: number): number {
  const ch = (shift: number): number => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const LOOK_COLOURS = ['zenith', 'horizon', 'ground', 'sun', 'hemiSky', 'hemiGround', 'cloudColor', 'cloudShadow'] as const;
const LOOK_NUMBERS = ['sunIntensity', 'hemiIntensity', 'ambient', 'envIntensity', 'glow', 'cover', 'fogScale', 'fogFalloff', 'stars', 'aurora', 'exposure', 'nightLight', 'mistAmount'] as const;

/**
 * Two looks mixed by `t` (0 = `from`, 1 = `to`): colours per channel, numbers linear; what has no middle
 * (the ambient particles) is `to`'s from the half on. A change of the sky preset (day to dusk to night, as a
 * time of day or a wave's event sets it) fades through these instead of jumping
 */
export function mixLook(from: BiomeLook, to: BiomeLook, t: number): BiomeLook {
  const k = Math.min(1, Math.max(0, t));
  const look: BiomeLook = { ...(k < 0.5 ? from : to) };
  for (const key of LOOK_COLOURS) look[key] = mixHex(from[key], to[key], k);
  for (const key of LOOK_NUMBERS) {
    const a = from[key];
    const b = to[key];
    if (a !== undefined && b !== undefined) look[key] = a * (1 - k) + b * k;
  }
  look.grade = [from.grade[0] * (1 - k) + to.grade[0] * k, from.grade[1] * (1 - k) + to.grade[1] * k, mixHex(from.grade[2], to.grade[2], k)];
  look.split = [mixHex(from.split[0], to.split[0], k), mixHex(from.split[1], to.split[1], k)];
  if (from.glowColor !== undefined && to.glowColor !== undefined) look.glowColor = mixHex(from.glowColor, to.glowColor, k);
  if (from.mist !== undefined && to.mist !== undefined) look.mist = mixHex(from.mist, to.mist, k);
  return look;
}

/** `color` scaled down to the luminance of `limit` when it is brighter, keeping its hue */
function noBrighterThan(color: number, limit: number): number {
  const lum = (c: number): number => (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255;
  const l = lum(color);
  const max = lum(limit);
  if (l <= max || l === 0) return color;
  const k = max / l;
  const ch = (shift: number): number => Math.round(((color >> shift) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function biomeLookUnclamped(biome: MapBiome | undefined, sky: MapEnvironment['sky']): BiomeLook {
  const p = SKY_PRESETS[sky] ?? SKY_PRESETS.day;
  const night = sky === 'night';
  const dusk = sky === 'dusk';
  const nightStars = night ? 0.8 : 0;
  switch (biome) {
    case 'hell':
      return {
        ...p,
        ...PLAIN,
        split: [0xe2d2e8, 0xffe8cc],
        zenith: 0x140303,
        horizon: 0x6a2410,
        ground: 0x200808,
        sun: 0xffa070,
        sunIntensity: night ? 0.8 : 2.2,
        hemiSky: 0x8a5040,
        hemiGround: 0x2a1008,
        hemiIntensity: 0.75,
        ambient: 0.1,
        glow: 0.5,
        cover: 0.3,
        cloudColor: 0x4a1a10,
        cloudShadow: 0x140404,
        grade: [1.15, 0.92, 0xffe6dc],
        fogScale: 1.0,
        particles: 'embers',
      };
    case 'moon':
      return {
        ...p,
        ...PLAIN,
        split: [0xeef0f6, 0xffffff],
        zenith: 0x000000,
        horizon: 0x05060a,
        ground: 0x0a0a0c,
        sun: 0xffffff,
        sunIntensity: 4.6,
        hemiSky: 0x30343c,
        hemiGround: 0x101010,
        hemiIntensity: 0.12,
        ambient: 0.02,
        envIntensity: 0.15,
        glow: 0.25,
        cover: 2,
        grade: [1.15, 0.7, 0xffffff],
        fogScale: 0,
        stars: 1,
      };
    case 'mars':
      // Mars as the rovers see it: a butterscotch sky by day, pale and greyish rather than red, and
      // a blue halo round the setting sun (fine dust scatters blue forward). Light near white, so the
      // ground keeps its own colours: dark basalt, light dust, ochre and grey rock
      return {
        ...p,
        ...PLAIN,
        split: [0xd6e0f4, dusk ? 0xf4f6ff : 0xfff0dc],
        zenith: night ? 0x100c0c : dusk ? 0x302826 : 0x8a7868,
        horizon: night ? 0x2e2620 : dusk ? 0x8a7262 : 0xd2b690,
        ground: 0x5e4a3c,
        sun: dusk ? 0xeef0ff : 0xfff6ea,
        sunIntensity: night ? 0.5 : dusk ? 2.2 : 3.0,
        hemiSky: dusk ? 0x9aa0b4 : 0xd8c4a8,
        hemiGround: 0x5a4636,
        hemiIntensity: dusk ? 0.9 : 0.7,
        glow: dusk ? 1.1 : 0.7,
        glowColor: dusk ? 0x4c86f0 : undefined,
        cover: 1.1,
        cloudColor: dusk ? 0x8e94a8 : 0xe4d4c0,
        cloudShadow: dusk ? 0x403c44 : 0x9a8672,
        grade: [1.14, dusk ? 0.9 : 0.74, dusk ? 0xf6f8ff : 0xfff6ee],
        fogScale: 1.3,
        fogFalloff: 1 / 160,
        stars: nightStars,
        particles: 'dust',
      };
    case 'arctic':
      return {
        ...p,
        ...PLAIN,
        split: [0xdde8ff, 0xfffcf6],
        zenith: night ? 0x050a18 : 0x6a98d0,
        horizon: night ? 0x18263c : 0xe8f0f6,
        hemiSky: night ? 0x405078 : 0xe4eef8,
        hemiGround: 0xc8d0d8,
        hemiIntensity: night ? 0.7 : 0.7,
        sun: night ? 0x9fb4ff : 0xf4f8ff,
        grade: [1.06, 0.9, 0xf0f6ff],
        stars: nightStars,
        aurora: night ? 1 : 0,
        particles: 'snow',
      };
    case 'apocalypse':
      return {
        ...p,
        ...PLAIN,
        split: [0xd8dcf0, 0xfff0cc],
        zenith: night ? 0x0c0c0a : 0x6a6650,
        horizon: night ? 0x262420 : 0xaaa486,
        ground: 0x3a3830,
        sun: 0xe8d8a8,
        sunIntensity: night ? 0.5 : 1.6,
        hemiSky: 0xa8a48c,
        hemiGround: 0x3a3830,
        hemiIntensity: 0.9,
        glow: 0.5,
        cover: 0.15,
        cloudColor: 0x8a8670,
        cloudShadow: 0x3a382e,
        // Harder light and shade, the dust thick on the ground and thin above it: the ruins read from the game camera
        grade: [1.2, 0.62, 0xf4ecd8],
        fogScale: 2.6,
        fogFalloff: 1 / 30,
        mist: night ? 0x2a2822 : 0x9c8e6c,
        mistAmount: 0.7,
        particles: 'ash',
      };
    case 'swamp':
      return {
        ...p,
        ...PLAIN,
        split: [0xd9eee6, 0xf8fde6],
        horizon: night ? 0x18221c : 0xa8b49a,
        zenith: night ? 0x060c0a : 0x6a8a84,
        hemiSky: 0xb0c0a0,
        hemiGround: 0x3a4028,
        cover: Math.min(p.cover, 0.35),
        cloudColor: 0xc8d0c0,
        cloudShadow: 0x6a7468,
        grade: [1.05, 0.85, 0xeef6e4],
        // Thinner by night: the thick ground fog swallowed walks and enemies under the game camera
        fogScale: night ? 2.4 : 3.2,
        fogFalloff: 1 / 18,
        // Pale mist on the water and in the reeds, moonlit at night: it reads as mist, not as darkness
        mist: night ? 0x5e7670 : dusk ? 0x8c8678 : 0xb4c0ac,
        mistAmount: night ? 0.75 : 0.85,
        // A swamp's night lifts its islands and water more than open land's: they read from the game camera
        nightLight: night ? 2 : p.nightLight,
        stars: nightStars * 0.5,
      };
    case 'desert':
      return {
        ...p,
        ...PLAIN,
        split: [0xe2e6ff, 0xfff0da],
        zenith: night ? 0x050a1c : 0x3a7cc8,
        horizon: night ? 0x1c2440 : 0xeadcc4,
        sun: night ? p.sun : 0xfff2dc,
        sunIntensity: night ? p.sunIntensity : 4.4,
        hemiSky: night ? p.hemiSky : 0xf0e4cc,
        hemiGround: 0xa08860,
        hemiIntensity: night ? p.hemiIntensity : 0.75,
        cover: Math.max(p.cover, 0.9),
        grade: [1.1, 1.02, 0xfff4e4],
        fogScale: 0.8,
        fogFalloff: 1 / 40,
        stars: night ? 1 : 0,
        particles: 'dust',
      };
    case 'mountain':
      return {
        ...p,
        ...PLAIN,
        split: [0xdfe9ff, 0xfffaf0],
        cover: p.cover + 0.06,
        grade: [1.08, 0.96, 0xf8fbff],
        fogScale: 0.45,
        fogFalloff: 1 / 45,
        stars: nightStars,
      };
    case 'city':
      return { ...p, ...PLAIN, grade: [1.08, 0.9, 0xf4f6ff], fogScale: 1.2, stars: nightStars * 0.3, split: [0xe4ebff, 0xfff1e2] };
    default:
      return { ...p, ...PLAIN, stars: nightStars };
  }
}
