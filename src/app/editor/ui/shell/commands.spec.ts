import { matchScore, rankCommands, type EditorCommand } from './commands';

const cmd = (label: string, group = 'Tools'): EditorCommand => ({ id: label, label, group, run: () => undefined });

describe('command palette ranking', () => {
  it('matches letters in order and prefers word starts', () => {
    expect(matchScore('lsc', 'Landscape')).not.toBeNull();
    expect(matchScore('xyz', 'Landscape')).toBeNull();
    expect(matchScore('gv', 'Game view')!).toBeGreaterThan(matchScore('gv', 'Gravel')!);
  });

  it('ranks the best match first and keeps the order without a query', () => {
    const list = [cmd('Paint'), cmd('Biome: Hell', 'Landscape'), cmd('Help: keys', 'Editor'), cmd('Hide objects', 'View')];
    expect(rankCommands('hell', list)[0].label).toBe('Biome: Hell');
    expect(rankCommands('he', list).map((c) => c.label)).toContain('Help: keys');
    expect(rankCommands('', list)).toEqual(list);
    expect(rankCommands('zzz', list)).toEqual([]);
    // Words in any order
    expect(rankCommands('view hide', list)[0].label).toBe('Hide objects');
  });
});
