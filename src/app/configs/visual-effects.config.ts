/**
 * Visual Effects Configuration
 *
 * Centralized particle, decal, and effect settings.
 * Previously hardcoded in three-effects.renderer.ts
 */

import type { TowerTypeId } from './tower-types.config';

/** Particle pool limits */
export const PARTICLE_LIMITS = {
  /** Trail additive pool serves: fire, explosions, rockets, bullets, flame beams - needs capacity for HQ explosion (~700) + inferno (300) */
  maxTrailParticlesPerPool: 3000,
  /** Trail normal pool serves: smoke, cannon trails, blood splatter */
  maxTrailNormalParticlesPerPool: 4000,
} as const;

/** Blood decal configuration */
export const BLOOD_DECAL_CONFIG = {
  maxDecals: 100,
  fadeDelay: 20000,    // ms before fade starts
  fadeDuration: 10000, // ms fade duration
  baseOpacity: 0.7,
  baseColor: { r: 0.55, g: 0, b: 0 },  // Dark red
  colorVariation: 0.2,  // Random variation range for r channel
  heightOffset: 0.12,   // Above ground to avoid z-fighting
} as const;

/** Ice decal configuration */
export const ICE_DECAL_CONFIG = {
  maxDecals: 150,
  fadeDelay: 4000,
  fadeDuration: 3000,
  baseOpacity: 0.6,
  baseColor: { r: 0.75, g: 0.94, b: 1.0 },  // Light cyan/white
  colorVariation: 0.1,  // Random variation range
  heightOffset: 0.12,   // Above ground to avoid z-fighting
} as const;

/**
 * Scorch marks, layer 1 of COMBAT_HEATMAP_STUDY.md: dark burn marks where
 * cannon shells and rockets land and where flame beams hit. At most one per
 * route-grid cell: another hit in the same cell darkens the mark and starts
 * its fade over instead of adding one, so the zones that see the most
 * fighting turn dark and the pool does not fill up with duplicates. Only
 * on route cells, only near the ground (air hits leave none).
 */
export const SCORCH_DECAL_CONFIG = {
  maxDecals: 200,
  fadeDelay: 60000,    // ms before fade starts (wall clock, like blood)
  fadeDuration: 30000, // ms fade duration
  /** Cap for the darkening by repeated hits */
  maxOpacity: 0.8,
  baseColor: { r: 0.07, g: 0.05, b: 0.035 },  // Soot, brownish black
  colorVariation: 0.03,
  heightOffset: 0.1,   // Above ground, below blood and ice (0.12)
  /** A hit further above the cell's ground than this (air units) leaves no mark, m */
  maxHeightAboveGround: 6,
  /** Per source: decal radius (m), opacity of a new mark, opacity added per further hit */
  sources: {
    cannon: { size: 2.2, opacity: 0.5, opacityStep: 0.1 },
    rocket: { size: 2.6, opacity: 0.55, opacityStep: 0.12 },
    fire:   { size: 1.6, opacity: 0.3, opacityStep: 0.05 },
  },
  /** A burning flame beam marks its target this often, ms */
  fireIntervalMs: 400,
} as const;

export type ScorchSource = keyof typeof SCORCH_DECAL_CONFIG.sources;

/** Peak and length of one screen shake */
export interface ScreenShakePreset {
  /** Peak offset as a share of the view height (0.005 = about 5 px at 1080p) */
  amplitude: number;
  /** ms until the offset is back to 0, falling linearly */
  duration: number;
}

/**
 * Screen shake (ScreenShakeService picks, ThreeTilesEngine draws it as a
 * screen-space offset of the projection). Impacts only shake near the
 * camera: full strength up to nearDistance, none from farDistance on. HQ
 * damage and boss deaths are game events rather than places and shake
 * wherever they happen.
 *
 * Calibrated on the camera-offset shake used until 2026-09-12 (metres, so
 * its size on screen shrank with the camera distance): impacts match it
 * seen from 150 m, HQ damage and boss deaths from the 425 m start camera.
 * Playtest 2026-09-12: 150 / 450 m reached too far, the shake has to fade
 * out much sooner; now full up to 40 m, none from 100 m.
 *
 * The nuclear strike fades with the distance too, over a range of its own:
 * the player aims it and watches it, usually from the overview camera
 * (about 425 m), and from there it has to shake hard. Full up to
 * strikeNearDistance, none from strikeFarDistance on. Until 2026-09-13 it
 * shook at 0.008 for 700 ms wherever it landed.
 */
