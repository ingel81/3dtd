import { ShaderLib, UniformsUtils, Vector3 } from 'three';
import { IMPOSTOR_FRAMES, hemiOctDirection, hemiOctPoint, turnToCamera } from './impostor';

describe('octahedral impostor', () => {
  it('finds each baked view again from its direction, and every direction from above lies on the grid', () => {
    const d = new Vector3();
    for (let j = 0; j < IMPOSTOR_FRAMES; j++) {
      for (let i = 0; i < IMPOSTOR_FRAMES; i++) {
        hemiOctDirection(i / (IMPOSTOR_FRAMES - 1), j / (IMPOSTOR_FRAMES - 1), d);
        expect(d.y).toBeGreaterThanOrEqual(-1e-9);
        const [ex, ey] = hemiOctPoint(d);
        expect(ex * (IMPOSTOR_FRAMES - 1)).toBeCloseTo(i, 6);
        expect(ey * (IMPOSTOR_FRAMES - 1)).toBeCloseTo(j, 6);
      }
    }
    // Straight down onto the model: the grid's middle; the horizon: its edge
    expect(hemiOctPoint(new Vector3(0, 1, 0))).toEqual([0.5, 0.5]);
    const [hx, hy] = hemiOctPoint(new Vector3(1, 0, 0));
    expect(Math.min(hx, hy, 1 - hx, 1 - hy)).toBeCloseTo(0, 9);
  });

  it('turns the card in the standard and in the shadow pass, the normal following it', () => {
    for (const [lib, lit] of [[ShaderLib.standard, true], [ShaderLib.depth, false]] as const) {
      const shader = { uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      turnToCamera(shader as never, { uImpCenter: { value: new Vector3() }, uImpRadius: { value: 1 } }, lit);
      expect(shader.vertexShader).toContain('vec3 impDir =');
      expect(shader.vertexShader).toContain('vec3 transformed = uImpCenter');
      expect(shader.vertexShader.indexOf('vec3 impDir =')).toBeLessThan(shader.vertexShader.indexOf('vec3 transformed = uImpCenter'));
      expect(shader.fragmentShader).toContain('impA');
      expect(shader.vertexShader.includes('objectNormal = normalize(impDir')).toBe(lit);
    }
  });
});
