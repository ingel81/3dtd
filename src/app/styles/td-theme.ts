/**
 * Tower Defense Theme - WC3/Ancient Command inspired
 * Central color scheme with CSS Custom Properties
 *
 * Design Refinements (2026-05): tokens shifted by ~1L for better depth staging,
 * gold desaturated to "antique brass", new bevel/glass/glow recipes.
 * The design notes were never checked in; docs/DESIGN_SYSTEM.md describes the tokens.
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
  // Tooltip accents for lightning and chaos towers, the DAMAGE_TYPE_UI colours
  lightning: '#7DD3FC',
  chaos: '#D946EF',

  // === Debug & Event Category Colors ===
  eventVfx: '#a855f7', // VFX events (purple)
  eventAudio: '#3b82f6', // Audio events (blue)
  perfCritical: '#ff4444', // Critical performance threshold
  perfWarning: '#ff8844', // Warning/bottleneck (orange-red)
} as const;

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
 * Layout-Tokens
 * Sidebar-Breite und seitlicher Innenabstand der Sidebar-Sektionen. Der Header
 * richtet seine Stat-Leiste an diesen Kanten aus (game-header), deshalb zentral.
 */
export const TD_LAYOUT = {
  sidebarWidth: '300px',
  sidebarGutter: '14px',
} as const;

/**
 * Stapelung der Canvas-HUD-Teile (z-index), von unten nach oben: Markierungen
 * auf der Karte (Ping-Pfeile), HUD-Leisten (Fähigkeitenleiste, Squad-Box),
 * das Coop-Dock darüber. Dialoge und Overlays liegen weit darüber.
 */
export const TD_LAYERS = {
  marks: 5,
  hud: 6,
  dock: 7,
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
  --td-lightning: ${TD_THEME.lightning};
  --td-chaos: ${TD_THEME.chaos};

  --td-shadow-soft: ${TD_SHADOWS.shadowSoft};
  --td-shadow-key: ${TD_SHADOWS.shadowKey};
  --td-inner-highlight: ${TD_SHADOWS.innerHighlight};
  --td-gold-glow: ${TD_SHADOWS.goldGlow};
  --td-teal-glow: ${TD_SHADOWS.tealGlow};

  --td-font-mono: ${TD_FONTS.mono};
  --td-font-body: ${TD_FONTS.body};
  --td-font-display: ${TD_FONTS.display};

  --td-sidebar-width: ${TD_LAYOUT.sidebarWidth};
  --td-sidebar-gutter: ${TD_LAYOUT.sidebarGutter};

  --td-z-marks: ${TD_LAYERS.marks};
  --td-z-hud: ${TD_LAYERS.hud};
  --td-z-dock: ${TD_LAYERS.dock};

  --td-event-vfx: ${TD_THEME.eventVfx};
  --td-event-audio: ${TD_THEME.eventAudio};
  --td-perf-critical: ${TD_THEME.perfCritical};
  --td-perf-warning: ${TD_THEME.perfWarning};
`;