export const SCREEN_SHAKE_CONFIG = {
  nearDistance: 40,  // m, camera to impact
  farDistance: 100,  // m
  strikeNearDistance: 350,  // m
  strikeFarDistance: 1500,  // m
  presets: {
    cannon:    { amplitude: 0.0025, duration: 150 },
    rocket:    { amplitude: 0.005,  duration: 200 },
    /** Times 0.5 to 2 for 5 to 20 HP lost */
    hqDamage:  { amplitude: 0.0025, duration: 300 },
    bossDeath: { amplitude: 0.004,  duration: 400 },
    nuclearStrike: { amplitude: 0.014, duration: 1600 },
  },
} as const satisfies {
  nearDistance: number;
  farDistance: number;
  strikeNearDistance: number;
  strikeFarDistance: number;
  presets: Record<string, ScreenShakePreset>;
};

/**
 * Fire intensity presets for spawnFire and its terrain/local-Y variants:
 * particle count and the radius they scatter over (m). Every fire burns until
 * stopFire(). Until 2026-09-13 this table held other values that nothing
 * read, and the renderer kept its own copy of the ones below.
 */
export const FIRE_INTENSITY = {
  tiny:    { count: 15,  radius: 1.5 },
  small:   { count: 40,  radius: 2.5 },
  medium:  { count: 80,  radius: 4 },
  large:   { count: 120, radius: 6 },
  inferno: { count: 200, radius: 10 },
} as const;

/**
 * Explosion presets for different projectile types. `radius` sizes the
 * fire-atlas explosion (EXPLOSION_LOOK), `smokePuffs` is its smoke stage.
 * The spark bursts (poison, arcane, chaos, bone) only take a particle count,
 * their colours come from BURST_PALETTES.
 */
export const EXPLOSION_PRESETS = {
  // No splash: the radius is purely visual
  rocket:   { particles: 50,  radius: 8, smokePuffs: 6 },
  // Until 2026-09-12 a cannon hit spawned two explosions, 35 particles from
  // the impact event and 30 more from a second splash event one metre lower.
  // One explosion now, with most of the second one's particles folded in.
  // VFXService takes the radius from the cannonball's splashRadius.
  cannon:   { particles: 50,  radius: 6, smokePuffs: 5 },
  // Passes no radius: sized like the reference radius (EXPLOSION_LOOK)
  bullet:   { particles: 2 },
  // Green spark burst (BURST_PALETTES.poison). Until 2026-09-12 the glob hit
  // with 6 + 30 orange fire-atlas particles, which read as a fireball.
  poison:   { particles: 14 },
  arcane:   { particles: 14 },
  chaos:    { particles: 14 },
  // Where a skeleton splits into its minions (enemy:split, BURST_PALETTES.bone)
  bone:     { particles: 12 },
} as const;

/**
 * Scorch marks of a nuclear strike (abilities.config.ts), besides the one on
 * the impact point: rings of `count` marks at `distance` times the strike
 * radius. Only where they meet route cells, only with ground marks on. The
 * cloud itself is MUSHROOM_CLOUD_LOOK. Until 2026-09-13 an explosion from
 * the fire-atlas pools went off at every mark, the rings 120 and 260 ms
 * after the impact on wall-clock timers.
 */
export const NUCLEAR_STRIKE_SCORCH_RINGS = [
  { count: 6, distance: 0.45 },
  { count: 9, distance: 0.85 },
] as const;

/**
 * Death blood for at most this many kills of one ability strike, the first
 * ones in grid order. A strike on a big wave kills 100 to 200 enemies at
 * once; each splatter is 40 particles in the normal pool (4000) plus a decal
 * with a terrain raycast. 24 splatters keep that under a quarter of the pool
 * and 24 raycasts. The blood decal pool (100) would only evict its oldest.
 */
export const ABILITY_DEATH_BLOOD_CAP = 24;

/**
 * Look of the fire-atlas explosion (cannon, rocket and bullet impacts), in
 * two stages: a fireball of additive explosion-atlas sprites, then smoke
 * puffs from the smoke atlas in the normal pool that only show up once the
 * fireball's bright half is over.
 *
 * Speeds and sprite sizes are given for `referenceRadius` and scale with
 * the blast radius of the impact. The cannon (6 m splash) therefore keeps
 * the ranges every explosion used before 2026-09-12 and the rocket (8 m) is
 * a third larger; the bullet passes no radius and keeps them as well.
 *
 * Back to the old look: fire.sizeEnd 0 (sprites shrink to nothing again)
 * and smokePuffs 0 in EXPLOSION_PRESETS.
 */
