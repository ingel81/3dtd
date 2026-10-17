/**
 * The AI agent's way into the editor (desktop app, docs/AGENT_MCP.md): the
 * bridge's calls go to EditorAgent, which sees the editor only as an
 * AgentHost; this class is that host, made of the session's services. It
 * also carries the agent's switch, stop and status for the panel.
 */
import { signal, type NgZone } from '@angular/core';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { DEFAULT_CELL_SIZE } from '../../world/custom-map/map-create';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { MapIssue } from '../../map-ops/validation/map-validation';
import { readAgentBridge, type AgentStatus } from '../../core/desktop-bridge';
import type { EditCommand } from '../model/doc-change';
import type { EditorDocument } from '../model/editor-document';
import type { MapVersion } from '../model/version-store';
import type { SavedStamp, StampKeep } from '../model/stamp-store';
import type { Stamp, StampRect } from '../ops/stamp';
import { templateById } from '../ops/landscape/templates';
import { EditorAgent, type AgentHost, type AgentNewMap } from '../agent/editor-agent';
import { runScriptInSandbox } from '../agent/script-sandbox';
import type { CheckService } from './check-service';
import type { EditorNotices } from './editor-notices';
import type { EditorPictures } from './editor-pictures';
import type { EditorState } from './editor-state';
import type { JobRunner } from './job-runner';
import type { MapLibrary } from './map-library';
import type { MapLifecycle } from './map-lifecycle';
import type { SaveService } from './save-service';
import type { ViewHost } from './view-host';

/** What the adapter needs of the session besides its services */
export interface AgentSessionParts {
  zone: NgZone;
  notices: EditorNotices;
  library: MapLibrary;
  saves: SaveService;
  jobs: JobRunner;
  check: CheckService;
  state: EditorState;
  view: ViewHost;
  pictures: EditorPictures;
  maps: MapLifecycle;
  catalog(): CatalogIndex;
  catalogReady(): Promise<void>;
  busyReason(): string | null;
  execute(command: EditCommand): void;
  undo(): void;
  saveStamp(name: string, stamp: Stamp, region: StampRect | null, keep?: StampKeep): Promise<SavedStamp | null>;
}

export class AgentAdapter implements AgentHost {
  /** Whether AI agents may edit maps, who is connected and what it does; null in the web build */
  readonly status = signal<AgentStatus | null>(null);
  private readonly agent: EditorAgent;
  private readonly bridge = readAgentBridge();
  private readonly unlisten: (() => void)[] = [];

  constructor(private readonly s: AgentSessionParts) {
    this.agent = new EditorAgent(this, (source, doc, catalog, seed, signal) => runScriptInSandbox(source, doc, catalog.catalog, seed, { signal }));
    const bridge = this.bridge;
    if (!bridge) return;
    const zone = s.zone;
    this.unlisten.push(
      bridge.onCall((call, reply) => {
        void zone.run(() => this.agent.handle(call)).then(reply, (e: unknown) => reply({ text: String((e as Error)?.message ?? e), isError: true }));
      }),
    );
    const show = (status: AgentStatus | null) => status && zone.run(() => this.status.set(status));
    if (bridge.onStatus) this.unlisten.push(bridge.onStatus(show));
    else void bridge.status().then(show);
  }

  /** The editor's switch "AI agents": the MCP server on or off */
  async setEnabled(on: boolean): Promise<void> {
    const status = await this.bridge?.setEnabled(on);
    if (status) this.status.set(status);
  }

  /**
   * Stop in the agent band: what the agent runs now ends and the map goes
   * back to how it was before that call; its next calls are refused until
   * the player lets it go on
   */
  async stop(): Promise<void> {
    this.agent.stop();
    const status = await this.bridge?.stop?.();
    if (status) this.status.set(status);
    this.s.notices.flash('The agent is stopped; its calls are refused until you let it go on');
  }

  async resume(): Promise<void> {
    const status = await this.bridge?.resume?.();
    if (status) this.status.set(status);
  }

  dispose(): void {
    for (const u of this.unlisten) u();
  }

  // ------------------------------------------------------------------ AgentHost

  get editor(): EditorDocument | null {
    return this.s.maps.editor;
  }

  get store() {
    return this.s.library.store;
  }

  catalog(): CatalogIndex {
    return this.s.catalog();
  }

  busyReason(): string | null {
    return this.s.busyReason();
  }

  runCheck(): Promise<MapIssue[]> {
    return this.s.check.runCheck();
  }

  async checkIssues(doc?: CustomMapDocument): Promise<MapIssue[]> {
    // A check of the page's that took this one's place before it began: asked again
    for (;;) {
      const issues = await this.s.check.checkIssues(doc);
      if (issues) return issues;
    }
  }

  execute(command: EditCommand): void {
    this.s.execute(command);
  }

  undo(): void {
    this.s.undo();
  }

  refresh(): void {
    this.s.state.refresh();
  }

  agentEdit<T>(label: string, play: (editor: EditorDocument, signal: AbortSignal, progress: (share: number) => void) => Promise<T>): Promise<T> {
    return this.s.jobs.agentEdit(label, play);
  }

  erodeWholeMap(strength: number, seed: number, label: string): Promise<boolean> {
    return this.s.jobs.erodeWholeMap(strength, seed, label);
  }

  erodeCopy(g: { columns: number; rows: number; cellSize: number; heights: Float32Array }, strength: number, seed: number): Promise<Float32Array | null> {
    return this.s.jobs.erodeCopy(g, strength, seed);
  }

  cancelAgentJob(): void {
    this.s.jobs.cancelAgentJob();
  }

  /** The map changed its size or came back as another version: the view frames it */
  mapReshaped(): void {
    this.s.view.frameMap();
  }

  topDownPicture(size: number): Promise<string | null> {
    return this.s.pictures.topDownPicture(size);
  }

  flash(message: string): void {
    this.s.notices.flash(message);
  }

  /** Opens a map as the player would; resolves the id that opened */
  async openMap(id: string): Promise<string> {
    try {
      return await this.s.maps.switchTo(id);
    } catch (e) {
      throw new Error(`The map did not open: ${(e as Error).message}`, { cause: e });
    }
  }

  /** A new own map with a template or a generator, opened in the editor */
  async createMap(options: AgentNewMap): Promise<string> {
    const s = this.s;
    if (s.maps.editor && !(await s.maps.close())) throw new Error('The open map could not be saved, so it stays open');
    await s.catalogReady();
    const id = await s.maps.createNew(
      { name: options.name, width: options.width, depth: options.depth, cellSize: DEFAULT_CELL_SIZE, ground: 'flat', baseMaterial: s.catalog().materials.has('grass') ? 'grass' : undefined },
      { preset: options.preset ?? 'flat', seed: options.seed, strength: options.strength },
      options.template ? templateById(options.template) : undefined,
    );
    return this.openMap(id);
  }

  /** Saves and goes back to the map list as the player would; false when the map could not be saved */
  closeMap(): Promise<boolean> {
    return this.s.maps.close();
  }

  save(manual: boolean): Promise<boolean> {
    return this.s.saves.save(manual);
  }

  versions(): MapVersion[] {
    return this.s.saves.versions();
  }

  versionDoc(version: MapVersion): Promise<CustomMapDocument> {
    return this.s.saves.versionDoc(version);
  }

  savedStamps(): Promise<SavedStamp[]> {
    return this.s.library.stamps.list();
  }

  saveStamp(name: string, stamp: Stamp, region: StampRect | null, keep?: StampKeep): Promise<SavedStamp | null> {
    return this.s.saveStamp(name, stamp, region, keep);
  }
}
