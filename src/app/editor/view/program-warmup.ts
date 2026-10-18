/**
 * Builds the shader programs the editor will draw before it draws them: a
 * program linked in the frame that first needs it costs that frame up to
 * seconds. The map's programs before the view shows, then in idle moments
 * the top-down picture's and the variants a first stroke switches to; the
 * overlay's at once; a biome's or an asset's before they are placed, and a
 * new ground material's before it replaces the old.
 */
import { Group, SRGBColorSpace, WebGLRenderTarget, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { firstUsePrograms, programsReady } from '../../three-engine/programs-ready';
import { idle } from './idle';
import type { EditorMapView } from './map-view';

export class ProgramWarmup {
  /** Set once the viewport is gone: late promises must not reach the page */
  private disposed = false;
  /** Assets whose programs were compiled ahead, or are being: settles when they are built */
  private readonly warmed = new Map<string, Promise<void>>();
  /**
   * The view whose ground is in and programs built (view): frames draw only
   * then, so a map opening shows the page's "Preparing the view" and a
   * rebuilt view the last frame, not the terrain's green stand-in ground
   */
  private shownView: EditorMapView | null = null;
  /**
   * Settles once the top-down picture's programs are built: a picture
   * before would link them all in one frame (1.2 s at the editor's start)
   */
  private topDownWarm: Promise<void> = Promise.resolve();
  /** Stands in for the top-down picture's target when compiling its programs ahead (sRGB, any size) */
  private readonly topDownProbe = new WebGLRenderTarget(1, 1, { colorSpace: SRGBColorSpace });

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    /** The map view now (a rebuild replaces it) */
    private readonly current: () => EditorMapView,
  ) {}

  /** Whether `view`'s programs are built: it draws */
  shows(view: EditorMapView): boolean {
    return this.shownView === view;
  }

  /** Resolves once the top-down picture's programs are built */
  get topDownReady(): Promise<void> {
    return this.topDownWarm;
  }

  /** Whether the viewport went */
  get gone(): boolean {
    return this.disposed;
  }

  /**
   * Compiles the map's programs, then calls `ready` (the page says the view
   * is ready). After that, in idle moments, what the editor will need next:
   * the top-down picture's programs (minimap, previews; a render target and
   * no fog make them programs of their own) and the terrain shader's
   * variants with more material layers, which a first stroke with a new
   * biome or material switches to. All of it off the main thread where the
   * driver allows (compileAsync); linked in the frame they cost seconds.
   */
  async view(ready: () => void): Promise<void> {
    const view = this.current();
    // A new view's materials are new, and with them their programs
    this.warmed.clear();
    const stale = () => this.disposed || view !== this.current();
    let topDownWarm!: () => void;
    this.topDownWarm = new Promise<void>((resolve) => (topDownWarm = resolve));
    try {
      await view.warmUp(this.renderer, this.scene, this.camera);
      if (stale()) return;
      this.shownView = view;
      ready();
      await idle(2000);
      if (stale()) return;
      await this.compileForViews(this.scene, false);
      topDownWarm();
      await idle(2000);
      if (stale()) return;
      const twins = [...view.terrainLayerTwins(), ...view.effectTwins()];
      if (twins.length) {
        const group = new Group();
        for (const t of twins) group.add(t);
        await this.compileForViews(group);
      }
      // What was compiled ahead does its first-use work now, not in the frame of a click that first draws it
      await firstUsePrograms(this.renderer, stale);
    } catch {
      // A view replaced or lost while compiling; a view still current draws as it is
      if (!stale()) this.shownView = view;
    } finally {
      topDownWarm();
    }
  }

  /**
   * Compiles the overlay's programs (brush rings, handles, gizmo, lines)
   * before a tool first shows them: a first compile stalled the frame of a
   * tool switch by up to 70 ms on the GPU
   */
  async overlay(group: Group): Promise<void> {
    const hidden: { visible: boolean }[] = [];
    group.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    // compileAsync gathers the programs at once; the parts hide again before the next frame draws
    let done: Promise<unknown>;
    try {
      done = this.renderer.compileAsync(group, this.camera, this.scene);
    } finally {
      for (const o of hidden) o.visible = false;
    }
    await done.catch(() => undefined);
  }

  /** Compiles the programs of assets before they are placed, so the first stroke with them does not stall */
  assets(assetIds: string[]): void {
    void this.assetsReady(assetIds);
  }

  /**
   * Settles once the programs of these assets are built (compiling those not
   * asked for yet): the map view waits for it before it shows an asset new to
   * the map, whoever placed it (a stroke, the agent, a paste), instead of
   * linking its programs in the frame (90 ms each, five or six for a biome)
   */
  assetsReady(assetIds: string[]): Promise<void> {
    const fresh = [...new Set(assetIds)].filter((id) => !this.warmed.has(id));
    if (fresh.length) {
      const view = this.current();
      const done = view
        .warmUpAssets(this.renderer, this.scene, this.camera, fresh, (o) => this.compileForViews(o))
        .then(() => firstUsePrograms(this.renderer, () => this.disposed || view !== this.current()))
        .catch(() => undefined);
      for (const id of fresh) this.warmed.set(id, done);
    }
    return Promise.all(assetIds.map((id) => this.warmed.get(id))).then(() => undefined);
  }

  /**
   * Builds the programs of `meshes` for every picture before they draw (new
   * ground materials, MapTerrainLayer.prepare), with their first-use work
   */
  async prepare(meshes: Mesh[]): Promise<void> {
    const view = this.current();
    const group = new Group();
    for (const m of meshes) group.add(m);
    await this.compileForViews(group).catch(() => undefined);
    await firstUsePrograms(this.renderer, () => this.disposed || view !== this.current());
  }

  dispose(): void {
    this.disposed = true;
    this.topDownProbe.dispose();
  }

  /**
   * Compiles `object`'s programs for the pictures the editor draws: the view
   * and the top-down picture, whose render target, missing fog and hidden
   * effects (their point lights with them) give other programs. The view's
   * twice: with the map's point lights as they are (`screen`) and in the
   * other state, as a night (or a first lamp after dark) changes their
   * number and every lit material links new programs in that frame (3.9 s
   * in the showreel review). compileAsync builds them before it returns its
   * promise, so target, fog and lights change only around the call.
   */
  private compileForViews(object: Object3D, screen = true): Promise<unknown> {
    const r = this.renderer;
    const view = this.current();
    const jobs: Promise<unknown>[] = [];
    view.withEitherLights((current) => {
      if (screen || !current) jobs.push(r.compileAsync(object, this.camera, this.scene));
      // The water's mirror draws into a linear target: programs of their own (a new ground layer linked them there)
      const mirror = screen ? view.compileForMirror(r, object, this.camera, this.scene) : null;
      if (mirror) jobs.push(mirror);
    });
    const fog = this.scene.fog;
    const previous = r.getRenderTarget();
    try {
      this.scene.fog = null;
      view.setParticlesVisible(false);
      r.setRenderTarget(this.topDownProbe);
      jobs.push(r.compileAsync(object, this.camera, this.scene));
    } finally {
      r.setRenderTarget(previous);
      view.setParticlesVisible(true);
      this.scene.fog = fog;
    }
    // The view keeps drawing meanwhile, which makes compileAsync settle early (programsReady)
    return Promise.all(jobs).then(() => programsReady(r));
  }
}
