/**
 * How the shots of a siege gun look, sound and shake (EnemyTypeConfig.siege,
 * docs/ENEMY_CREATION.md, "Belagerung"): per enemy type, presentation only.
 * The simulation decides when it fires and where the shell lands
 * (managers/enemy-siege.ts); SiegeEffects (presentation/siege-effects.ts)
 * shows the shot and the blast, SiegeShellRenderer the shell in flight,
 * GameSoundsService and ScreenShakeService play `sounds` and `shake` on the
 * main bus's vfx:siege-shot and vfx:siege-impact, and the turret's servo hums
 * while it turns (GunPresenter).
 */
import type { EnemyTypeId } from './enemy-types.config';
import type { GameSoundSample } from './game-sounds.config';
import type { BurstPalette, MuzzleFlashProfile, ScreenShakePreset } from './visual-effects.config';
import type { ShotLightLook, ShotLightPulseLook } from './shot-lights.config';

/** A shake that fades out from `near` to `far` metres between the camera and its place */
export interface SiegeShake extends ScreenShakePreset {
  near: number;
  far: number;
}

export interface SiegeLook {
  shot: {
    /** The flash at each muzzle, its light, and its fire and smoke rolling out ahead of the barrels */
    flash: MuzzleFlashProfile;
    light: ShotLightPulseLook;
    /** The muzzle blast: fireball particles, its radius, and dark smoke puffs that hang on, per muzzle */
    blast: { particles: number; radius: number; smokePuffs: number };
    /** Dust the blast throws up round the walker's foot: puffs on a ring of `radius` m, out at `speed` m/s */
    dust: { puffs: number; radius: number; speed: number };
  };
  shell: {
    /** The glowing core of the shell: streak length and width, m */
    length: number;
    width: number;
    /** Hot colour at its head, linear */
    color: readonly [number, number, number];
    /** Its light as it flies */
    light: ShotLightLook;
    /** A puff of its smoke trail every this many metres */
    smokeEveryM: number;
  };
  impact: {
    /** The blast: fireball particles, radius m, smoke puffs */
    blast: { particles: number; radius: number; smokePuffs: number };
    light: ShotLightPulseLook;
    /** Grit and sparks thrown out: particle count and the palette (dark, mid, light) */
    sparks: { particles: number; palette: BurstPalette };
    /** Dust rolling out over the ground under the blast */
    dust: { puffs: number; radius: number; speed: number };
    /** Pieces of the structure it hit thrown out (the destruction's flying debris), as a fall of this radius and height */
    debris: { radius: number; height: number };
  };
  sounds: {
    shot: GameSoundSample;
    impact: GameSoundSample;
    /** The turret's servo, a loop while it turns */
    servo: GameSoundSample;
  };
  shake: { shot: SiegeShake; impact: SiegeShake };
  /** The turret counts as turning above this many rad per second of game time (its servo hums) */
  servoFromRadPerS: number;
}

const JUMPER_SOUNDS = 'assets/sounds/enemies/jumper/';

export const SIEGE_LOOKS: Partial<Record<EnemyTypeId, SiegeLook>> = {
  jumper: {
    shot: {
      // Twice the cannon tower's: two barrels of a gun the size of a house
      flash: { countMin: 10, countMax: 14, sizeMin: 4.5, sizeMax: 8, lifeMin: 0.08, lifeMax: 0.14 },
      light: { color: [1.0, 0.8, 0.5], fade: [0.95, 0.3, 0.06], intensity: 14, radius: 34, durationS: 0.18, jitter: 0.1 },
      blast: { particles: 16, radius: 3, smokePuffs: 7 },
      dust: { puffs: 26, radius: 7, speed: 7 },
    },
    shell: {
      length: 9,
      width: 0.7,
      color: [1.0, 0.62, 0.22],
      light: { color: [1.0, 0.5, 0.15], intensity: 3, radius: 14 },
      smokeEveryM: 2.5,
    },
    impact: {
      blast: { particles: 70, radius: 9, smokePuffs: 12 },
      light: { color: [1.0, 0.85, 0.6], fade: [0.85, 0.22, 0.04], intensity: 18, radius: 40, durationS: 0.6, jitter: 0.08 },
      sparks: {
        particles: 40,
        palette: [{ r: 1.0, g: 0.55, b: 0.15 }, { r: 0.42, g: 0.38, b: 0.34 }, { r: 0.75, g: 0.7, b: 0.62 }],
      },
      dust: { puffs: 30, radius: 6, speed: 6 },
      debris: { radius: 4, height: 6 },
    },
    sounds: {
      shot: {
        id: 'jumper_cannon', url: `${JUMPER_SOUNDS}cannon.mp3`, volume: 1, refDistance: 110, rolloffFactor: 0.8,
        maxInstances: 2, priority: true, audibleDistance: 900,
      },
      impact: {
        id: 'jumper_impact', url: `${JUMPER_SOUNDS}impact.mp3`, volume: 1, refDistance: 100, rolloffFactor: 0.8,
        maxInstances: 2, priority: true, audibleDistance: 900,
      },
      servo: { id: 'jumper_turret_servo', url: `${JUMPER_SOUNDS}turret_servo.mp3`, volume: 0.5, refDistance: 40, rolloffFactor: 1.1 },
    },
    shake: {
      shot: { amplitude: 0.0045, duration: 260, near: 60, far: 220 },
      impact: { amplitude: 0.006, duration: 380, near: 50, far: 200 },
    },
    servoFromRadPerS: 0.05,
  },
};
