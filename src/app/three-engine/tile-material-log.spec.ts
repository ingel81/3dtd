import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  type Object3D,
} from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { computesLights, logTileMaterialTypes } from './tile-material-log';

/** Tiles renderer stand-in that only records the load-model listener. */
function fakeTiles() {
  let onLoadModel: ((event: { scene: Object3D }) => void) | null = null;
  const tiles = {
    addEventListener: (name: string, callback: (event: { scene: Object3D }) => void) => {
      if (name === 'load-model') onLoadModel = callback;
    },
  };
  return {
    tiles: tiles as unknown as Pick<TilesRenderer, 'addEventListener'>,
    load: (...meshes: Mesh[]) => {
      const scene = new Group();
      scene.add(...meshes);
      onLoadModel!({ scene });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computesLights', () => {
  it('tells lit from unlit materials', () => {
    expect(computesLights(new MeshStandardMaterial())).toBe(true);
    expect(computesLights(new MeshBasicMaterial())).toBe(false);
    expect(computesLights(new ShaderMaterial())).toBe(false);
    expect(computesLights(new ShaderMaterial({ lights: true }))).toBe(true);
  });
});

describe('logTileMaterialTypes', () => {
  it('logs each material type once, with its count in the first tile that has it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { tiles, load } = fakeTiles();
    logTileMaterialTypes(tiles);

    load(new Mesh(undefined, new MeshBasicMaterial()), new Mesh(undefined, new MeshBasicMaterial()));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('MeshBasicMaterial x2');
    expect(log.mock.calls[0][0]).toContain('unlit');

    load(new Mesh(undefined, new MeshBasicMaterial()), new Mesh(undefined, new MeshStandardMaterial()));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain('MeshStandardMaterial x1');
    expect(log.mock.calls[1][0]).toContain('lit, runs the scene lights');

    load(new Mesh(undefined, new MeshStandardMaterial()));
    expect(log).toHaveBeenCalledTimes(2);
  });
});
