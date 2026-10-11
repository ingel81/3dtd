import { GeometricErrorScalePlugin } from './geometric-error-scale-plugin';

describe('GeometricErrorScalePlugin', () => {
  it('liest den geometricError einer Kachel mit dem Faktor', () => {
    const tile = { geometricError: 0.25 };
    new GeometricErrorScalePlugin(20).preprocessNode(tile);
    expect(tile.geometricError).toBe(5);
  });

  it('lässt eine Kachel ohne Fehlerwert in Ruhe', () => {
    const tile: { geometricError?: number } = {};
    new GeometricErrorScalePlugin(20).preprocessNode(tile);
    expect(tile.geometricError).toBeUndefined();
  });
});
