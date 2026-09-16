/** A stretch of a tip's text, `accent` in gold or teal. */
export interface TipPart {
  text: string;
  accent?: 'gold' | 'teal';
}

export interface FieldTip {
  parts: readonly TipPart[];
}

const gold = (text: string): TipPart => ({ text, accent: 'gold' });
const teal = (text: string): TipPart => ({ text, accent: 'teal' });

/** A tip from a template literal whose placeholders are its accents. */
function tip(strings: TemplateStringsArray, ...accents: TipPart[]): FieldTip {
  const parts: TipPart[] = [];
  strings.forEach((text, i) => {
    if (text) parts.push({ text });
    if (i < accents.length) parts.push(accents[i]);
  });
  return { parts };
}

/**
 * Rotating tips shown while the game boots.
 * Kept generic for now — refine with concrete tower names / mechanics later.
 * The loading screen renders the parts as text and an accent as a coloured
 * `<b>` (loading-screen.component.html): no HTML string, so no sanitizer and
 * no style that has to reach past the component's encapsulation.
 */
export const FIELD_TIPS: FieldTip[] = [
  tip`Mix your damage types. A single tower line that all deals the same kind of damage will get walled by the wrong armor.`,
  tip`Frost slows and chips, but its damage is tiny, so treat it as a slower. Stack it in front of a ${gold('high-DPS')} tower so frozen enemies sit in the kill zone longer.`,
  tip`Upgrade costs scale steeply (×1.25 per level). A second tower of a different damage type often beats maxing the first one out.`,
  tip`The compass shows true map north. When the map is rotated, a small reset button appears next to it. Click that to face north again.`,
  tip`Chain and splash towers chew through ${teal('swarm waves')} where single-target towers fall behind. The denser the group, the bigger the payoff.`,
  tip`Heavy armor shrugs off most damage but folds to ${teal('siege')}. Check the wave preview for the next armor mix before you spend.`,
  tip`Damage numbers flag the matchup: tiny grey means your tower is the wrong type, big gold means it is the perfect counter.`,
  tip`Plan research around upcoming waves. One node finished before a Ghost surge or an armored boss can flip the fight. Research resets on game restart.`,
  tip`Watch the route grid in build mode. Towers placed off the corridor will not have line of sight to incoming enemies.`,
  tip`Selling a tower refunds ${gold('75%')} of everything you invested, base cost plus all upgrades. Don't hesitate to reshuffle between waves.`,
];
