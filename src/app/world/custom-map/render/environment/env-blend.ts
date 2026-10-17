import { GLSL3, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, type WebGLRenderTarget, type WebGLRenderer } from 'three';

const VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Texel for texel: both maps have PMREM's layout (cube faces and their blurred mips side by side)
const FRAGMENT = /* glsl */ `
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uMix;
out highp vec4 blended;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  blended = mix(texelFetch(uFrom, p, 0), texelFetch(uTo, p, 0), uMix);
}
`;

/**
 * Blends two prefiltered environment maps of the same size into a third,
 * texel for texel: a sky fade's environment map each frame
 * (CustomMapEnvironment.beginEnvFade). A full-screen triangle pair over a
 * map of a few hundred texels a side, no CPU work. Offscreen only: no depth,
 * no fog, no tone mapping.
 */
export class EnvBlend {
  readonly material = new ShaderMaterial({
    name: 'custom-map-env-blend',
    glslVersion: GLSL3,
    uniforms: { uFrom: { value: null }, uTo: { value: null }, uMix: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();

  constructor() {
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** `into` = mix(from, to, t); the renderer's target is put back */
  draw(renderer: WebGLRenderer, from: WebGLRenderTarget, to: WebGLRenderTarget, t: number, into: WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u['uFrom'].value = from.texture;
    u['uTo'].value = to.texture;
    u['uMix'].value = t;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(into);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(previous);
    u['uFrom'].value = null;
    u['uTo'].value = null;
  }

  dispose(): void {
    this.material.dispose();
    for (const child of this.scene.children) (child as Mesh).geometry.dispose();
  }
}
