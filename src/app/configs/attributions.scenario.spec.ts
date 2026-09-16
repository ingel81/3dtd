/**
 * Playtest 302 (night 2026-09-14): the Attributions dialog from the sidebar
 * footer names the hero model and the world map data. The dialog draws
 * ATTRIBUTIONS as it stands (attributions-dialog.component.html: a section
 * per category with its title, per entry the name, "by" the author and the
 * licence badge), so these are the lines the player reads. The dialog itself
 * is not rendered here.
 */
import { describe, it, expect } from 'vitest';
import { ATTRIBUTIONS } from './attributions.config';

const category = (title: string) => ATTRIBUTIONS.find((c) => c.title === title);

describe('Attributions of the hero and the world map (playtest 302)', () => {
  it('302: lists the SWAT model as the hero, by Quaternius, CC0', () => {
    expect(category('3D Models')!.items).toContainEqual(expect.objectContaining({
      name: 'SWAT (Hero, recoloured, gun added)',
      author: 'Quaternius',
      license: 'CC0',
    }));
  });

  it('names Stone Golem and Herbert as original work of ingel81 (decided 2026-09-16)', () => {
    for (const name of ['Stone Golem', 'Herbert']) {
      expect(category('3D Models')!.items).toContainEqual({ name, author: 'ingel81', license: 'Original work' });
    }
  });

  it('302: has a section "Map Data" with Natural Earth, Public Domain', () => {
    expect(category('Map Data')!.items).toEqual([
      expect.objectContaining({ author: 'Natural Earth', license: 'Public Domain' }),
    ]);
  });
});
