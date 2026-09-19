import { EntityManager } from './entity-manager';
import { GameObject } from '../core/game-object';

vi.mock('three', () => ({
  Vector3: class {
    x = 0;
    y = 0;
    z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
  },
}));

class TestEntity extends GameObject {
  updateSpy = vi.fn();
  destroySpy = vi.fn();

  constructor() {
    super('tower');
  }

  override update(deltaTime: number): void {
    this.updateSpy(deltaTime);
  }

  override destroy(): void {
    this.destroySpy();
    super.destroy();
  }
}

class TestEntityManager extends EntityManager<TestEntity> {}

describe('EntityManager', () => {
  let manager: TestEntityManager;

  beforeEach(() => {
    manager = new TestEntityManager();
  });

  it('add() adds entity, getById finds it, and it is active', () => {
    const entity = new TestEntity();

    manager.add(entity);

    expect(manager.getById(entity.id)).toBe(entity);
    expect(manager.getAllActive()).toContain(entity);
  });

  it('remove() removes entity and calls destroy()', () => {
    const entity = new TestEntity();
    manager.add(entity);

    manager.remove(entity);

    expect(entity.destroySpy).toHaveBeenCalledTimes(1);
    expect(manager.getById(entity.id)).toBeNull();
    expect(manager.getAll()).not.toContain(entity);
    expect(manager.getAllActive()).not.toContain(entity);
  });

  it('getById() returns entity or null for unknown id', () => {
    const entity = new TestEntity();
    manager.add(entity);

    expect(manager.getById(entity.id)).toBe(entity);
    expect(manager.getById('unknown')).toBeNull();
  });

  it('getAll() returns all entities', () => {
    const e1 = new TestEntity();
    const e2 = new TestEntity();
    manager.add(e1);
    manager.add(e2);

    const all = manager.getAll();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([e1, e2]));
  });

  it('getAllActive() returns only active entities', () => {
    const e1 = new TestEntity();
    const e2 = new TestEntity();
    manager.add(e1);
    manager.add(e2);

    manager.remove(e1);

    const active = manager.getAllActive();
    expect(active).toHaveLength(1);
    expect(active).toEqual([e2]);
  });

  it('clear() removes all entities and calls destroy()', () => {
    const e1 = new TestEntity();
    const e2 = new TestEntity();
    manager.add(e1);
    manager.add(e2);

    manager.clear();

    expect(e1.destroySpy).toHaveBeenCalledTimes(1);
    expect(e2.destroySpy).toHaveBeenCalledTimes(1);
    expect(manager.getAll()).toHaveLength(0);
    expect(manager.getAllActive()).toHaveLength(0);
  });

  it('update(dt) calls update on all active entities', () => {
    const e1 = new TestEntity();
    const e2 = new TestEntity();
    manager.add(e1);
    manager.add(e2);
    manager.remove(e1);

    manager.update(0.16);

    expect(e1.updateSpy).not.toHaveBeenCalled();
    expect(e2.updateSpy).toHaveBeenCalledWith(0.16);
  });

  it('handles multiple entities correctly', () => {
    const entities = Array.from({ length: 5 }, () => new TestEntity());
    entities.forEach((e) => manager.add(e));

    manager.remove(entities[1]);
    manager.remove(entities[3]);

    expect(manager.getAll()).toHaveLength(3);
  });

  it('edge cases: removing non-existing entity and unknown getById', () => {
    const e1 = new TestEntity();
    manager.add(e1);

    const notAdded = new TestEntity();
    manager.remove(notAdded);

    expect(manager.getAll()).toHaveLength(1);
    expect(manager.getById('unknown')).toBeNull();
  });

  describe('the arrays handed out', () => {
    it('keep insertion order through removals', () => {
      const entities = Array.from({ length: 5 }, () => new TestEntity());
      entities.forEach((e) => manager.add(e));
      manager.remove(entities[1]);
      manager.add(entities[1]);

      const order = [entities[0], entities[2], entities[3], entities[4], entities[1]];
      expect(manager.getAllActive()).toEqual(order);
      expect(manager.getAll()).toEqual(order);
    });

    it('stay the same array while nothing changes', () => {
      manager.add(new TestEntity());
      expect(manager.getAllActive()).toBe(manager.getAllActive());
      expect(manager.getAll()).toBe(manager.getAll());
    });

    it('never change under a reader that removes while it iterates', () => {
      const entities = Array.from({ length: 4 }, () => new TestEntity());
      entities.forEach((e) => manager.add(e));

      const seen: TestEntity[] = [];
      for (const e of manager.getAllActive()) {
        seen.push(e);
        manager.remove(e);
      }

      expect(seen).toEqual(entities);
      expect(manager.getAllActive()).toEqual([]);
      expect(manager.getAll()).toEqual([]);
    });

    it('do not see an entity added after they were handed out', () => {
      const first = new TestEntity();
      manager.add(first);
      const before = manager.getAllActive();
      manager.add(new TestEntity());

      expect(before).toEqual([first]);
      expect(manager.getAllActive()).toHaveLength(2);
    });

    it('hold an entity added twice once', () => {
      const e = new TestEntity();
      manager.add(e);
      manager.add(e);

      expect(manager.getAllActive()).toEqual([e]);
      expect(manager.getAll()).toEqual([e]);
    });

    it('are empty after clear()', () => {
      Array.from({ length: 3 }, () => new TestEntity()).forEach((e) => manager.add(e));
      manager.clear();

      expect(manager.getAll()).toEqual([]);
      expect(manager.getAllActive()).toEqual([]);
    });
  });
});
