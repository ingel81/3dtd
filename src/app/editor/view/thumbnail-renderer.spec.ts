import { DataTexture, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { ThumbnailRenderer } from './thumbnail-renderer';
import { texturesOf } from '../../three-engine/texture-upload';
import { settleContexts } from '../../three-engine/context-release';
import type { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';

describe('thumbnail renderer', () => {
  it('finds every texture of a picture once, for uploading one per idle moment', () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const normal = new DataTexture(new Uint8Array(4), 1, 1);
    const a = new MeshStandardMaterial({ map, normalMap: normal });
    const b = new MeshStandardMaterial({ map });
    const group = new Group();
    const inner = new Group();
    group.add(new Mesh(new PlaneGeometry(), a), inner);
    inner.add(new Mesh(new PlaneGeometry(), [a, b]));
    expect([...texturesOf(group)]).toEqual([map, normal]);
  });

  it('gives its GPU context back when the editor goes and keeps the pictures; a new one comes only when asked for', () => {
    const library = { clear: vi.fn() };
    const thumbs = new ThumbnailRenderer(() => undefined, library as unknown as MapAssetLibrary);
    const inside = thumbs as unknown as { renderer: unknown; pictures: Map<string, string>; queued: Set<string>; gl: unknown };
    const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn() };
    inside.renderer = renderer;
    inside.pictures.set('m:2:grass:#00ff00', 'data:kept');
    inside.queued.add('o:2:tree:');
    vi.useFakeTimers();
    thumbs.release();
    expect(renderer.dispose).toHaveBeenCalled();
    // Its models' textures went with the context (they keep no pixels past the upload): loaded again for the next
    expect(library.clear).toHaveBeenCalled();
    // Its context goes once the next view stands (context-release.ts)
    expect(renderer.forceContextLoss).not.toHaveBeenCalled();
    settleContexts();
    vi.runAllTimers();
    vi.useRealTimers();
    expect(renderer.forceContextLoss).toHaveBeenCalled();
    expect(inside.renderer).toBeNull();
    expect(inside.queued.size).toBe(0);
    // A draw that was under way makes no new context while the game runs
    expect(() => inside.gl).toThrow(/rest/);
    // Back in the editor: the kept picture shows at once
    expect(thumbs.material({ id: 'grass', color: '#00ff00' } as never)).toBe('data:kept');
    thumbs.dispose();
  });
});
