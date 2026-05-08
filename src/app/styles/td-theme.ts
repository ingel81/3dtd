/**
 * Tower Defense Theme - WC3/Ancient Command inspired
 * Central color scheme with CSS Custom Properties
 *
 * Design Refinements (2026-05): tokens shifted by ~1L for better depth staging,
 * gold desaturated to "antique brass", new bevel/glass/glow recipes.
 * See: tmp/README.md (Tower Defense — Design Refinements).
 */

export const TD_THEME = {
  // === Base surfaces (Sidebar & Panels) ===
  bgDark: '#111613', // Main sidebar, dark stone (was #141815)
  bgSurface: '#1A201C', // General surface (Overlay, Loading)
  panelDark: '#181D19', // Dark panel sections (debugger selected states)
  panelPrimary: '#222A24', // Primary panel surface (alias for panelMain)
  panelMain: '#222A24', // Primary panel surface (was #232B25)
  panelSecondary: '#1A1F1B', // Sub-panels, slots (was #1C221E)
  panelShadow: '#0B0F0C', // Inset shadow, depth (was #0F130F)

  // === Frames & Material (WC3-DNA) ===
  // Rule: light on top, dark on bottom (classic WC3 look)
  frameDark: '#2F3631', // Bottom edge, shadow (was #3A423C)
  frameMid: '#4A544D', // Main frame color (was #4F5A53)
  frameLight: '#7A8580', // Top edge / highlight (was #6B756D)
  edgeHighlight: '#A7B3A8', // Focus, selection (was #8E9A90)

  // === Accent colors (Magic & Authority) ===
  // Use sparingly!
  // Gold leicht entsättigt → "antikes Messing" statt Goldmedaille
  gold: '#C2A055', // Important, buttons, titles (was #C9A44C)
  goldLight: '#D9BC68', // Button highlight (was #E0C06A)
  goldDark: '#8E7228', // Pressed / inactive (was #9E7E32)
  // Teal kühler & ruhiger
  teal: '#6BB6A4', // Magical accents (was #6FB7A5)
  tealLight: '#8FD9C6', // Button highlight (was #5DE8C2)
  tealDark: '#1F8772', // Button shadow (was #1A9A7A)
  green: '#9ED6A0', // Buffs, positive
  greenDark: '#6AAB6C', // Pressed / button shadow

  // === Status & Feedback colors ===
  healthRed: '#B83E32', // wärmer (was #B14436)
  healthBg: '#2E1614', // (was #3A1B18)
  warnOrange: '#C96A3A',
  disabled: '#5B625C',

  // === Text colors ===
  // Never use pure white!
  textPrimary: '#EEF1EB', // (was #ECEFE9)
  textSecondary: '#B6C0B3', // (was #B2BCAF)
  textMuted: '#8E988C', // (was #8B948A)
  textTertiary: '#7A837A', // Between muted and disabled, for pending/inactive elements
  textDisabled: '#6A726A',

  // === Decorative / Rune accents (new) ===
  // For section dividers, header underlines, tower-tier markers
  runeAmber: '#A47A2C',
  runeAmberMuted: '#6B5320',

  // === Glass / Scrim (new) ===
  // For overlays with backdrop-blur
  glassTint: 'rgba(17,22,19,0.78)',
  scrim: 'rgba(8,11,9,0.58)',

  // === Damage-Type Cold (new) ===
  // Tooltip armor-rows for cold damage
  cold: '#5BA4D9',

  // === Debug & Event Category Colors ===
  eventVfx: '#a855f7', // VFX events (purple)
  eventAudio: '#3b82f6', // Audio events (blue)
  perfCritical: '#ff4444', // Critical performance threshold
  perfWarning: '#ff8844', // Warning/bottleneck (orange-red)
} as const;

export type TdThemeKey = keyof typeof TD_THEME;

/**
 * Shadow & glow recipes (new)
 * String values, applied via CSS custom properties.
 */