export const EXPLOSION_LOOK = {
  referenceRadius: 6,
  fire: {
    /** Outward speed, m/s at the reference radius */
    speedMin: 5,
    speedMax: 20,
    /** Lifetime, s. The flash is the first quarter of the 16 atlas frames. */
    lifeMin: 0.3,
    lifeMax: 0.7,
    /** Sprite size at the reference radius */
    sizeMin: 2.5,
    sizeMax: 5.5,
    /**
     * Sprite scale at birth and at death. The atlas frames already grow the
     * fireball; shrinking the sprite to 0 (the old curve) halved it by the
     * time the fireball frames came up and collapsed it while it dissipated.
     */
    sizeStart: 1,
    sizeEnd: 0.4,
  },
  smoke: {
    /** Seconds before a puff shows: the fire sprites' bright half ends after 0.15-0.35 s */
    delayMin: 0.2,
    delayMax: 0.35,
    /** Lifetime after the delay, s */
    lifeMin: 1.2,
    lifeMax: 2.0,
    /** Sprite size at the reference radius */
    sizeMin: 2.5,
    sizeMax: 4.0,
    /** Puffs start at half size and billow out */
    sizeStart: 0.5,
    sizeEnd: 1,
    /** Horizontal scatter around the impact, share of the radius */
    spread: 0.3,
    /** Rise and sideways drift, m/s */
    riseMin: 1.0,
    riseMax: 2.5,
    drift: 0.5,
    /** Grey tint over the light smoke atlas: soot, not steam */
    greyMin: 0.3,
    greyMax: 0.45,
  },
} as const;

/**
 * Mushroom cloud of the nuclear strike (MushroomCloudRenderer). Times are
 * game seconds after the impact, so a pause freezes the cloud and the
 * timescale runs it faster; lengths are metres at `referenceRadius` and
 * scale with the strike radius.
 *
 * 0 to 1.6 s, the detonation: a white flash over the ground point and over
 * the whole screen, a white-hot core in a fireball that punches up and
 * turns orange, a second fire front running out over the ground, a bright
 * shock dome, a shockwave ring out to 70 m with a wall of dust on its
 * front, embers thrown out and up.
 * 0.35 to 8 s: the fireball lifts and turns into the cap, a torus of
 * smoke in shifting lobes that rolls outward over the top and back in
 * underneath, dark on top and glowing orange underneath; it punches up to
 * about 55 m within the first second, then climbs slowly to about 110 m. A
 * stem of fire turning into smoke flows up into it, a white condensation
 * ring stands around the stem until 3.8 s, the ground at its foot burns
 * until 7.5 s.
 * 8 to 14 s: the cloud spreads, rises, drifts with the wind and fades.
 *
 * With impact effects off (VFX settings, the Low preset) the detonation
 * only: flash, core, fireball, fire front, shock dome and shockwave; no
 * smoke, no embers, no ground fire.
 *
 * Budget: 432 glow and 546 smoke particles per cloud, in buffers of the
 * renderer's own (2 clouds: 864 and 1092), not in the trail pools, which a
 * big wave keeps busy. While a cloud is up: two Points draw calls, for the
 * first 1.6 s the ring, 0.75 s the dome, 0.5 s the flash sprite and 0.55 s
 * a screen quad on top.
 */
