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
import { waterLevelAt } from '../world/custom-map/water-level';
import { DEFAULT_CELL_SIZE } from '../world/custom-map/map-create';
import type { TerrainPreset } from '../editor/ops/generate';
import { packMapFile, unpackMapFile, MAP_FILE_EXTENSION } from '../world/custom-map/map-file';
import type { MapEnvironment } from '../world/custom-map/map-document';
import { poseToOrbit, type CameraPose, type MapPoint3 } from './camera-path';
import { CAMERA_FLOOR_M, flooredHeight } from './camera-floor';
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
  cameraFloor = CAMERA_FLOOR_M;
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

  waterAt(x: number, y: number): number | null {
    const t = this.session.doc?.terrain;
    return t ? waterLevelAt(t, x, y, this.groundAt(x, y)) : null;
  }

  surfaceAt(x: number, y: number): number {
    const ground = this.groundAt(x, y);
    return Math.max(ground, this.waterAt(x, y) ?? ground);
  }

  rendererState(): string | null {
    const info = this.viewport?.renderer.info;
    return info ? `${info.programs?.length ?? 0}:${info.memory.geometries}:${info.memory.textures}` : null;
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
    // Negative indices count from the end: node:-1 is the newest road node
    const pick = <T>(list: readonly T[], i: number): T | undefined => list[i < 0 ? list.length + i : i];
    const node = /^node:(-?\d+)$/.exec(name);
    if (node) return pick(doc.paths.nodes, Number(node[1])) ?? null;
    const river = /^river:(-?\d+):(-?\d+)$/.exec(name);
    if (river) {
      const r = pick(doc.terrain.rivers ?? [], Number(river[1]));
      return (r && pick(r.points, Number(river[2]))) ?? null;
    }
    // runner:<i> a runner of the trial wave, where it walks now (follow it with the director's follow step)
    const runner = /^runner:(\d+)$/.exec(name);
    if (runner) {
      const trial = (this.viewport as unknown as { trial?: { runners: { model: { position: { x: number; z: number } } }[] } } | null)?.trial;
      const r = trial?.runners[Number(runner[1])];
      return r ? { x: -r.model.position.x, y: r.model.position.z } : null;
    }
    // object:<asset> the newest object of an asset, object:last the newest of all
    const object = /^object:(.+)$/.exec(name);
    if (object) {
      const list = object[1] === 'last' ? doc.objects : doc.objects.filter((o) => o.asset === object[1]);
      return pick(list, -1) ?? null;
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

  /** The pose with its eye over the camera floor (the ground there plus cameraFloor, any water surface) */
  private floored(pose: CameraPose): CameraPose {
    const ground = this.groundAt(pose.eye.x, pose.eye.y);
    const h = Number.isNaN(pose.eye.h) ? ground : pose.eye.h;
    return { eye: { ...pose.eye, h: flooredHeight(h, ground, this.waterAt(pose.eye.x, pose.eye.y), this.cameraFloor) }, look: pose.look };
  }

  private applyPose(camera: PerspectiveCamera): void {
    const pose = this.floored(this.posed!);
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

  canvas(): HTMLCanvasElement | null {
    return this.viewport?.canvas ?? null;
  }

  toScreen(p: MapPoint3): ScreenPoint | null {
    const viewport = this.viewport;
    if (!viewport) return null;
    return viewport.ctx.toScreen(p.x, p.y, this.ground(p));
  }

  /**
   * A take's start: a `.3dtdmap` (base64) stored as an own map, its environment patched first (so the map opens
   * in the scene's light, with no step of the scene's history for it); returns its id for `/editor?map=<id>`
   */
  async importMap(base64: string, environment?: Partial<MapEnvironment>): Promise<string> {
    const loaded = unpackMapFile(Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)));
    if (environment) loaded.doc.environment = { ...loaded.doc.environment, ...environment };
    return (await this.session.store.importDocument(loaded)).doc.meta.id;
  }

  /**
   * A new own map as the editor's New map form makes it (`size` metres square or [width, depth], `ground` a
   * generator preset, `material` the base material's id); returns its id. A fixture chain's first state
   */
  async newMap(options: { name: string; size?: number | [number, number]; ground?: string; material?: string; seed?: number; strength?: number }): Promise<string> {
    const [width, depth] = Array.isArray(options.size) ? options.size : [options.size ?? 1024, options.size ?? 1024];
    return this.session.createNew(
      { name: options.name, width, depth, cellSize: DEFAULT_CELL_SIZE, ground: 'flat', baseMaterial: options.material },
      { preset: (options.ground ?? 'flat') as TerrainPreset, seed: options.seed ?? 1, strength: options.strength ?? 0.5 },
    );
  }

  /** One call of the editor's agent (docs/AGENT_MCP.md): `run_script` plays MapKit commands on the open map */
  agent(tool: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
    const agent = (this.session as unknown as { agent: { handle(call: { tool: string; args: Record<string, unknown> }): Promise<{ text: string; isError?: boolean }> } }).agent;
    return agent.handle({ tool, args });
  }

  /** The open map as a `.3dtdmap` file, base64, and the file name it would download under */
  mapFile(): { name: string; base64: string } {
    const doc = this.session.doc;
    if (!doc) throw new Error('showreel: no map open');
    const bytes = packMapFile(doc);
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: `${doc.meta.id}${MAP_FILE_EXTENSION}`, base64: btoa(text) };
  }

  /** What a take's start can be checked against: the map's environment, the editor's frame and overlay */
  state(): Record<string, unknown> {
    return {
      environment: this.session.doc?.environment ?? null,
      ui: !document.documentElement.classList.contains('sr-clean'),
      markers: this.viewport?.overlay.group.visible ?? null,
      busy: this.session.busyReason(),
    };
  }

  async act(name: string, args: Record<string, unknown>): Promise<void> {
    const session = this.session;
    switch (name) {
      case 'ui':
        // Without header, tool column, side column, status bar and minimap the view fills the window
        document.documentElement.classList.toggle('sr-clean', args['on'] === false);
        await waitSeconds(0.1);
        return;
      case 'overlay': {
        // The map's own markers (spawn flags, road nodes, HQ, brush ring) out of the picture, as for a chase
        const viewport = this.viewport;
        if (viewport) viewport.overlay.group.visible = args['on'] !== false;
        return;
      }
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
      case 'history': {
        // Through the history a step at a time, as clicking down the History list: to step `to` (0 the map as
        // opened), or with `to: 'end'` forward to the newest
        const editor = (session as unknown as { editor: { historySteps: number; history: { done: string[]; undone: string[] } } | null }).editor;
        if (!editor) return;
        const total = editor.history.done.length + editor.history.undone.length;
        const goal = args['to'] === 'end' ? total : Number(args['to'] ?? 0);
        const stepS = Number(args['stepS'] ?? 0.12);
        while (editor.historySteps !== goal) {
          session.jumpTo(editor.historySteps + (goal > editor.historySteps ? 1 : -1));
          await waitSeconds(stepS);
        }
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
