import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import type { SiegeLook } from '../../configs/siege-look.config';
import type { TrailParticleConfig } from '../../configs/projectile-types.config';
import { DISPLAY_OUTPUT_GLSL } from './display-output';
import { DrawGate } from './draw-gate';
import { unpickable } from './effect-buffers';
import { drawnInWorldSpace } from '../static-group';
import type { ShotLights, ShotLightSource } from '../shot-lights/shot-lights';

/** Shells in flight at once at most; a shot past it takes the oldest's place */
const SHELLS = 8;

/** Smoke a shell leaves behind it: dark grey puffs that drift up and hang on */
const SHELL_SMOKE: TrailParticleConfig = {
  enabled: true,
  spawnChance: 1,
  countPerSpawn: 2,
  colorMin: { r: 0.08, g: 0.08, b: 0.08 },
  colorMax: { r: 0.32, g: 0.3, b: 0.28 },
  sizeMin: 1.2,
  sizeMax: 2.6,
  lifetimeMin: 0.9,
  lifetimeMax: 1.8,
  velocityX: { min: -0.6, max: 0.6 },
  velocityY: { min: 0.4, max: 1.2 },
  velocityZ: { min: -0.6, max: 0.6 },
  spawnOffset: 0.5,
  blending: 'normal',
};

/** Where the smoke goes (ThreeEffectsRenderer.spawnConfigurableTrail) */
export type ShellSmoke = (x: number, y: number, z: number, config: TrailParticleConfig) => void;

interface Shell {
  active: boolean;
  enemyId: string;
  look: SiegeLook['shell'] | null;
  from: Vector3;
  to: Vector3;
  /** Game ms flown, of `flightMs` */
  age: number;
  flightMs: number;
  /** Metres of the way left smoke behind */
  smoked: number;
  /** Order of its shot, for the oldest to give way */
  sequence: number;
}

/**
 * The shells of the siege guns (EnemyTypeConfig.siege) from the muzzles to
 * where they land: a white-hot streak with an orange edge, facing the camera
 * along its flight, its smoke behind it (the effects' trail particles) and
 * its light (ShotLightSource). One draw call for all, nothing allocated per
 * frame.
 *
 * It flies in game time: a pause holds it, the timescale speeds it up, and it
 * comes in as the simulation's shell lands (`land`, op main.siegeImpact). It
 * holds just short of the end should the impact come a frame late, and goes
 * with the impact even if it is early.
 */
export class SiegeShellRenderer implements ShotLightSource {
  private readonly shells: Shell[] = [];
  private readonly mesh: Mesh;
  private readonly gate: DrawGate;
  private readonly head: InstancedBufferAttribute;
  private readonly tail: InstancedBufferAttribute;
  private readonly style: InstancedBufferAttribute;
  private readonly geometry: InstancedBufferGeometry;
  private sequence = 0;
  private active = 0;
  private readonly at = new Vector3();
  private readonly back = new Vector3();

