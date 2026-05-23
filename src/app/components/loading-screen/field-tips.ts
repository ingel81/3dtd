export interface FieldTip {
  html: string;
}

/**
 * Rotating tips shown while the game boots.
 * Kept generic for now — refine with concrete tower names / mechanics later.
 * Inline `<b style="color:var(--td-…)">` tags pull accents from the theme.
 */
export const FIELD_TIPS: FieldTip[] = [
  {
    html: 'Mix your damage types. A single tower line that all deals the same kind of damage will get walled by the wrong armor.',
  },
  {
    html: 'Frost slows and chips, but its damage is tiny — treat it as a slower. Stack it in front of a <b style="color:var(--td-gold-light)">high-DPS</b> tower so frozen enemies sit in the kill zone longer.',
  },
  {
    html: 'Upgrade costs scale steeply (×1.25 per level). A second tower of a different damage type often beats maxing the first one out.',
  },
  {
    html: 'The compass shows true map north. When the map is rotated, a small reset button appears next to it — click that to face north again.',
  },
  {
    html: 'Chain and splash towers chew through <b style="color:var(--td-teal-light)">swarm waves</b> where single-target towers fall behind. The denser the group, the bigger the payoff.',
  },
  {
    html: 'Heavy armor shrugs off most damage but folds to <b style="color:var(--td-teal-light)">siege</b>. Check the wave preview for the next armor mix before you spend.',
  },
  {
    html: 'Damage numbers flag the matchup: tiny grey means your tower is the wrong type, big gold means it is the perfect counter.',
  },
  {
    html: 'Plan research around upcoming waves — one node before a Ghost surge or an armored boss can flip the fight. Research resets on game restart.',
  },
  {
    html: 'Watch the route grid in build mode — towers placed off the corridor will not have line of sight to incoming enemies.',
  },
  {
    html: 'Selling a tower refunds <b style="color:var(--td-gold-light)">75%</b> of everything you invested — base cost plus all upgrades. Don\'t hesitate to reshuffle between waves.',
  },
];
