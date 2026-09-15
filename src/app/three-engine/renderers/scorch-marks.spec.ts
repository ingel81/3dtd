import { describe, it, expect } from 'vitest';
import { BufferAttribute, PlaneGeometry } from 'three';
import { SCORCH_DECAL_CONFIG } from '../../configs/visual-effects.config';
import { ScorchMarks, type ScorchGround } from './scorch-marks';

/** Route grid stand-in: 2 m cells on x and z from 0 to 40 m, ground at y = 5. */
const grid: ScorchGround = {
  getCellAt: (x, z) =>
    x >= 0 && x < 40 && z >= 0 && z < 40 ? { key: Math.floor(x / 2) * 1000 + Math.floor(z / 2) } : undefined,
  getGroundLocalYAt: () => 5,
};

describe('ScorchMarks', () => {
  const create = () => {
    const marks = new ScorchMarks(new PlaneGeometry(2, 2));
    marks.setGround(grid);
    const opacity = marks.decals.instancedMesh.geometry.getAttribute('instanceOpacity') as BufferAttribute;
    return { marks, opacity };
  };
  const { cannon, rocket, beam } = SCORCH_DECAL_CONFIG.sources;
  const colorOf = (marks: ScorchMarks, index: number) =>
    (marks.decals.instancedMesh.geometry.getAttribute('instanceColor') as BufferAttribute).getX(index);
  const radiusOf = (marks: ScorchMarks, index: number) => {
    const matrix = marks.decals.instancedMesh.instanceMatrix.array;
    return Math.hypot(matrix[index * 16], matrix[index * 16 + 1], matrix[index * 16 + 2]);
  };

  it('burns the beam trail wider and darker than a rocket, in a mark of its own beside the guns', () => {
    const { marks, opacity } = create();
    marks.mark(1, 5, 1, 'rocket', 0);
    marks.mark(1, 5, 1, 'beam', 0); // same cell
    expect(marks.decals.count).toBe(2);
    expect(opacity.getX(0)).toBeCloseTo(rocket.opacity); // the rocket's mark is left alone
    expect(opacity.getX(1)).toBeCloseTo(beam.opacity);
    expect(opacity.getX(1)).toBeGreaterThan(opacity.getX(0));
    expect(colorOf(marks, 1)).toBeLessThan(colorOf(marks, 0));
    expect(radiusOf(marks, 1)).toBeGreaterThan(radiusOf(marks, 0) * 1.4);

    // A second beam over the cell darkens its trail mark, up to the beam's own cap
    for (let i = 0; i < 10; i++) marks.mark(1, 5, 1, 'beam', 10 + i);
    expect(marks.decals.count).toBe(2);
    expect(opacity.getX(1)).toBeCloseTo(beam.maxOpacity);
  });

  it('keeps the beam trail longer than the gun marks', () => {
    const { marks } = create();
    marks.mark(1, 5, 1, 'cannon', 0);
    marks.mark(3, 5, 1, 'beam', 0);
    marks.updateFades(SCORCH_DECAL_CONFIG.fadeDelay + SCORCH_DECAL_CONFIG.fadeDuration + 1);
    expect(marks.decals.count).toBe(1); // the cannon's mark is gone, the trail lies on
    marks.updateFades(beam.fadeDelay + beam.fadeDuration + 1);
    expect(marks.decals.count).toBe(0);
  });

  it('gives up gun marks before a beam trail still due to lie when the pool is full', () => {
    const { marks } = create();
    marks.mark(1, 5, 1, 'beam', 0); // the oldest mark of all
    for (let i = 1; i < SCORCH_DECAL_CONFIG.maxDecals; i++) {
      marks.mark((i % 20) * 2 + 1, 5, Math.floor(i / 20) * 2 + 1, 'cannon', i);
    }
    marks.mark(39, 5, 39, 'cannon', 1000); // a new cell in a full pool
    expect(marks.decals.getInstance(`scorch_beam_${grid.getCellAt(1, 1)!.key}`)).toBeDefined();
    expect(marks.decals.count).toBe(SCORCH_DECAL_CONFIG.maxDecals);
  });

  it('keeps one mark per cell and darkens it on every further hit', () => {
    const { marks, opacity } = create();
    expect(marks.mark(1, 8, 1, 'cannon', 0)).toBe(true);
    expect(marks.mark(1.9, 8, 0.2, 'cannon', 10)).toBe(true); // same 2 m cell
    expect(marks.decals.count).toBe(1);
    expect(opacity.getX(0)).toBeCloseTo(cannon.opacity + cannon.opacityStep);

    for (let i = 0; i < 20; i++) marks.mark(1, 8, 1, 'cannon', 20 + i);
    expect(opacity.getX(0)).toBeCloseTo(SCORCH_DECAL_CONFIG.maxOpacity);

    marks.mark(3, 8, 1, 'cannon', 100); // neighbour cell
    expect(marks.decals.count).toBe(2);
  });

  it('puts the mark on the ground below the hit', () => {
    const { marks } = create();
    marks.mark(10, 8, 10, 'rocket', 0);
    const translationY = marks.decals.instancedMesh.instanceMatrix.array[13];
    expect(translationY).toBeCloseTo(5 + SCORCH_DECAL_CONFIG.heightOffset);
  });

  it('leaves no mark off the grid, high in the air or without a ground', () => {
    const { marks } = create();
    expect(marks.mark(-5, 5, 1, 'cannon', 0)).toBe(false);
    expect(marks.mark(1, 5 + SCORCH_DECAL_CONFIG.maxHeightAboveGround + 1, 1, 'rocket', 0)).toBe(false);
    marks.setGround({ getCellAt: grid.getCellAt, getGroundLocalYAt: () => null });
    expect(marks.mark(1, 5, 1, 'cannon', 0)).toBe(false);
    marks.setGround(null);
    expect(marks.mark(1, 5, 1, 'cannon', 0)).toBe(false);
    expect(marks.decals.count).toBe(0);
  });

  it('gives up the mark hit longest ago when the pool is full', () => {
    const { marks } = create();
    const max = SCORCH_DECAL_CONFIG.maxDecals;
    // One mark per cell along a 2 m grid, ordered by time
    const cellAt = (i: number): [number, number] => [(i % 20) * 2 + 1, Math.floor(i / 20) * 2 + 1];
    for (let i = 0; i < max; i++) {
      const [x, z] = cellAt(i);
      marks.mark(x, 5, z, 'fire', i);
    }
    // Hitting the first cell again makes it the youngest
    const [x0, z0] = cellAt(0);
    marks.mark(x0, 5, z0, 'fire', max);
    expect(marks.decals.count).toBe(max);

    marks.mark(39, 5, 39, 'fire', max + 1); // a new cell in a full pool
    expect(marks.decals.count).toBe(max);
    expect(marks.decals.getInstance('scorch_0')).toBeDefined(); // reinforced, kept
    const [x1, z1] = cellAt(1);
    expect(marks.decals.getInstance(`scorch_${grid.getCellAt(x1, z1)!.key}`)).toBeUndefined();
  });

  it('is drawn only while it holds a mark (DrawGate)', () => {
    const { marks } = create();
    const mesh = marks.decals.instancedMesh;
    expect(mesh.visible).toBe(false);

    marks.mark(1, 5, 1, 'cannon', 0);
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(1);
    marks.mark(1, 5, 1, 'cannon', 10); // reinforced, still one
    expect(mesh.count).toBe(1);

    marks.updateFades(SCORCH_DECAL_CONFIG.fadeDelay + SCORCH_DECAL_CONFIG.fadeDuration + 100);
    expect(mesh.visible).toBe(false);

    marks.mark(3, 5, 1, 'rocket', 0);
    marks.clear();
    expect(mesh.visible).toBe(false);
  });

  it('fades marks out and clears them on reset', () => {
    const { marks } = create();
    marks.mark(1, 5, 1, 'cannon', 0);
    marks.updateFades(SCORCH_DECAL_CONFIG.fadeDelay + SCORCH_DECAL_CONFIG.fadeDuration + 1);
    expect(marks.decals.count).toBe(0);

    marks.mark(1, 5, 1, 'cannon', 0);
    marks.clear();
    expect(marks.decals.count).toBe(0);
  });
});