export const MUSHROOM_CLOUD_LOOK = {
  referenceRadius: 25,
  /** Until the last smoke is gone */
  duration: 14,
  /** Clouds drawn at once; another strike takes the place of the oldest */
  clouds: 2,
  /**
   * Additive particles from the explosion atlas, per cloud. `embers` counts
   * streaks of `embers.trail` points each.
   */
  glowParticles: { core: 16, fireball: 56, shell: 48, embers: 48, groundFire: 32, stemFire: 40, rim: 48 },
  /** Normal-blended particles from the smoke atlas, per cloud */
  smokeParticles: { cap: 190, dome: 64, stem: 100, dust: 60, skirt: 36, wall: 56, condensation: 40 },
  /**
   * Sprite of `size` metres `height` above the ground point, additive at
   * `intensity`, and a screen-wide brightening of `screenPeak`, both fading
   * out quadratically. screenPeak 0 turns the screen flash off.
   */
  flash: { duration: 0.5, size: 150, height: 10, intensity: 3, screenPeak: 0.65, screenDuration: 0.55 },
  /**
   * Bloom kick with the flash: strength and threshold of the bloom pass
   * jump to these values at the impact and fall back to their own over
   * `duration`, quadratically. Only while bloom is on (VFX settings).
   */
  bloomKick: { duration: 0.9, strength: 1.4, threshold: 0.55 },
  /** Ring on the ground, its radius closing in on `radius` with the time constant */
  shockwave: { duration: 1.6, radius: 70, timeConstant: 0.35, opacity: 1 },
  /**
   * Shock dome: a bright hemisphere, brightest along its outline, closing in
   * on `radius` with the time constant and gone after `duration`.
   */
  shockDome: { duration: 0.75, radius: 46, timeConstant: 0.22, opacity: 0.85 },
  /** White-hot core of the fireball, gone by `duration`. Particle diameters m. */
  core: { radius: 6, duration: 0.6, intensity: 3, size: [7, 11] },
  /**
   * Hemisphere on the ground growing to `radius`, its centre punched up by
   * `punch` metres (time constant punchTime), lifting into the cap between
   * liftStart and liftEnd, gone by fadeEnd. White-hot until hotEnd, then
   * orange. Particle diameters m.
   */
  fireball: {
    radius: 18,
    growTime: 0.15,
    punch: 14,
    punchTime: 0.3,
    hotEnd: 0.7,
    liftStart: 0.5,
    liftEnd: 1.7,
    fadeStart: 1.9,
    fadeEnd: 3.1,
    size: [9, 15],
  },
  /** Second fire front: a flattened shell running out to `radius` from `start` on */
  shell: { start: 0.05, duration: 1, radius: 38, timeConstant: 0.25, size: [8, 13] },
  /**
   * Glowing debris thrown out and up at `speed` (m/s), slowed by air drag
   * (time constant `drag`) and pulled down by `gravity`; each lives `life`
   * seconds or until it reaches the ground. Drawn as streaks: the head and
   * its positions `trailStep`, 2 and 3 times that many seconds earlier.
   */
  embers: { speed: [22, 55], life: [1.2, 2.6], drag: 1.2, gravity: 9.8, trail: 4, trailStep: 0.045, size: [2, 3.2] },
  /** Burning ground between `radius` metres from the centre, flickering, out by fadeEnd */
  groundFire: { start: 0.35, fadeStart: 4.5, fadeEnd: 7.5, radius: [5, 24], size: [3, 6] },
  /**
   * The cap from `start` on: its centre punches up from startHeight by
   * punchHeight (time constant punchTime), then climbs on slowly towards
   * height (time constant riseTime); ring and tube radius grow from the
   * first to the second value with it. `flatten` squashes the tube; the
   * roll turns it at rollSpeed rad/s, slowing with the time constant
   * rollTime. `lobes` bulges the tube around the stem in shifting lobes.
   */
  cap: {
    start: 0.35,
    startHeight: 10,
    punchHeight: 50,
    punchTime: 0.45,
    height: 110,
    riseTime: 3.5,
    ringRadius: [5, 24],
    tubeRadius: [7, 16],
    flatten: 0.72,
    rollSpeed: 1.5,
    rollTime: 4,
    lobes: 0.16,
  },
  /** Stem radius at mid height; `flow` is the share of the stem its smoke climbs per second */
  stem: { start: 0.3, width: 5.5, flow: 0.28 },
  /** Base surge: dust out to `radius`, time constant `time` */
  dust: { radius: 50, time: 0.9 },
  /**
   * Condensation ring (Wilson cloud): a white ring around the stem at
   * mid height, from `start` to `end`, spreading between the two radii
   * with the time constant `time`
   */
  condensation: { start: 0.5, end: 3.8, radius: [8, 42], time: 1.2 },
  /** From `start` on the cloud spreads and rises (m/s), drifts with the wind (m/s) and fades out by `duration` */
  disperse: { start: 8, spread: 1.2, rise: 1, wind: 1 },
  /** Particle tints, linear. The smoke ones go over the light grey smoke atlas. */
  colors: {
    smoke: { r: 0.27, g: 0.245, b: 0.23 },
    fireLit: { r: 1.7, g: 0.82, b: 0.34 },
    dust: { r: 0.74, g: 0.66, b: 0.54 },
    condensation: { r: 0.92, g: 0.93, b: 0.95 },
    core: { r: 1, g: 0.98, b: 0.92 },
    /** The fireball runs from fireballHot to fireball */
    fireballHot: { r: 1, g: 0.93, b: 0.8 },
    fireball: { r: 1, g: 0.62, b: 0.28 },
    shell: { r: 1, g: 0.55, b: 0.2 },
    ember: { r: 1, g: 0.72, b: 0.36 },
    groundFire: { r: 1, g: 0.5, b: 0.16 },
    stemFire: { r: 1, g: 0.62, b: 0.3 },
    rim: { r: 1, g: 0.5, b: 0.18 },
    flash: { r: 1, g: 0.95, b: 0.85 },
    shockwave: { r: 1, g: 0.86, b: 0.62 },
    shockDome: { r: 1, g: 0.9, b: 0.75 },
  },
} as const;

