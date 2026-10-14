import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TRIAL_SPEEDS, TrialRunners, stepTrialSpeed } from './trial-runners';

describe('trial wave', () => {
  it('walks ground enemies along the routes at their speed', () => {
    const trial = new TrialRunners(() => 2);
    // Models do not load here; the runners still walk
    (trial as unknown as { model: () => Promise<null> }).model = () => Promise.resolve(null);
    const route = { points: [{ x: 0, y: 0 }, { x: 0, y: 200 }], length: 200 };
    const types = trial.start([route], ['zombie', 'bat', 'rat']);
    expect(types.map((t) => t.id)).toEqual(['zombie', 'rat']);
    trial.update(1.7);
    // One runner: its model and its dot
    expect(trial.group.children).toHaveLength(2);
    const [first, dot] = trial.group.children;
    trial.update(1);
    // A zombie walks its base speed: z is map north in the scene
    expect(first.position.z).toBeCloseTo(ENEMY_TYPES['zombie'].baseSpeed * 2.7, 0);
    expect(first.position.y).toBe(2);
    // The dot rides just above it, the same size on the screen from near and far
    expect(dot.position.z).toBeCloseTo(first.position.z);
    expect(dot.position.y).toBeCloseTo(3.5);
    const t = TrialRunners.timing([route], types);
    expect(t.fastest).toBeCloseTo(200 / ENEMY_TYPES['rat'].baseSpeed);
    expect(t.slowest).toBeCloseTo(200 / ENEMY_TYPES['zombie'].baseSpeed);
    trial.stop();
    expect(trial.group.children).toHaveLength(0);
    expect(trial.active).toBe(false);
  });

  it('walks faster at a higher speed, also when changed while it walks', () => {
    const trial = new TrialRunners(() => 0);
    (trial as unknown as { model: () => Promise<null> }).model = () => Promise.resolve(null);
    trial.start([{ points: [{ x: 0, y: 0 }, { x: 0, y: 400 }], length: 400 }], ['zombie']);
    trial.update(1.7);
    const [first] = trial.group.children;
    const at1 = first.position.z;
    trial.update(1);
    const step1 = first.position.z - at1;
    trial.speed = 4;
    trial.update(1);
    expect(first.position.z - at1 - step1).toBeCloseTo(4 * step1, 5);
    // A runner each spacing of the wave's own clock: four times as many in the same frames
    expect(trial.group.children.length).toBeGreaterThan(2);
    expect(stepTrialSpeed(1, 1)).toBe(2);
    expect(stepTrialSpeed(8, 1)).toBe(8);
    expect(stepTrialSpeed(1, -1)).toBe(1);
    expect(stepTrialSpeed(3, 1)).toBe(4);
    expect(stepTrialSpeed(4, -1)).toBe(TRIAL_SPEEDS[1]);
    // The speed stays for the next wave
    trial.start([{ points: [{ x: 0, y: 0 }, { x: 0, y: 400 }], length: 400 }], ['zombie']);
    expect(trial.speed).toBe(4);
  });
});
