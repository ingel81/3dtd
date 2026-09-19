import { describe, it, expect } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { HOLD_FIRE_BRIGHTNESS, setTowerGreyedOut } from './tower-hold-fire';

function tower() {
  const body = new MeshStandardMaterial({ color: 0xcc3322, emissive: 0x2244ff });
  const flag = new MeshBasicMaterial({ color: 0x33aa55 });
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(), body));
  root.add(new Mesh(new BoxGeometry(), [flag, flag]));
  return { root, body, flag, bodyColor: body.color.clone(), bodyGlow: body.emissive.clone(), flagColor: flag.color.clone() };
}

describe('setTowerGreyedOut', () => {
  it('turns every colour to a dim grey of its brightness and puts a glow out', () => {
    const { root, body, flag, bodyColor } = tower();
    setTowerGreyedOut(root, true);

    const grey = (0.299 * bodyColor.r + 0.587 * bodyColor.g + 0.114 * bodyColor.b) * HOLD_FIRE_BRIGHTNESS;
    expect(body.color.r).toBeCloseTo(grey, 6);
    expect(body.color.g).toBeCloseTo(grey, 6);
    expect(body.color.b).toBeCloseTo(grey, 6);
    expect(body.emissive.equals(new Color(0, 0, 0))).toBe(true);
    expect(flag.color.r).toBe(flag.color.g);
  });

  it('gives the tower its own colours back, exactly, however often it was greyed', () => {
    const { root, body, flag, bodyColor, bodyGlow, flagColor } = tower();
    setTowerGreyedOut(root, true);
    setTowerGreyedOut(root, true);
    setTowerGreyedOut(root, false);

    expect(body.color.equals(bodyColor)).toBe(true);
    expect(body.emissive.equals(bodyGlow)).toBe(true);
    expect(flag.color.equals(flagColor)).toBe(true);
  });

  it('leaves a tower that is not grey as it is', () => {
    const { root, body, bodyColor } = tower();
    setTowerGreyedOut(root, false);
    expect(body.color.equals(bodyColor)).toBe(true);
  });
});
