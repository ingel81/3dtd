import { Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { UnlitTilesPlugin, toUnlitTileMaterial } from './unlit-tiles-plugin';

describe('toUnlitTileMaterial()', () => {
  it('turns a lit material into an unlit one with its texture, colour and surface settings, and disposes the old', () => {
    const map = new Texture();
    const lit = new MeshStandardMaterial({ map, color: new Color(0.5, 0.6, 0.7), side: DoubleSide, vertexColors: true, name: 'photo' });
    const dispose = vi.spyOn(lit, 'dispose');
    const textureDispose = vi.spyOn(map, 'dispose');

    const unlit = toUnlitTileMaterial(lit) as MeshBasicMaterial;

    expect(unlit).toBeInstanceOf(MeshBasicMaterial);
    expect(unlit.map).toBe(map);
    expect(unlit.color.equals(new Color(0.5, 0.6, 0.7))).toBe(true);
    expect(unlit.side).toBe(DoubleSide);
    expect(unlit.vertexColors).toBe(true);
    expect(unlit.name).toBe('photo');
    expect(dispose).toHaveBeenCalledOnce();
    // The texture stays: the unlit material draws it
    expect(textureDispose).not.toHaveBeenCalled();
  });

  it('leaves a material that ignores the lights as it is', () => {
    const basic = new MeshBasicMaterial();
    expect(toUnlitTileMaterial(basic)).toBe(basic);
  });
});

describe('UnlitTilesPlugin', () => {
  it('swaps the materials of every mesh in a tile, material lists too', () => {
    const tile = new Group();
    const single = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
    const multi = new Mesh(new PlaneGeometry(), [new MeshStandardMaterial(), new MeshBasicMaterial()]);
    tile.add(single, multi);

    new UnlitTilesPlugin().processTileModel(tile);

    expect(single.material).toBeInstanceOf(MeshBasicMaterial);
    const list = multi.material as MeshBasicMaterial[];
    expect(list.map((m) => m.type)).toEqual(['MeshBasicMaterial', 'MeshBasicMaterial']);
  });
});
