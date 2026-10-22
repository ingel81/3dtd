import { DepthFormat, DepthStencilFormat, DepthTexture, FloatType, LinearFilter, UnsignedByteType, UnsignedInt248Type, UnsignedIntType, UnsignedShortType, Vector2, WebGLRenderTarget, type TextureDataType, type WebGLRenderer } from 'three';

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
 *
 * The frame's depth comes along (a second blit into a depth texture of the
 * source's own format, read once when the copy is made), so water knows how
 * deep a thing stands in it (a pier, a ruin, a stone), not only the ground
 * under it. Where the formats do not match the blit fails once and the
 * depth stays off (`uSceneDepthOn` 0): the water falls back to the ground.
 *
 * A pass into another target in the middle of the frame (the water's
 * mirror, water-reflection.ts) runs `without` the copy: a heat shimmer it
 * drew took the copy of the mirror at the mirror's size and the frame
 * then kept it, so the water's refraction read the mirror stretched, cut
 * off in straight lines at the mirror's width and height.
 */
export class SceneCopy {
  readonly uniforms = {
    uSceneCopy: { value: null as WebGLRenderTarget['texture'] | null },
    uSceneSize: { value: new Vector2(1, 1) },
    uSceneDepth: { value: null as DepthTexture | null },
    uSceneDepthOn: { value: 0 },
  };
  private target: WebGLRenderTarget | null = null;
  private depthTarget: WebGLRenderTarget | null = null;
  /** False once the depth blit failed (formats that do not match): no further tries */
  private depthWorks = true;
  private frame = -1;
  private readonly size = new Vector2();
  /** Passes running `without` the copy */
  private held = 0;

  /** Copies the frame drawn so far, at most once per frame; not within `without` */
  capture(renderer: WebGLRenderer): void {
    if (this.held > 0) return;
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
    if (this.depthWorks) this.copyDepth(renderer, gl, source);
    // Both bindings back as three left them: its state cache stays true
    gl.bindFramebuffer(gl.FRAMEBUFFER, source);
  }

  /** The frame's depth into a texture of the source's own depth format (made anew when the size changes) */
  private copyDepth(renderer: WebGLRenderer, gl: WebGL2RenderingContext, source: WebGLFramebuffer | null): void {
    const fresh = !this.depthTarget || this.depthTarget.width !== this.size.x || this.depthTarget.height !== this.size.y;
    if (fresh) {
      this.depthTarget?.dispose();
      this.depthTarget = null;
      this.uniforms.uSceneDepthOn.value = 0;
      // The source's depth and stencil bits (a query that waits for the GPU: only when the copy is made)
      // (DEPTH_BITS reads the bound draw framebuffer: the source again, not the colour copy)
      gl.bindFramebuffer(gl.FRAMEBUFFER, source);
      let depthBits = 0;
      let stencilBits = 0;
      if (!source) {
        depthBits = gl.getParameter(gl.DEPTH_BITS) as number;
        stencilBits = gl.getParameter(gl.STENCIL_BITS) as number;
      } else if (gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) !== gl.NONE) {
        depthBits = gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE) as number;
        const stencil = gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) !== gl.NONE;
        stencilBits = stencil ? (gl.getFramebufferAttachmentParameter(gl.READ_FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE) as number) : 0;
      }
      const type = stencilBits > 0 ? UnsignedInt248Type : depthBits === 32 ? FloatType : depthBits === 16 ? UnsignedShortType : depthBits === 24 ? UnsignedIntType : null;
      if (!type || (stencilBits > 0 && depthBits !== 24)) {
        this.depthWorks = false;
        return;
      }
      const depth = new DepthTexture(this.size.x, this.size.y, type);
      depth.format = stencilBits > 0 ? DepthStencilFormat : DepthFormat;
      this.depthTarget = new WebGLRenderTarget(this.size.x, this.size.y, { depthBuffer: true, stencilBuffer: stencilBits > 0, depthTexture: depth, generateMipmaps: false });
      renderer.initRenderTarget(this.depthTarget);
    }
    const target = (renderer.properties.get(this.depthTarget!) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer ?? null;
    if (!target) return;
    // Earlier errors of the frame must not count as this blit's
    if (fresh) while (gl.getError() !== gl.NO_ERROR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
    gl.blitFramebuffer(0, 0, this.size.x, this.size.y, 0, 0, this.size.x, this.size.y, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    if (fresh) {
      // Once per copy made: did the formats match? (getError waits for the GPU)
      const err = gl.getError();
      if (err !== gl.NO_ERROR) {
        this.depthWorks = false;
        this.depthTarget?.dispose();
        this.depthTarget = null;
        return;
      }
      this.uniforms.uSceneDepth.value = this.depthTarget!.depthTexture as DepthTexture;
      this.uniforms.uSceneDepthOn.value = 1;
    }
  }

  /** Runs `draw`, another pass into its own target, without taking the copy there */
  without(draw: () => void): void {
    this.held++;
    try {
      draw();
    } finally {
      this.held--;
    }
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.depthTarget?.dispose();
    this.depthTarget = null;
    this.uniforms.uSceneCopy.value = null;
    this.uniforms.uSceneDepth.value = null;
    this.uniforms.uSceneDepthOn.value = 0;
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
uniform sampler2D uSceneDepth;
uniform float uSceneDepthOn;
// How far from the camera (clip w) the frame drew what lies behind this pixel; 0 without the depth copy
float sceneDistanceBehind() {
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  if (uSceneDepthOn < 0.5) return 0.0;
  float d = texture2D(uSceneDepth, gl_FragCoord.xy / uSceneSize).r;
  return exp2(d * 2.0 / logDepthBufFC) - 1.0;
#else
  return 0.0;
#endif
}
`;
