import { describe, it, expect } from 'vitest';
import { createPortalClipUniforms, setPortalClips, type PortalClipUniforms } from './portal-clip';
import {
  MAX_SPAWN_PORTALS,
  PORTAL_CLIP,
  PORTAL_DEPTH,
  PORTAL_OPENING_WIDTH,
} from '../../configs/marker-geometry.config';

/** portalClipAhead of the shader (PORTAL_CLIP_GLSL), over the uniforms as written. */
function ahead(uniforms: PortalClipUniforms, x: number, y: number, z: number): number {
  let best = 1e4;
  for (let i = 0; i < uniforms.uPortalClipCount.value; i++) {
    const plane = uniforms.uPortalClipPlane.value[i];
    const box = uniforms.uPortalClipBox.value[i];
    const dx = x - plane.x;
    const dz = z - plane.y;
    const along = dx * plane.z + dz * plane.w;
    if (along < -box.y || along >= best) continue;
    if (Math.abs(dx * plane.w - dz * plane.z) > box.x || y < box.z || y > box.w) continue;
    if (along < 0) return along;
    best = along;
  }
  return best;
}

describe('portal clip', () => {
  it('puts the box of a turned, scaled portal behind its plane, the route start in its middle', () => {
    const uniforms = createPortalClipUniforms();
    // Facing +x, 1.5 times the frame: plane 7.875 m ahead, box 15.75 m deep, 10.5 m to either side
    const pose = { x: 100, y: 20, z: -50, heading: Math.PI / 2, scale: 1.5 };
    setPortalClips(uniforms, [pose]);
    const front = (PORTAL_DEPTH / 2) * 1.5;
    const half = (PORTAL_OPENING_WIDTH / 2) * 1.5 + PORTAL_CLIP.side;
    const top = 20 + PORTAL_CLIP.top * 1.5;

    expect(uniforms.uPortalClipCount.value).toBe(1);
    expect(ahead(uniforms, 100, 21, -50)).toBeCloseTo(-front, 9);
    // Inside to the corners, the back included
    for (const [x, y, z] of [[100 - front + 0.01, 20 - PORTAL_CLIP.below + 0.01, -50 - half + 0.01], [100 + front - 0.01, top - 0.01, -50 + half - 0.01]]) {
      expect(ahead(uniforms, x, y, z)).toBeLessThan(0);
    }
    // Just out through the plane: in front of it, for the seam
    expect(ahead(uniforms, 100 + front + 0.03, 25, -48)).toBeCloseTo(0.03, 9);
    // Beside, behind, above and below the box nothing is hidden, nor gets a seam
    for (const [x, y, z] of [[100, 25, -50 - half - 0.01], [100 - front - 0.01, 25, -50], [100, top + 0.01, -50], [100, 20 - PORTAL_CLIP.below - 0.01, -50]]) {
      expect(ahead(uniforms, x, y, z)).toBe(1e4);
    }
  });

  it('holds the first MAX_SPAWN_PORTALS portals and forgets removed ones', () => {
    const uniforms = createPortalClipUniforms();
    const poses = Array.from({ length: MAX_SPAWN_PORTALS + 2 }, (_, i) => ({ x: i * 100, y: 0, z: 0, heading: 0, scale: 1 }));
    setPortalClips(uniforms, poses);
    expect(uniforms.uPortalClipCount.value).toBe(MAX_SPAWN_PORTALS);
    expect(ahead(uniforms, (MAX_SPAWN_PORTALS - 1) * 100, 1, 0)).toBeLessThan(0);
    expect(ahead(uniforms, MAX_SPAWN_PORTALS * 100, 1, 0)).toBe(1e4);

    setPortalClips(uniforms, poses.slice(1, 2));
    expect(uniforms.uPortalClipCount.value).toBe(1);
    expect(ahead(uniforms, 0, 1, 0)).toBe(1e4);
    expect(ahead(uniforms, 100, 1, 0)).toBeLessThan(0);
  });
});