/**
 * Spawn portals (SpawnPortalManager). Energy is a factor on the glow of the
 * surface, the sigils and the light on the street, and on the swirl's
 * speed. Times in seconds of wall time, the portal keeps moving while the
 * game is paused; only the sigils' life (glyphs) stands in the pause.
 */
export const SPAWN_PORTAL_LOOK = {
  /**
   * Colours of the smouldering look, channels 0-1 as the shaders write
   * them: the void's near-black ground, the dark red of its swirl, the
   * glowing seams and the light on the stone and the street, the dull
   * orange of the hottest points and the embers, a violet in the swirl's
   * troughs. The spawn's own colour only tints the rim, the runes and the
   * street light, so spawns stay apart without a bright disc.
   */
  palette: {
    void: { r: 0.012, g: 0.004, b: 0.007 },
    ember: { r: 0.4, g: 0.055, b: 0.03 },
    hot: { r: 0.8, g: 0.26, b: 0.07 },
    violet: { r: 0.15, g: 0.035, b: 0.2 },
  },
  /**
   * The frame's stone (baked textures, spawn-portal-frame.ts): gain on its
   * base colour under the faked light, in linear light, dark and
   * threatening against the tiles but no black silhouette, the relief, the
   * joints and the worn edges readable from the overview; and the strength
   * of the key light's glints on the glossy obsidian and the iron. Leave
   * the glow alone.
   */
  frameExposure: 1.15,
  frameGlints: 0.35,
  /**
   * The carved sigils on the frame, glowing from inside their grooves: a
   * hot core along each stroke, a darker blood red at its edges. Glow level
   * `dormant` between waves, a low ember that still reads from the
   * overview, `active` while a wave runs, up to `flare` more at the peak of
   * a wave start's surge; `gain` is the core's light at level 1, times the
   * palette's hot as linear light. Each sigil breathes at its own pace, its
   * breaths between the two `breath` lengths (s), dimming by up to
   * breathDepth of its glow. Now and then one wakes: an uneven glimmer
   * crawls along its strokes (crawl, stroke orders per second), it rises
   * (rise), holds (hold) and sinks back (fade), up to wakeGain brighter,
   * heat shimmers over it (shimmer, cell units) and embers rise off it.
   * Each sigil gets slots of about wakePeriod seconds (plus or minus 20 %)
   * and wakes at most once in a slot, with the chance wakeChance, from idle
   * to wave energy; the surge of a wave start stirs them all. Seconds of
   * wall time that stand while the game is paused; the timescale does not
   * hurry them.
   */
  glyphs: {
    dormant: 0.38, active: 1.2, flare: 0.8, gain: 4.3, breath: [5, 11], breathDepth: 0.5,
    wakePeriod: 16, wakeChance: [0.2, 0.55], rise: 1.2, hold: 2.4, fade: 3.2, wakeGain: 1.2, crawl: 1.6, shimmer: 0.004,
  },
  /** Between waves */
  idleEnergy: 0.45,
  /** While a wave runs */
  waveEnergy: 0.8,
  /** Extra energy at wave start, falling off with the time constant surgeDecay */
  surge: 1.2,
  surgeDecay: 1.2,
  /** Time constant of the change between idle and wave energy */
  settle: 1.5,
  /**
   * Spawn effect, when an enemy steps through: a ripple over the surface
   * and the street, and sparks thrown out of the portal. Waves reach
   * thousands of enemies, so a portal takes at most one burst per
   * burstIntervalMs (wall time), however many come through.
   */
  burstIntervalMs: 250,
  burstParticles: 10,
  /** Life of the ripple (s) */
  rippleLife: 0.9,
  /**
   * Summoning circle on the street ahead of the portal, drawn in the
   * frame's sigils (marker-shaders.ts, portalCircle): centre ahead of the
   * front surface and outer radius (m, scale 1), turn (rad/s), glow between
   * and during waves, and on top of it at the peak of a wave start's surge.
   */
  circle: { centre: 4.6, radius: 3.9, spin: 0.02, glow: 0.12, flare: 0.8 },
} as const;

