import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, PerspectiveCamera } from 'three';
import { FADE_S, MirrorChoice, type MirrorCandidate } from './mirror-choice';

/** A body's tile: a flat strip at `level` (scene y) over scene x in [x0, x1], 200 m deep */
function strip(x0: number, x1: number, level: number): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([x0, level, -100, x1, level, -100, x1, level, 100, x0, level, 100]), 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const mesh = new Mesh(g);
  mesh.updateMatrixWorld();
  return mesh;
}

/** A camera over scene point (x, 0), looking straight down */
function cameraOver(x: number, height = 60): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 1.5, 0.5, 4000);
  camera.position.set(x, height, 0.01);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function run(choice: MirrorChoice<string>, camera: PerspectiveCamera, bodies: MirrorCandidate<string>[], seconds: number, step = 0.05) {
  let pick = null as ReturnType<MirrorChoice<string>['update']>;
  const weights: number[] = [];
  for (let t = 0; t < seconds; t += step) {
    pick = choice.update(step, camera, 400, bodies);
    weights.push(pick ? pick.weight : 0);
  }
  return { pick, weights };
}

describe('MirrorChoice', () => {
  it('mirrors the level the camera sees, fading in instead of switching on', () => {
    const bodies = [
      { owner: 'west', level: 0, meshes: [strip(-150, -100, 0)] },
      { owner: 'east', level: 1, meshes: [strip(100, 150, 1)] },
    ];
    const choice = new MirrorChoice<string>();
    const { pick, weights } = run(choice, cameraOver(125), bodies, 1.5);
    expect([...pick!.owners]).toEqual(['east']);
    expect(pick!.level).toBe(1);
    expect(pick!.weight).toBe(1);
    // No step larger than a frame's share of the fade
    for (let k = 1; k < weights.length; k++) expect(Math.abs(weights[k] - weights[k - 1])).toBeLessThanOrEqual(0.05 / FADE_S + 1e-9);
  });

  it('hands the mirror to another level by fading out, then in', () => {
    const bodies = [
      { owner: 'west', level: 0, meshes: [strip(-150, -100, 0)] },
      { owner: 'east', level: 1, meshes: [strip(100, 150, 1)] },
    ];
    const choice = new MirrorChoice<string>();
    run(choice, cameraOver(125), bodies, 1.5);
    const { pick, weights } = run(choice, cameraOver(-125), bodies, 2);
    expect([...pick!.owners]).toEqual(['west']);
    expect(pick!.weight).toBe(1);
    for (let k = 1; k < weights.length; k++) expect(Math.abs(weights[k] - weights[k - 1])).toBeLessThanOrEqual(0.05 / FADE_S + 1e-9);
    // It went through nothing between the two
    expect(Math.min(...weights)).toBe(0);
  });

  it('lets bodies on one level share the mirror', () => {
    const bodies = [
      { owner: 'a', level: 0.5, meshes: [strip(-30, -10, 0.5)] },
      { owner: 'b', level: 0.52, meshes: [strip(10, 30, 0.52)] },
    ];
    const { pick } = run(new MirrorChoice<string>(), cameraOver(0, 120), bodies, 1);
    expect(new Set(pick!.owners)).toEqual(new Set(['a', 'b']));
  });

  it('fades out when no water is in view or within the reach', () => {
    const bodies = [{ owner: 'east', level: 0, meshes: [strip(100, 150, 0)] }];
    const choice = new MirrorChoice<string>();
    run(choice, cameraOver(125), bodies, 1);
    const { pick, weights } = run(choice, cameraOver(-150), bodies, 1);
    expect(pick).toBeNull();
    expect(weights.at(-1)).toBe(0);
    expect(Math.max(...weights.slice(1))).toBeLessThan(1);
  });
});
