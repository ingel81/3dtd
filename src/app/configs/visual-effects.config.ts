/**
 * Visual Effects Configuration
 *
 * Centralized particle, decal, and effect settings.
 * Previously hardcoded in three-effects.renderer.ts
 */

import type { TowerTypeId } from './tower-types.config';
import type { AbilityId } from './abilities.config';

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
 *
 * The other abilities are aimed and watched the same way but shake far
 * less: full up to abilityNearDistance, none from abilityFarDistance on,
 * so the overview camera (about 425 m) keeps about half.
 *
 * HQ damage shakes at most once per hqDamageMinIntervalMs of wall time,
 * unless a hit costing more HP than the last shake's comes in: an ooze
 * flowing in loses HP point by point, at 4x about seven times a second, and
 * shook the screen without a pause. The same interval as the red leak edge
 * (LeakVignetteComponent).
 */
export const SCREEN_SHAKE_CONFIG = {
  nearDistance: 40,  // m, camera to impact
  farDistance: 100,  // m
  strikeNearDistance: 350,  // m
  strikeFarDistance: 1500,  // m
  abilityNearDistance: 150,  // m
  abilityFarDistance: 700,  // m
  hqDamageMinIntervalMs: 900,
  presets: {
    cannon:    { amplitude: 0.0025, duration: 150 },
    rocket:    { amplitude: 0.005,  duration: 200 },
    /** Times 0.5 to 2 for 5 to 20 HP lost */
    hqDamage:  { amplitude: 0.0025, duration: 300 },
    bossDeath: { amplitude: 0.004,  duration: 400 },
    nuclearStrike: { amplitude: 0.014, duration: 1600 },
    frostBomb: { amplitude: 0.004, duration: 350 },
    emp: { amplitude: 0.005, duration: 450 },
    orbitalLaser: { amplitude: 0.003, duration: 1200 },
  },
} as const satisfies {
  nearDistance: number;
  farDistance: number;
  strikeNearDistance: number;
  strikeFarDistance: number;
  abilityNearDistance: number;
  abilityFarDistance: number;
  hqDamageMinIntervalMs: number;
  presets: Record<string, ScreenShakePreset>;
};

/** Screen shake of an ability's impact and the camera distances it fades over */
export interface AbilityImpactShake {
  preset: ScreenShakePreset;
  /** Full strength up to this distance from the camera, m */
  nearDistance: number;
  /** None from this distance on, m */
  farDistance: number;
}

/**
 * Screen shake per ability on `ability:impact` (ScreenShakeService), null
 * for one that does not shake. Complete per AbilityId, so a new ability
 * decides here.
 */
