import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointLight, Scene } from 'three';
import { TowerMuzzleFlash } from './tower-muzzle-flash';

describe('TowerMuzzleFlash', () => {
  let scene: Scene;
  let flash: TowerMuzzleFlash;
  const light = () => scene.children[0] as PointLight;

  beforeEach(() => {
    vi.useFakeTimers();
    scene = new Scene();
    flash = new TowerMuzzleFlash(scene);
  });

  afterEach(() => vi.useRealTimers());

  it('keeps one dark light in the scene from the start', () => {
    expect(scene.children).toHaveLength(1);
    expect(light()).toBeInstanceOf(PointLight);
    expect(light().intensity).toBe(0);
  });

  it('lights the shoot position for 50 ms and restarts the timer on the next shot', () => {
    flash.flash(1, 12, 3, 4);
    expect(light().position.toArray()).toEqual([1, 12, 3]);
    expect(light().intensity).toBe(4);

    vi.advanceTimersByTime(40);
    flash.flash(2, 12, 3, 5);
    vi.advanceTimersByTime(40);
    expect(light().intensity).toBe(5);
    vi.advanceTimersByTime(10);
    expect(light().intensity).toBe(0);
    expect(scene.children).toHaveLength(1);
  });

  it('goes dark when switched off and stays in the scene', () => {
    flash.flash(0, 0, 0, 4);
    flash.setEnabled(false);
    expect(flash.isEnabled).toBe(false);
    expect(light().intensity).toBe(0);
    expect(scene.children).toHaveLength(1);
  });

  it('takes the light out of the scene on dispose', () => {
    flash.flash(0, 0, 0, 4);
    flash.dispose();
    expect(scene.children).toHaveLength(0);
    vi.advanceTimersByTime(100);
  });
});
