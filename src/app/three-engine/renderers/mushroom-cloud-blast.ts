import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Uniform,
  Vector3,
  type Scene,
} from 'three';
import { MUSHROOM_CLOUD_LOOK as LOOK } from '../../configs/visual-effects.config';
import { DrawGate } from './draw-gate';
import { radialTexture, reach, unpickable } from './effect-buffers';
import { TAU, type Cloud } from './mushroom-cloud-shape';

/** Above the strike marker (950), under the particle pools (999) */
const RING_ORDER = 951;
const DOME_ORDER = 952;
const FLASH_ORDER = 1002;
const SCREEN_ORDER = 1003;
/** Shockwave ring above the ground point, m */
const RING_LIFT = 0.6;
/** Height of the shock dome over its radius */
const DOME_FLATTEN = 0.8;

/** A quad over the whole screen, additive: the screen part of the flash. */
const SCREEN_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const SCREEN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  #include <logdepthbuf_pars_fragment>

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <logdepthbuf_fragment>
  }
`;

/** Shock dome: additive, faint where it faces the camera, bright along its outline. */
const DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;

  #include <logdepthbuf_pars_fragment>

  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float outline = pow(1.0 - facing, 2.5);
    gl_FragColor = vec4(uColor, uOpacity * (0.15 + 0.85 * outline));
    #include <logdepthbuf_fragment>
  }
`;

/**
 * The detonation of the mushroom clouds besides their particles: per cloud
 * a shockwave ring on the ground, a shock dome and a flash sprite, and one
 * additive quad over the whole screen for the screen part of the flash
 * (MushroomCloudRenderer).
 */
export class CloudBlast {
  private readonly ringTexture: DataTexture;
  private readonly flashTexture: DataTexture;
  private readonly ringGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  /** Upper half of a unit sphere */
  private readonly domeGeometry = new SphereGeometry(1, 32, 10, 0, TAU, 0, Math.PI / 2);
  private readonly rings: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly domes: Mesh<SphereGeometry, ShaderMaterial>[] = [];
  private readonly flashes: Sprite[] = [];
  private readonly ringGates: DrawGate[] = [];
  private readonly domeGates: DrawGate[] = [];
  private readonly flashGates: DrawGate[] = [];
  private readonly screen: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly screenGate: DrawGate;

