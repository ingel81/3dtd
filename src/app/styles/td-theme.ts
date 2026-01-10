/**
 * Tower Defense Theme - WC3/Ancient Command inspired
 * Zentrales Farbschema mit CSS Custom Properties
 */

export const TD_THEME = {
  // === Basisflächen (Sidebar & Panels) ===
  bgDark: '#141815', // Haupt-Sidebar, dunkler Stein
  panelMain: '#232B25', // Primäre Panel-Fläche
  panelSecondary: '#1C221E', // Unterpanels, Slots
  panelShadow: '#0F130F', // Inset-Schatten, Tiefe

  // === Rahmen & Material (WC3-DNA) ===
  // Regel: hell oben, dunkel unten (klassischer WC3-Look)
  frameDark: '#3A423C', // Unterkante, Schatten
  frameMid: '#4F5A53', // Haupt-Rahmenfarbe
  frameLight: '#6B756D', // Oberkante / Licht
  edgeHighlight: '#8E9A90', // Fokus, Selektion

  // === Akzentfarben (Magie & Autorität) ===
  // Sparsam einsetzen!
  gold: '#C9A44C', // Wichtiges, Buttons, Titel
  goldDark: '#9E7E32', // Gedrückt / Inaktiv
  teal: '#6FB7A5', // Magische Akzente
  green: '#9ED6A0', // Buffs, Positiv
  greenDark: '#6AAB6C', // Gedrückt / Button-Schatten

  // === Status- & Feedbackfarben ===
  healthRed: '#B14436',
  healthBg: '#3A1B18',
  warnOrange: '#C96A3A',
  disabled: '#5B625C',

  // === Textfarben ===
  // Nie reines Weiß verwenden!
  textPrimary: '#ECEFE9',
  textSecondary: '#B2BCAF',
  textMuted: '#8B948A',
  textDisabled: '#6A726A',

  // === Bars (HP, Mana, Progress) ===
  hpFill: '#B14436',
  hpBg: '#3A1B18',
  manaFill: '#4FB3C2',
  manaBg: '#1A2B30',
  xpFill: '#9ED6A0',
} as const;

export type TdThemeKey = keyof typeof TD_THEME;

/**
 * CSS Custom Properties String
 * Zur Verwendung in :host oder Root-Element
 */
export const TD_CSS_VARS = `
  --td-bg-dark: ${TD_THEME.bgDark};
  --td-panel-main: ${TD_THEME.panelMain};
  --td-panel-secondary: ${TD_THEME.panelSecondary};
  --td-panel-shadow: ${TD_THEME.panelShadow};

  --td-frame-dark: ${TD_THEME.frameDark};
  --td-frame-mid: ${TD_THEME.frameMid};
  --td-frame-light: ${TD_THEME.frameLight};
  --td-edge-highlight: ${TD_THEME.edgeHighlight};

  --td-gold: ${TD_THEME.gold};
  --td-gold-dark: ${TD_THEME.goldDark};
  --td-teal: ${TD_THEME.teal};
  --td-green: ${TD_THEME.green};
  --td-green-dark: ${TD_THEME.greenDark};

  --td-health-red: ${TD_THEME.healthRed};
  --td-health-bg: ${TD_THEME.healthBg};
  --td-warn-orange: ${TD_THEME.warnOrange};
  --td-disabled: ${TD_THEME.disabled};

  --td-text-primary: ${TD_THEME.textPrimary};
  --td-text-secondary: ${TD_THEME.textSecondary};
  --td-text-muted: ${TD_THEME.textMuted};
  --td-text-disabled: ${TD_THEME.textDisabled};

  --td-hp-fill: ${TD_THEME.hpFill};
  --td-hp-bg: ${TD_THEME.hpBg};
  --td-mana-fill: ${TD_THEME.manaFill};
  --td-mana-bg: ${TD_THEME.manaBg};
  --td-xp-fill: ${TD_THEME.xpFill};
`;

/**
 * Gemeinsame Panel-Styles (WC3-Rahmen)
 * Verwendung: background: var(--td-panel-main);
 */
export const TD_PANEL_STYLES = `
  background: var(--td-panel-main);
  border-top: 1px solid var(--td-frame-light);
  border-left: 1px solid var(--td-frame-mid);
  border-right: 1px solid var(--td-frame-dark);
  border-bottom: 2px solid var(--td-frame-dark);
  color: var(--td-text-primary);
`;

/**
 * Button-Styles (Gold-Akzent)
 */
export const TD_BUTTON_STYLES = `
  background: var(--td-gold);
  color: var(--td-bg-dark);
  border: none;
  border-top: 1px solid var(--td-edge-highlight);
  border-bottom: 2px solid var(--td-gold-dark);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
`;

/**
 * Slot-Style (für Items, Tower-Auswahl etc.)
 */
export const TD_SLOT_STYLES = `
  background: var(--td-panel-secondary);
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-dark);
  border-left-color: var(--td-frame-dark);
`;
