import { BoxGeometry, InstancedBufferAttribute, MeshStandardMaterial } from 'three';
import { LOD_BAND, addLodFade, blendAt, disposeFadeGeometry, fadeGeometry, levelAt, settleBlend } from './lod-fade';

describe('lod-fade (soft detail switches)', () => {
  // Starts per metre of the object's radius: an object of 10 m switches at 100 m, its impostor from 300 m
  const levels = [{ from: 0 }, { from: 10 }, { from: 30, impostor: true }];

  it("picks the level by distance and size, impostors from the quality level's distance", () => {
    expect(levelAt(levels, 50, 10, 1000, 1, 380)).toBe(0);
    expect(levelAt(levels, 150, 10, 1000, 1, 380)).toBe(1);
    expect(levelAt(levels, 350, 10, 1000, 1, 380)).toBe(1);
    expect(levelAt(levels, 400, 10, 1000, 1, 380)).toBe(2);
    expect(levelAt(levels, 1200, 10, 1000, 1, 380)).toBe(-1);
    // A lower detail bias switches nearer
    expect(levelAt(levels, 60, 10, 1000, 0.5, 380)).toBe(1);
    // A smaller object switches nearer, a bigger one farther; the impostor no nearer than the quality level's distance
    expect(levelAt(levels, 60, 5, 1000, 1, 380)).toBe(1);
    expect(levelAt(levels, 150, 20, 1000, 1, 380)).toBe(0);
    expect(levelAt(levels, 300, 5, 1000, 1, 380)).toBe(1);
  });

  it('blends across a band of LOD_BAND around each switch and the draw distance', () => {
    const half = (100 * LOD_BAND) / 2;
    // Outside a band: how far the camera may move before the band begins
    expect(blendAt(levels, 100 - half - 1, 10, 1000, 1, 380)).toEqual({ level: 0, next: null, t: 0, slack: expect.closeTo(1) });
    expect(blendAt(levels, 100, 10, 1000, 1, 380)).toEqual({ level: 0, next: 1, t: 0.5, slack: 0 });
    expect(blendAt(levels, 1000, 10, 1000, 1, 380)).toEqual({ level: 2, next: -1, t: expect.closeTo(0.5), slack: 0 });
    expect(blendAt(levels, 380, 10, 1000, 1, 380)).toEqual({ level: 1, next: 2, t: expect.closeTo(0.5), slack: 0 });
    // Between the bands of 100 m and 380 m: the nearer one
    expect(blendAt(levels, 200, 10, 1000, 1, 380).slack).toBeCloseTo(200 - 100 - half);
  });

  it('settles a band at rest towards the level nearer the distance, and shows that one alone at the end', () => {
    const quarter = { level: 0, next: 1, t: 0.25, slack: 0 };
    expect(settleBlend(quarter, 0)).toEqual(quarter);
    expect(settleBlend(quarter, 0.5)).toEqual({ level: 0, next: 1, t: 0.125, slack: 0 });
    expect(settleBlend(quarter, 1)).toEqual({ level: 0, next: null, t: 0, slack: 0 });
    // Past the middle the next level; into nothing at the draw distance
    expect(settleBlend({ level: 1, next: 2, t: 0.75, slack: 0 }, 1)).toEqual({ level: 2, next: null, t: 0, slack: 0 });
    expect(settleBlend({ level: 1, next: -1, t: 0.6, slack: 0 }, 1)).toEqual({ level: -1, next: null, t: 0, slack: 0 });
    // Outside a band nothing changes
    expect(settleBlend({ level: 1, next: null, t: 0, slack: 4 }, 1)).toEqual({ level: 1, next: null, t: 0, slack: 4 });
  });

  it('shares the model\'s buffers and frees only its own', () => {
    const box = new BoxGeometry();
    const fade = new InstancedBufferAttribute(new Float32Array(3), 1);
    const g = fadeGeometry(box, fade);
    expect(g.getAttribute('position')).toBe(box.getAttribute('position'));
    expect(g.getIndex()).toBe(box.getIndex());
    expect(g.getAttribute('lodFade')).toBe(fade);
    disposeFadeGeometry(g);
    expect(box.getAttribute('position')).toBeDefined();
  });

  it('dithers in the shader, keyed apart from the plain program', () => {
    const m = new MeshStandardMaterial();
    m.customProgramCacheKey = () => 'object';
    addLodFade(m);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <clipping_planes_fragment>',
    };
    m.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain('vLodFade = lodFade;');
    expect(shader.fragmentShader).toContain('discard');
    expect(m.customProgramCacheKey()).toBe('object-lod-fade');
  });
});

describe('blendAt and settleBlend into one object', () => {
  it('write into the object given, settleBlend also into the blend itself', () => {
    const levels = [{ from: 0 }, { from: 10 }];
    const out = { level: 9, next: 9 as number | null, t: 9, slack: 9 };
    expect(blendAt(levels, 100, 10, 1000, 1, 380, out)).toBe(out);
    expect(out).toEqual({ level: 0, next: 1, t: 0.5, slack: 0 });
    expect(settleBlend(out, 1, out)).toBe(out);
    expect(out).toEqual({ level: 1, next: null, t: 0, slack: 0 });
    expect(blendAt(levels, 10, 10, 1000, 1, 380, out)).toEqual({ level: 0, next: null, t: 0, slack: expect.closeTo(84) });
  });
});
