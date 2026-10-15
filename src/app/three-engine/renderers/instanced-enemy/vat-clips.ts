import type { AnimationClip } from 'three';
import { enemyDeathDuration, type EnemyTypeConfig } from '../../../configs/enemy-types.config';

/** Registry entry for one animation clip within the VAT */
export interface VATAnimationEntry {
  name: string;
  frameStart: number;
  frameCount: number;
  duration: number; // seconds
  totalTime: number; // pre-computed: frameCount / fps (for animation loop)
}

export const DEFAULT_BAKE_FPS = 30;

/** One clip to bake. */
export interface VATClip {
  name: string;
  /** Clip time the game can show (s), counted from `from`; the bake stops there. Infinity for looping clips. */
  seconds: number;
  /** Clip time the bake starts at (s), EnemyTypeConfig.clipStart; 0 when missing */
  from?: number;
}

type VATClipConfig = Pick<
  EnemyTypeConfig,
  'walkAnimation' | 'runAnimation' | 'deathAnimation' | 'deathAnimations' | 'animationSpeed' | 'deathAnimationSpeed' | 'deathDuration' | 'clipStart'
>;

/** Playback speed of a type's death clips (EnemyTypeConfig.deathAnimationSpeed) */
export function deathPlaybackSpeed(config: Pick<EnemyTypeConfig, 'animationSpeed' | 'deathAnimationSpeed'>): number {
  return config.deathAnimationSpeed ?? config.animationSpeed ?? 1;
}

/**
 * Clip time a death animation is on screen, from where it starts. It plays at
 * deathPlaybackSpeed() until EnemyManager removes the enemy,
 * enemyDeathDuration() after the kill.
 */
export function vatDeathSeconds(config: Pick<EnemyTypeConfig, 'animationSpeed' | 'deathAnimationSpeed' | 'deathDuration'>): number {
  return (enemyDeathDuration(config) / 1000) * deathPlaybackSpeed(config);
}

/**
 * Clips baked for an enemy type, in bake order. Walk and run loop and are
 * baked whole; death clips only up to vatDeathSeconds(), the rest of the clip
 * would never be on screen.
 */
export function vatClips(config: VATClipConfig): VATClip[] {
  const clips: VATClip[] = [];
  const add = (name: string | undefined, seconds: number): void => {
    if (!name) return;
    const known = clips.find((c) => c.name === name);
    const from = config.clipStart?.[name];
    if (known) known.seconds = Math.max(known.seconds, seconds);
    else clips.push(from ? { name, seconds, from } : { name, seconds });
  };
  add(config.walkAnimation, Infinity);
  add(config.runAnimation, Infinity);
  const deathSeconds = vatDeathSeconds(config);
  add(config.deathAnimation, deathSeconds);
  for (const name of config.deathAnimations ?? []) add(name, deathSeconds);
  return clips;
}

/**
 * Frames by which a clip duration may run past a whole frame count: the
 * loaders keep key times in float32, so 4/3 s reads as 1.3333334 s, which is
 * 40.0000012 frames at 30 fps.
 */
const FRAME_EPSILON = 1e-3;

/**
 * VAT frames one clip takes. A loop needs the frames before its end, since
 * the frame at the end is frame 0 again: ceil(duration × fps). A clip that
 * stops (death) shows frame floor(t × fps) at clip time t and holds the last
 * one, so it needs frames 0 to floor(min(seconds, duration) × fps), its end
 * pose included when it ends before the cut. `seconds` is Infinity for loops.
 */
export function vatFrameCount(duration: number, fps: number, seconds = Infinity): number {
  if (seconds === Infinity) return Math.max(1, Math.ceil(duration * fps - FRAME_EPSILON));
  return Math.floor(Math.min(seconds, duration) * fps + FRAME_EPSILON) + 1;
}

/** Where the bake of a clip starts, within the clip */
export function clipFrom(duration: number, clip: Pick<VATClip, 'from'>): number {
  return Math.min(Math.max(clip.from ?? 0, 0), duration);
}

/** VAT frames of a clip from its start (VATClip.from) on, as vatFrameCount counts them */
export function vatClipFrameCount(duration: number, fps: number, clip: VATClip): number {
  const from = clipFrom(duration, clip);
  return vatFrameCount(duration - from, fps, clip.seconds);
}

/** The clips of a model that get baked and their frames in the VAT (vatClipRegistry). */
export interface VATClipRegistry {
  /** The model's clips by name */
  clipMap: Map<string, AnimationClip>;
  /** The clips to bake that the model has, in bake order */
  validClips: VATClip[];
  /** Frame range of each baked clip */
  animEntries: Map<string, VATAnimationEntry>;
  totalFrames: number;
}

/**
 * The clips of `clips` that `animations` has, one after the other in bake
 * order, each with its frame range (vatFrameCount). Null when the model has
 * none of them.
 */
export function vatClipRegistry(animations: AnimationClip[], clips: VATClip[], fps: number): VATClipRegistry | null {
  const clipMap = new Map<string, AnimationClip>();
  for (const clip of animations) {
    clipMap.set(clip.name, clip);
  }

  const validClips = clips.filter((c) => clipMap.has(c.name));
  if (validClips.length === 0) return null;

  let totalFrames = 0;
  const animEntries = new Map<string, VATAnimationEntry>();

  for (const vatClip of validClips) {
    const clip = clipMap.get(vatClip.name)!;
    const frameCount = vatClipFrameCount(clip.duration, fps, vatClip);
    animEntries.set(vatClip.name, {
      name: vatClip.name,
      frameStart: totalFrames,
      frameCount,
      duration: clip.duration - clipFrom(clip.duration, vatClip),
      totalTime: frameCount / fps,
    });
    totalFrames += frameCount;
  }

  return { clipMap, validClips, animEntries, totalFrames };
}
