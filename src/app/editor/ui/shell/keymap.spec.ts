import { KEY_ACTIONS, actionFor, bindable, loadKeymap, rebind, saveKeymap, toolKeys } from './keymap';
import { MarkerTool } from '../../tools/marker-tool';
import { ObjectTool } from '../../tools/object-tool';
import { PathTool } from '../../tools/path-tool';
import { StampTool } from '../../tools/stamp-tool';
import { en } from '../../../i18n/messages/en';

const fixed = toolKeys(en, [new ObjectTool(), new MarkerTool(), new PathTool(), new StampTool()]);

describe('keymap', () => {
  it('rebinds, swaps a taken key and keeps only the changes', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let map = loadKeymap(storage);
    expect(actionFor(map, '1')).toBe('tool:landscape');
    expect(actionFor(map, 'T')).toBe('view:top');
    // Y is free; then give C (game view's) to the top view: game view takes the old Y
    map = rebind(map, 'view:top', 'y');
    map = rebind(map, 'view:game', 'y');
    expect(map['view:top']).toBe('c');
    expect(map['view:game']).toBe('y');
    saveKeymap(map, storage);
    expect(JSON.parse(store.get('3dtd-editor-keys')!)).toEqual({ 'view:top': 'c', 'view:game': 'y' });
    expect(loadKeymap(storage)['view:game']).toBe('y');
    expect(KEY_ACTIONS.length).toBeGreaterThan(12);
    expect(bindable('[')).toBe(false);
    expect(bindable('+')).toBe(false);
    expect(bindable('-')).toBe(false);
    expect(bindable('x')).toBe(true);
  });

  it('gives every action its own key, none of the fixed keys inside the tools and the fly keys', () => {
    const keys = KEY_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    // W E R L, S X J, Q H inside the tools, as the tools name them (D flies only while the right button turns the view)
    expect([...fixed.keys()].sort().join('')).toBe('ehjlqrswx');
    for (const key of fixed.keys()) expect(keys, key).not.toContain(key);
    expect(fixed.get('r')).toBe('scale the selection (Objects), turn the copy by 90 degrees (Copy and stamps)');
    expect(actionFor(loadKeymap(null), 'b')).toBe('view:still');
  });

  it('drops an own key that a tool keeps fixed; the action goes back to its default, or waits when that is taken', () => {
    const own = { 'map:check': 'w', 'view:top': 'u', 'map:symmetry': 'v' };
    const map = loadKeymap({ getItem: () => JSON.stringify(own) }, fixed);
    expect(map['map:check']).toBe('');
    expect(map['view:top']).toBe('u');
    expect(actionFor(map, 'w')).toBeNull();
    expect(loadKeymap({ getItem: () => JSON.stringify({ 'map:check': 'w' }) }, fixed)['map:check']).toBe('v');
  });
});
