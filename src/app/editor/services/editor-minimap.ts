/**
 * The minimap's marks (roads, spawns, HQ) as a bitmap, drawn in the
 * editor's worker (EditorCore, job `minimap`, workers/minimap-job.ts)
 * whenever the roads, the markers or the map's size changed, at most as
 * often as the panels follow the map (EditorState). The minimap draws the
 * bitmap over its picture; the camera's frame stays its own.
 */
import { signal } from '@angular/core';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import type { PartVersions } from '../model/doc-mirror';
import type { DocPart } from '../model/doc-change';
import type { EditorCore } from './editor-core';

/** What the marks are drawn from, apart from the map's size */
const MARK_PARTS: readonly DocPart[] = ['paths', 'markers'];

export class EditorMinimap {
  /** The open map's marks; null before the first came */
  readonly marks = signal<ImageBitmap | null>(null);
  /** The parts' versions and the map's size the newest job asked for was sent with */
  private asked: Readonly<PartVersions> | null = null;
  private size = '';
  /** Counts the maps opened: marks of the map before are dropped */
  private map = 0;
  private disposed = false;

  constructor(
    private readonly core: EditorCore,
    private readonly doc: () => CustomMapDocument | null,
  ) {}

  /** Another map is open: its marks are drawn anew */
  opened(): void {
    this.asked = null;
    this.map++;
    this.show(null);
    this.changed();
  }

  /** The map changed: the marks follow when the roads, the markers or the size did */
  changed(): void {
    const now = this.core.versions;
    const t = this.doc()?.terrain;
    if (!now || !t || this.disposed) return;
    const size = `${t.width}x${t.depth}`;
    if (this.asked && size === this.size && this.core.current(this.asked, MARK_PARTS)) return;
    this.asked = { ...now };
    this.size = size;
    const map = this.map;
    void this.core.run('minimap', {}).then(
      (drawn) => {
        // A newer job took its place; or another map opened meanwhile
        if (!drawn) return;
        if (this.disposed || map !== this.map) drawn.value?.close();
        else this.show(drawn.value);
      },
      (e: unknown) => console.warn('[Editor] minimap marks not drawn:', e),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.show(null);
  }

  /** The bitmap before is let go: the minimap draws only the newest */
  private show(bitmap: ImageBitmap | null): void {
    const before = this.marks();
    this.marks.set(bitmap);
    before?.close();
  }
}
