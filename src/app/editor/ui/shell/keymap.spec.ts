import { KEY_ACTIONS, actionFor, bindable, loadKeymap, rebind, saveKeymap } from './keymap';

describe('keymap', () => {
  it('rebinds, swaps a taken key and keeps only the changes', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let map = loadKeymap(storage);
    expect(actionFor(map, '1')).toBe('tool:landscape');
    expect(actionFor(map, 'T')).toBe('view:top');
    // B is free; then give C (game view's) to the top view: game view takes the old B
    map = rebind(map, 'view:top', 'b');
    map = rebind(map, 'view:game', 'b');
    expect(map['view:top']).toBe('c');
    expect(map['view:game']).toBe('b');
    saveKeymap(map, storage);
    expect(JSON.parse(store.get('3dtd-editor-keys')!)).toEqual({ 'view:top': 'c', 'view:game': 'b' });
    expect(loadKeymap(storage)['view:game']).toBe('b');
    expect(KEY_ACTIONS.length).toBeGreaterThan(12);
    expect(bindable('[')).toBe(false);
    expect(bindable('x')).toBe(true);
  });
});