/** RGB colour, channels 0-1 (linear, as the particle pools store it). */
export interface EffectRgb {
  r: number;
  g: number;
  b: number;
}

/** Spark-burst palette: 40 % of the particles get the first colour, 30 % each the other two. */
export type BurstPalette = readonly [EffectRgb, EffectRgb, EffectRgb];

/** Palettes for the round-particle spark bursts (ice, arcane orb, chaos orb and poison glob hits, a skeleton's split). */
export const BURST_PALETTES = {
  // Bone white to dust grey. The pool blends additively, so the colours stay
  // dim: a bone-white core at full value would flash like the ice burst.
  bone: [
    { r: 0.8, g: 0.77, b: 0.68 },  // Bone white
    { r: 0.55, g: 0.51, b: 0.44 }, // Aged bone
    { r: 0.32, g: 0.3, b: 0.26 },  // Dust
  ],
  poison: [
    { r: 0.55, g: 1.0, b: 0.2 },  // Bright toxic green core
    { r: 0.2, g: 0.8, b: 0.05 },  // Green
    { r: 0.1, g: 0.45, b: 0.0 },  // Dark green
  ],
  ice: [
    { r: 1.0, g: 1.0, b: 1.0 },   // White core
    { r: 0.9, g: 0.98, b: 1.0 },  // Very light cyan
    { r: 0.8, g: 0.95, b: 1.0 },  // Light ice blue
  ],
  arcane: [
    { r: 0.85, g: 0.9, b: 1.0 },  // White-lavender core
    { r: 0.55, g: 0.25, b: 1.0 }, // Violet
    { r: 0.3, g: 0.8, b: 1.0 },   // Cyan
  ],
  chaos: [
    { r: 1.0, g: 0.6, b: 1.0 },   // Pale magenta core
    { r: 0.6, g: 0.0, b: 1.0 },   // Violet
    { r: 0.95, g: 0.1, b: 0.65 }, // Magenta
  ],
} as const satisfies Record<string, BurstPalette>;

/** Muzzle flash of one tower type: particle burst at the shoot point plus the pooled flash light. */
export interface MuzzleFlashProfile {
  countMin: number;
  countMax: number;
  sizeMin: number;
  sizeMax: number;
  /** Particle lifetime in seconds */
  lifeMin: number;
  lifeMax: number;
  /** Intensity of the tower renderer's single muzzle PointLight (0 = no light) */
  lightIntensity: number;
}

/**
 * Muzzle flash per tower type. Only the towers listed here flash: the guns,
 * the launcher and (faintly) the bow. Ice, Magic and Poison also fire
 * projectiles but cast or spit them; Fire, Lightning and Tentacle never
 * spawn one. Until 2026-09-11 every projectile tower but Ice and Magic got
 * the same flash, Poison included.
 */
export const MUZZLE_FLASH_PROFILES: Partial<Record<TowerTypeId, MuzzleFlashProfile>> = {
  // A bow has no muzzle: a faint glint, no light
  archer: { countMin: 1, countMax: 2, sizeMin: 0.6, sizeMax: 1.2, lifeMin: 0.03, lifeMax: 0.05, lightIntensity: 0 },
  // 5 shots/s from two barrels: small and short, or the stream turns into a strobe
  'dual-gatling': { countMin: 2, countMax: 3, sizeMin: 1.0, sizeMax: 2.0, lifeMin: 0.03, lifeMax: 0.05, lightIntensity: 2 },
  // Launch flash: the values every tower shared before
  rocket: { countMin: 3, countMax: 5, sizeMin: 1.5, sizeMax: 3.0, lifeMin: 0.04, lifeMax: 0.06, lightIntensity: 3 },
  // Heavy gun at 0.5 shots/s: the biggest and longest flash
  cannon: { countMin: 6, countMax: 8, sizeMin: 2.5, sizeMax: 4.5, lifeMin: 0.06, lifeMax: 0.1, lightIntensity: 5 },
};

/** Type exports */
export type FireIntensityLevel = keyof typeof FIRE_INTENSITY;
