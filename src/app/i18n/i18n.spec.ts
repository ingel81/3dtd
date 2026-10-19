import '@angular/compiler';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { UIStore } from '../store/ui.store';
import { DICTIONARIES } from './dictionaries';
import { formatters } from './format';
import { I18n, type I18nService } from './i18n.service';
import { LOCALES, SOURCE_LOCALE, detectLocale, resolveLocale } from './locale';
import { en, type Messages } from './messages/en';
import { RUN_PLAN } from '../director/sources/budget/run-plan';
import { WAVE_TABLE } from '../director/sources/table/wave-table';

/** Every leaf of a dictionary by its key path: a text, or a function and its number of values */
function leaves(node: unknown, path = '', out = new Map<string, string | number>()): Map<string, string | number> {
  if (typeof node === 'string') out.set(path, 'text');
  else if (node === null) out.set(path, 'none');
  else if (typeof node === 'function') out.set(path, node.length);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  else out.set(path, `bad ${typeof node}`);
  return out;
}

function leafAt(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict);
}

/**
 * A value for every parameter of a text: a number (7) where one is read, a
 * string where one is joined, and every field of an object reads as it too
 */
const SAMPLE: unknown = new Proxy({}, {
  get: (_target, key) => {
    if (key === Symbol.toPrimitive) return () => 7;
    if (key === 'length') return 1;
    if (key === 'join' || key === 'toUpperCase' || key === 'toLowerCase' || key === 'toString') return () => '7';
    if (key === 'map') return (each: (v: unknown) => unknown) => [each(SAMPLE)];
    return SAMPLE;
  },
});

describe('dictionaries (TODO E245)', () => {
  const source = leaves(en);

  for (const locale of LOCALES) {
    it(`${locale} has exactly the keys of English, each of the same kind`, async () => {
      const dict = await DICTIONARIES[locale]();
      const own = leaves(dict);
      expect([...own.keys()].filter((k) => !source.has(k)), 'keys English does not have').toEqual([]);
      expect([...source.keys()].filter((k) => !own.has(k)), 'keys missing').toEqual([]);
      for (const [key, kind] of source) expect(own.get(key), key).toBe(kind);
    });

    it(`${locale} says something for every key, with all its values in`, async () => {
      const dict = await DICTIONARIES[locale]();
      for (const [key, kind] of leaves(dict)) {
        if (kind === 'none') continue;
        const leaf = leafAt(dict, key);
        const text = typeof leaf === 'function' ? (leaf as (...a: unknown[]) => unknown)(...Array.from({ length: kind as number }, () => SAMPLE)) : leaf;
        expect(typeof text, key).toBe('string');
        expect((text as string).trim(), key).not.toBe('');
        expect(text, key).not.toMatch(/undefined|NaN|\[object /);
      }
    });
  }
});

describe('wave names', () => {
  it('every wave the run plan and the wave list name has a text in every language', async () => {
    const names = new Set([...RUN_PLAN.map((row) => row.name), ...WAVE_TABLE.waves.map((row) => row.name)]);
    for (const locale of LOCALES) {
      const dict = await DICTIONARIES[locale]();
      expect([...names].filter((name) => !dict.hud.wave.names[name]), locale).toEqual([]);
    }
  });
});

describe('the type Messages', () => {
  it('turns a missing or an extra key into a compile error (tsc -p tsconfig.spec.json)', () => {
    // @ts-expect-error a language without a key does not compile
    const missing: Messages = { common: en.common, units: en.units };
    // @ts-expect-error nor one with a key English does not have
    const extra: Messages = { ...en, extra: 'x' };
    // @ts-expect-error nor one whose text takes other values
    const values: Messages = { ...en, units: { ...en.units, waves: (n: string) => n } };
    expect([missing, extra, values]).toHaveLength(3);
  });
});

describe('detectLocale', () => {
  it('takes the first language the game speaks, by its main tag', () => {
    expect(detectLocale(['de-AT', 'en'])).toBe('de');
    expect(detectLocale(['fr-FR', 'DE'])).toBe('de');
    expect(detectLocale(['en-GB', 'de'])).toBe('en');
  });

  it('falls back to English', () => {
    expect(detectLocale(['fr', 'ja'])).toBe(SOURCE_LOCALE);
    expect(detectLocale([])).toBe(SOURCE_LOCALE);
  });

  it('a chosen language wins over the system', () => {
    expect(resolveLocale('en', ['de-DE'])).toBe('en');
    expect(resolveLocale('system', ['de-DE'])).toBe('de');
  });
});

describe('formatters', () => {
  it('plurals by the language rule', () => {
    expect(en.units.waves(1)).toBe('1 wave');
    expect(en.units.waves(0)).toBe('0 waves');
    expect(formatters('de').plural(2, 'Welle', 'Wellen')).toBe('Wellen');
  });

  it('groups digits and writes decimals as the language does', () => {
    expect(formatters('en').int(12345)).toBe('12,345');
    expect(formatters('de').int(12345)).toBe('12.345');
    expect(formatters('de').int(999)).toBe('999');
    expect(formatters('de').fixed(2.5, 1)).toBe('2,5');
    expect(formatters('en').fixed(2, 1)).toBe('2.0');
  });
});

describe('I18n', () => {
  let ui: UIStore;
  let i18n: I18nService;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  beforeEach(() => {
    localStorage.removeItem('td-ui-state');
    ui = TestBed.inject(UIStore);
    i18n = TestBed.inject(I18n);
    TestBed.tick();
  });

  it('starts in the system language (English in the test browser)', async () => {
    await i18n.ready();
    expect(i18n.systemLocale).toBe('en');
    expect(i18n.locale()).toBe('en');
    expect(i18n.t().common.cancel).toBe('Cancel');
  });

  it('switches at once when the player picks a language, and back', async () => {
    ui.localePreference.set('de');
    TestBed.tick();
    await i18n.ready();
    expect(i18n.locale()).toBe('de');
    expect(i18n.t().common.cancel).toBe('Abbrechen');
    expect(document.documentElement.getAttribute('lang')).toBe('de');

    ui.localePreference.set('system');
    TestBed.tick();
    await i18n.ready();
    expect(i18n.t().common.cancel).toBe('Cancel');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('loads a stored choice as it is made, before any change detection: the app waits for it before the first frame', async () => {
    TestBed.resetTestingModule();
    localStorage.setItem('td-ui-state', JSON.stringify({ locale: 'de' }));
    const fresh = TestBed.inject(I18n);
    await fresh.ready();
    expect(fresh.locale()).toBe('de');
    localStorage.removeItem('td-ui-state');
  });

  it('the last choice wins when loads overlap', async () => {
    ui.localePreference.set('de');
    TestBed.tick();
    const first = i18n.ready();
    ui.localePreference.set('en');
    TestBed.tick();
    await first;
    await i18n.ready();
    expect(i18n.locale()).toBe('en');
  });
});

describe('UIStore.localePreference', () => {
  beforeEach(() => localStorage.removeItem('td-ui-state'));

  it('reads the stored choice, and keeps "system" for anything else', () => {
    localStorage.setItem('td-ui-state', JSON.stringify({ infoOverlayVisible: false, streetsVisible: false, routesVisible: true, spatialGridDebugVisible: false, locale: 'de' }));
    expect(new UIStore().localePreference()).toBe('de');
    localStorage.setItem('td-ui-state', JSON.stringify({ infoOverlayVisible: false, streetsVisible: false, routesVisible: true, spatialGridDebugVisible: false, locale: 'xx' }));
    expect(new UIStore().localePreference()).toBe('system');
  });
});
