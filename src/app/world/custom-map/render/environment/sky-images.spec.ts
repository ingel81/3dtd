import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sunDirection } from './map-environment';
import { chooseSkyImage, SKY_IMAGES, skyImageOf, skyImageYaw } from './sky-images';
import { Vector3 } from 'three';

const ASSETS = join(process.cwd(), 'public/maps/assets');

describe('image skies (TODO E172)', () => {
  it('ships every picture it lists, under 15 MB together, each in the licence list', () => {
    const licences = readFileSync(join(ASSETS, 'LICENSES.md'), 'utf8');
    let bytes = 0;
    for (const s of SKY_IMAGES) {
      bytes += statSync(join(ASSETS, 'skies', s.file)).size;
      expect(licences).toContain(`| ${s.id} | ${s.source} |`);
      expect(['day', 'dusk', 'night', 'overcast']).toContain(s.preset);
    }
    expect(new Set(SKY_IMAGES.map((s) => s.id)).size).toBe(SKY_IMAGES.length);
    expect(SKY_IMAGES.length).toBeGreaterThanOrEqual(6);
    expect(bytes).toBeLessThan(15 * 1024 * 1024);
  });

  it('finds the map sky: none, a shipped id, an id this game does not ship', () => {
    expect(skyImageOf({})).toBeNull();
    expect(skyImageOf({ skyImage: 'starry-night' })?.preset).toBe('night');
    expect(skyImageOf({ skyImage: 'from-a-newer-game' })).toBeNull();
  });

  it('choosing a picture brings its preset and its sun height; procedural leaves the rest', () => {
    const sunny = SKY_IMAGES.find((s) => s.sun && s.sun.elevation > 2)!;
    expect(chooseSkyImage(sunny.id)).toEqual({ skyImage: sunny.id, sky: sunny.preset, sunElevation: Math.round(sunny.sun!.elevation) });
    const sunless = SKY_IMAGES.find((s) => !s.sun)!;
    expect(chooseSkyImage(sunless.id)).toEqual({ skyImage: sunless.id, sky: sunless.preset });
    expect(chooseSkyImage(null)).toEqual({ skyImage: undefined });
    expect(chooseSkyImage('unknown')).toEqual({ skyImage: undefined });
  });

  it('turns the picture so its sun stands at the map sun azimuth', () => {
    const image = SKY_IMAGES.find((s) => s.sun)!;
    for (const azimuth of [0, 90, 200, 333]) {
      // The dome's lookup: atan(z, x) + yaw, as an azimuth of the picture (sky-images.ts, build_skies.py)
      const dir = sunDirection(azimuth, 30, new Vector3());
      const phi = Math.atan2(dir.z, dir.x) + skyImageYaw(image, azimuth);
      const pictureAzimuth = (((Math.atan2(-Math.cos(phi), Math.sin(phi)) * 180) / Math.PI) % 360 + 360) % 360;
      expect(pictureAzimuth).toBeCloseTo(image.sun!.azimuth, 6);
    }
  });
});