export const TD_SHADOWS = {
  /** Soft drop shadow for elevated surfaces (dialogs, popovers) */
  shadowSoft: '0 6px 20px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.5)',
  /** Subtle key shadow for inset/raised buttons */
  shadowKey: '0 1px 0 rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)',
  /** Inner highlight for raised surfaces */
  innerHighlight: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  /** Gold glow on hover/active */
  goldGlow: '0 0 14px rgba(194,160,85,0.28), 0 0 0 1px rgba(217,188,104,0.15)',
  /** Teal glow on hover/active */
  tealGlow: '0 0 14px rgba(107,182,164,0.32), 0 0 0 1px rgba(143,217,198,0.18)',
} as const;

/**
 * Type-Pairing Tokens (new)
 * Mono → Stats, HP-values, Cost-Badges, Hotkey-Chips, Wave-Counter, Section-Headers
 * Body → Tower-Names, Tooltip-Body, Dialog-Titles, Hint-Beschreibungen, Address-Labels
 * Display → reserved for Game-Over / Victory (not used yet)
 */
export const TD_FONTS = {
  mono: `'JetBrains Mono', ui-monospace, monospace`,
  body: `'Inter Tight', system-ui, -apple-system, sans-serif`,
  display: `'Cinzel', 'Inter Tight', serif`,
} as const;

/**
 * CSS Custom Properties String
 * For use in :host or root element
 */
export const TD_CSS_VARS = `
  --td-bg-dark: ${TD_THEME.bgDark};
  --td-bg-surface: ${TD_THEME.bgSurface};
  --td-panel-dark: ${TD_THEME.panelDark};
  --td-panel-primary: ${TD_THEME.panelPrimary};
  --td-panel-main: ${TD_THEME.panelMain};
  --td-panel-secondary: ${TD_THEME.panelSecondary};
  --td-panel-shadow: ${TD_THEME.panelShadow};

  --td-frame-dark: ${TD_THEME.frameDark};
  --td-frame-mid: ${TD_THEME.frameMid};
  --td-frame-light: ${TD_THEME.frameLight};
  --td-edge-highlight: ${TD_THEME.edgeHighlight};

  --td-gold: ${TD_THEME.gold};
  --td-gold-light: ${TD_THEME.goldLight};
  --td-gold-dark: ${TD_THEME.goldDark};
  --td-teal: ${TD_THEME.teal};
  --td-teal-light: ${TD_THEME.tealLight};
  --td-teal-dark: ${TD_THEME.tealDark};
  --td-green: ${TD_THEME.green};
  --td-green-dark: ${TD_THEME.greenDark};

  --td-red: ${TD_THEME.healthRed};
  --td-health-red: ${TD_THEME.healthRed};
  --td-health-bg: ${TD_THEME.healthBg};
  --td-warn-orange: ${TD_THEME.warnOrange};
  --td-disabled: ${TD_THEME.disabled};

  --td-text-primary: ${TD_THEME.textPrimary};
  --td-text-secondary: ${TD_THEME.textSecondary};
  --td-text-muted: ${TD_THEME.textMuted};
  --td-text-tertiary: ${TD_THEME.textTertiary};
  --td-text-disabled: ${TD_THEME.textDisabled};

  --td-rune-amber: ${TD_THEME.runeAmber};
  --td-rune-amber-muted: ${TD_THEME.runeAmberMuted};
  --td-glass-tint: ${TD_THEME.glassTint};
  --td-scrim: ${TD_THEME.scrim};
  --td-cold: ${TD_THEME.cold};

  --td-shadow-soft: ${TD_SHADOWS.shadowSoft};
  --td-shadow-key: ${TD_SHADOWS.shadowKey};
  --td-inner-highlight: ${TD_SHADOWS.innerHighlight};
  --td-gold-glow: ${TD_SHADOWS.goldGlow};
  --td-teal-glow: ${TD_SHADOWS.tealGlow};

  --td-font-mono: ${TD_FONTS.mono};
  --td-font-body: ${TD_FONTS.body};
  --td-font-display: ${TD_FONTS.display};

  --td-event-vfx: ${TD_THEME.eventVfx};
  --td-event-audio: ${TD_THEME.eventAudio};
  --td-perf-critical: ${TD_THEME.perfCritical};
  --td-perf-warning: ${TD_THEME.perfWarning};
`;

/**
 * Bevel recipe — raised panel (new system)
 *
 * 1px outline + inset highlight + footer line.
 * Replaces the legacy 4-border WC3 bevel — same depth, fewer visible seams,
 * uniform render cost.
 */
