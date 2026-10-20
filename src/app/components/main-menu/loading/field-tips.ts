/** A stretch of a tip's text, `accent` in gold or teal. */
export interface TipPart {
  text: string;
  accent?: 'gold' | 'teal';
}

export interface FieldTip {
  parts: readonly TipPart[];
}

export const gold = (text: string): TipPart => ({ text, accent: 'gold' });
export const teal = (text: string): TipPart => ({ text, accent: 'teal' });

/** A tip from a template literal whose placeholders are its accents (the dictionaries write theirs so, `menu.tips`). */
export function tip(strings: TemplateStringsArray, ...accents: TipPart[]): FieldTip {
  const parts: TipPart[] = [];
  strings.forEach((text, i) => {
    if (text) parts.push({ text });
    if (i < accents.length) parts.push(accents[i]);
  });
  return { parts };
}

/*
 * The rotating tips under the start menu while the game loads behind it are
 * the dictionary's (`menu.tips`). The start menu renders the parts as text
 * and an accent as a coloured `<b>` (main-menu.component.html): no HTML
 * string, so no sanitizer and no style that has to reach past the
 * component's encapsulation.
 */
