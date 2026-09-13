import { describe, it, expect } from 'vitest';
import { screenshotFileName } from './screenshot';

describe('screenshotFileName', () => {
  const date = new Date(2026, 8, 13, 7, 5, 9);

  it('puts place and local time into the name', () => {
    expect(screenshotFileName('Times Square, New York', date)).toBe('3dtd-times-square-new-york-20260913-070509.png');
  });

  it('reduces accents and other characters to ASCII and dashes', () => {
    expect(screenshotFileName('Place de l\'Opéra, Paris 9e', date)).toBe('3dtd-place-de-l-opera-paris-9e-20260913-070509.png');
    expect(screenshotFileName('Staroměstské náměstí', date)).toBe('3dtd-staromestske-namesti-20260913-070509.png');
  });

  it('leaves the place out when nothing of it is left', () => {
    expect(screenshotFileName('渋谷', date)).toBe('3dtd-20260913-070509.png');
    expect(screenshotFileName('', date)).toBe('3dtd-20260913-070509.png');
  });

  it('caps a long place without a trailing dash', () => {
    const name = screenshotFileName('Avenida Nossa Senhora de Copacabana 165, Rio de Janeiro', date);
    const slug = name.slice('3dtd-'.length, -'-20260913-070509.png'.length);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});
