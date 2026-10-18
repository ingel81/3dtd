import { BoxGeometry, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { mergeKey } from './merge-parts';
import { isRotor, rotorGeometry, rotorHub } from './rotor';

/** Three blades of a turbine round a hub at (1, 20, -0.9), flat across z: copies turned a third of a turn apart */
function blades(): BufferGeometry {
  const points: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3;
    const along = [Math.cos(a), Math.sin(a)];
    const side = [-Math.sin(a), Math.cos(a)];
    for (const [l, s] of [[0, 0.25], [0, -0.1], [6, -0.05]]) points.push(1 + along[0] * l + side[0] * s, 20 + along[1] * l + side[1] * s, -0.9);
  }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points, 3));
}

describe('rotor parts', () => {
  it('finds the hub of a rotationally symmetric part and its axle along the thinnest extent', () => {
    const spinner = new BoxGeometry(0.8, 0.8, 0.4).translate(1, 20, -0.8);
    const { hub, axle } = rotorHub([blades(), spinner]);
    expect(hub[0]).toBeCloseTo(1, 5);
    expect(hub[1]).toBeCloseTo(20, 5);
    expect(axle).toBe(2);
  });

  it('gives every vertex the hub and axle, the source untouched', () => {
    const source = blades();
    const out = rotorGeometry(source, { hub: [1, 20, -0.9], axle: 2 });
    const a = out.getAttribute('aRotor');
    expect(a.count).toBe(9);
    expect([a.getX(4), a.getY(4), a.getZ(4), a.getW(4)]).toEqual([1, 20, expect.closeTo(-0.9, 5), 2]);
    expect(source.getAttribute('aRotor')).toBeUndefined();
  });

  it('keeps rotor parts out of the merged draw', () => {
    const rotor = new MeshStandardMaterial();
    rotor.name = 'rotor-turbine-blades';
    const still = new MeshStandardMaterial();
    still.name = 'turbine-white';
    expect(isRotor(rotor)).toBe(true);
    expect(isRotor(still)).toBe(false);
    expect(mergeKey(rotor)).toBeNull();
    expect(mergeKey(still)).not.toBeNull();
  });
});
