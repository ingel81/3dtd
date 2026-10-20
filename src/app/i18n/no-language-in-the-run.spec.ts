import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { en } from './messages/en';
import { de } from './messages/de';
import { ROOM_OPTION_CHOICES } from '../coop/room-options';
import { PLAYER_NAME_FALLBACK } from '../coop/coop-name';

/**
 * The player's language never reaches what two clients must agree on (TODO
 * E245, docs/I18N_PLAN.md 4.4, 4.6, 4.11): the simulation in the worker, the
 * coop protocol and its world package, checksums, saves, replays and the run
 * log. Two players in different languages play the same game. Those parts
 * carry ids, codes and numbers; where they need a word they read the source
 * language (`en`), never the dictionary the player chose.
 */
const app = resolve(__dirname, '..');

/** Where the run is decided, sent or kept: no word of the player's language may come in here */
const RUN_DIRS = ['sim', 'coop', 'simulator', 'managers', 'director', 'entities', 'game-components', 'services/save-game', 'run-log', 'replay'];

/** What follows the player's choice of language: the service, the language files other than the source, the loader */
const CHOSEN_LANGUAGE = /from '(?:\.\.?\/)+(?:i18n\/)?(?:i18n\.service|dictionaries|messages\/(?!en')[a-z]+|pseudo)'/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts') && !/\.(spec|scenario|perf|bench)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe('no language in the run (TODO E245)', () => {
  it('the simulation, coop, saves, replays and the run log never read the language the player chose', () => {
    const found: string[] = [];
    for (const dir of RUN_DIRS) {
      for (const file of sources(join(app, ...dir.split('/')))) {
        const text = readFileSync(file, 'utf8');
        for (const line of text.split('\n')) {
          if (/^\s*import\s/.test(line) && CHOSEN_LANGUAGE.test(line)) found.push(`${relative(app, file).split(sep).join('/')}: ${line.trim()}`);
        }
        if (/\binjectT\s*\(|\binject\(\s*I18n\b/.test(text)) found.push(`${relative(app, file).split(sep).join('/')}: reads the dictionary`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the files the coop relay imports read nothing of the dictionary, not even its types', () => {
    const relay = resolve(app, '..', '..', 'coop-server', 'src');
    const imported = new Set<string>();
    for (const name of readdirSync(relay).filter((n) => n.endsWith('.ts'))) {
      for (const m of readFileSync(join(relay, name), 'utf8').matchAll(/from '\.\.\/\.\.\/src\/app\/([^']+)'/g)) imported.add(m[1]);
    }
    expect(imported.size).toBeGreaterThan(3);
    const reading = [...imported].filter((file) => /i18n\//.test(readFileSync(join(app, ...file.split('/')), 'utf8')));
    expect(reading).toEqual([]);
  });

  it('a room option goes over the relay as its value; its words stay on each client', () => {
    for (const option of ROOM_OPTION_CHOICES) {
      expect(option).toEqual({ key: option.key, choices: option.choices });
      for (const choice of option.choices) {
        expect(Object.keys(choice)).toEqual(['value']);
        expect(choice.value).toMatch(/^[a-z-]+$/);
        // Every value has its words in every language
        expect(en.coop.options[option.key]).toHaveProperty(choice.value);
        expect(de.coop.options[option.key]).toHaveProperty(choice.value);
      }
    }
  });

  it('a player without a name goes to the others under one name, the same in every language', () => {
    expect(PLAYER_NAME_FALLBACK).toBe('Player');
  });
});
