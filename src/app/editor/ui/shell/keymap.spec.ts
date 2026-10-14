import { KEY_ACTIONS, actionFor, bindable, loadKeymap, rebind, saveKeymap } from './keymap';

describe('keymap', () => {
  it('rebinds, swaps a taken key and keeps only the changes', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let map = loadKeymap(storage);
    expect(actionFor(map, '1')).toBe('tool:landscape');
    expect(actionFor(map, 'T')).toBe('view:top');
    // N is free; then give C (game view's) to the top view: game view takes the old N
    map = rebind(map, 'view:top', 'n');
    map = rebind(map, 'view:game', 'n');
    expect(map['view:top']).toBe('c');
    expect(map['view:game']).toBe('n');
    saveKeymap(map, storage);
    expect(JSON.parse(store.get('3dtd-editor-keys')!)).toEqual({ 'view:top': 'c', 'view:game': 'n' });
    expect(loadKeymap(storage)['view:game']).toBe('n');
    expect(KEY_ACTIONS.length).toBeGreaterThan(12);
    expect(bindable('[')).toBe(false);
    expect(bindable('+')).toBe(false);
    expect(bindable('-')).toBe(false);
    expect(bindable('x')).toBe(true);
  });

  it('gives every action its own key, none of the fixed keys inside the tools and the fly keys', () => {
    const keys = KEY_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    // W E R L, S X J, Q H inside the tools (D, the Measure tool's, flies only while the right button turns the view)
    for (const fixed of 'werlsxjqh') expect(keys, fixed).not.toContain(fixed);
    expect(actionFor(loadKeymap(null), 'b')).toBe('view:still');
  });
});
