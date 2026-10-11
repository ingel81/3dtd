import { Vector3 } from 'three';
import { CameraController } from './camera-controller';

describe('camera controller', () => {
  it('flies along the view and comes back to a kept goal', () => {
    const c = new CameraController(new Vector3(), 200);
    c.goal.yaw = 0;
    const kept = c.saveGoal();
    // Yaw 0 looks north (+z in the scene)
    c.fly(10, 0, 0);
    expect(c.goal.target.z).toBeCloseTo(10);
    c.fly(0, 0, -50);
    expect(c.goal.distance).toBe(150);
    c.setGoal(kept);
    expect(c.goal.target.z).toBe(0);
    expect(c.goal.distance).toBe(200);
    // The kept copy does not follow later moves
    c.fly(5, 0, 0);
    expect(kept.target.z).toBe(0);
  });
});
