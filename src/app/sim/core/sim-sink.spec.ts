import { describe, expect, it } from 'vitest';
import { SimOps, isTransientOp, opVec } from './sim-sink';

describe('SimOps', () => {
  it('records calls by path in call order and hands them over once', () => {
    const ops = new SimOps();
    ops.sink.enemies.create('enemy-1', 'zombie', 1, 2, 3, true);
    ops.sink.towers.remove('tower-4');
    expect(ops.take()).toEqual([
      ['enemies.create', 'enemy-1', 'zombie', 1, 2, 3, true],
      ['towers.remove', 'tower-4'],
    ]);
    expect(ops.take()).toEqual([]);
  });

  it('drops transient ops while the show is muted, keeps the ones that build', () => {
    const ops = new SimOps();
    ops.setShowMuted(true);
    ops.sink.effects.spawnFloatingText('-5', 0, 0, 0, {});
    ops.sink.main.chainLightning('tower-1', []);
    ops.sink.enemies.remove('enemy-2');
    ops.setShowMuted(false);
    ops.sink.effects.spawnFloatingText('-6', 0, 0, 0, {});
    expect(ops.take().map((op) => op[0])).toEqual(['enemies.remove', 'effects.spawnFloatingText']);
  });

  it('copies vectors plain', () => {
    const v = { x: 1, y: 2, z: 3, extra: true };
    expect(opVec(v)).toEqual({ x: 1, y: 2, z: 3 });
    expect(isTransientOp('spatialAudio.playAt')).toBe(true);
    expect(isTransientOp('towers.create')).toBe(false);
  });
});
