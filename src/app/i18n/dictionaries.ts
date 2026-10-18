import type { Locale } from './locale';
import { en, type Messages } from './messages/en';

/**
 * Where each language's texts come from. English is in the main bundle (the
 * fallback while another loads); every other language is a chunk of its own,
 * fetched when chosen, so a player pays only for the language they play in.
 */
export const DICTIONARIES: Readonly<Record<Locale, () => Promise<Messages>>> = {
  en: () => Promise.resolve(en),
  de: () => import('./messages/de').then((m) => m.de),
};
