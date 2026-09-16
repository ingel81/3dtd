import { describe, it, expect } from 'vitest';
import { BufferGeometry, Group, Mesh, Scene, Vector3 } from 'three';
import { AbilityMarkerRenderer } from './ability-marker.renderer';

/** A beam's stretch at the first place and one at the new place */
const PATH = [new Vector3(10, 5, -10), new Vector3(10, 5, -40), new Vector3(30, 6, -40)];
const NEW_PATH = [new Vector3(500, 2, 500), new Vector3(500, 2, 470)];

/** The path bands in the scene: meshes of their own geometry, not in a marker group */
function bands(scene: Scene): Mesh<BufferGeometry>[] {
  return scene.children.filter((c): c is Mesh<BufferGeometry> => c instanceof Mesh && !(c instanceof Group));
}

/**
 * Playtest 427 (night 2, docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed on the
 * real renderer: aim the laser (gold band), cancel, change the location over
 * the world map. A location change keeps the engine
 * (LocationChangeExecutorService step 2: setOrigin and gameState.reset());
 * the reset's game:reset clears the markers (VFXService.clearStrikes), and
 * AbilityTargetingService.initialize cancels once more for the new place.
 * On teardown engine.dispose() frees the band (fix d597329f).
 */
describe('Laser aim band through a location change, playtest 427 replayed', () => {
  it('shows no band after cancel and the reset, aims a fresh one at the new place, frees it on dispose', () => {
    const scene = new Scene();
    const markers = new AbilityMarkerRenderer(scene);

    markers.showAim(PATH[0], 5, true, PATH);
    expect(bands(scene).filter((b) => b.visible)).toHaveLength(1);

    markers.hideAim();   // Esc: AbilityTargetingService.cancel
    markers.clear();     // location change: game:reset, VFXService.clearStrikes
    markers.hideAim();   // AbilityTargetingService.initialize for the new place
    expect(bands(scene).filter((b) => b.visible)).toEqual([]);

    // The nuclear strike's ring at the new place brings no band back
    markers.showAim(NEW_PATH[0], 25, true);
    expect(bands(scene).filter((b) => b.visible)).toEqual([]);

    // The laser again: its band lies on the new stretch, not the old one
    markers.showAim(NEW_PATH[0], 5, true, NEW_PATH);
    const visible = bands(scene).filter((b) => b.visible);
    expect(visible).toHaveLength(1);
    const first = new Vector3().fromBufferAttribute(visible[0].geometry.getAttribute('position'), 0);
    expect(first.distanceTo(NEW_PATH[0])).toBeLessThan(10);

    markers.dispose();
    expect(scene.children).toEqual([]);
  });
});
