import { describe, it, expect } from 'vitest';
import { Group } from 'three';
import { SpawnPortalManager } from './spawn-portal.manager';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';

const POSE = { x: 0, y: 0, z: 0, heading: 0, scale: 1 };
const FRAME_MS = 1000 / 60;

/** `seconds` of frames at 60 fps from `t`, returns the end time. */
function run(portals: SpawnPortalManager, t: number, seconds: number): number {
  for (let i = 0; i < seconds * 60; i++) portals.update((t += FRAME_MS));
  return t;
}

describe('SpawnPortalManager: Energie', () => {
  it('schwillt bei Wellenstart an, hält die Wellenenergie und beruhigt sich danach', () => {
    const L = SPAWN_PORTAL_LOOK;
    const portals = new SpawnPortalManager(new Group());
    portals.add('s1', POSE, 0xef4444);

    let t = 1000;
    portals.update(t);
    expect(portals.energyLevel).toBeCloseTo(L.idleEnergy);

    portals.startWave(t);
    portals.update(t);
    expect(portals.energyLevel).toBeGreaterThan(L.idleEnergy + 0.9 * L.surge);

    t = run(portals, t, 10);
    expect(portals.energyLevel).toBeCloseTo(L.waveEnergy, 2);

    portals.endWave();
    t = run(portals, t, 1);
    // Beruhigt sich allmählich, springt nicht
    expect(portals.energyLevel).toBeLessThan(L.waveEnergy);
    expect(portals.energyLevel).toBeGreaterThan(L.idleEnergy);
    run(portals, t, 10);
    expect(portals.energyLevel).toBeCloseTo(L.idleEnergy, 2);
  });

  it('springt nach einer langen Pause des Tabs nicht auf das Ziel', () => {
    const L = SPAWN_PORTAL_LOOK;
    const portals = new SpawnPortalManager(new Group());
    portals.update(0);
    portals.startWave(0);
    portals.update(60_000);
    // Ein Schritt zählt höchstens 250 ms
    expect(portals.energyLevel).toBeLessThan(L.waveEnergy);
  });
});
