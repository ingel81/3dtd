import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameObject } from './game-object';
import { Component, ComponentType } from './component';

class TestGameObject extends GameObject {
  constructor(type: 'enemy' | 'tower' | 'projectile' = 'enemy') {
    super(type);
  }

  getAllComponents(): Component[] {
    return Array.from(this.components.values());
  }
}

class TestComponent extends Component {
  onDestroySpy: ReturnType<typeof vi.fn>;

  constructor(gameObject: GameObject, onDestroySpy = vi.fn()) {
    super(gameObject);
    this.onDestroySpy = onDestroySpy;
  }

  update(_deltaTime: number): void {
    // no-op
  }

  override onDestroy(): void {
    this.onDestroySpy();
  }
}

describe('GameObject', () => {
  beforeEach(() => {
    GameObject.resetIdCounter();
  });

  it('generates unique IDs that include the type string', () => {
    const a = new TestGameObject('enemy');
    const b = new TestGameObject('enemy');

    expect(a.id).not.toBe(b.id);
    expect(a.id).toContain('enemy-');
    expect(b.id).toContain('enemy-');
  });

  it('adds a component and retrieves it with getComponent', () => {
    const obj = new TestGameObject();
    const component = new TestComponent(obj);

    obj.addComponent(component, ComponentType.TRANSFORM);

    const fetched = obj.getComponent<TestComponent>(ComponentType.TRANSFORM);
    expect(fetched).toBe(component);
  });

  it('hasComponent returns true for existing and false for missing components', () => {
    const obj = new TestGameObject();
    const component = new TestComponent(obj);

    obj.addComponent(component, ComponentType.HEALTH);

    expect(obj.hasComponent(ComponentType.HEALTH)).toBe(true);
    expect(obj.hasComponent(ComponentType.AUDIO)).toBe(false);
  });

  it('removeComponent removes component and calls onDestroy', () => {
    const obj = new TestGameObject();
    const onDestroySpy = vi.fn();
    const component = new TestComponent(obj, onDestroySpy);

    obj.addComponent(component, ComponentType.RENDER);
    obj.removeComponent(ComponentType.RENDER);

    expect(onDestroySpy).toHaveBeenCalledTimes(1);
    expect(obj.hasComponent(ComponentType.RENDER)).toBe(false);
  });

  it('destroy deactivates object and calls onDestroy on all components', () => {
    const obj = new TestGameObject();
    const destroyA = vi.fn();
    const destroyB = vi.fn();

    obj.addComponent(new TestComponent(obj, destroyA), ComponentType.TRANSFORM);
    obj.addComponent(new TestComponent(obj, destroyB), ComponentType.HEALTH);

    obj.destroy();

    expect(destroyA).toHaveBeenCalledTimes(1);
    expect(destroyB).toHaveBeenCalledTimes(1);
    expect(obj.active).toBe(false);
    expect(obj.getAllComponents()).toHaveLength(0);
  });

  it('can hold multiple different component types', () => {
    const obj = new TestGameObject();
    obj.addComponent(new TestComponent(obj), ComponentType.TRANSFORM);
    obj.addComponent(new TestComponent(obj), ComponentType.HEALTH);
    obj.addComponent(new TestComponent(obj), ComponentType.RENDER);

    expect(obj.getAllComponents()).toHaveLength(3);
    expect(obj.hasComponent(ComponentType.TRANSFORM)).toBe(true);
    expect(obj.hasComponent(ComponentType.HEALTH)).toBe(true);
    expect(obj.hasComponent(ComponentType.RENDER)).toBe(true);
  });

  it('warns when adding a duplicate component type', () => {
    const obj = new TestGameObject();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    obj.addComponent(new TestComponent(obj), ComponentType.TRANSFORM);
    obj.addComponent(new TestComponent(obj), ComponentType.TRANSFORM);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
