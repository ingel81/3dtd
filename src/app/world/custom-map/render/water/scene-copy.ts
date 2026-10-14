import { LinearFilter, UnsignedByteType, Vector2, WebGLRenderTarget, type TextureDataType, type WebGLRenderer } from 'three';

/**
 * A copy of what the frame drew so far, for materials that look through
 * themselves (refraction, heat haze). Taken once per frame, right before
 * the first such material draws: the opaque pass is done then, the
 * transparent one has not begun. One blit of the frame (resolving the
 * multisampled buffer), at full size, in the target's own format (the
 * canvas: 8 bit, the post-processing target: half float).
 *
 * The copy holds the frame's colours as the target stores them: display
 * values on the canvas, linear light in the post target (readers decode
 * with `SCENE_COPY_GLSL`).
 */
export class SceneCopy {
  readonly uniforms = {
    uSceneCopy: { value: null as WebGLRenderTarget['texture'] | null },
    uSceneSize: { value: new Vector2(1, 1) },
  };
  private target: WebGLRenderTarget | null = null;
  private frame = -1;
  private readonly size = new Vector2();

  /** Copies the frame drawn so far, at most once per frame */
  capture(renderer: WebGLRenderer): void {
    const frame = renderer.info.render.frame;
    if (frame === this.frame) return;
    this.frame = frame;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const current = renderer.getRenderTarget();
    if (current) this.size.set(current.width, current.height);
    else renderer.getDrawingBufferSize(this.size);
    // A post target's size can carry the pixel ratio's fraction
    this.size.set(Math.floor(this.size.x), Math.floor(this.size.y));
    const type: TextureDataType = current ? current.texture.type : UnsignedByteType;
    if (!this.target || this.target.width !== this.size.x || this.target.height !== this.size.y || this.target.texture.type !== type) {
      this.target?.dispose();
      this.target = new WebGLRenderTarget(this.size.x, this.size.y, {
        type,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
      renderer.initRenderTarget(this.target);
      this.uniforms.uSceneCopy.value = this.target.texture;
      this.uniforms.uSceneSize.value.copy(this.size);
    }
    const source = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const copy = (renderer.properties.get(this.target) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
    if (!copy) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy);
    gl.blitFramebuffer(0, 0, this.size.x, this.size.y, 0, 0, this.size.x, this.size.y, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // Both bindings back as three left them: its state cache stays true
    gl.bindFramebuffer(gl.FRAMEBUFFER, source);
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.uniforms.uSceneCopy.value = null;
  }
}

/**
 * GLSL: the frame behind a fragment at a screen offset, as linear light
 * (the canvas copy holds display values: decoded; the post target's is
 * linear already). Needs `uSceneCopy`, `uSceneSize`.
 */
export const SCENE_COPY_GLSL = /* glsl */ `
uniform sampler2D uSceneCopy;
uniform vec2 uSceneSize;
vec3 sceneBehind(vec2 offset) {
  vec3 c = texture2D(uSceneCopy, gl_FragCoord.xy / uSceneSize + offset).rgb;
  bool linearOut = linearToOutputTexel(vec4(0.5)).r < 0.6;
  return linearOut ? c : sRGBTransferEOTF(vec4(c, 1.0)).rgb;
}
`;
