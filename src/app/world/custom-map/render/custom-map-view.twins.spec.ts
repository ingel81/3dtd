import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createMapDocument } from '../map-create';
import { CustomMapView } from './custom-map-view';
import { MapAssetLibrary } from './map-asset-library';

const catalog = JSON.parse(readFileSync('public/maps/assets/catalog.json', 'utf8')) as { objects: { id: string }[] };

function offlineLibrary(): MapAssetLibrary {
  return new MapAssetLibrary('maps/assets/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    decodeImage: () => Promise.reject(new Error('offline')),
    loadModel: () => Promise.reject(new Error('offline')),
    textureSize: 4,
  });
}

describe('effect stand-ins', () => {
  it('stand in for every water kind, lava with its shimmer, particles and halos, built once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = createMapDocument({ id: 'm', name: 'M', width: 100, depth: 100, cellSize: 2 });
    const view = new CustomMapView(doc, offlineLibrary(), { grass: false, effects: { lavaGlow: true } });
    await view.ready;
    const twins = view.effectTwins();
    const names = twins.map((m) => (m.material as { name: string }).name);
    for (const kind of ['water', 'sea', 'swamp', 'ice', 'lava']) expect(names).toContain(`custom-map-water-${kind}`);
    expect(names.filter((n) => n === 'custom-map-water-lava')).toHaveLength(2);
    expect(names).toContain('custom-map-particles-smoke');
    expect(names).toContain('custom-map-glows');
    const lava = twins.find((m) => (m.material as { name: string }).name === 'custom-map-water-lava')!;
    expect(lava.children.map((c) => c.name)).toContain('custom-map-heat-haze');
    expect(view.effectTwins()).toBe(twins);
    view.dispose();
  });
});
