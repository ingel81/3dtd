import { createMapDocument } from '../world/custom-map/map-create';
import { drawMapPicture, mapPicturePng, MAP_PICTURE_PX, pictureColours } from './map-picture';

/** The pixel at (x, y) of an RGB picture */
function pixel(rgb: Uint8Array, width: number, x: number, y: number): number[] {
  return [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}

describe('map picture', () => {
  it("takes a material's average colour, else its colour", () => {
    expect(pictureColours([{ id: 'grass', average: '#5b672e' }, { id: 'sand', color: '#d2be8c' }, { id: 'bare' }])).toEqual({ grass: '#5b672e', sand: '#d2be8c' });
  });

  it('paints the ground in its material colour, north at the top, a wide map half as high', () => {
    const doc = createMapDocument({ id: 'wide', name: 'Wide', width: 128, depth: 64 });
    // The spawn moved to the north edge's middle: it shows at the top
    doc.spawns = [{ ...doc.spawns[0], x: 0, y: 28 }];
    const { rgb, width, height } = drawMapPicture(doc, 128, { grass: '#2040c0' });
    expect([width, height]).toEqual([128, 64]);
    // Flat ground, unshaded, in the grass's colour; the corner holds no road, spawn or HQ
    expect(pixel(rgb, width, 2, 2)).toEqual([0x20, 0x40, 0xc0]);
    expect(pixel(rgb, width, 64, 4)).toEqual([239, 68, 68]);
    // The road along the middle row from west to east, pale
    expect(pixel(rgb, width, 32, 32)).not.toEqual([0x20, 0x40, 0xc0]);
  });

  it('greys a material the colours do not know', () => {
    const doc = createMapDocument({ id: 'grey', name: 'Grey', width: 64, depth: 64 });
    const { rgb, width } = drawMapPicture(doc, 64, {});
    expect(pixel(rgb, width, 1, 1)).toEqual([0x77, 0x77, 0x77]);
  });

  it('writes a PNG of the runtime size, small enough to keep beside every map', () => {
    const doc = createMapDocument({ id: 'png', name: 'Png', width: 256, depth: 256 });
    const png = mapPicturePng(doc, { grass: '#5b672e' });
    expect(String.fromCharCode(...png.subarray(1, 4))).toBe('PNG');
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([MAP_PICTURE_PX, MAP_PICTURE_PX]);
    expect(png.length).toBeLessThan(MAP_PICTURE_PX * MAP_PICTURE_PX * 3);
  });
});
