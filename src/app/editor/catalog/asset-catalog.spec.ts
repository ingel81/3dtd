import { CatalogIndex, normalizeCatalog } from './asset-catalog';

describe('asset catalogue', () => {
  it('reads the renderer catalogue format', () => {
    const c = normalizeCatalog(
      {
        materials: [{ id: 'grass', name: 'Gras', average: '#606d30', files: { color: 'materials/grass/color.jpg' } }],
        objects: [
          { id: 'tree-fir', name: 'Tanne', category: 'tree', footprint: 2.5, height: 14, file: 'models/fir.glb', blocksLos: true, blocksBuild: true },
          { id: 'lamp-post', category: 'prop' },
          { id: 'bridge-deck', category: 'prop' },
        ],
      },
      'http://x/game/maps/assets/',
    );
    expect(c.materials[0]).toMatchObject({ id: 'grass', color: '#606d30', thumbnail: 'http://x/game/maps/assets/materials/grass/color.jpg' });
    expect(c.objects[0]).toMatchObject({ category: 'Trees', shape: 'pine', radius: 2.5, height: 14, model: 'http://x/game/maps/assets/models/fir.glb' });
    expect(c.objects[1]).toMatchObject({ name: 'lamp-post', category: 'Props', shape: 'crate', blocksBuild: true });
    expect(new CatalogIndex(c).categories()).toEqual(['Trees', 'Props']);
    expect(c.objects[2].internal).toBe(true);
  });

  it('keeps the tags and offers the biomes in palette order', () => {
    const c = normalizeCatalog(
      {
        materials: [{ id: 'ash', tags: ['wasteland', 'volcanic'] }],
        objects: [
          { id: 'reeds', category: 'plant', tags: ['swamp', 'shore', 'temperate'] },
          { id: 'fx-smoke', category: 'fx', file: '' },
          { id: 'pier', category: 'structure', tags: ['coast'] },
        ],
      },
      'http://x/',
    );
    expect(c.objects[0].tags).toEqual(['swamp', 'shore', 'temperate']);
    expect(c.objects[1]).toMatchObject({ category: 'Effects', model: undefined });
    expect(c.objects[2].category).toBe('Structures');
    // Brush roles like shore are no biomes
    expect(new CatalogIndex(c).biomes()).toEqual(['temperate', 'coast', 'swamp', 'volcanic', 'wasteland']);
  });

  it('answers for ids it does not know', () => {
    const index = new CatalogIndex({ materials: [], objects: [] });
    expect(index.material('lava').name).toBe('lava');
    expect(index.object('ufo').radius).toBeGreaterThan(0);
  });
});
