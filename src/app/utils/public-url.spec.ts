import { describe, expect, it } from 'vitest';
import { PUBLIC_GAME_URL, shareableUrl } from './public-url';

describe('shareableUrl', () => {
  it('leaves web addresses alone', () => {
    expect(shareableUrl('https://3dtd.sgeht.net/play/?l=48.1,11.5')).toBe('https://3dtd.sgeht.net/play/?l=48.1,11.5');
    expect(shareableUrl('http://localhost:4200/?l=48.1,11.5&s=48.2,11.6')).toBe(
      'http://localhost:4200/?l=48.1,11.5&s=48.2,11.6'
    );
  });

  it('points a desktop address at the web version with the same location', () => {
    expect(shareableUrl('app://app/?l=40.75701,-73.98597&s=40.76693,-73.97898')).toBe(
      `${PUBLIC_GAME_URL}?l=40.75701,-73.98597&s=40.76693,-73.97898`
    );
    expect(shareableUrl('app://app/')).toBe(PUBLIC_GAME_URL);
  });

  it('drops the fragment of a desktop address with the rest of it', () => {
    expect(shareableUrl('app://app/some/route?l=1,2#x')).toBe(`${PUBLIC_GAME_URL}?l=1,2`);
  });

  it('returns what it cannot read unchanged', () => {
    expect(shareableUrl('not a url')).toBe('not a url');
  });
});
