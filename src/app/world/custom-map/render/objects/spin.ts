/**
 * Parts that turn round a model's upright axis (materials `spin-…`, catalogue
 * `spin`: seconds a turn) and what turns with them (a lighthouse's `beam`
 * effect). Both work out the turn the same way on the GPU, from the wind's
 * clock and where the object stands, so a beam stays with its lens.
 */

/** Seconds a turn takes when the catalogue names none */
export const DEFAULT_SPIN = 8;

/** GLSL: spinAngle(xz), a turning object's own starting angle (radians) from where it stands (group space x, z) */
export const SPIN_GLSL = /* glsl */ `
float spinAngle(vec2 at) {
  return fract(sin(dot(floor(at * 10.0) / 10.0, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
}
`;
