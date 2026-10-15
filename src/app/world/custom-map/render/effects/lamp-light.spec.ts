import { Color, DataUtils, Vector3, Vector4, type DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { LampLight, type LampSpot } from './lamp-light';

/** A flat map 100 m a side at 4 m */
function flat(): HeightField {
  return new HeightField({ columns: 3, rows: 3, cellSize: 50, heights: new Float32Array(9).fill(4) }, 100, 100);
}

/** The light (rgb) and ground height (a) of a texture at map point (x, y) */
function at(lamps: LampLight, texture: DataTexture, x: number, y: number): number[] {
  const uv = lamps.gridUv(new Vector4());
  const w = texture.image.width;
  const i = Math.round((x * uv.x + uv.z) * w - 0.5);
  const j = Math.round((y * uv.y + uv.w) * texture.image.height - 0.5);
  const data = texture.image.data as Uint16Array;
  return [0, 1, 2, 3].map((c) => DataUtils.fromHalfFloat(data[(j * w + i) * 4 + c]));
}

/** A lamp at map point (x, y), 4 m over the ground */
const lamp = (x: number, y: number, flicker = false): LampSpot => ({
  position: new Vector3(-x, 8, y),
  color: new Color(1, 0.8, 0.5),
  intensity: 1,
  distance: 12,
  flicker,
});

describe('lamp light', () => {
  it('lights the ground under a lamp, less further out, nothing past its reach', () => {
    const lamps = new LampLight(flat());
    expect(lamps.bake([lamp(0, 0)])).toBe(true);
    const under = at(lamps, lamps.steady, 0, 0);
    const near = at(lamps, lamps.steady, 6, 0);
    expect(under[0]).toBeGreaterThan(1);
    expect(near[0]).toBeLessThan(under[0]);
    expect(near[0]).toBeGreaterThan(0);
    expect(at(lamps, lamps.steady, 20, 0)[0]).toBe(0);
    // The ground the light stands on, for the fade over roofs
    expect(under[3]).toBeCloseTo(4, 1);
    // A steady lamp puts nothing into the flickering light
    expect(at(lamps, lamps.flicker, 0, 0)[0]).toBe(0);
  });

  it('keeps a low light bright out to half its reach', () => {
    const lamps = new LampLight(flat());
    // A torch 1 m over the ground with 12 m of reach: a pure inverse square left 3 percent at 6 m
    lamps.bake([{ ...lamp(0, 0), position: new Vector3(0, 5, 0) }]);
    const under = at(lamps, lamps.steady, 0, 0)[0];
    expect(at(lamps, lamps.steady, 6, 0)[0]).toBeGreaterThan(under * 0.25);
    lamps.dispose();
  });

  it('puts a fire into the flickering light, and a lamp moved leaves nothing behind', () => {
    const lamps = new LampLight(flat());
    lamps.bake([lamp(-20, 0, true)]);
    expect(at(lamps, lamps.flicker, -20, 0)[0]).toBeGreaterThan(1);
    lamps.bake([lamp(25, 10, true)]);
    expect(at(lamps, lamps.flicker, -20, 0)[0]).toBe(0);
    expect(at(lamps, lamps.flicker, 25, 10)[0]).toBeGreaterThan(1);
    expect(lamps.bake([])).toBe(false);
    expect(at(lamps, lamps.flicker, 25, 10)[0]).toBe(0);
    lamps.dispose();
  });
});
