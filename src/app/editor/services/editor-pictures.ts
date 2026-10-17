/**
 * Pictures the editor shows or keeps: the palettes' pictures of objects,
 * materials and biomes (a small renderer of their own, one picture per idle
 * moment, a drawn symbol until it is ready), and the map from above for the
 * list, a stamp, the download and the AI agent.
 */
import { signal, type NgZone } from '@angular/core';
import type { CatalogIndex, GroundMaterialEntry, ObjectAssetEntry } from '../../map-ops/asset-catalog';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { downloadBlob } from '../../utils/download';
import type { BiomeDef } from '../ops/landscape/biomes';
import type { StampRect } from '../ops/stamp';
import { shadeRelief } from '../agent/relief-shade';
import { ThumbnailRenderer } from '../view/thumbnail-renderer';
import { biomeThumbnail, materialThumbnail, objectThumbnail } from '../view/thumbnails';
import type { ViewHost } from './view-host';

/** Side of the list's picture of a map */
const THUMBNAIL_SIZE = 256;

export class EditorPictures {
  /** Bumps when a rendered palette picture is ready */
  readonly thumbRev = signal(0);
  private renderer: ThumbnailRenderer | null = null;

  constructor(
    private readonly zone: NgZone,
    private readonly view: ViewHost,
    private readonly catalog: () => CatalogIndex,
    private readonly doc: () => CustomMapDocument | null,
  ) {}

  /** Picture of an object for the palette: rendered when ready, a drawn symbol until then */
  objectPicture(entry: ObjectAssetEntry): string {
    this.thumbRev();
    return this.thumbs.object(entry) ?? objectThumbnail(entry);
  }

  materialPicture(entry: GroundMaterialEntry): string {
    this.thumbRev();
    return this.thumbs.material(entry) ?? materialThumbnail(entry);
  }

  biomePicture(biome: BiomeDef): string {
    this.thumbRev();
    const catalog = this.catalog();
    if (!catalog.catalog.objects.length) return biomeThumbnail(biome, catalog);
    return this.thumbs.biome(biome, catalog) ?? biomeThumbnail(biome, catalog);
  }

  /** The palettes' GPU context goes with the view (the game needs the room); it comes back with the next picture */
  release(): void {
    this.renderer?.release();
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** The list's picture of the map as PNG, null without a view */
  async thumbnail(): Promise<Uint8Array | null> {
    if (!this.view.shown) return null;
    try {
      const canvas = await this.view.renderTopDown(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  /** A stamp's picture of its rectangle, 96 px on its longer side; null without a view */
  async stampPicture(region: StampRect): Promise<string | null> {
    if (!this.view.shown) return null;
    const w = Math.abs(region.x1 - region.x0);
    const h = Math.abs(region.y1 - region.y0);
    const k = 96 / Math.max(w, h);
    try {
      return (await this.view.renderTopDown(Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k)), false, region)).toDataURL('image/png');
    } catch {
      return null;
    }
  }

  /** The AI agent's picture from above: roads, spawns and the HQ drawn over it, the relief shaded */
  async topDownPicture(size: number): Promise<string | null> {
    const doc = this.doc();
    if (!this.view.shown || !doc || this.view.viewLost()) return null;
    const canvas = await this.view.renderTopDown(size, size, true);
    const c2d = canvas.getContext('2d');
    if (c2d) {
      const image = c2d.getImageData(0, 0, canvas.width, canvas.height);
      shadeRelief(image.data, canvas.width, canvas.height, doc.terrain);
      c2d.putImageData(image, 0, 0);
    }
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /** A top-down picture of the map as a PNG download */
  async downloadPng(size = 2048): Promise<void> {
    const doc = this.doc();
    if (!this.view.shown || !doc) return;
    const aspect = doc.terrain.depth / doc.terrain.width;
    const w = aspect <= 1 ? size : Math.round(size / aspect);
    const h = aspect <= 1 ? Math.round(size * aspect) : size;
    const canvas = await this.view.renderTopDown(w, h, true);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) downloadBlob(blob, `${doc.meta.id}.png`);
  }

  private get thumbs(): ThumbnailRenderer {
    this.renderer ??= this.zone.runOutsideAngular(() => new ThumbnailRenderer(() => this.thumbRev.update((n) => n + 1)));
    return this.renderer;
  }
}
