/**
 * Output of the custom shaders that build their colour in display values.
 *
 * Bloom and colour grading are off by default: the engine then draws
 * straight onto the sRGB canvas, where a ShaderMaterial's gl_FragColor is
 * what the screen shows. Most of the game's own shaders were tuned there,
 * in display values. With bloom or grading on, the scene goes into the
 * composer's linear half-float target first and the output pass encodes
 * the frame to sRGB: a display value written into that target as it is
 * comes out brighter and paler (0.2 shows as 0.48).
 *
 * DISPLAY_OUTPUT_GLSL writes such a colour for either target. three puts
 * linearToOutputTexel in front of every ShaderMaterial, the encoding of the
 * target the program is built for: sRGB for the canvas, none for a render
 * target (WebGLPrograms, outputColorSpace). A display value decoded to
 * linear light and encoded again is the same value on the canvas, so the
 * default look does not change; into the composer target goes the light it
 * stands for, which the output pass turns back into that display value.
 * The part above 1 passes as it is: the canvas clamps it either way, and
 * the bloom gets as much of it as before (decoded, 3 would be 12.9).
 *
 * Blending mixes in the values of the target: display values on the canvas,
 * linear light in the composer target.
 * - Opaque (displayOutput): alike on both.
 * - Normal blending (displayOutput): alike where alpha is 1; a partial alpha
 *   mixes in linear light through the composer, as for three's own
 *   transparent materials there, a little lighter than on the canvas.
 * - Additive light (displayLight): no one amount adds alike over every
 *   ground. displayLight writes the light that raises a ground of
 *   ADDITIVE_GROUND by as much as the canvas does: alike there, brighter
 *   through the composer over a darker ground, dimmer over a lighter one.
 *   Decoded alone, a glow over a sunlit street had almost vanished with
 *   bloom (playtest 248, the portal's summoning circle).
 */

/**
 * Display value of the ground additive light is matched on: a street of the
 * photoreal tiles, where the summoning circle was matched after playtest 248.
 */
export const ADDITIVE_GROUND = 0.3;

/**
 * GLSL: displayOutput and displayLight, for a ShaderMaterial's fragment
 * shader (not a RawShaderMaterial: they call three's linearToOutputTexel and
 * sRGBTransferEOTF). On the canvas both return what they are given, up to
 * float rounding (display-output.spec.ts).
 */
export const DISPLAY_OUTPUT_GLSL = /* glsl */ `
  // A colour built in display values, written for the target: on the
  // canvas as it is, into the composer's linear target as the light it
  // stands for; the part above 1 as it is
  vec3 displayOutput(vec3 display) {
    vec3 c = max(display, 0.0);
    vec3 low = min(c, 1.0);
    return linearToOutputTexel(sRGBTransferEOTF(vec4(low, 1.0))).rgb + c - low;
  }

  vec4 displayOutput(vec4 display) {
    return vec4(displayOutput(display.rgb), display.a);
  }

  // Additive light built in display values (blending One, One): the step
  // from a ground of ADDITIVE_GROUND to that ground plus the light, written
  // for the target. On the canvas the light itself
  vec3 displayLight(vec3 light) {
    const vec3 ground = vec3(${ADDITIVE_GROUND.toFixed(2)});
    return displayOutput(ground + max(light, 0.0)) - displayOutput(ground);
  }

  // The same for AdditiveBlending (SrcAlpha, One), where rgb * alpha arrives
  vec4 displayLight(vec4 light) {
    if (light.a <= 0.0) return vec4(0.0);
    return vec4(displayLight(light.rgb * light.a) / light.a, light.a);
  }
`;
