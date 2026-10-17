/**
 * The path mask of the editor's view (roads, river banks and road covers in
 * the ground) kept by the editor's worker (EditorCore, job `pathMask`,
 * workers/path-mask-job.ts): the view paints it once with the map and says
 * so (`built`); after that, whenever it laid new roads or water (`changed`),
 * the worker paints what changed and the view writes those texels into its
 * texture and uploads them alone.
 *
 * The covers (where a paved road hides the ground) are the view's, laid with
 * its road surface: each job brings the ones that came, changed (a new line)
 * or went since the last.
 */
import type { RoadCover } from '../../world/custom-map/render/paths/path-mask';
import type { CoverPatch, PathMaskRect } from '../workers/path-mask-job';
import type { EditorCore } from './editor-core';

/** What the service needs of the view */
export interface PathMaskView {
  /** Where the view's road surface hides the ground, as laid now */
  roadCovers(): readonly RoadCover[];
  /** Writes texels the worker painted into the view's mask; false when they are of another mask */
  setPathMask(rect: PathMaskRect): boolean;
}

export class EditorPathMask {
  private view: PathMaskView | null = null;
  /** Counts the masks the views built: texels for an older one are dropped */
  private generation = 0;
  /** The covers as sent last, by id */
  private sent = new Map<string, { line: readonly unknown[]; half: number }>();

  constructor(private readonly core: EditorCore) {}

  /** The view painted its mask from the map as it is now: the worker paints it too and keeps it from here */
  built(view: PathMaskView): void {
    this.view = view;
    this.generation++;
    this.sent.clear();
    this.send(true);
  }

  /** The view laid new roads or water: the texels that changed come from the worker */
  changed(): void {
    if (this.view) this.send(false);
  }

  /** The view went */
  detach(): void {
    this.view = null;
  }

  private send(prime: boolean): void {
    const view = this.view!;
    // No map open (a view finishing its ground after the map closed)
    if (!this.core.versions) return;
    const generation = this.generation;
    void this.core.run('pathMask', { generation, prime, covers: this.covers(view.roadCovers()) }).then(
      (found) => {
        const rect = found?.value;
        if (rect && rect.generation === this.generation && this.view === view) view.setPathMask(rect);
      },
      (e: unknown) => console.warn('[Editor] path mask not painted:', e),
    );
  }

  /** The covers against those sent last */
  private covers(now: readonly RoadCover[]): CoverPatch {
    if (!this.sent.size) {
      for (const c of now) this.sent.set(c.id, { line: c.line, half: c.half });
      return { whole: [...now] };
    }
    const set: RoadCover[] = [];
    const seen = new Set<string>();
    for (const c of now) {
      seen.add(c.id);
      const was = this.sent.get(c.id);
      if (was && was.line === c.line && was.half === c.half) continue;
      set.push(c);
      this.sent.set(c.id, { line: c.line, half: c.half });
    }
    const drop: string[] = [];
    for (const id of this.sent.keys()) if (!seen.has(id)) drop.push(id);
    for (const id of drop) this.sent.delete(id);
    return { ...(set.length ? { set } : {}), ...(drop.length ? { drop } : {}) };
  }
}
