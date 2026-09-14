import { describe, it, expect } from 'vitest';
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';
import { GUARDED_HIGH_PASS_FRAGMENT, guardBloomHighPass } from './bloom-guard';

function bloomPass(): UnrealBloomPass {
  return new UnrealBloomPass(new Vector2(64, 64), 0.3, 0.4, 0.85);
}

describe('guardBloomHighPass', () => {
  it('swaps in the guarded high pass and back, the uniforms kept', () => {
    const pass = bloomPass();
    const material = pass.materialHighPassFilter;
    const uniforms = material.uniforms;
    const version = material.version;

    guardBloomHighPass(pass);
    expect(material.fragmentShader).toBe(GUARDED_HIGH_PASS_FRAGMENT);
    expect(material.uniforms).toBe(uniforms);
    expect(material.version).toBeGreaterThan(version);

    guardBloomHighPass(pass, false);
    expect(material.fragmentShader).toBe(LuminosityHighPassShader.fragmentShader);
  });

  it('does not recompile when the pass already has the shader asked for', () => {
    const pass = bloomPass();
    guardBloomHighPass(pass);
    const version = pass.materialHighPassFilter.version;
    guardBloomHighPass(pass);
    expect(pass.materialHighPassFilter.version).toBe(version);
  });

  it('reads the uniforms three sets on the high pass', () => {
    for (const name of Object.keys(LuminosityHighPassShader.uniforms)) {
      expect(GUARDED_HIGH_PASS_FRAGMENT).toMatch(new RegExp(`uniform \\w+ ${name};`));
    }
  });
});
