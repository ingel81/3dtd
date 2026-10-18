import { Vector3 } from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { CELL_HEIGHT, layoutSignCells, MAX_SIGNS, signInk, signKey, signQuads, signText, SignLayer } from './sign-text';
import { isSignIcon, SIGN_ICONS } from './sign-icons';

const board: CatalogObject = {
  id: 'board',
  name: 'Board',
  category: 'prop',
  file: 'b.glb',
  footprint: 1,
  height: 1,
  blocksLos: false,
  blocksBuild: false,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 500,
  aloft: true,
  signPanel: { at: [0, 0.3, 0.05], width: 2.4, height: 0.48 },
};
const hanging: CatalogObject = { ...board, id: 'hanging', signPanel: { at: [0.015, 0.6, 0.67], width: 0.42, height: 0.42, normal: [1, 0, 0], sides: 2, ink: '#d8b45e' } };
const plain: CatalogObject = { ...board, id: 'plain', signPanel: undefined };
const entries = new Map([board, hanging, plain].map((e) => [e.id, e]));
const flat = () => 10;
const dry = () => null;
const obj = (o: Partial<MapObject>): MapObject => ({ id: 'o', asset: 'board', x: 0, y: 0, z: 0, rotation: 0, scale: 1, ...o });

describe('sign text', () => {
  it('lays labels out in shelves as wide as their panels, the atlas a power of two high', () => {
    const labels = [
      { text: 'Bäckerei', icon: 'pretzel', aspect: 5 },
      { text: 'Apotheke', icon: 'cross', aspect: 5 },
      { text: '', icon: 'beer', aspect: 1 },
      { text: 'Supermarkt', icon: 'basket', aspect: 10.9 },
    ];
    const out = layoutSignCells(labels)!;
    expect(out.cells.map((c) => c.w)).toEqual([320, 320, 64, 698]);
    // The fourth does not fit beside the first three: a new shelf
    expect(out.cells[3]).toMatchObject({ x: 0, y: CELL_HEIGHT + 4 });
    expect(out.height).toBe(256);
    for (const c of out.cells) expect(c.x + c.w).toBeLessThanOrEqual(1024);
  });

  it('refuses more labels than the largest atlas holds', () => {
    const many = Array.from({ length: 200 }, (_, k) => ({ text: `Laden ${k}`, icon: '', aspect: 10 }));
    expect(layoutSignCells(many)).toBeNull();
  });

  it('writes a sign on its panel, in front of it and facing out of the model front', () => {
    const { quads, labels } = signQuads([obj({ x: 5, y: -2, sign: { text: 'Bäckerei', icon: 'pretzel' } })], entries, flat, dry);
    expect(quads).toHaveLength(1);
    expect([...labels.keys()]).toEqual([signKey('Bäckerei', 'pretzel', 5)]);
    const p = new Vector3().setFromMatrixPosition(quads[0].matrix);
    // Map (5, -2) is scene (-5, ., -2); the panel's middle 0.3 m up, 0.05 m and the lift in front (+z)
    expect(p.x).toBeCloseTo(-5);
    expect(p.y).toBeCloseTo(10.3);
    expect(p.z).toBeCloseTo(-2 + 0.056);
    const x = new Vector3().setFromMatrixColumn(quads[0].matrix, 0);
    const n = new Vector3().setFromMatrixColumn(quads[0].matrix, 2);
    expect(x.length()).toBeCloseTo(2.4);
    expect(n.z).toBeCloseTo(1);
  });

  it('turns and scales the panel with its object', () => {
    const { quads } = signQuads([obj({ rotation: Math.PI / 2, scale: 2, sign: { text: 'Café' } })], entries, flat, dry);
    const p = new Vector3().setFromMatrixPosition(quads[0].matrix);
    const n = new Vector3().setFromMatrixColumn(quads[0].matrix, 2);
    // A quarter turn about up takes the front (+z) to +x
    expect(n.x).toBeCloseTo(1);
    expect(p.x).toBeCloseTo((0.05 + 0.006) * 2);
    expect(p.y).toBeCloseTo(10 + 0.6);
    expect(new Vector3().setFromMatrixColumn(quads[0].matrix, 0).length()).toBeCloseTo(4.8);
  });

  it('writes a hanging sign on both faces, mirrored, in the panel ink', () => {
    const { quads } = signQuads([obj({ asset: 'hanging', sign: { icon: 'pretzel' } })], entries, flat, dry);
    expect(quads).toHaveLength(2);
    const a = new Vector3().setFromMatrixPosition(quads[0].matrix);
    const b = new Vector3().setFromMatrixPosition(quads[1].matrix);
    expect(a.x).toBeCloseTo(0.021);
    expect(b.x).toBeCloseTo(-0.021);
    expect(new Vector3().setFromMatrixColumn(quads[1].matrix, 2).x).toBeCloseTo(-1);
    expect(quads.every((q) => q.ink === '#d8b45e')).toBe(true);
  });

  it('writes nothing on a model without a panel, for an empty sign or an unknown pictogram alone', () => {
    const { quads } = signQuads(
      [obj({ asset: 'plain', sign: { text: 'X' } }), obj({ sign: { text: '  ' } }), obj({ sign: { icon: 'nope' } }), obj({})],
      entries,
      flat,
      dry,
    );
    expect(quads).toHaveLength(0);
  });

  it('caps the quads it draws', () => {
    const many = Array.from({ length: MAX_SIGNS + 10 }, (_, k) => obj({ id: `o${k}`, sign: { text: 'Bank' } }));
    expect(signQuads(many, entries, flat, dry).quads).toHaveLength(MAX_SIGNS);
  });

  it('writes dark on light boards and light on dark ones, the panel ink first', () => {
    expect(signInk(board.signPanel!, undefined)).toBe('#1d1b18');
    expect(signInk(board.signPanel!, '#e8dfc8')).toBe('#1d1b18');
    expect(signInk(board.signPanel!, '#2b3a2f')).toBe('#f0e8d4');
    expect(signInk(hanging.signPanel!, '#e8dfc8')).toBe('#d8b45e');
  });

  it('cuts long words and knows its pictograms', () => {
    expect(signText(' Lebensmittel und Getränke aller Art ')).toHaveLength(24);
    expect(isSignIcon('pretzel')).toBe(true);
    expect(isSignIcon('toString')).toBe(false);
    expect(Object.keys(SIGN_ICONS).length).toBeGreaterThan(30);
  });

  it('draws nothing without a canvas (the layer stays empty, no throw)', () => {
    const layer = new SignLayer(() => null);
    layer.set([obj({ sign: { text: 'Post' } })], { version: 1, materials: [], objects: [board] }, flat, dry);
    expect(layer.count).toBe(0);
    layer.dispose();
  });
});