export const ABILITY_IMPACT_SHAKE: Record<AbilityId, AbilityImpactShake | null> = {
  'nuclear-strike': {
    preset: SCREEN_SHAKE_CONFIG.presets.nuclearStrike,
    nearDistance: SCREEN_SHAKE_CONFIG.strikeNearDistance,
    farDistance: SCREEN_SHAKE_CONFIG.strikeFarDistance,
  },
  'frost-bomb': {
    preset: SCREEN_SHAKE_CONFIG.presets.frostBomb,
    nearDistance: SCREEN_SHAKE_CONFIG.abilityNearDistance,
    farDistance: SCREEN_SHAKE_CONFIG.abilityFarDistance,
  },
  emp: {
    preset: SCREEN_SHAKE_CONFIG.presets.emp,
    nearDistance: SCREEN_SHAKE_CONFIG.abilityNearDistance,
    farDistance: SCREEN_SHAKE_CONFIG.abilityFarDistance,
  },
  'orbital-laser': {
    preset: SCREEN_SHAKE_CONFIG.presets.orbitalLaser,
    nearDistance: SCREEN_SHAKE_CONFIG.abilityNearDistance,
    farDistance: SCREEN_SHAKE_CONFIG.abilityFarDistance,
  },
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
  // The hero's explosive rounds (no splash, the radius is visual) and rune
  // rounds (BURST_PALETTES.arcane). Small: he fires up to twice a second
  heroShell: { particles: 12, radius: 2.5, smokePuffs: 1 },
  heroRune:  { particles: 8 },
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
 * Frost patches of a frost bomb (ice decals, the ice tower's), besides the
 * one on the impact point: rings of `count` patches at `distance` times the
 * radius, `size` metres across. Only with ground marks on. The burst itself
 * is FROST_BURST_LOOK.
 */
export const FROST_BOMB_ICE_RINGS = [
  { count: 6, distance: 0.45, size: 4 },
  { count: 10, distance: 0.85, size: 3.2 },
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
 * The ooze's body (OozeBandRenderer): a band of toxic green translucent
 * slime along the route, as wide as the covered corridor, with bubbles
 * rising in it and bone remnants drifting inside, glossy at the edges. It
 * thins with the ooze's HP. Colours are linear; the shader encodes its
 * output for the canvas. Times are game seconds.
 */
export const OOZE_LOOK = {
  /** Height of the crest at full HP (m) */
  height: 1.5,
  /** Share of the width and the height left at 0 HP */
  minWidth: 0.6,
  minHeight: 0.55,
  /** Length over which tip and tail round off (m) */
  capLength: 4,
  /** Vertices across the band */
  across: 9,
  /** Seconds between two ground refreshes of the body's stretch (route cells refine as tiles stream) */
  groundRefresh: 1,
  /** Seconds the band takes to sink away once the ooze is gone (a leak, a removal) */
  dissolve: 0.6,
  /**
   * Seconds a killed ooze's band takes to collapse (OozeBandRenderer.collapse):
   * it boils and swells for a moment, slumps into a puddle that runs past its
   * edges and tears open until nothing is left. Long enough for the bubbles,
   * spray and debris to read as a sequence; short enough that the clumps
   * (4.5 m/s) have hopped about 9 m out of it before it is gone, so the towers
   * are not seen shooting into a band that is no target any more.
   */
  collapse: 2,
  /** Deep and bright slime, bone remnants, the glow of bubbles and rim */
  deep: [0.015, 0.12, 0.008] as const,
  bright: [0.22, 0.8, 0.04] as const,
  bone: [0.55, 0.5, 0.38] as const,
  glow: [0.4, 1.0, 0.25] as const,
  /** Status tints: colour mixed in and how much (slow, poison); burn glows on top */
  slowTint: [0.35, 0.75, 1.0] as const,
  slowAmount: 0.4,
  poisonTint: [0.18, 0.02, 0.22] as const,
  poisonAmount: 0.3,
  /** Frozen solid (freeze) and stunned (stun), over the slow and the poison */
  iceTint: [0.85, 0.95, 1.0] as const,
  iceAmount: 0.55,
  stunTint: [0.55, 0.45, 1.0] as const,
  stunAmount: 0.45,
  burnGlow: [1.0, 0.45, 0.08] as const,
};

/**
 * What a killed ooze lets go while its band collapses (OOZE_LOOK.collapse):
 * bubbles bursting with a spray of slime, splashes of it on the ground
 * (blood decals in its colour, tinted by the blood moon like every ground
 * mark) and the debris it had swallowed, thrown up from its whole length
 * (OozeDebrisRenderer). OozeBandRenderer plans it at the kill
 * (planOozeDeath) and lets each part go at its share of the collapse.
 * Counts go with the body's length; the minimums hold for a body a few
 * metres long.
 *
 * With impact effects off (VFX settings, the Low preset) no bubbles and no
 * spray and a third of the debris; with ground marks off no splashes.
 *
 * Budget of an 80 m body: 32 bubbles of 8 sparks (additive pool) and 14
 * drops (normal pool), 704 particles over 1.6 s; 16 splashes out of the
 * 100 blood decals; 60 pieces of debris, instanced, one draw call per kind
 * with a piece in the air or on the ground (nine kinds).
 */
export const OOZE_DEATH_LOOK = {
  /** Colour of the spray and the splashes: the ooze's bloodColor, which its clumps splash in */
  goo: 0x6fe021,
  /** Bursting bubbles: one per `everyM` of body, `sparks` additive sparks and `spray` slime drops each, `lift` m above the ground, until `until` of the collapse */
  pops: { everyM: 2.5, min: 4, sparks: 8, spray: 14, lift: 0.9, until: 0.8 },
  /** Splashes on the ground: one per `everyM` of body, sizeMin..sizeMax m across, between `from` and `until` of the collapse */
  splashes: { everyM: 5, min: 2, sizeMin: 2.2, sizeMax: 3.8, from: 0.2, until: 0.85 },
  /**
   * Debris: `perM` pieces a metre of body, at least `min` (with impact
   * effects off `lowShare` of them, at least `minLow`), thrown between
   * `from` and `until` of the collapse from `lift` m above the ground,
   * upMin..upMax m/s up and outMin..outMax m/s out, spinning at up to
   * `spin` rad/s under `gravity` m/s². A piece bounces once, lies
   * restMin..restMax seconds and sinks into the ground over `sink`. `scale`
   * over the pieces' natural size: they have to read from the overview
   * camera.
   */
  debris: {
    perM: 0.75,
    min: 6,
    minLow: 3,
    lowShare: 1 / 3,
    from: 0.05,
    until: 0.6,
    lift: 0.8,
    upMin: 5,
    upMax: 11,
    outMin: 1,
    outMax: 4.5,
    spin: 12,
    gravity: 16,
    restMin: 2,
    restMax: 3.5,
    sink: 1,
    scale: 1.6,
  },
} as const;

/**
 * Mushroom cloud of the nuclear strike (MushroomCloudRenderer). Times are
 * game seconds after the impact, so a pause freezes the cloud and the
 * timescale runs it faster; lengths are metres at `referenceRadius` and
 * scale with the strike radius. Playtest 2 (2026-09-14) asked for the look
 * of archive footage, bigger: the cloud is about 1.6 times the size of the
 * one before and stands 22 s instead of 14.
 *
 * 0 to 1.1 s, the detonation: a white flash blinds the screen and lights
 * the sky, then warms as it fades. A fireball swells on the ground, its
 * surface boiling, white-hot, turning yellow, orange and by 3 s dark red; a
 * fire front runs out along the ground, a white shock dome and a shockwave
 * ring run out to 135 m, a wall of dust on the ring's front; embers fly
 * out, the ground glows around the foot (an additive disc, the tiles take
 * no light).
 * 0.3 to 12 s: the fireball rises and flattens into the core of the cap,
 * a torus of billowing smoke that rolls out over the top and back in
 * underneath, sooty on top, glowing orange underneath, darkening as it
 * cools; it punches up to about 95 m by 1.5 s and climbs on to about 165 m
 * by 10 s. A stem, far narrower than the cap, carries smoke and dust up;
 * dust is drawn in along the ground to its foot; a white condensation ring
 * stands around the stem from 0.6 to 3.6 s; the base surge spreads out to
 * about 115 m.
 * 12 to 22 s: the cloud spreads, rises, drifts with the wind and fades.
 *
 * With impact effects off (VFX settings, the Low preset) the same phases
 * and silhouette from fewer, larger sprites (the `low` counts), no embers,
 * the smoke unlit and the fireball's surface in two octaves of noise
 * instead of four.
 *
 * Budget per cloud: 740 smoke and 402 glow sprites, Low 294 and 88;
 * instanced quads in buffers of the renderer's own, 2 clouds at once.
 */
export const MUSHROOM_CLOUD_LOOK = {
  referenceRadius: 25,
  /** Until the last smoke is gone */
  duration: 22,
  /** Clouds drawn at once; another strike takes the place of the oldest */
  clouds: 2,
  /** Billow atlas of the sprites (mushroom-cloud-sprites.ts): cells per side, pixels per cell */
  atlas: { cells: 4, cellSize: 96 },
  /** Lit smoke sprites per cloud, whole and with impact effects off */
  smokeSprites: {
    full: { cap: 260, dome: 80, stem: 130, inflow: 70, surge: 90, wall: 60, condensation: 50 },
    low: { cap: 110, dome: 30, stem: 50, inflow: 24, surge: 40, wall: 24, condensation: 16 },
  },
  /** Additive glow sprites per cloud, whole and with impact effects off; `embers` counts streaks of `embers.trail` sprites */
  glowSprites: {
    full: { shell: 40, embers: 48, groundFire: 40, stemFire: 50, rim: 80 },
    low: { shell: 20, embers: 0, groundFire: 12, stemFire: 20, rim: 36 },
  },
  /**
   * Sprite of `size` metres `height` above the ground point, additive at
   * `intensity`, fading out quadratically over `duration`: the sky lights
   * up. Over the whole screen `screenPeak` of white for `screenHold`, then
   * fading out quadratically and warming towards colors.flashAfter until
   * `screenDuration`. screenPeak 0 turns the screen flash off.
   */
  flash: { duration: 1.4, size: 520, height: 60, intensity: 3, screenPeak: 0.92, screenHold: 0.08, screenDuration: 1.1 },
  /**
   * Bloom kick with the flash: strength and threshold of the bloom pass
   * jump to these values at the impact and fall back to their own over
   * `duration`, quadratically. Only while bloom is on (VFX settings).
   */
  bloomKick: { duration: 1.4, strength: 1.6, threshold: 0.5 },
  /**
   * Light on the ground around the foot: an additive disc of `radius`
   * metres, `peak` bright at the impact and dimming with the fireball,
   * gone by fadeEnd
   */
  groundGlow: { radius: 130, peak: 1.1, fadeStart: 2, fadeEnd: 7 },
  /** Ring on the ground, its radius closing in on `radius` with the time constant */
  shockwave: { duration: 2.2, radius: 135, timeConstant: 0.45, opacity: 1 },
  /**
   * Shock dome: a bright hemisphere, brightest along its outline, closing in
   * on `radius` with the time constant and gone after `duration`.
   */
  shockDome: { duration: 0.9, radius: 75, timeConstant: 0.25, opacity: 0.8 },
  /**
   * Fireball: grows to `radius` with the time constant growTime and by
   * `swell` of that over the first 3 s, its centre punched up by `punch`
   * (time constant punchTime). Between riseStart and riseEnd its centre
   * goes up to the cap's, the head of the rising column; between
   * flattenStart and flattenEnd it flattens into the core of the cap. Its
   * heat runs from white-hot down with the time constant heatTime
   * (fireballHeat), its brightness from intensity[0] to intensity[1];
   * `boil` is how far its surface bulges. Fades out between fadeStart and
   * fadeEnd.
   */
  fireball: {
    radius: 24,
    growTime: 0.12,
    swell: 0.3,
    punch: 14,
    punchTime: 0.3,
    riseStart: 0.2,
    riseEnd: 1,
    flattenStart: 0.6,
    flattenEnd: 3,
    heatTime: 1.1,
    intensity: [3.2, 0.9],
    intensityTime: 0.5,
    fadeStart: 2.8,
    fadeEnd: 6,
    boil: 0.28,
  },
  /** Fire front: a flattened shell running out along the ground to `radius` from `start` on. Sprite diameters m. */
  shell: { start: 0.03, duration: 0.9, radius: 45, timeConstant: 0.22, size: [11, 18] },
  /**
   * Glowing debris thrown out and up at `speed` (m/s), slowed by air drag
   * (time constant `drag`) and pulled down by `gravity`; each lives `life`
   * seconds or until it reaches the ground. Drawn as streaks: the head and
   * its positions `trailStep`, 2 and 3 times that many seconds earlier.
   */
  embers: { speed: [30, 75], life: [1.3, 2.8], drag: 1.2, gravity: 9.8, trail: 4, trailStep: 0.045, size: [2.6, 4.2] },
  /** Burning ground between `radius` metres from the centre, flickering, out by fadeEnd */
  groundFire: { start: 0.3, fadeStart: 5, fadeEnd: 9, radius: [6, 36], size: [5, 10] },
  /**
   * The cap from `start` on (capHeightAt): its centre punches up from
   * startHeight by punchHeight (time constant punchTime), then climbs on
   * slowly towards height (time constant riseTime); ring and tube radius
   * grow from the first to the second value with it. `flatten` squashes the
   * tube; the roll turns it at rollSpeed rad/s, slowing with the time
   * constant rollTime. `lobes` bulges the tube around the stem in shifting
   * lobes. Its smoke comes up around the fireball between the two `appear`
   * times.
   */
  cap: {
    start: 0.3,
    startHeight: 20,
    punchHeight: 70,
    punchTime: 0.7,
    height: 175,
    riseTime: 5,
    ringRadius: [8, 38],
    tubeRadius: [16, 24],
    flatten: 0.72,
    rollSpeed: 1.6,
    rollTime: 6,
    lobes: 0.14,
    appear: [1, 2.6],
  },
  /** Stem radius at mid height and at its foot; `flow` is the share of the stem its smoke climbs per second */
  stem: { start: 0.25, width: 8, foot: 22, flow: 0.22 },
  /** Dust drawn in along the ground from between the two radii to the stem's foot, `rate` trips per second */
  inflow: { start: 0.8, radius: [25, 75], rate: 0.16 },
  /** Base surge: dust rolling out along the ground to `radius`, time constant `time`, puff centres between the heights */
  surge: { start: 0.5, radius: 115, time: 2.8, height: [3, 14] },
  /**
   * Condensation ring (Wilson cloud): a white ring around the stem at
   * `height` times the cap's height, from `start` to `end`, spreading
   * between the two radii with the time constant `time`
   */
  condensation: { start: 0.6, end: 3.6, radius: [10, 62], time: 1.1, height: 0.42 },
  /** From `start` on the cloud spreads and rises (m/s), drifts with the wind (m/s) and fades out by `duration` */
  disperse: { start: 12, spread: 1.4, rise: 1.4, wind: 1.2 },
  /** Tints, linear. Smoke tints are the albedo the sprite shader lights; fireLit is the fire's light from below. */
  colors: {
    smoke: { r: 0.22, g: 0.19, b: 0.165 },
    fireLit: { r: 1.6, g: 0.62, b: 0.2 },
    dust: { r: 0.5, g: 0.42, b: 0.32 },
    condensation: { r: 0.9, g: 0.92, b: 0.95 },
    shell: { r: 1, g: 0.55, b: 0.2 },
    ember: { r: 1, g: 0.72, b: 0.36 },
    groundFire: { r: 1, g: 0.5, b: 0.16 },
    stemFire: { r: 1, g: 0.6, b: 0.28 },
    /** The underside glows from rim to rimLate as it cools */
    rim: { r: 1, g: 0.45, b: 0.14 },
    rimLate: { r: 0.6, g: 0.13, b: 0.03 },
    /** The screen flash warms from flash to flashAfter */
    flash: { r: 1, g: 0.97, b: 0.92 },
    flashAfter: { r: 1, g: 0.72, b: 0.45 },
    groundGlow: { r: 1, g: 0.58, b: 0.24 },
    shockwave: { r: 1, g: 0.88, b: 0.7 },
    shockDome: { r: 0.95, g: 0.95, b: 0.92 },
  },
} as const;

/**
 * Frost burst of the frost bomb (FrostBurstRenderer). Times are game
 * seconds after the impact, so a pause holds the burst and the timescale
 * plays it faster; lengths are metres at `referenceRadius` and scale with
 * the ability's radius (the ring and the rime take the radius itself).
 *
 * 0 to 0.35 s a white-cyan flash over the ground point; to 1.2 s a ring of
 * cold running out to 1.15 times the radius; ice shards thrown out and up,
 * resting on the ground until they fade (up to 1.3 s); a low mist rolling
 * out over the radius (to about 3.2 s). Rime on the ground over the whole
 * radius comes up in 0.12 s, holds as long as the freeze (the VFXService
 * passes it) and fades out over `rime.fade`.
 *
 * With impact effects off (VFX settings) flash, ring and rime only.
 * Budget: 64 shards and 28 mist puffs per burst, two bursts at once, in
 * buffers of the renderer's own.
 */
export const FROST_BURST_LOOK = {
  referenceRadius: 20,
  /** Bursts drawn at once; another takes the place of the oldest */
  bursts: 2,
  /** Sprite of `size` metres `height` above the ground point, additive at `intensity` */
  flash: { duration: 0.35, size: 70, height: 4, intensity: 2.2 },
  /** Ring out to `radius` times the ability radius, time constant `timeConstant` */
  ring: { duration: 1.2, radius: 1.15, timeConstant: 0.16, opacity: 0.95 },
  /** Rime over the radius: up in `rise` s, held for the freeze, gone `fade` s later */
  rime: { rise: 0.12, fade: 1.0, opacity: 0.45 },
  /**
   * Shards thrown out at `speed` and up at `lift` (m/s), slowed by air drag
   * (time constant `drag`, s) and pulled down by `gravity`; each lives
   * `life` seconds. Diameters in metres.
   */
  shards: { count: 64, speed: [9, 26], lift: [3, 13], drag: 1.2, gravity: 16, life: [0.55, 1.3], size: [0.9, 2.1] },
  /**
   * Mist puffs from `start` on, in a ring at `radius` times the ability
   * radius, rolling out at `spread` and rising at `rise` (m/s). Diameters m.
   */
  mist: { count: 28, start: 0.04, radius: [0.35, 1.0], rise: 0.9, spread: 1.2, life: [1.6, 3.0], size: [6, 11] },
  /** Tints, linear. Mist goes over the light grey smoke atlas. */
  colors: {
    flash: { r: 0.85, g: 0.95, b: 1.0 },
    ring: { r: 0.6, g: 0.88, b: 1.0 },
    rime: { r: 0.55, g: 0.8, b: 1.0 },
    shard: { r: 0.8, g: 0.95, b: 1.0 },
    shardDeep: { r: 0.35, g: 0.7, b: 1.0 },
    mist: { r: 0.86, g: 0.93, b: 1.0 },
  },
} as const;

/**
 * Pulse of the EMP (EmpPulseRenderer). Times are game seconds after the
 * impact, so a pause holds the pulse and the timescale plays it faster;
 * radii are shares of the ability's radius, sizes metres at
 * `referenceRadius`.
 *
 * 0 to 0.25 s a blue-white flash; two electric fronts run out over the
 * ground, jagged and crackling, the first to 1.05 times the radius in
 * 0.75 s, the second 0.14 s later to 0.85 times; a faint shell over the
 * radius, brightest along its outline, 0.45 s; sparks crackle along the
 * first front where it passes, born until 0.7 s, each for 0.12 to 0.35 s.
 *
 * With impact effects off (VFX settings) no sparks. Budget: 96 sparks per
 * pulse, two pulses at once, in a buffer of the renderer's own; while a
 * pulse is up four draw calls more (two fronts, shell, flash).
 */
export const EMP_PULSE_LOOK = {
  referenceRadius: 30,
  /** Pulses drawn at once; another takes the place of the oldest */
  pulses: 2,
  /** Sprite of `size` metres `height` above the ground point, additive at `intensity` */
  flash: { duration: 0.25, size: 90, height: 6, intensity: 2.6 },
  /**
   * Electric fronts: from `delay` on, out to `radius` times the ability
   * radius with time constant `timeConstant`, gone by `delay + duration`.
   * `width` is the band's half width as a share of the ability radius.
   */
  rings: [
    { delay: 0, duration: 0.75, radius: 1.05, timeConstant: 0.14, width: 0.05, opacity: 1 },
    { delay: 0.14, duration: 0.8, radius: 0.85, timeConstant: 0.2, width: 0.035, opacity: 0.7 },
  ],
  /** Shell out to `radius` times the ability radius, `flatten` its height over its radius */
  dome: { duration: 0.45, radius: 0.95, timeConstant: 0.12, opacity: 0.5, flatten: 0.55 },
  /** Sparks on the first front: born until `until` s, `lift` m above the ground, diameters m */
  sparks: { count: 96, until: 0.7, life: [0.12, 0.35], size: [0.8, 2.0], lift: [0.2, 3.5] },
  /** Tints, linear */
  colors: {
    flash: { r: 0.8, g: 0.88, b: 1.0 },
    ring: { r: 0.35, g: 0.45, b: 1.0 },
    ringCore: { r: 0.85, g: 0.92, b: 1.0 },
    dome: { r: 0.45, g: 0.5, b: 1.0 },
    spark: { r: 0.55, g: 0.5, b: 1.0 },
    sparkCore: { r: 0.9, g: 0.95, b: 1.0 },
  },
} as const;

/**
 * Beam of the orbital laser (OrbitalBeamRenderer). Times are game seconds,
 * so a pause holds the beam and the timescale plays it faster; the foot
 * runs along the swept route at the ability's speed.
 *
 * A column of light `column.height` m high over the foot, a white-hot core
 * of `coreWidth` and an orange glow of `glowWidth` (half widths, m) on a
 * quad `quadWidth` m wide turned to the camera, depth tested; a glow at the
 * foot and a ring at the beam's radius on the ground (depth test off); a
 * flash where it comes down; `sparks.rate` sparks per second thrown from
 * the foot; a scorch mark every `scorchStep` metres of the way (with
 * ground marks on). Fades in over `fadeIn`, out over `fadeOut` once it has
 * burnt its time or reached the end of its path.
 *
 * With impact effects off (VFX settings) no sparks. Budget per beam: about
 * 120 sparks in a buffer of the renderer's own, four draw calls more
 * (column, ring, foot, flash) while it burns; two beams at once.
 */
export const ORBITAL_BEAM_LOOK = {
  /** Beams drawn at once; another takes the place of the oldest */
  beams: 2,
  column: { height: 320, coreWidth: 0.9, glowWidth: 3.2, quadWidth: 9, intensity: 2.2 },
  fadeIn: 0.12,
  fadeOut: 0.35,
  /** Glow sprite at the foot, `size` times the beam radius across */
  foot: { size: 3.2, intensity: 2.0 },
  /** Sprite of `size` m where the beam comes down */
  flash: { duration: 0.3, size: 60, intensity: 2.5 },
  /** Ring on the ground at the beam's radius: where it hurts */
  ring: { opacity: 0.8 },
  /** Sparks: `rate` per second, out at `speed` and up at `lift` (m/s), pulled down by `gravity`; diameters m */
  sparks: { rate: 220, life: 0.55, speed: [4, 12], lift: [3, 10], gravity: 14, size: [0.5, 1.3] },
  /** Metres of the way between two scorch marks */
  scorchStep: 3,
  /** Tints, linear */
  colors: {
    core: { r: 1.0, g: 0.95, b: 0.85 },
    glow: { r: 1.0, g: 0.42, b: 0.12 },
    foot: { r: 1.0, g: 0.6, b: 0.25 },
    flash: { r: 1.0, g: 0.85, b: 0.65 },
    ring: { r: 1.0, g: 0.5, b: 0.18 },
    spark: { r: 1.0, g: 0.45, b: 0.1 },
    sparkHot: { r: 1.0, g: 0.9, b: 0.6 },
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
   * frame's sigils (spawn-portal-glow-material.ts, portalCircle): centre ahead of the
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

/**
 * Sparks on a stunned enemy (stun status, EnemyManager.presentFrame): a
 * burst of `particles` sparks `height` metres above its feet every
 * `intervalMs` of game time, so the pause holds them and the timescale
 * speeds them up; at most `perFrame` bursts per rendered frame, the others
 * wait for the next. The impact bursts' pool and switch, BURST_PALETTES.stun.
 */
export const STUN_SPARKS = { intervalMs: 400, particles: 5, perFrame: 8, height: 1.6 } as const;

/** Palettes for the round-particle spark bursts (ice, arcane orb, chaos orb and poison glob hits, a skeleton's split, an ooze's bubbles, stun sparks). */
export const BURST_PALETTES = {
  // Bone white to dust grey. The pool blends additively, so the colours stay
  // dim: a bone-white core at full value would flash like the ice burst.
  bone: [
    { r: 0.8, g: 0.77, b: 0.68 },  // Bone white
    { r: 0.55, g: 0.51, b: 0.44 }, // Aged bone
    { r: 0.32, g: 0.3, b: 0.26 },  // Dust
  ],
  // Bubbles bursting on a collapsing ooze (OOZE_DEATH_LOOK.pops): the glow
  // of its slime, dim like the bone burst since the pool blends additively
  slime: [
    { r: 0.35, g: 0.8, b: 0.12 },  // Glowing slime
    { r: 0.18, g: 0.45, b: 0.05 }, // Deep slime
    { r: 0.5, g: 0.85, b: 0.32 },  // Bubble film
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
  // Electric: blue-white core, the stun tint's violet-blue, a deep blue
  stun: [
    { r: 0.85, g: 0.92, b: 1.0 }, // Blue-white core
    { r: 0.55, g: 0.5, b: 1.0 },  // Violet-blue
    { r: 0.2, g: 0.35, b: 1.0 },  // Deep blue
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
