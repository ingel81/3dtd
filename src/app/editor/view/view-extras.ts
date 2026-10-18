/**
 * What the view shows or plays besides the map being edited: the trial
 * wave, the map's ambient sound, the intro flight and the game's start
 * view. Each part keeps its own state; the viewport drives them per frame.
 */
import { Color, Vector3, type PerspectiveCamera } from 'three';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import type { MapIntro } from '../../world/custom-map/map-document';
import { emptyPose, introPoseAt } from '../../world/custom-map/map-intro';
import { Soundscape } from '../../world/custom-map/ambience/soundscape';
import type { Lightning, LightningStrike } from '../../world/custom-map/render/environment/lightning';
import type { Route } from '../../map-ops/path-graph';
import type { EditorDocument } from '../model/editor-document';
import type { CameraController, OrbitState } from './camera-controller';
import { mapToScene } from './map-view';
import { TRIAL_TYPES, TrialRunners } from './trial-runners';

/** The editor's level of the map's ambient sound (it has no volume setting of its own) */
const AMBIENCE_VOLUME = 0.8;
/** The editor camera's field of view, degrees */
export const EDITOR_FOV = 50;
/**
 * The game's start view (three-engine/camera-rig.ts applyStartPosition):
 * over the HQ from the south, 400 m up and 145 m back, about 70 degrees
 * down, with the game camera's 60 degree field of view
 */
const GAME_VIEW = { height: 400, back: 145, fov: 60 };

type Height = (x: number, y: number) => number;

export interface ExtrasHost {
  readonly editor: EditorDocument;
  readonly camera: PerspectiveCamera;
  readonly controller: CameraController;
  heightAt: Height;
  /** The water's surface where water lies, else the ground */
  surfaceAt: Height;
  /** Where an enemy walks: a bridge deck, else the ground */
  walkHeightAt: Height;
  /** How dark the map's sky is now (0 day, 1 night) */
  darkness(): number;
  /** The view's lightning, whose strikes the map's sound answers with thunder */
  lightning(): Lightning;
  status(message: string): void;
}

/**
 * The trial wave: the enemies of the map's first wave (or a mix of speeds)
 * walk every spawn's route at their real speed
 */
export class TrialWave {
  readonly runners: TrialRunners;

  constructor(private readonly host: ExtrasHost) {
    this.runners = new TrialRunners(host.walkHeightAt);
  }

  /** Whether the trial wave walks */
  get running(): boolean {
    return this.runners.active;
  }

  /** How much faster than real time the trial wave walks (1, 2, 4, 8); changes a running wave at once */
  get speed(): number {
    return this.runners.speed;
  }

  set speed(speed: number) {
    this.runners.speed = speed;
  }

  /** Starts it on the spawns' routes (EditorRoutes, found in the editor's worker), or stops it */
  toggle(found: ReadonlyMap<string, Route | null>): void {
    const { editor, status } = this.host;
    if (this.runners.active) {
      this.runners.stop();
      status('Trial wave stopped');
      return;
    }
    const doc = editor.doc;
    // Each route's runners in the colour of its spawn, as on the minimap
    const routes = doc.spawns.flatMap((sp, k) => {
      const r = found.get(sp.id);
      return r ? [{ ...r, color: '#' + new Color(SPAWN_COLORS[k % SPAWN_COLORS.length]).getHexString() }] : [];
    });
    if (!routes.length) {
      status('No spawn reaches the HQ: draw a road first');
      return;
    }
    const waves = doc.gameplay?.waves;
    const first = waves?.kind === 'table' ? waves.table.waves[0] : undefined;
    const types = this.runners.start(routes, first ? Object.keys(first.enemies) : TRIAL_TYPES);
    const t = TrialRunners.timing(routes, types);
    status(
      `Trial wave: ${types.map((x) => x.name).join(', ')} on ${routes.length} ${routes.length === 1 ? 'route' : 'routes'}; ` +
        `the HQ in ${Math.round(t.fastest)} to ${Math.round(t.slowest)} s (P stops, + and - change the speed)`,
    );
  }
}

/** The map's ambient sound (soundscape.ts) heard from where the view looks, in an audio context of the editor's own */
export class MapSound {
  private ambience: { sound: Soundscape; context: AudioContext } | null = null;
  private readonly right = new Vector3();
  private readonly thunder = (strike: Readonly<LightningStrike>): void => this.ambience?.sound.thunder(strike);

  constructor(private readonly host: ExtrasHost) {}

  /** On or off. Call it from a click: a browser starts audio only after the person did something on the page */
  set(on: boolean): void {
    if (!on) {
      this.ambience?.sound.dispose();
      void this.ambience?.context.close();
      this.ambience = null;
      return;
    }
    if (this.ambience) return;
    const context = new AudioContext();
    const sound = new Soundscape({ context, destination: context.destination });
    sound.setMap(this.host.editor.doc);
    sound.setVolume(AMBIENCE_VOLUME);
    this.ambience = { sound, context };
  }