  constructor(
    scene: Scene,
    private readonly smoke: ShellSmoke,
  ) {
    for (let i = 0; i < SHELLS; i++) {
      this.shells.push({
        active: false, enemyId: '', look: null, from: new Vector3(), to: new Vector3(),
        age: 0, flightMs: 1, smoked: 0, sequence: 0,
      });
    }
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.head = new InstancedBufferAttribute(new Float32Array(SHELLS * 3), 3);
    this.tail = new InstancedBufferAttribute(new Float32Array(SHELLS * 3), 3);
    // width, then rgb of the hot colour
    this.style = new InstancedBufferAttribute(new Float32Array(SHELLS * 4), 4);
    geometry.setAttribute('aHead', this.head);
    geometry.setAttribute('aTail', this.tail);
    geometry.setAttribute('aStyle', this.style);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    const material = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 aHead;
        attribute vec3 aTail;
        attribute vec4 aStyle;
        varying vec2 vUv;
        varying vec3 vColor;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vUv = uv;
          vColor = aStyle.yzw;
          // Along the flight from tail (v 0) to head (v 1), across it facing the camera
          vec3 along = aHead - aTail;
          vec3 middle = (aHead + aTail) * 0.5;
          vec3 side = normalize(cross(along, cameraPosition - middle));
          vec3 world = mix(aTail, aHead, uv.y) + side * (uv.x - 0.5) * aStyle.x;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        #include <logdepthbuf_pars_fragment>
        ${DISPLAY_OUTPUT_GLSL}
        void main() {
          #include <logdepthbuf_fragment>
          // White-hot along the middle, the colour at the edges; bright at the head, gone at the tail
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float core = smoothstep(0.55, 1.0, across);
          float body = smoothstep(0.0, 0.8, across);
          float run = vUv.y * vUv.y;
          vec3 color = mix(vColor, vec3(1.0, 0.97, 0.9), core) * (1.0 + 2.0 * core);
          gl_FragColor = displayLight(vec4(color * body * run, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = unpickable(new Mesh(geometry, material));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    drawnInWorldSpace(this.mesh);
    this.gate = new DrawGate([this.mesh]);
    scene.add(this.mesh);
  }

  /** A shell of enemy `enemyId` leaves `from` for `to` (scene-local), landing in `flightMs` of game time */
  fire(enemyId: string, from: Vector3, to: Vector3, flightMs: number, look: SiegeLook['shell']): void {
    let shell = this.shells.find((s) => !s.active);
    if (!shell) shell = this.shells.reduce((a, b) => (a.sequence <= b.sequence ? a : b));
    else this.active++;
    shell.active = true;
    shell.enemyId = enemyId;
    shell.look = look;
    shell.from.copy(from);
    shell.to.copy(to);
    shell.age = 0;
    shell.flightMs = Math.max(1, flightMs);
    shell.smoked = 0;
    shell.sequence = ++this.sequence;
  }

  /** The shell of enemy `enemyId` landed: it goes */
  land(enemyId: string): void {
    for (const shell of this.shells) {
      if (!shell.active || shell.enemyId !== enemyId) continue;
      shell.active = false;
      this.active--;
    }
  }

  /** `gameDeltaMs` of game time on: the shells fly on, smoke behind them, and are written for the frame */
  update(gameDeltaMs: number): void {
    let n = 0;
    for (const shell of this.shells) {
      const look = shell.look;
      if (!shell.active || !look) continue;
      shell.age += gameDeltaMs;
      const way = shell.from.distanceTo(shell.to);
      // Just short of the end until the simulation lands it
      const t = Math.min(0.995, shell.age / shell.flightMs);
      const head = this.at.lerpVectors(shell.from, shell.to, t);
      const run = way * t;
      const length = Math.min(look.length, run);
      const tail = this.back.copy(shell.to).sub(shell.from).setLength(Math.max(length, 1e-3)).negate().add(head);
      // Smoke at the points of the way it passed since the last frame
      while (shell.smoked + look.smokeEveryM <= run) {
        shell.smoked += look.smokeEveryM;
        const p = shell.smoked / way;
        this.smoke(
          shell.from.x + (shell.to.x - shell.from.x) * p,
          shell.from.y + (shell.to.y - shell.from.y) * p,
          shell.from.z + (shell.to.z - shell.from.z) * p,
          SHELL_SMOKE,
        );
      }
      this.head.setXYZ(n, head.x, head.y, head.z);
      this.tail.setXYZ(n, tail.x, tail.y, tail.z);
      const c = look.color;
      this.style.setXYZW(n, look.width, c[0], c[1], c[2]);
      n++;
    }
    this.geometry.instanceCount = n;
    this.gate.setCount(n);
    if (n > 0) {
      this.head.needsUpdate = true;
      this.tail.needsUpdate = true;
      this.style.needsUpdate = true;
    }
  }

  /** ShotLightSource: each shell in flight lights what it passes */
  shotLights(lights: ShotLights): void {
    if (this.active === 0) return;
    const head = this.head.array as Float32Array;
    let n = 0;
    for (const shell of this.shells) {
      if (!shell.active || !shell.look) continue;
      lights.add(head[n * 3], head[n * 3 + 1], head[n * 3 + 2], shell.look.light);
      n++;
    }
  }

  /** Every shell gone (a new run, a restore, a seek) */
  clear(): void {
    for (const shell of this.shells) shell.active = false;
    this.active = 0;
    this.geometry.instanceCount = 0;
    this.gate.setCount(0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
