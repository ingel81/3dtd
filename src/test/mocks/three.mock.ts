/* eslint-disable @typescript-eslint/no-empty-function */

// Minimal Three.js mock for unit tests that don't need real 3D rendering.
// Add stubs as needed when tests fail with "No X export is defined".

export class Vector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  sub() { return this; }
  normalize() { return this; }
  multiplyScalar() { return this; }
  length() { return 0; }
  addScaledVector() { return this; }
}

export class Vector2 {
  constructor(public x = 0, public y = 0) {}
}

export class Quaternion {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  setFromAxisAngle() { return this; }
}

export class Color {
  r = 0; g = 0; b = 0;
  constructor(_color?: number | string) {}
  set() { return this; }
}

export class Matrix4 {
  elements = new Float32Array(16);
  compose() { return this; }
  decompose() { return this; }
  identity() { return this; }
  setPosition() { return this; }
}

export class Object3D {
  position = new Vector3();
  rotation = { x: 0, y: 0, z: 0 };
  scale = new Vector3(1, 1, 1);
  children: Object3D[] = [];
  visible = true;
  name = '';
  add() {}
  remove() {}
  traverse(_cb: (obj: Object3D) => void) {}
  updateMatrixWorld() {}
}

export class Group extends Object3D {}
export class Scene extends Object3D {}
export class Mesh extends Object3D {}
export class InstancedMesh extends Object3D {}
export class Points extends Object3D {}
export class Line extends Object3D {}

export class Camera extends Object3D {}
export class PerspectiveCamera extends Camera {
  constructor(public fov = 75, public aspect = 1, public near = 0.1, public far = 1000) { super(); }
  updateProjectionMatrix() {}
}

export class WebGLRenderer {
  domElement = { getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }) };
  setSize() {}
  setPixelRatio() {}
  render() {}
  dispose() {}
}

export class Raycaster {
  set() {}
  setFromCamera() {}
  intersectObject() { return []; }
  far = 0;
}

export class BufferGeometry {
  setAttribute() {}
  dispose() {}
}

export class BoxGeometry extends BufferGeometry {}
export class PlaneGeometry extends BufferGeometry {}
export class SphereGeometry extends BufferGeometry {}

export class Material { dispose() {} }
export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class ShaderMaterial extends Material {}
export class PointsMaterial extends Material {}

export class DataTexture { needsUpdate = false; dispose() {} }
export class Texture { dispose() {} }

export class AudioLoader {
  load(_url: string, onLoad?: (buffer: unknown) => void) {
    if (onLoad) onLoad({});
  }
}

export class AudioListener {}

export class Audio {
  constructor(_listener: unknown) {}
  setBuffer() { return this; }
  setLoop() { return this; }
  setVolume() { return this; }
  play() { return this; }
  stop() { return this; }
  pause() { return this; }
  isPlaying = false;
}

export class InstancedBufferAttribute {
  needsUpdate = false;
  setX() {}
  setXY() {}
  setXYZ() {}
  setXYZW() {}
}

export class BufferAttribute {
  constructor(_array?: unknown, _itemSize?: number) {}
}

export const MathUtils = {
  DEG2RAD: Math.PI / 180,
  RAD2DEG: 180 / Math.PI,
  clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
};

// Constants
export const SRGBColorSpace = 'srgb';
export const DoubleSide = 2;
export const FrontSide = 0;
export const NearestFilter = 1003;
export const FloatType = 1015;
export const RGBAFormat = 1023;
export const StaticDrawUsage = 35044;
export const DynamicDrawUsage = 35048;
export const LoopOnce = 2200;
export const EquirectangularReflectionMapping = 305;

export class Fog {}
export class HemisphereLight extends Object3D {}
export class DirectionalLight extends Object3D {}
export class AmbientLight extends Object3D {}
export class TextureLoader { load() { return new Texture(); } }
export class AxesHelper extends Object3D {}

export default {
  Vector3, Vector2, Quaternion, Color, Matrix4,
  Object3D, Group, Scene, Mesh, InstancedMesh, Points, Line,
  Camera, PerspectiveCamera, WebGLRenderer, Raycaster,
  BufferGeometry, BoxGeometry, PlaneGeometry, SphereGeometry,
  Material, MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, PointsMaterial,
  DataTexture, Texture, AudioLoader, AudioListener, Audio,
  InstancedBufferAttribute, BufferAttribute, MathUtils,
  SRGBColorSpace, DoubleSide, FrontSide, NearestFilter, FloatType, RGBAFormat,
  StaticDrawUsage, DynamicDrawUsage, LoopOnce, EquirectangularReflectionMapping,
  Fog, HemisphereLight, DirectionalLight, AmbientLight, TextureLoader, AxesHelper,
};
