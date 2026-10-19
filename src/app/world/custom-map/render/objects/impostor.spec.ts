import { Matrix3, MeshStandardMaterial, ShaderLib, UniformsUtils, Vector3 } from 'three';
import { IMPOSTOR_FRAMES, hemiOctDirection, hemiOctPoint, impostorCell, measureLook, normalDepthMaterial, turnToCamera } from './impostor';

describe('octahedral impostor', () => {
  it('gives an untextured part a matrix for its map transform, as three uploads the mat3 on every draw', () => {
    const material = normalDepthMaterial(new MeshStandardMaterial(), new Vector3(), 1);
    expect(material.uniforms['uMapTransform'].value).toBeInstanceOf(Matrix3);
    material.dispose();
  });

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
      expect(shader.vertexShader).toContain('transformed = uImpCenter');
      expect(shader.vertexShader.indexOf('vec3 impDir =')).toBeLessThan(shader.vertexShader.indexOf('transformed = uImpCenter'));
      expect(shader.fragmentShader).toContain('impA');
      expect(shader.vertexShader.includes('objectNormal = normalize(impDir')).toBe(lit);
      // The seen card looks up its shadow nearer the sun, out of its own caster
      expect(shader.vertexShader.includes('worldPosition.xyz += uImpSun')).toBe(lit);
      // The include stays for hooks added after it (the detail band's fade)
      expect(shader.vertexShader).toContain('#include <begin_vertex>');
      // Lit: the baked normal turned into view space, and the self shadow inside three's shadowed sun light
      expect(shader.fragmentShader.includes('normal = impViewNormal')).toBe(lit);
      expect(shader.fragmentShader.includes('directLight.color *= impSelfShade( vDirectionalShadowCoord[ i ]')).toBe(lit);
    }
  });

  it('bakes trees at 128 px a view on a high screen, at 64 below it and small far things always', () => {
    expect(impostorCell(8, 2160)).toBe(128);
    expect(impostorCell(8, 1080)).toBe(64);
    expect(impostorCell(1.2, 2160)).toBe(64);
  });

  it('cuts the card to the coverage of the model and takes the tone from what both then cover, within its limits', () => {
    const size = 2;
    const views = 2;
    const width = size * views;
    const px = new Uint8Array(width * size * 2 * 4);
    const set = (x: number, y: number, r: number, g: number, b: number, a: number): void => px.set([r, g, b, a], (y * width + x) * 4);
    // The model covers two pixels, mean 100, 80, 60; a clear pixel is left out
    set(0, 0, 100, 80, 60, 255);
    set(1, 1, 100, 80, 60, 255);
    set(2, 0, 250, 250, 250, 0);
    // The card's blended alpha covers four: the two most solid are kept, the faint rim is cut
    set(0, 2, 125, 80, 30, 230);
    set(3, 3, 125, 80, 30, 200);
    set(1, 2, 255, 255, 255, 120);
    set(2, 3, 255, 255, 255, 90);
    const look = measureLook(px, size, views);
    expect(look.alphaTest).toBeCloseTo(200 / 255, 5);
    expect(look.tone.r).toBeCloseTo(0.8, 5);
    expect(look.tone.g).toBeCloseTo(1, 5);
    // 60 / 30 is beyond the limit
    expect(look.tone.b).toBeCloseTo(1.6, 5);
    // A card all faint keeps the lowest test; nothing covered: no tone
    expect(measureLook(new Uint8Array(px.length), size, views).tone.r).toBe(1);
  });
});
