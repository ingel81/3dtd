import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TrialRunners } from './trial-runners';

describe('trial wave', () => {
  it('walks ground enemies along the routes at their speed', () => {
    const trial = new TrialRunners(() => 2);
    // Models do not load here; the runners still walk
    (trial as unknown as { model: () => Promise<null> }).model = () => Promise.resolve(null);
    const route = { points: [{ x: 0, y: 0 }, { x: 0, y: 200 }], length: 200 };
    const types = trial.start([route], ['zombie', 'bat', 'rat']);
    expect(types.map((t) => t.id)).toEqual(['zombie', 'rat']);
    trial.update(1.7);
    expect(trial.group.children).toHaveLength(1);
    const first = trial.group.children[0];
    trial.update(1);
    // A zombie walks its base speed: z is map north in the scene
    expect(first.position.z).toBeCloseTo(ENEMY_TYPES['zombie'].baseSpeed * 2.7, 0);
    expect(first.position.y).toBe(2);
    const t = TrialRunners.timing([route], types);
    expect(t.fastest).toBeCloseTo(200 / ENEMY_TYPES['rat'].baseSpeed);
    expect(t.slowest).toBeCloseTo(200 / ENEMY_TYPES['zombie'].baseSpeed);
    trial.stop();
    expect(trial.group.children).toHaveLength(0);
    expect(trial.active).toBe(false);
  });
});