  constructor(scene: Scene) {
    // Shockwave: a bright front with a faint fill behind it
    this.ringTexture = radialTexture(256, (r) =>
      Math.exp(-(((r - 0.9) / 0.045) ** 2)) + (r < 0.9 ? 0.18 * MathUtils.smoothstep(r, 0.2, 0.9) : 0));
    this.flashTexture = radialTexture(64, (r) => (1 - r) ** 2);

    const { flash, shockwave, shockDome } = LOOK.colors;
    const intensity = LOOK.flash.intensity;
    for (let i = 0; i < LOOK.clouds; i++) {
      const ringMaterial = new MeshBasicMaterial({
        map: this.ringTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      ringMaterial.color.setRGB(shockwave.r, shockwave.g, shockwave.b);
      const ring = unpickable(new Mesh(this.ringGeometry, ringMaterial));
      ring.frustumCulled = false;
      ring.renderOrder = RING_ORDER;
      scene.add(ring);
      this.rings.push(ring);
      this.ringGates.push(new DrawGate([ring]));

      const domeMaterial = new ShaderMaterial({
        vertexShader: DOME_VERTEX_SHADER,
        fragmentShader: DOME_FRAGMENT_SHADER,
        uniforms: {
          uColor: new Uniform(new Vector3(shockDome.r, shockDome.g, shockDome.b)),
          uOpacity: new Uniform(0),
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const dome = unpickable(new Mesh(this.domeGeometry, domeMaterial));
      dome.frustumCulled = false;
      dome.renderOrder = DOME_ORDER;
      scene.add(dome);
      this.domes.push(dome);
      this.domeGates.push(new DrawGate([dome]));

      const flashMaterial = new SpriteMaterial({
        map: this.flashTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      flashMaterial.color.setRGB(flash.r * intensity, flash.g * intensity, flash.b * intensity);
      const sprite = unpickable(new Sprite(flashMaterial));
      sprite.frustumCulled = false;
      sprite.renderOrder = FLASH_ORDER;
      scene.add(sprite);
      this.flashes.push(sprite);
      this.flashGates.push(new DrawGate([sprite]));
    }

    const screenMaterial = new ShaderMaterial({
      vertexShader: SCREEN_VERTEX_SHADER,
      fragmentShader: SCREEN_FRAGMENT_SHADER,
      uniforms: {
        uColor: new Uniform(new Vector3(flash.r, flash.g, flash.b)),
        uOpacity: new Uniform(0),
      },
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.screen = unpickable(new Mesh(new PlaneGeometry(2, 2), screenMaterial));
    this.screen.frustumCulled = false;
    this.screen.renderOrder = SCREEN_ORDER;
    scene.add(this.screen);
    this.screenGate = new DrawGate([this.screen]);
  }

  /** The ring, dome and flash of `cloud` in its `slot`, at its age. */
  update(cloud: Cloud, slot: number): void {
    this.updateRing(cloud, slot);
    this.updateDome(cloud, slot);
    this.updateFlash(cloud, slot);
  }

  /** Hide the ring, dome and flash of `slot` (no cloud there). */
  hide(slot: number): void {
    this.ringGates[slot].setCount(0);
    this.domeGates[slot].setCount(0);
    this.flashGates[slot].setCount(0);
  }

  /** The screen part of the flash at `opacity`, not drawn at 0. */
  setScreen(opacity: number): void {
    this.screen.material.uniforms['uOpacity'].value = opacity;
    this.screenGate.setCount(opacity > 0 ? 1 : 0);
  }

  /** Hide all of it (restart). */
  clear(): void {
    for (const gate of this.ringGates) gate.setCount(0);
    for (const gate of this.domeGates) gate.setCount(0);
    for (const gate of this.flashGates) gate.setCount(0);
    this.screenGate.setCount(0);
  }

  /** Remove and free all of it. */
  dispose(scene: Scene): void {
    for (const ring of this.rings) {
      scene.remove(ring);
      ring.material.dispose();
    }
    for (const dome of this.domes) {
      scene.remove(dome);
      dome.material.dispose();
    }
    for (const sprite of this.flashes) {
      scene.remove(sprite);
      sprite.material.dispose();
    }
    scene.remove(this.screen);
    this.screen.geometry.dispose();
    this.screen.material.dispose();
    this.ringGeometry.dispose();
    this.domeGeometry.dispose();
    this.ringTexture.dispose();
    this.flashTexture.dispose();
  }

  /** Shockwave: out over the ground, fast at first, fading as it goes. */
  private updateRing(cloud: Cloud, slot: number): void {
    const { shockwave } = LOOK;
    const gate = this.ringGates[slot];
    if (cloud.t >= shockwave.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, shockwave.radius * cloud.scale * reach(cloud.t, shockwave.duration, shockwave.timeConstant));
    const ring = this.rings[slot];
    ring.position.set(cloud.x, cloud.y + RING_LIFT, cloud.z);
    ring.scale.set(radius, 1, radius);
    ring.material.opacity = shockwave.opacity * (1 - cloud.t / shockwave.duration) ** 1.3;
    gate.setCount(1);
  }

  /** Shock dome: a hemisphere out over the ground point, faster than the ring and gone sooner. */
  private updateDome(cloud: Cloud, slot: number): void {
    const { shockDome } = LOOK;
    const gate = this.domeGates[slot];
    if (cloud.t >= shockDome.duration) {
      gate.setCount(0);
      return;
    }
    const radius = Math.max(0.01, shockDome.radius * cloud.scale * reach(cloud.t, shockDome.duration, shockDome.timeConstant));
    const dome = this.domes[slot];
    dome.position.set(cloud.x, cloud.y, cloud.z);
    dome.scale.set(radius, radius * DOME_FLATTEN, radius);
    dome.material.uniforms['uOpacity'].value = shockDome.opacity * (1 - cloud.t / shockDome.duration) ** 1.5;
    gate.setCount(1);
  }

  /** Flash over the ground point: full size within 80 ms, then gone by LOOK.flash.duration. */
  private updateFlash(cloud: Cloud, slot: number): void {
    const { flash } = LOOK;
    const gate = this.flashGates[slot];
    if (cloud.t >= flash.duration) {
      gate.setCount(0);
      return;
    }
    const fade = 1 - cloud.t / flash.duration;
    const size = flash.size * cloud.scale * (0.4 + 0.6 * MathUtils.smoothstep(cloud.t, 0, 0.08));
    const sprite = this.flashes[slot];
    sprite.position.set(cloud.x, cloud.y + flash.height * cloud.scale, cloud.z);
    sprite.scale.set(size, size, 1);
    sprite.material.opacity = fade * fade;
    gate.setCount(1);
  }
}
