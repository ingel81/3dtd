import { describe, it, expect } from 'vitest';
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
} from 'three';
import { bakeVAT, vatClips, vatDeathSeconds, vatFrameCount } from './vat-baker';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { TIMING } from '../../../configs/timing.config';

describe('vatFrameCount', () => {
  it('bakes a whole clip up to its last frame', () => {
    expect(vatFrameCount(2.958, 30)).toBe(89);
    expect(vatFrameCount(1, 30)).toBe(30);
    expect(vatFrameCount(0, 30)).toBe(1);
  });

  it('bakes a cut clip up to the frame shown at the cut', () => {
    // floor(t × 30) for t in [0, 2] is 0 to 60.
    expect(vatFrameCount(6.333, 30, 2)).toBe(61);
    expect(vatFrameCount(2.208, 30, 1.5)).toBe(46);
    expect(vatFrameCount(4.5, 30, 2.76)).toBe(83);
  });

  it('bakes the whole clip when the cut is past its end', () => {
    expect(vatFrameCount(2.958, 30, 8.22)).toBe(89);
    expect(vatFrameCount(1, 30, 1)).toBe(30);
  });
});

describe('vatClips', () => {
  it('cuts death clips where the enemy is removed and keeps loops whole', () => {
    const config = ENEMY_TYPES['zombie-v2'];
    const deathSeconds = (TIMING.deathAnimationDuration / 1000) * config.animationSpeed!;
    expect(vatDeathSeconds(config)).toBe(deathSeconds);
    expect(vatClips(config)).toEqual([
      { name: config.walkAnimation, seconds: Infinity },
      ...config.deathAnimations!.map((name) => ({ name, seconds: deathSeconds })),
    ]);
  });

  it('scales the death cut with animationSpeed', () => {
    const clips = vatClips({ walkAnimation: 'walk', deathAnimation: 'die', animationSpeed: 0.75 });
    expect(clips[1]).toEqual({ name: 'die', seconds: 1.5 });
  });

  it('bakes a clip used twice once, as far as its longest use', () => {
    expect(vatClips({ walkAnimation: 'a', deathAnimation: 'a', deathAnimations: ['b', 'b'] })).toEqual([
      { name: 'a', seconds: Infinity },
      { name: 'b', seconds: 2 },
    ]);
  });
});

describe('bakeVAT', () => {
  /** One triangle skinned to a bone that moves; returns the model root. */
  function skinnedTriangle(): Group {
    const bone = new Bone();
    bone.name = 'root';
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    const root = new Group();
    root.add(bone, mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new Skeleton([bone]));
    return root;
  }

  it('stops a death clip at the frame on screen when the enemy is removed', () => {
    const walk = new AnimationClip('walk', 1, [
      new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 1, 0, 0]),
    ]);
    // Sinks one unit per second for five seconds; the enemy is removed after two.
    const die = new AnimationClip('die', 5, [
      new VectorKeyframeTrack('root.position', [0, 5], [0, 0, 0, 0, -5, 0]),
    ]);
    const vat = bakeVAT(skinnedTriangle(), [walk, die], vatClips({
      walkAnimation: 'walk',
      deathAnimation: 'die',
      animationSpeed: 1,
    }))!;

    expect(vat.animations.get('walk')).toMatchObject({ frameStart: 0, frameCount: 30 });
    expect(vat.animations.get('die')).toMatchObject({ frameStart: 30, frameCount: 61 });
    expect(vat.totalFrames).toBe(91);
    expect(vat.positionTexture.image.height).toBe(91);

    // Last baked frame: the pose at 2 s, vertex 0 sunk by two units.
    const data = vat.positionTexture.image.data as Float32Array;
    const lastRow = (30 + 60) * vat.texWidth * 4;
    expect(data[lastRow + 1]).toBeCloseTo(-2, 5);
  });
});