export const TD_BEVEL_PANEL = `
  border: 1px solid var(--td-frame-dark);
  box-shadow:
    inset 0 1px 0 rgba(122, 133, 128, 0.2),
    inset 0 -1px 0 var(--td-panel-shadow),
    0 1px 0 var(--td-panel-shadow);
`;

/**
 * Bevel recipe — pressed/inset surface (slots, inputs, hp-backgrounds)
 */
export const TD_BEVEL_INSET = `
  border: 1px solid var(--td-frame-dark);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.5),
    inset 0 -1px 0 rgba(74, 84, 77, 0.13);
`;

/**
 * Glass overlay recipe (dialogs, hint-popups, quick-actions)
 *
 * Stone-tinted matte glass via backdrop-blur. Use on:
 *   .td-dialog-panel .mdc-dialog__surface, app-context-hint, quick-actions buttons.
 */
export const TD_BEVEL_GLASS = `
  background: var(--td-glass-tint);
  backdrop-filter: blur(8px) saturate(1.1);
  -webkit-backdrop-filter: blur(8px) saturate(1.1);
  border: 1px solid var(--td-frame-mid);
  box-shadow: var(--td-shadow-soft), inset 0 1px 0 rgba(122, 133, 128, 0.33);
`;

/**
 * Gemeinsame Panel-Styles (WC3-Rahmen)
 * Verwendung: background: var(--td-panel-main);
 */
export const TD_PANEL_STYLES = `
  background: var(--td-panel-main);
  ${TD_BEVEL_PANEL}
  color: var(--td-text-primary);
`;

/**
 * Gold Button — Material-Look (gradient + inner highlight + glow-hover)
 */
export const TD_BUTTON_STYLES = `
  background: linear-gradient(
    180deg,
    var(--td-gold-light) 0%,
    var(--td-gold) 55%,
    var(--td-gold-dark) 100%
  );
  color: #1A140A;
  border: 1px solid #11140F;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35),
    var(--td-shadow-key);
  font-family: var(--td-font-mono);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 8px 14px;
  cursor: pointer;
  transition: box-shadow .18s ease;
`;

/**
 * Teal Button — Magic-Look variant
 */
export const TD_BUTTON_TEAL_STYLES = `
  background: linear-gradient(
    180deg,
    var(--td-teal-light) 0%,
    var(--td-teal) 55%,
    var(--td-teal-dark) 100%
  );
  color: #0E1612;
  border: 1px solid #11140F;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35),
    var(--td-shadow-key);
  font-family: var(--td-font-mono);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 8px 14px;
  cursor: pointer;
  transition: box-shadow .18s ease;
`;

/**
 * Slot style (for items, tower selection etc.)
 */
export const TD_SLOT_STYLES = `
  background: var(--td-panel-secondary);
  ${TD_BEVEL_PANEL}
`;

/**
 * Secondary Button (Border-only, for cancel etc.)
 */
export const TD_BUTTON_SECONDARY_STYLES = `
  background: var(--td-panel-main);
  color: var(--td-text-secondary);
  border: 1px solid var(--td-frame-dark);
  box-shadow:
    inset 0 1px 0 rgba(122, 133, 128, 0.2),
    var(--td-shadow-key);
  font-family: var(--td-font-mono);
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: box-shadow .18s ease, color .15s ease;
`;

/**
 * Dialog Container Styles
 */
export const TD_DIALOG_STYLES = `
  background: var(--td-panel-main);
  ${TD_BEVEL_PANEL}
  color: var(--td-text-primary);
  font-family: var(--td-font-body);
`;

/**
 * Input Field Styles
 */
export const TD_INPUT_STYLES = `
  background: var(--td-panel-shadow);
  ${TD_BEVEL_INSET}
  color: var(--td-text-primary);
  font-family: var(--td-font-mono);
  transition: border-color 0.15s ease;
`;

/**
 * Radio/Checkbox Option Styles (Slot-like)
 */
export const TD_OPTION_STYLES = `
  background: var(--td-panel-secondary);
  ${TD_BEVEL_PANEL}
  cursor: pointer;
  transition: box-shadow 0.15s ease;
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
