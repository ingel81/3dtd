/**
 * The map editor (`/editor`) as a showreel stage: its orbit camera driven to
 * exact poses, its map, settings and session. Strokes and clicks go through
 * the drawn pointer (Hands) like a person's.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { EditorSession } from '../editor/ui/editor-session.service';
import type { EditorViewport } from '../editor/view/editor-viewport';
import type { EditorSettings } from '../editor/tools/tool';
import { mapToScene } from '../editor/view/map-view';
import { poseToOrbit, type CameraPose, type MapPoint3 } from './camera-path';
import type { ScreenPoint } from './pointer';
import type { Stage } from './stage';
import { waitSeconds, waitUntil } from './hands';

/** The session's parts the stage reads although they are its own */
interface SessionInside {
  viewport: EditorViewport | null;
}

/** Deep merge of plain objects, arrays and values replaced */
function merge(into: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      merge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else into[k] = v;
  }
}

export class EditorStage implements Stage {
  readonly kind = 'editor';
  private posed: CameraPose | null = null;
  /** The viewport whose camera the stage holds, and its own apply */
  private held: { viewport: EditorViewport; apply: (camera: PerspectiveCamera) => void } | null = null;

  get session(): EditorSession {
    const ng = (window as unknown as { ng?: { getComponent(el: Element | null): unknown } }).ng;
    const page = ng?.getComponent(document.querySelector('app-editor-page')) as { session?: EditorSession } | null | undefined;
    if (!page?.session) throw new Error('showreel: no editor page (dev build only)');
    return page.session;
  }

  private get viewport(): EditorViewport | null {
    return (this.session as unknown as SessionInside).viewport;
  }

  /** The map list, or an open map's view drawn */
  ready(): boolean {
    try {
      const session = this.session;
      return session.meta() === null ? !!document.querySelector('[data-test=new-map]') : this.mapShown();
    } catch {
      return false;
    }
  }

  private mapShown(): boolean {
    return !!this.viewport && this.session.viewShown();
  }

  mapSize(): { width: number; depth: number } | null {
    const t = this.session.doc?.terrain;
    return t ? { width: t.width, depth: t.depth } : null;
  }

  groundAt(x: number, y: number): number {
    return this.viewport?.heightAt(x, y) ?? 0;
  }

  named(name: string): { x: number; y: number } | null {
    const doc = this.session.doc;
    if (!doc) return null;
    if (name === 'hq') return { x: doc.hq.x, y: doc.hq.y };
    if (name === 'center') return { x: 0, y: 0 };
    const spawn = /^spawn:(\d+)$/.exec(name);
    if (spawn) {
      const s = doc.spawns[Number(spawn[1])];
      return s ? { x: s.x, y: s.y } : null;
    }
    return null;
  }

  private ground(p: MapPoint3): number {
    return Number.isNaN(p.h) ? this.groundAt(p.x, p.y) : p.h;
  }

  setPose(pose: CameraPose | null): void {
    const viewport = this.viewport;
    if (!viewport) return;
    if (this.held && this.held.viewport !== viewport) this.held = null;
    if (pose && !this.held) {
      // The controller's apply stands in for the stage's while it holds the camera
      const apply = viewport.controller.apply.bind(viewport.controller);
      this.held = { viewport, apply };
      viewport.controller.apply = (camera) => (this.posed ? this.applyPose(camera) : apply(camera));
    }
    this.posed = pose;
    if (pose) this.syncController(viewport, pose);
    else if (this.held) {
      viewport.controller.apply = this.held.apply;
      this.held = null;
    }
  }

  /** The orbit camera follows the pose, so its target (LOD, haze) is right and letting go does not jump */
  private syncController(viewport: EditorViewport, pose: CameraPose): void {
    const look = { ...pose.look, h: this.ground(pose.look) };
    const eye = { ...pose.eye, h: this.ground(pose.eye) };
    const orbit = poseToOrbit({ eye, look });
    for (const state of [viewport.controller.goal, viewport.controller.current]) {
      mapToScene(look.x, look.y, look.h, state.target);
      state.distance = orbit.distance;
      state.yaw = orbit.yaw;
      state.pitch = Math.max(0.12, orbit.pitch);
    }
  }

  private applyPose(camera: PerspectiveCamera): void {
    const pose = this.posed!;
    const viewport = this.viewport;
    if (viewport) this.syncController(viewport, pose);
    const eye = mapToScene(pose.eye.x, pose.eye.y, this.ground(pose.eye), new Vector3());
    const look = mapToScene(pose.look.x, pose.look.y, this.ground(pose.look), new Vector3());
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    const distance = eye.distanceTo(look);
    camera.near = Math.max(0.5, distance / 2000);
    camera.far = Math.max(20000, distance * 20);
    camera.updateProjectionMatrix();
  }

  pose(): CameraPose | null {
    const viewport = this.viewport;
    if (!viewport) return null;
    const c = viewport.controller.current;
    const camera = viewport.camera;
    return {
      eye: { x: -camera.position.x, y: camera.position.z, h: camera.position.y },
      look: { x: -c.target.x, y: c.target.z, h: c.target.y },
    };
  }

  toScreen(p: MapPoint3): ScreenPoint | null {
    const viewport = this.viewport;
    if (!viewport) return null;
    return viewport.ctx.toScreen(p.x, p.y, this.ground(p));
  }

  async act(name: string, args: Record<string, unknown>): Promise<void> {
    const session = this.session;
    switch (name) {
      case 'settings':
        // Seeds, brush, river and road options: what the panels would set, at once
        session.patchSettings((s: EditorSettings) => merge(s as unknown as Record<string, unknown>, args['patch'] as Record<string, unknown>));
        return;
      case 'environment':
        session.editEnvironment(args['patch'] as Parameters<EditorSession['editEnvironment']>[0], String(args['label'] ?? 'Environment'));
        return;
      case 'trialSpeed': {
        const viewport = this.viewport;
        if (viewport) viewport.trialSpeed = Number(args['value'] ?? 4);
        return;
      }
      case 'save':
        await session.save(true);
        return;
      case 'viewReady':
        await waitUntil(() => this.mapShown(), Number(args['timeout'] ?? 60), 'the editor view');
        return;
      case 'idle':
        // A terrain job or a held stroke still running
        await waitUntil(() => session.busyReason() === null, Number(args['timeout'] ?? 60), 'the editor to be idle');
        await waitSeconds(0.1);
        return;
      default:
        throw new Error(`showreel: the editor knows no action ${name}`);
    }
  }
}
