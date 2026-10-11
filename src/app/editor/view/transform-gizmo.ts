/**
 * The handles over a selection: for Move three arrows (map x red, map y
 * green, up blue) and a square for free moves on the ground; for Turn a
 * ring; for Scale a cube. They keep their size on screen, draw over
 * everything, light up under the pointer and answer which handle a ray
 * hits. Local space turns the ground arrows with the first selected object.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Raycaster,
  TorusGeometry,
  Vector3,
} from 'three';
import { TD_THEME } from '../../styles/td-theme';

export type GizmoHandle = 'x' | 'y' | 'z' | 'free' | 'ring' | 'scale';
export type GizmoKind = 'move' | 'rotate' | 'scale';

/** Arrow length in screen-relative units (metres at a view distance of 100 m) */
const SIZE = 9;
const COLORS: Record<GizmoHandle, string> = {
  x: '#d9534a',
  y: '#5cb85c',
  z: '#4a90d9',
  free: TD_THEME.brassLight,
  ring: TD_THEME.tealLight,
  scale: TD_THEME.brassLight,
};

export class TransformGizmo {
  readonly group = new Group();
  private readonly parts = new Map<GizmoHandle, Mesh[]>();
  private readonly materials = new Map<GizmoHandle, MeshBasicMaterial>();
  private readonly ground = new Group();
  private kind: GizmoKind = 'move';
  private hot: GizmoHandle | null = null;

  constructor() {
    this.group.name = 'transform-gizmo';
    this.group.visible = false;
    for (const h of Object.keys(COLORS) as GizmoHandle[]) {
      this.materials.set(h, new MeshBasicMaterial({ color: COLORS[h], depthTest: false, transparent: true, opacity: 0.85, side: DoubleSide }));
    }
    // Arrows: shaft and head along +y of the arrow, turned onto each axis
    const arrow = (h: 'x' | 'y' | 'z'): Group => {
      const g = new Group();
      const m = this.materials.get(h)!;
      const shaft = new Mesh(new CylinderGeometry(0.12, 0.12, SIZE, 8), m);
      shaft.position.y = SIZE / 2;
      const head = new Mesh(new ConeGeometry(0.55, 1.8, 12), m);
      head.position.y = SIZE + 0.9;
      // A fatter, invisible-ish grip so the arrow is easy to catch
      const grip = new Mesh(new CylinderGeometry(0.6, 0.6, SIZE + 1.8, 6), m);
      grip.position.y = (SIZE + 1.8) / 2;
      grip.visible = false;
      g.add(shaft, head, grip);
      this.parts.set(h, [shaft, head, grip]);
      return g;
    };
    // Map x is scene -x, map y is scene +z
    const ax = arrow('x');
    ax.rotation.z = Math.PI / 2;
    const ay = arrow('y');
    ay.rotation.x = Math.PI / 2;
    const az = arrow('z');
    const free = new Mesh(new PlaneGeometry(2.4, 2.4), this.materials.get('free')!);
    free.rotation.x = -Math.PI / 2;
    free.position.set(-1.8, 0, 1.8);
    this.parts.set('free', [free]);
    this.ground.add(ax, ay, free);
    const ring = new Mesh(new TorusGeometry(SIZE * 0.9, 0.18, 6, 64), this.materials.get('ring')!);
    ring.rotation.x = Math.PI / 2;
    const ringGrip = new Mesh(new TorusGeometry(SIZE * 0.9, 0.9, 6, 48), this.materials.get('ring')!);
    ringGrip.rotation.x = Math.PI / 2;
    ringGrip.visible = false;
    this.parts.set('ring', [ring, ringGrip]);
    const cube = new Mesh(new BoxGeometry(2, 2, 2), this.materials.get('scale')!);
    cube.position.y = SIZE * 0.6;
    this.parts.set('scale', [cube]);
    this.group.add(this.ground, az, ring, ringGrip, cube);
    for (const list of this.parts.values()) {
      for (const m of list) {
        m.renderOrder = 20;
        m.frustumCulled = false;
        m.userData['gizmo'] = true;
      }
    }
    this.setKind('move');
  }

  /** Which handles show */
  setKind(kind: GizmoKind): void {
    this.kind = kind;
    const show = (h: GizmoHandle, on: boolean) => this.parts.get(h)!.forEach((m, k) => (m.visible = on && !(k === 2 && h !== 'free') && !(h === 'ring' && k === 1)));
    show('x', kind === 'move');
    show('y', kind === 'move');
    show('z', kind === 'move');
    show('free', kind === 'move');
    show('ring', kind === 'rotate');
    show('scale', kind === 'scale');
  }

  /**
   * At a scene point; `yaw` turns the ground arrows (local space), `scale`
   * keeps the size on screen (the view distance over 100 m).
   */
  place(at: Vector3, yaw: number, scale: number): void {
    this.group.visible = true;
    this.group.position.copy(at);
    this.group.scale.setScalar(scale);
    this.ground.rotation.y = yaw;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** The handle a ray hits, or null */
  pick(raycaster: Raycaster): GizmoHandle | null {
    if (!this.group.visible) return null;
    const candidates: Mesh[] = [];
    const handles = new Map<Mesh, GizmoHandle>();
    const active: GizmoHandle[] = this.kind === 'move' ? ['x', 'y', 'z', 'free'] : this.kind === 'rotate' ? ['ring'] : ['scale'];
    for (const h of active) {
      for (const m of this.parts.get(h)!) {
        candidates.push(m);
        handles.set(m, h);
      }
    }
    // The hidden grips count for picking
    const hidden = candidates.filter((m) => !m.visible);
    for (const m of hidden) m.visible = true;
    this.group.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(candidates, false);
    for (const m of hidden) m.visible = false;
    return hits.length ? handles.get(hits[0].object as Mesh)! : null;
  }

  /** Light up the handle under the pointer */
  highlight(handle: GizmoHandle | null): void {
    if (handle === this.hot) return;
    if (this.hot) this.materials.get(this.hot)!.opacity = 0.85;
    this.hot = handle;
    if (handle) this.materials.get(handle)!.opacity = 1;
    for (const [h, m] of this.materials) m.color.set(h === handle ? '#ffffff' : COLORS[h]);
  }

  /** Map direction of a ground arrow for a yaw (x turns toward y counter-clockwise) */
  static axis(handle: 'x' | 'y', yaw: number): { x: number; y: number } {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return handle === 'x' ? { x: c, y: s } : { x: -s, y: c };
  }
}

/** Scene position of a map point (scene x is west) */
export function gizmoAnchor(x: number, y: number, z: number): Vector3 {
  return new Vector3(-x, z, y);
}