  /** The map's wave sound once, as at a wave's start; turns the sound on (from a click) */
  playWave(): void {
    this.set(true);
    void this.ambience?.sound.playWave();
  }

  /** The map's life or environment changed: the sound areas and the bed follow */
  mapChanged(): void {
    this.ambience?.sound.setMap(this.host.editor.doc);
  }

  /** The soundscape heard from the ground the view orbits */
  update(dt: number): void {
    const a = this.ambience;
    if (!a) return;
    // The view's lightning (a new view brings a new one) answered with thunder
    const lightning = this.host.lightning();
    if (lightning.onStrike !== this.thunder) lightning.onStrike = this.thunder;
    const { camera, controller, heightAt } = this.host;
    const target = controller.current.target;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    const len = Math.hypot(this.right.x, this.right.z) || 1;
    a.sound.update(dt, {
      at: { x: -target.x, y: target.z },
      height: camera.position.y - heightAt(-target.x, target.z),
      right: { x: -this.right.x / len, y: this.right.z / len },
      darkness: this.host.darkness(),
    });
  }

  dispose(): void {
    this.set(false);
  }
}

/**
 * The map's intro flight played in the view as the game does (without the
 * game's swing in and out); the view goes back as it was after
 */
export class IntroPreview {
  /** Until it ends or a click or the wheel stops it */
  private playing: { intro: MapIntro; t: number; hq: { x: number; y: number; h: number }; done: () => void } | null = null;
  private readonly pose = emptyPose();

  constructor(private readonly host: ExtrasHost) {}

  /** Plays `intro`; `done` when it ends or is stopped */
  start(intro: MapIntro, done: () => void): void {
    this.stop();
    const hq = this.host.editor.doc.hq;
    this.playing = { intro, t: 0, hq: { x: hq.x, y: hq.y, h: this.host.heightAt(hq.x, hq.y) }, done };
  }

  /** Stops it; true when it was playing */
  stop(): boolean {
    const p = this.playing;
    this.playing = null;
    p?.done();
    return !!p;
  }

  /** One frame of the flight; false when none plays (the controller has the camera) */
  frame(dt: number): boolean {
    const p = this.playing;
    if (!p) return false;
    p.t += dt;
    if (p.t > p.intro.seconds) {
      this.stop();
      return false;
    }
    const pose = introPoseAt(p.intro, p.hq, p.t, this.pose);
    const camera = this.host.camera;
    // As the game keeps it (CustomMapWorld.introShot): never under the ground or the water
    const floor = this.host.surfaceAt(pose.x, pose.y) + 3;
    camera.position.set(-pose.x, Math.max(floor, pose.h), pose.y);
    camera.up.set(0, 1, 0);
    camera.lookAt(-pose.lookX, pose.lookH, pose.lookY);
    camera.near = 0.5;
    camera.far = 20000;
    camera.updateProjectionMatrix();
    return true;
  }
}

/** The game's start view over the HQ, and back to the view before */
export class GameView {
  /** The view before the game camera took over, to go back to */
  private before: OrbitState | null = null;

  constructor(private readonly host: ExtrasHost) {}

  /** Whether the view shows what the game shows at the start */
  get on(): boolean {
    return this.before !== null;
  }

  toggle(): void {
    const { controller: c, editor, heightAt, status } = this.host;
    if (this.before) {
      c.setGoal(this.before);
      this.before = null;
      this.setFov(EDITOR_FOV);
      status('Editor view');
      return;
    }
    this.before = c.saveGoal();
    const hq = editor.doc.hq;
    c.setGoal({
      target: mapToScene(hq.x, hq.y, heightAt(hq.x, hq.y)),
      distance: Math.hypot(GAME_VIEW.height, GAME_VIEW.back),
      yaw: 0,
      pitch: Math.atan2(GAME_VIEW.height, GAME_VIEW.back),
    });
    this.setFov(GAME_VIEW.fov);
    status('Game view: where the game starts (C goes back)');
  }

  private setFov(fov: number): void {
    this.host.camera.fov = fov;
    this.host.camera.updateProjectionMatrix();
  }
}

export class ViewExtras {
  readonly trial: TrialWave;
  readonly sound: MapSound;
  readonly intro: IntroPreview;
  readonly gameView: GameView;

  constructor(host: ExtrasHost) {
    this.trial = new TrialWave(host);
    this.sound = new MapSound(host);
    this.intro = new IntroPreview(host);
    this.gameView = new GameView(host);
  }

  /** Once a frame after the camera moved */
  update(dt: number): void {
    this.sound.update(dt);
    this.trial.runners.update(dt);
  }

  dispose(): void {
    this.sound.dispose();
    this.trial.runners.dispose();
  }
}
