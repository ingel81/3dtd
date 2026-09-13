import { describe, it, expect, vi } from 'vitest';
import { BoxGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, ShaderMaterial, Texture, Vector3 } from 'three';
import { SpawnPortalManager } from './spawn-portal.manager';
import { portalGlyphDrive } from './marker-shaders';
import { GameClock } from '../../../managers/game-state/game-clock';
import type { SpawnPortalFrame } from './spawn-portal-frame';
import { SPAWN_PORTAL_LOOK } from '../../../configs/visual-effects.config';

const POSE = { x: 0, y: 0, z: 0, heading: 0, scale: 1 };
const FRAME_MS = 1000 / 60;

/** `seconds` of frames at 60 fps from `t`, the game running, returns the end time. */
function run(portals: SpawnPortalManager, t: number, seconds: number): number {
  for (let i = 0; i < seconds * 60; i++) portals.update((t += FRAME_MS), false);
  return t;
}

describe('SpawnPortalManager: Energie', () => {
  it('schwillt bei Wellenstart an, hält die Wellenenergie und beruhigt sich danach', () => {
    const L = SPAWN_PORTAL_LOOK;
    const portals = new SpawnPortalManager(new Group());
    portals.add('s1', POSE, 0xef4444);

    let t = 1000;
    portals.update(t, false);
    expect(portals.energyLevel).toBeCloseTo(L.idleEnergy);

    portals.startWave(t);
    portals.update(t, false);
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
    portals.update(0, false);
    portals.startWave(0);
    portals.update(60_000, false);
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
  it('gibt dem Tor die Belichtung und die Glanzlichter des Steins aus dem Look', () => {
    const group = new Group();
    new SpawnPortalManager(group);
    const gate = group.children.find((o) => o.name === 'spawnPortalGates') as InstancedMesh;
    const material = gate.material as ShaderMaterial;
    expect(material.uniforms['uExposure'].value).toBe(SPAWN_PORTAL_LOOK.frameExposure);
    expect(material.uniforms['uGlints'].value).toBe(SPAWN_PORTAL_LOOK.frameGlints);
    expect(material.fragmentShader).toContain('base * uExposure');
  });
});

describe('SpawnPortalManager: Sigillen', () => {
  const gateMaterial = (group: Group) =>
    (group.children.find((o) => o.name === 'spawnPortalGates') as InstancedMesh).material as ShaderMaterial;

  it('gibt dem Tor Atem, Glühen und Erwachen der Sigillen aus dem Look', () => {
    const group = new Group();
    new SpawnPortalManager(group);
    const material = gateMaterial(group);
    const L = SPAWN_PORTAL_LOOK;
    const G = L.glyphs;
    expect(material.uniforms['uGlyphWake'].value.toArray()).toEqual([G.wakePeriod, G.rise, G.hold, G.fade]);
    expect(material.uniforms['uGlyphBreath'].value.toArray()).toEqual([G.breath[0], G.breath[1], G.breathDepth, G.gain]);
    expect(material.uniforms['uGlyphFlow'].value.toArray()).toEqual([G.crawl, G.shimmer, G.wakeGain]);
    // Vor dem ersten Update: ruhend wie zwischen den Wellen
    expect(material.uniforms['uGlyphDrive'].value.toArray()).toEqual([G.dormant, G.wakeChance[0], 0]);
    expect(material.uniforms['uEnergy'].value).toBe(L.idleEnergy);
    // Jede Sigille aus ihrem Distanzfeld nach ihrer Zelle, aufwachend mit
    // einem Glimmen entlang der Striche, in Spielzeit
    expect(material.fragmentShader).toContain('portalGlyphCell(p, uOpening, centre)');
    expect(material.fragmentShader).toContain('portalGlyphInk(p.xy, cell, centre, wobble, stroke)');
    expect(material.fragmentShader).toContain('e.g * 6.0 - uGlyphTime * uGlyphFlow.x');
  });

  it('atmet in Echtzeit und steht in der Pause, der Wirbel läuft weiter', () => {
    const group = new Group();
    const portals = new SpawnPortalManager(group);
    portals.add('s1', POSE, 0xef4444);
    const uniforms = gateMaterial(group).uniforms;

    // The first update only sets the clock's start
    portals.update(10_000, false);
    let t = run(portals, 10_000, 2);
    const breath = uniforms['uGlyphTime'].value as number;
    expect(breath).toBeCloseTo(2, 3);

    // Pausiert: die Uhr der Sigillen steht, die des Wirbels nicht
    for (let i = 0; i < 180; i++) portals.update((t += FRAME_MS), true);
    expect(uniforms['uGlyphTime'].value).toBe(breath);
    expect(uniforms['uTime'].value).toBeCloseTo(t / 1000, 6);

    // Weiter ohne Sprung: der nächste Frame zählt nur seine eigene Zeit
    portals.update(t + FRAME_MS, false);
    expect(uniforms['uGlyphTime'].value).toBeCloseTo(breath + FRAME_MS / 1000, 6);
  });

  it('atmet bei jeder Zeitskala gleich schnell', () => {
    const breathAfter = (timescale: number) => {
      const group = new Group();
      const portals = new SpawnPortalManager(group);
      portals.add('s1', POSE, 0xef4444);
      const clock = new GameClock();
      let t = 1000;
      for (let i = 0; i < 600; i++) {
        t += FRAME_MS;
        clock.beginFrame(t, timescale);
        while (clock.nextSubStep()) { /* the simulation's sub-steps */ }
        clock.endFrame();
        portals.update(t, false);
      }
      return { breath: gateMaterial(group).uniforms['uGlyphTime'].value as number, game: clock.gameTimeMs / 1000 };
    };
    const normal = breathAfter(1);
    const fast = breathAfter(10);
    // Zehnmal so viel Spielzeit, derselbe Atem
    expect(fast.game).toBeGreaterThan(9 * normal.game);
    expect(fast.breath).toBeCloseTo(normal.breath, 6);
    expect(normal.breath).toBeCloseTo(10, 1);
  });

  it('glüht zwischen den Wellen schwächer als in einer, am stärksten beim Wellenstart', () => {
    const L = SPAWN_PORTAL_LOOK;
    const group = new Group();
    const portals = new SpawnPortalManager(group);
    portals.add('s1', POSE, 0xef4444);
    const drive = () => (gateMaterial(group).uniforms['uGlyphDrive'].value as Vector3).clone();

    const t = 1000;
    portals.update(t, false);
    const idle = drive();
    expect(idle.x).toBeCloseTo(L.glyphs.dormant);
    expect(idle.y).toBeCloseTo(L.glyphs.wakeChance[0]);

    portals.startWave(t);
    portals.update(t, false);
    const surge = drive();
    expect(surge.x).toBeGreaterThan(L.glyphs.active);
    expect(surge.z).toBeGreaterThan(0);

    run(portals, t, 10);
    const wave = drive();
    expect(wave.x).toBeCloseTo(L.glyphs.active, 2);
    expect(wave.y).toBeCloseTo(L.glyphs.wakeChance[1], 2);
    expect(wave.z).toBe(0);
  });
});

describe('portalGlyphDrive', () => {
  const L = SPAWN_PORTAL_LOOK;
  const G = L.glyphs;

  it('ruht zwischen den Wellen auf einer lesbaren Glut, in der Welle deutlich stärker', () => {
    const idle = portalGlyphDrive(L.idleEnergy, L, G);
    const wave = portalGlyphDrive(L.waveEnergy, L, G);
    expect(idle).toEqual({ level: G.dormant, wakeChance: G.wakeChance[0], surge: 0 });
    expect(wave).toEqual({ level: G.active, wakeChance: G.wakeChance[1], surge: 0 });
    expect(G.dormant).toBeGreaterThan(0.3 * G.active);
    expect(G.active).toBeGreaterThan(1.5 * G.dormant);
  });

  it('legt den Schub eines Wellenstarts obendrauf, höchstens um flare', () => {
    const peak = portalGlyphDrive(L.waveEnergy + L.surge, L, G);
    expect(peak.level).toBeCloseTo(G.active + G.flare);
    expect(peak.surge).toBe(1);
    expect(portalGlyphDrive(L.waveEnergy + 10 * L.surge, L, G)).toEqual(peak);
    expect(portalGlyphDrive(0, L, G)).toEqual(portalGlyphDrive(L.idleEnergy, L, G));
  });

  it('steigt mit der Energie, ohne Sprung', () => {
    let last = portalGlyphDrive(0, L, G);
    for (let energy = 0.01; energy <= L.waveEnergy + L.surge + 0.2; energy += 0.01) {
      const next = portalGlyphDrive(energy, L, G);
      expect(next.level).toBeGreaterThanOrEqual(last.level);
      expect(next.level - last.level).toBeLessThan(0.05);
      expect(next.wakeChance).toBeGreaterThanOrEqual(last.wakeChance);
      last = next;
    }
  });
});

describe('SpawnPortalManager: Rahmen', () => {
  /** Ein Kasten mit Tangenten und den vier Texturen anstelle des GLB. */
  function fakeFrame(): SpawnPortalFrame {
    const geometry = new BoxGeometry(2, 2, 2);
    const vertices = geometry.getAttribute('position').count;
    geometry.setAttribute('tangent', new Float32BufferAttribute(new Float32Array(vertices * 4), 4));
    return { geometry, baseColor: new Texture(), normal: new Texture(), orm: new Texture(), emissive: new Texture() };
  }

  const gateOf = (group: Group) => group.children.find((o) => o.name === 'spawnPortalGates') as InstancedMesh;

  it('steht vor dem Laden als die zwei Flächen der Leere und nimmt dann den Rahmen mit seinen Texturen', () => {
    const group = new Group();
    const portals = new SpawnPortalManager(group);
    portals.add('s1', POSE, 0xef4444);
    const gate = gateOf(group);
    expect(gate.geometry.getAttribute('position').count).toBe(12);

    const frame = fakeFrame();
    portals.setFrame(frame);
    expect(gate.geometry.getAttribute('position').count).toBe(frame.geometry.getAttribute('position').count + 12);
    // Die Instanzattribute ziehen mit auf die neue Geometrie
    expect(gate.geometry.getAttribute('aColor').getX(0)).toBeCloseTo(new Color(0xef4444).r);
    const uniforms = (gate.material as ShaderMaterial).uniforms;
    expect(uniforms['uBaseMap'].value).toBe(frame.baseColor);
    expect(uniforms['uNormalMap'].value).toBe(frame.normal);
    expect(uniforms['uOrmMap'].value).toBe(frame.orm);
    expect(uniforms['uEmissiveMap'].value).toBe(frame.emissive);
  });

  it('gibt nur die eigene Geometrie frei, nicht die geteilten Instanzattribute und nicht den Rahmen', () => {
    const group = new Group();
    const portals = new SpawnPortalManager(group);
    const bare = gateOf(group).geometry;
    const bareDisposed = vi.fn();
    bare.addEventListener('dispose', bareDisposed);
    const frame = fakeFrame();
    const frameDisposed = vi.fn();
    frame.geometry.addEventListener('dispose', frameDisposed);

    portals.setFrame(frame);
    expect(bareDisposed).toHaveBeenCalledTimes(1);
    // Beim Freigeben trug die alte Geometrie die geteilten Attribute nicht
    // mehr; das Straßenlicht zeichnet weiter mit ihnen
    expect(bare.getAttribute('aColor')).toBeUndefined();
    const glow = group.children.find((o) => o.name === 'spawnPortalGlow') as InstancedMesh;
    expect(glow.geometry.getAttribute('aColor')).toBe(gateOf(group).geometry.getAttribute('aColor'));

    portals.dispose();
    expect(frameDisposed).not.toHaveBeenCalled();
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
