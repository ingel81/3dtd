/**
 * Tower Defense Theme - WC3/Ancient Command inspired
 * Central color scheme with CSS Custom Properties
 */

export const TD_THEME = {
  // === Base surfaces (Sidebar & Panels) ===
  bgDark: '#141815', // Main sidebar, dark stone
  bgSurface: '#1A201C', // General surface (Overlay, Loading)
  panelMain: '#232B25', // Primary panel surface
  panelSecondary: '#1C221E', // Sub-panels, slots
  panelShadow: '#0F130F', // Inset shadow, depth

  // === Frames & Material (WC3-DNA) ===
  // Rule: light on top, dark on bottom (classic WC3 look)
  frameDark: '#3A423C', // Bottom edge, shadow
  frameMid: '#4F5A53', // Main frame color
  frameLight: '#6B756D', // Top edge / highlight
  edgeHighlight: '#8E9A90', // Focus, selection

  // === Accent colors (Magic & Authority) ===
  // Use sparingly!
  gold: '#C9A44C', // Important, buttons, titles
  goldDark: '#9E7E32', // Pressed / inactive
  teal: '#6FB7A5', // Magical accents
  green: '#9ED6A0', // Buffs, positive
  greenDark: '#6AAB6C', // Pressed / button shadow

  // === Status & Feedback colors ===
  healthRed: '#B14436',
  healthBg: '#3A1B18',
  warnOrange: '#C96A3A',
  disabled: '#5B625C',

  // === Text colors ===
  // Never use pure white!
  textPrimary: '#ECEFE9',
  textSecondary: '#B2BCAF',
  textMuted: '#8B948A',
  textTertiary: '#7A837A', // Between muted and disabled, for pending/inactive elements
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
 * For use in :host or root element
 */
export const TD_CSS_VARS = `
  --td-bg-dark: ${TD_THEME.bgDark};
  --td-bg-surface: ${TD_THEME.bgSurface};
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
  --td-text-tertiary: ${TD_THEME.textTertiary};
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
 * Slot style (for items, tower selection etc.)
 */
export const TD_SLOT_STYLES = `
  background: var(--td-panel-secondary);
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-dark);
  border-left-color: var(--td-frame-dark);
`;

/**
 * Secondary Button (Border-only, for cancel etc.)
 */
export const TD_BUTTON_SECONDARY_STYLES = `
  background: transparent;
  color: var(--td-text-secondary);
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-light);
  border-bottom-color: var(--td-frame-dark);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
`;

/**
 * Dialog Container Styles
 */
export const TD_DIALOG_STYLES = `
  background: var(--td-bg-dark);
  border-top: 1px solid var(--td-frame-light);
  border-left: 1px solid var(--td-frame-mid);
  border-right: 1px solid var(--td-frame-dark);
  border-bottom: 2px solid var(--td-frame-dark);
  color: var(--td-text-primary);
  font-family: 'JetBrains Mono', monospace;
`;

/**
 * Input Field Styles
 */
export const TD_INPUT_STYLES = `
  background: var(--td-panel-shadow);
  border: 1px solid var(--td-frame-dark);
  border-top-color: var(--td-frame-dark);
  border-bottom-color: var(--td-frame-mid);
  color: var(--td-text-primary);
  font-family: 'JetBrains Mono', monospace;
  transition: border-color 0.15s ease;
`;

/**
 * Radio/Checkbox Option Styles (Slot-like)
 */
export const TD_OPTION_STYLES = `
  background: var(--td-panel-secondary);
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-dark);
  border-left-color: var(--td-frame-dark);
  cursor: pointer;
  transition: all 0.15s ease;
`;

/**
 * Custom Scrollbar Styles (Dark Theme)
 * Apply to scrollable containers. Uses Firefox standard properties
 * and Webkit pseudo-elements for cross-browser support.
 *
 * Usage: Add TD_SCROLLBAR_STYLES to the selector in component styles
 * Example: `.event-log { ${TD_SCROLLBAR_STYLES} }`
 */
export const TD_SCROLLBAR_STYLES = `
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: var(--td-frame-mid) var(--td-panel-shadow);
`;

/**
 * Webkit Scrollbar CSS (use as separate rule block)
 * Usage: Add as separate CSS block in component styles
 * Example:
 *   .event-log::-webkit-scrollbar { ... }
 */
export const TD_SCROLLBAR_WEBKIT = {
  scrollbar: `
    width: 8px;
    height: 8px;
  `,
  track: `
    background: var(--td-panel-shadow);
    border-radius: 4px;
  `,
  thumb: `
    background: var(--td-frame-mid);
    border-radius: 4px;
    border: 1px solid var(--td-panel-shadow);
  `,
  thumbHover: `
    background: var(--td-frame-light);
  `,
  corner: `
    background: var(--td-panel-shadow);
  `,
};
