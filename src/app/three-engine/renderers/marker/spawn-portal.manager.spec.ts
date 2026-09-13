import { describe, it, expect } from 'vitest';
import { Group, InstancedMesh, ShaderMaterial } from 'three';
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

describe('SpawnPortalManager: Spawn-Effekt', () => {
  it('nimmt je Portal höchstens einen Burst pro Intervall, egal wie viele Gegner kommen', () => {
    const portals = new SpawnPortalManager(new Group());
    portals.add('s1', POSE, 0xef4444);
    portals.add('s2', { ...POSE, x: 300 }, 0xf97316);

    // 2000 Gegner in einer Sekunde durch s1
    let bursts = 0;
    for (let i = 0; i < 2000; i++) if (portals.tryBurst('s1', 1000 + i * 0.5)) bursts++;
    expect(bursts).toBe(Math.ceil(1000 / SPAWN_PORTAL_LOOK.burstIntervalMs));

    // s2 hat seine eigene Uhr
    expect(portals.tryBurst('s2', 1500)).toBe(true);
    expect(portals.tryBurst('unbekannt', 1500)).toBe(false);
  });

  it('meldet, ab wann wieder ein Portal einen Burst nimmt', () => {
    const portals = new SpawnPortalManager(new Group());
    expect(portals.burstReadyMs).toBe(Infinity);
    portals.add('s1', POSE, 0xef4444);
    portals.add('s2', { ...POSE, x: 300 }, 0xf97316);
    expect(portals.burstReadyMs).toBe(0);

    portals.tryBurst('s1', 1000);
    expect(portals.burstReadyMs).toBe(0);
    portals.tryBurst('s2', 1100);
    expect(portals.burstReadyMs).toBe(1000 + SPAWN_PORTAL_LOOK.burstIntervalMs);

    portals.clear();
    expect(portals.burstReadyMs).toBe(Infinity);
  });

  it('ordnet einen Gegner dem nächsten Portal im Umkreis zu', () => {
    const portals = new SpawnPortalManager(new Group());
    portals.add('s1', POSE, 0xef4444);
    portals.add('s2', { ...POSE, x: 300 }, 0xf97316);
    expect(portals.portalNear(-2, 1, 8)).toBe('s1');
    expect(portals.portalNear(297, 0, 8)).toBe('s2');
    expect(portals.portalNear(150, 0, 8)).toBeNull();
  });
});

describe('SpawnPortalManager: Stein', () => {
  it('gibt dem Tor die Belichtung des Steins aus dem Look', () => {
    const group = new Group();
    new SpawnPortalManager(group);
    const gate = group.children.find((o) => o.name === 'spawnPortalGates') as InstancedMesh;
    const material = gate.material as ShaderMaterial;
    expect(material.uniforms['uExposure'].value).toBe(SPAWN_PORTAL_LOOK.frameExposure);
    expect(material.fragmentShader).toContain('uExposure, uEnergy');
  });
});

describe('SpawnPortalManager: Beschwörungskreis', () => {
  it('legt den Kreis aus dem Look auf das Straßenlicht, aufflammend mit dem Wellenstart', () => {
    const group = new Group();
    new SpawnPortalManager(group);
    const glow = group.children.find((o) => o.name === 'spawnPortalGlow') as InstancedMesh;
    const material = glow.material as ShaderMaterial;
    const L = SPAWN_PORTAL_LOOK;
    expect(material.uniforms['uCircle'].value.toArray()).toEqual([
      L.circle.centre, L.circle.radius, L.circle.spin, L.circle.glow,
    ]);
    expect(material.uniforms['uFlare'].value.toArray()).toEqual([L.waveEnergy, L.surge, L.circle.flare]);
    // Aus den Sigillen des Rahmens gezeichnet, vor der vorderen Fläche
    expect(material.fragmentShader).toContain('portalSigil(q, mod(sector, CIRCLE_SIGILS))');
    expect(material.fragmentShader).toContain('(vLocal.z - uHalfDepth) * vDepthRatio - uCircle.x');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
  });
});
