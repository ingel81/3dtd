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
  warnOrange: '#C96A3A', // fills, stripes, edges; on panels below AA as text
  warnText: '#D98A4A', // warning text on panels
  disabled: '#5B625C',

  // === Danger (destructive buttons, Game Over) ===
  dangerBg: '#3A1410',
  dangerEdge: '#B83E32',
  dangerText: '#F2C9C2',

  // === HUD states ===
  hpText: '#E36A5A', // HQ number; healthRed is a fill, too dark for text
  hpLow: '#E8735F', // HQ under 30 %
  hpWarmTop: '#3A1F1A', // HQ plate under 30 %
  hpWarmBottom: '#251612',
  gain: '#9ED6A0', // +credits
  loss: '#E36A5A', // -credits, a buy that fails

  // === Plates (panels, dialogs, menu) ===
  plateTop: '#262F28',
  plateBottom: '#1D241F',
  plateHeadTop: '#2B332D',
  plateHeadBottom: '#202722',
  lineBrass: '#8E7228', // 2px top edge of a title plate
  lineSteel: '#4A544D', // 1px frame of a plate
  ink: '#1A140A', // text on brass
  brassLip: '#4A3A12', // hard bottom edge of a brass button

  // === Text colors ===
  // Never use pure white!
  textPrimary: '#EEF1EB', // (was #ECEFE9)
  textSecondary: '#B6C0B3', // (was #B2BCAF)
  textMuted: '#8E988C', // (was #8B948A)
  textTertiary: '#7A837A', // Non-text only (icons, rules); below AA as text on panels
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
 * Schriften (docs/DESIGN_SYSTEM.md)
 * Display (Oswald) → Titel, Menü, Knöpfe, HUD-Zahlen
 * Body (Inter Tight) → Fließtext, Namen, Beschreibungen
 * Mono (JetBrains Mono) → Zahlen in Tabellen, Kosten, Hotkeys, Codes, kleine Labels
 */
export const TD_FONTS = {
  mono: `'JetBrains Mono', ui-monospace, monospace`,
  body: `'Inter Tight', system-ui, -apple-system, sans-serif`,
  display: `'Oswald', 'Arial Narrow', system-ui, sans-serif`,
} as const;

/** Schriftgrößen und Laufweiten. Nichts unter micro (10px). */
export const TD_TYPE = {
  micro: '10px',
  small: '11px',
  body: '13px',
  lead: '15px',
  title: '18px',
  hud: '22px',
  menu: '26px',
  hero: '44px',
  trackCaps: '0.12em',
  trackTitle: '0.06em',
} as const;

/** Abstände: 4/8/12/16/24/32 */
export const TD_SPACE = ['4px', '8px', '12px', '16px', '24px', '32px'] as const;

/** Formen: abgeschrägte Ecken der Platten, sonst eckig */
export const TD_SHAPE = {
  cut: '10px',
  cutSm: '6px',
  radius: '0',
} as const;

/** Bewegung */
export const TD_MOTION = {
  fast: '120ms',
  mid: '220ms',
  slow: '450ms',
  easeOut: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
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
 * CSS Custom Properties String. Steht einmal auf :root (installThemeVars in
 * main.ts), damit auch Overlays (.cdk-overlay-container) sie sehen.
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
  --td-warn-text: ${TD_THEME.warnText};
  --td-disabled: ${TD_THEME.disabled};

  --td-danger-bg: ${TD_THEME.dangerBg};
  --td-danger-edge: ${TD_THEME.dangerEdge};
  --td-danger-text: ${TD_THEME.dangerText};

  --td-hp-text: ${TD_THEME.hpText};
  --td-hp-low: ${TD_THEME.hpLow};
  --td-hp-plate: linear-gradient(180deg, ${TD_THEME.hpWarmTop}, ${TD_THEME.hpWarmBottom});
  --td-gain: ${TD_THEME.gain};
  --td-loss: ${TD_THEME.loss};
  --td-hazard: repeating-linear-gradient(-45deg, ${TD_THEME.warnOrange} 0 6px, ${TD_THEME.ink} 6px 12px);

  --td-plate: linear-gradient(180deg, ${TD_THEME.plateTop}, ${TD_THEME.plateBottom});
  --td-plate-top: ${TD_THEME.plateTop};
  --td-plate-head: linear-gradient(180deg, ${TD_THEME.plateHeadTop}, ${TD_THEME.plateHeadBottom});
  --td-line-brass: ${TD_THEME.lineBrass};
  --td-line-steel: ${TD_THEME.lineSteel};
  --td-ink: ${TD_THEME.ink};
  --td-brass-lip: ${TD_THEME.brassLip};

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

  --td-fs-micro: ${TD_TYPE.micro};
  --td-fs-small: ${TD_TYPE.small};
  --td-fs-body: ${TD_TYPE.body};
  --td-fs-lead: ${TD_TYPE.lead};
  --td-fs-title: ${TD_TYPE.title};
  --td-fs-hud: ${TD_TYPE.hud};
  --td-fs-menu: ${TD_TYPE.menu};
  --td-fs-hero: ${TD_TYPE.hero};
  --td-track-caps: ${TD_TYPE.trackCaps};
  --td-track-title: ${TD_TYPE.trackTitle};

  --td-sp-1: ${TD_SPACE[0]};
  --td-sp-2: ${TD_SPACE[1]};
  --td-sp-3: ${TD_SPACE[2]};
  --td-sp-4: ${TD_SPACE[3]};
  --td-sp-5: ${TD_SPACE[4]};
  --td-sp-6: ${TD_SPACE[5]};

  --td-cut: ${TD_SHAPE.cut};
  --td-cut-sm: ${TD_SHAPE.cutSm};
  --td-radius: ${TD_SHAPE.radius};

  --td-dur-fast: ${TD_MOTION.fast};
  --td-dur-mid: ${TD_MOTION.mid};
  --td-dur-slow: ${TD_MOTION.slow};
  --td-ease-out: ${TD_MOTION.easeOut};

  --td-focus-color: ${TD_THEME.goldLight};
  --td-focus-width: 2px;
  --td-focus-offset: 2px;

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

/**
 * Setzt TD_CSS_VARS einmal als `:root`-Regel in den Kopf des Dokuments, vor dem
 * Bootstrap (main.ts). Ein Stylesheet statt Inline-Style am <html>, damit
 * Komponenten sie wie jede Regel überschreiben können.
 */
export function installThemeVars(doc: Document): void {
  const id = 'td-theme-vars';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `:root {${TD_CSS_VARS}}`;
  doc.head.prepend(style);
}
