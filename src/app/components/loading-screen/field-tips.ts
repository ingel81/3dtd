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
    html: 'Frost slows but deals no damage. Pair it with a <b style="color:var(--td-gold-light)">high-DPS</b> tower downstream so the slow actually buys you kills.',
  },
  {
    html: 'Range upgrades hit diminishing returns at higher tiers. Splash and chain effects keep scaling — invest where the curve still bends.',
  },
  {
    html: 'The compass shows true map north. Click it to reset the bearing if you got lost rotating around the map.',
  },
  {
    html: 'Chain and splash towers love <b style="color:var(--td-teal-light)">clustered enemies</b>. Place them where two routes converge.',
  },
  {
    html: 'Heavy armor laughs at most damage but folds to <b style="color:var(--td-teal-light)">siege</b>. Check the wave preview for the next armor mix before you spend.',
  },
  {
    html: 'Research is permanent across runs. Even one node before a tough wave can change the math.',
  },
  {
    html: 'Watch the route grid in build mode — towers placed off the corridor will not have line of sight to incoming enemies.',
  },
];
