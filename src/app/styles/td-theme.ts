/**
 * The design tokens of the game UI (docs/DESIGN_SYSTEM.md): the only place
 * where colours, materials, fonts, sizes, lines and shadows are written down.
 * The recipes in styles/ui/ and the td-* classes read them as --td-* custom
 * properties; components read nothing else.
 *
 * The look: panels of tinted grey plaster, a basalt top bar, buttons and menu
 * entries as stone plates with engraved text, engraved lines, brass as the one
 * accent, Barlow Semi Condensed for all text.
 */

export const TD_THEME = {
  // === Grounds ===
  bgDark: '#0E110F', // page, full-screen ground (research, token step)
  bgSurface: '#151A16', // flat surfaces without plaster: menus of a select, charts
  panelMain: '#1C201E', // the plaster panel as one colour (fallback, contrast checks)
  panelSecondary: '#161A17', // flat areas inside a panel: debug blocks, chart wells
  panelShadow: '#0B0F0C', // deepest dark: wells, globe sea, screenshot plate
  ink: '#0B0F0C', // outline of a panel, text on a light fill

  // The stone surfaces as one colour each (fallback, contrast checks); the real
  // surfaces are the plaster recipes in TD_MATERIALS
  stoneDark: '#2E3330', // main button
  stoneDarker: '#262A27', // secondary and danger button, close, raised tools
  stoneLit: '#4F5450', // chosen table row
  stonePlate: '#494E4B', // chosen menu entry
  well: '#111312', // sunken field on a panel
  topbar: '#282D29', // the basalt top bar
  knob: '#BDB39A', // the handle of a slider
  knobLight: '#EFE6CB',
  knobDark: '#5A5240',
  switchOff: '#7F887D', // the knob of a switch that is off

  // === Lines that are no engraving: charts, the globe, debug graphs ===
  frameDark: '#2F3631',
  frameMid: '#4A544D',
  frameLight: '#7A8580',
  edgeHighlight: '#A7B3A8', // selection mark on a tower badge

  // === Accent: brass, the one accent ===
  brass: '#C9A44C', // section heads, values, icons, focus edge of a field
  brassLight: '#F2DD9A', // text of the main button, chosen entry, hover
  brassDark: '#A98A45', // quiet brass: menu icons at rest

  // === Signal colours ===
  teal: '#6BB6A4', // running, magic, confirmed
  tealLight: '#8FD9C6',
  tealDark: '#1F8772',
  green: '#9ED6A0', // positive, researched
  greenDark: '#6AAB6C',
  healthRed: '#B83E32', // red as a fill (bars, edges); too dark for text
  warnOrange: '#C96A3A', // warning fill, stripe, edge; below AA as text
  warnText: '#D98A4A',

  // === Danger and error ===
  dangerText: '#E2806F', // red text of a danger button on stone
  dangerEdge: '#C8463A', // edge of a field with an error, red marks
  errorText: '#EE8A7A', // the message under a field with an error

  // === HUD states ===
  hpText: '#E87A6A', // HQ number
  hpLow: '#EE8A5E', // HQ under 30 %
  gain: '#9ED6A0', // +credits
  loss: '#E87A6A', // -credits, a buy that fails

  // === Research tree: nodes by state, strands (they carry information) ===
  treeLine: '#2A312C',
  treeWell: '#0D110E',
  nodeTop: '#1C221E',
  nodeBottom: '#151A16',
  nodeLockedTop: '#141915',
  nodeLockedBottom: '#101410',
  nodeLockedEdge: '#262C27',
  nodeLockedTitle: '#94A092',
  nodeLockedFoot: '#8A968A',
  nodeOpenTop: '#232B25',
  nodeOpenBottom: '#191E1A',
  nodePoorEdge: '#3A332B',
  nodePoorMark: '#5C3A24',
  nodePoorHover: '#6E462B',
  nodePoorGlyph: '#9B6440',
  nodeActiveTop: '#1B2723',
  nodeActiveBottom: '#141D1A',
  nodeQueuedTop: '#22201A',
  nodeQueuedBottom: '#181712',
  nodeDoneTop: '#1A261C',
  nodeDoneBottom: '#141C15',
  nodeDoneEdge: '#3B5A3E',
  branchBiology: '#8FA85C',
  branchEngineering: '#8E9BA8',

  // === Text (never pure white) ===
  textPrimary: '#E6E1CF', // names, menu entries, field text
  textSecondary: '#C4CBC1', // running text in dialogs
  textMuted: '#9DA69B', // labels, side information
  textQuiet: '#B9C1B6', // text of a secondary button
  textTitle: '#E6DCC0', // values in rows, light headings
  textEngraved: '#CFC8B2', // titles, engraved into the plaster
  textValue: '#EFE4C2', // big numbers (top bar, results)
  textDim: '#8E978B', // the dim label before the place ("Defend")
  textTertiary: '#7A837A', // no text: quiet icons, rules
  textDisabled: '#6A726A',

  // === Damage types (tooltips, DAMAGE_TYPE_UI) ===
  cold: '#5BA4D9',
  lightning: '#7DD3FC',
  chaos: '#D946EF',
  ethereal: '#B58CF5', // ghosts and other ethereal enemies
  reticle: '#F2F0E8', // the crosshair of a manned tower
  cellSelection: '#E69F00', // cells the cell report picked, on the map and in its panel (Okabe-Ito orange)

  // === Debug and event categories ===
  eventVfx: '#a855f7',
  eventAudio: '#3b82f6',
  perfCritical: '#ff4444',
  perfWarning: '#ff8844',
} as const;

/**
 * Materials: the textures (CC0, Poly Haven, recoloured to the palette; see
 * attributions.config.ts) and the surfaces built from them. A URL resolves
 * against the document, so it works under any base href.
 */
export const TD_MATERIALS = {
  plaster: `url('assets/ui/plaster.jpg')`, // grey_plaster_02
  basalt: `url('assets/ui/basalt.jpg')`, // dark_rock
  size: '512px',
} as const;

/** Lines, shadows and text effects of the plaster look, as CSS values */
export const TD_RELIEF = {
  // An engraved line: dark groove, light edge under it
  lineDark: 'rgba(0,0,0,.5)',
  lineLight: 'rgba(255,255,255,.15)',
  lineWidth: '2px',
  lineGap: '1px',
  // A hairline between rows and under a sidebar head
  hairline: 'rgba(255,255,255,.07)',

  // Text and icons cut into the surface
  engrave: '0 -1px 0 rgba(0,0,0,.85), 0 1px 0 rgba(255,255,255,.14)',
  engraveIcon: 'drop-shadow(0 -1px 0 rgba(0,0,0,.8)) drop-shadow(0 1px 0 rgba(255,255,255,.12))',
  // Text over a picture (the menu globe): a soft dark halo keeps it legible on land, sea and cloud
  overImage: '0 1px 2px rgba(0,0,0,.95), 0 0 10px rgba(0,0,0,.7)',

  // A panel: sunken fill, strong drop
  panelRecess: 'inset 0 3px 8px rgba(0,0,0,.75), inset 0 0 0 1px rgba(0,0,0,.6)',
  panelDrop: '0 0 0 1px #0B0F0C, 0 18px 40px rgba(0,0,0,.8), 0 4px 10px rgba(0,0,0,.6)',

  // Raised stone: main button, secondary button, chosen row, chosen menu entry
  raised: 'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -2px 0 rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.55)',
  raisedQuiet: 'inset 0 1px 0 rgba(255,255,255,.14), inset 0 -3px 0 rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.45)',
  raisedLit: 'inset 0 1px 0 rgba(255,255,255,.18), inset 0 -2px 0 rgba(0,0,0,.55), 0 2px 3px rgba(0,0,0,.5)',
  raisedPlate: 'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -2px 0 rgba(0,0,0,.6), 0 2px 3px rgba(0,0,0,.5)',
  pressed: 'inset 0 3px 6px rgba(0,0,0,.75)',

  // Sunken: fields, segments, switches, cards
  well: 'rgba(0,0,0,.4)',
  wellShadow: 'inset 0 2px 4px rgba(0,0,0,.7), 0 1px 0 rgba(255,255,255,.07)',
  wellSoft: 'rgba(0,0,0,.24)',
  wellSoftShadow: 'inset 0 2px 4px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.06)',
  wellDeep: 'inset 0 2px 5px rgba(0,0,0,.7)',

  // The top bar: plate edge at the bottom
  topbarEdge: 'inset 0 -3px 0 rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.1), 0 4px 10px rgba(0,0,0,.55)',

  // A popup over the panel: tooltip, open select, context menu
  popupDrop: '0 0 0 1px #0B0F0C, 0 8px 16px rgba(0,0,0,.6)',
} as const;

/** Tint over the plaster, as r,g,b and its strength */
export const TD_TINT = {
  rgb: '12,15,13',
  panel: '.65', // a panel or dialog
  overlay: '.55', // a strip over the map, the map shows through
  overlayOpacity: '.86', // how much of the plaster such a strip keeps
  // Behind the open menu: dark from the left, fading out over 65 % of the
  // width onto an even base darkening
  menuFade: 0.8,
  menuFadeWidth: 65,
  menuBase: 0.35,
} as const;

/** Fonts: Barlow Semi Condensed for all text, mono only for codes and keys */
export const TD_FONTS = {
  ui: `'Barlow Semi Condensed', 'Arial Narrow', system-ui, sans-serif`,
  mono: `'JetBrains Mono', ui-monospace, monospace`,
} as const;

/** Font sizes. Nothing under micro. */
export const TD_TYPE = {
  micro: '11px', // caps labels in the HUD
  small: '13px', // side information, table heads, notes
  body: '15px', // text in the sidebar and tooltips
  text: '17px', // running text in dialogs, fields, rows
  button: '17px',
  lead: '19px', // small figures (tiles, counts), a research's title
  title: '21px', // dialog titles
  menu: '22px', // menu entries
  hud: '29px', // numbers in the top bar
  hero: '44px', // the boss's name in the boss intro
  trackCaps: '0.1em',
} as const;

/** Spacing: 4/8/12/16/24 */
export const TD_SPACE = ['4px', '8px', '12px', '16px', '24px'] as const;

/** Sizes of the controls */
export const TD_SIZE = {
  radius: '3px',
  button: '36px',
  buttonSm: '30px',
  field: '40px',
  row: '40px',
  rowGap: '4px',
  close: '24px',
  /** Square stone buttons with an icon, and their small size (rows, strips) */
  iconBtn: '32px',
  iconSm: '26px',
  tool: '32px',
  menuItem: '48px',
  menuWidth: '320px',
  topbar: '48px',
} as const;

/** The dense variant (td-dense: debug windows, developer panels): the same
 * classes, smaller type and controls */
export const TD_DENSE = {
  text: '14px',
  button: '14px',
  lead: '15px',
  title: '16px',
  buttonHeight: '28px',
  buttonSmHeight: '24px',
  field: '28px',
  row: '26px',
  tool: '24px',
} as const;

/** A theme colour ('#C9A44C') as the number WebGL code takes (0xc9a44c) */
export function themeHex(color: string): number {
  return parseInt(color.slice(1), 16);
}

/** Motion */
export const TD_MOTION = {
  /** Hover, press, a small state change */
  fast: '120ms',
  /** Opening and closing a popup or menu, a bar moving */
  mid: '250ms',
  /** Fading a whole layer in or out */
  slow: '450ms',
  /** A bar that follows a once-a-second count, linear, just under the tick */
  tick: '900ms',
  easeOut: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
} as const;

/**
 * Layout: width of the sidebar and the side gutter of its sections. The header
 * lines its stats up with these edges (game-header).
 */
export const TD_LAYOUT = {
  sidebarWidth: '300px',
  sidebarGutter: '14px',
  /** Side gutter of the coop dock's blocks */
  dockGutter: '18px',
} as const;

/**
 * Stacking of the canvas HUD parts (z-index), bottom to top: marks on the map
 * (ping arrows), HUD strips (ability bar, squad box), the coop dock. Dialogs
 * and overlays lie far above.
 */
export const TD_LAYERS = {
  marks: 5,
  hud: 6,
  dock: 7,
} as const;

const R = TD_RELIEF;
const T = TD_TINT;

/**
 * The CSS custom properties. Set once on :root (installThemeVars in main.ts),
 * so overlays (.cdk-overlay-container) see them too.
 */
export const TD_CSS_VARS = `
  --td-bg-dark: ${TD_THEME.bgDark};
  --td-bg-surface: ${TD_THEME.bgSurface};
  --td-panel-shadow: ${TD_THEME.panelShadow};
  --td-ink: ${TD_THEME.ink};

  --td-knob: ${TD_THEME.knob};
  --td-knob-light: ${TD_THEME.knobLight};
  --td-knob-dark: ${TD_THEME.knobDark};
  --td-switch-off: ${TD_THEME.switchOff};

  --td-frame-mid: ${TD_THEME.frameMid};
  --td-frame-light: ${TD_THEME.frameLight};

  --td-brass: ${TD_THEME.brass};
  --td-brass-light: ${TD_THEME.brassLight};
  --td-brass-dark: ${TD_THEME.brassDark};
  --td-teal: ${TD_THEME.teal};
  --td-teal-light: ${TD_THEME.tealLight};
  --td-teal-dark: ${TD_THEME.tealDark};
  --td-green: ${TD_THEME.green};
  --td-green-dark: ${TD_THEME.greenDark};
  --td-health-red: ${TD_THEME.healthRed};
  --td-warn-orange: ${TD_THEME.warnOrange};
  --td-warn-text: ${TD_THEME.warnText};
  --td-scrim-bottom: linear-gradient(to top, color-mix(in srgb, ${TD_THEME.ink} 72%, transparent), transparent);
  --td-leak-vignette: radial-gradient(ellipse at center, transparent 58%, color-mix(in srgb, ${TD_THEME.healthRed} 42%, transparent) 100%);
  --td-hazard: repeating-linear-gradient(-45deg, ${TD_THEME.warnOrange} 0 6px, ${TD_THEME.ink} 6px 12px);

  --td-danger-text: ${TD_THEME.dangerText};
  --td-danger-edge: ${TD_THEME.dangerEdge};
  --td-error-text: ${TD_THEME.errorText};

  --td-hp-text: ${TD_THEME.hpText};
  --td-hp-low: ${TD_THEME.hpLow};
  --td-gain: ${TD_THEME.gain};
  --td-loss: ${TD_THEME.loss};

  --td-tree-line: ${TD_THEME.treeLine};
  --td-tree-well: ${TD_THEME.treeWell};
  --td-node: linear-gradient(180deg, ${TD_THEME.nodeTop}, ${TD_THEME.nodeBottom});
  --td-node-locked: linear-gradient(180deg, ${TD_THEME.nodeLockedTop}, ${TD_THEME.nodeLockedBottom});
  --td-node-locked-edge: ${TD_THEME.nodeLockedEdge};
  --td-node-locked-title: ${TD_THEME.nodeLockedTitle};
  --td-node-locked-foot: ${TD_THEME.nodeLockedFoot};
  --td-node-open: linear-gradient(180deg, ${TD_THEME.nodeOpenTop}, ${TD_THEME.nodeOpenBottom});
  --td-node-poor-edge: ${TD_THEME.nodePoorEdge};
  --td-node-poor-mark: ${TD_THEME.nodePoorMark};
  --td-node-poor-hover: ${TD_THEME.nodePoorHover};
  --td-node-poor-glyph: ${TD_THEME.nodePoorGlyph};
  --td-node-active: linear-gradient(180deg, ${TD_THEME.nodeActiveTop}, ${TD_THEME.nodeActiveBottom});
  --td-node-queued: linear-gradient(180deg, ${TD_THEME.nodeQueuedTop}, ${TD_THEME.nodeQueuedBottom});
  --td-node-done: linear-gradient(180deg, ${TD_THEME.nodeDoneTop}, ${TD_THEME.nodeDoneBottom});
  --td-node-done-edge: ${TD_THEME.nodeDoneEdge};
  --td-branch-biology: ${TD_THEME.branchBiology};
  --td-branch-engineering: ${TD_THEME.branchEngineering};

  --td-text-primary: ${TD_THEME.textPrimary};
  --td-text-secondary: ${TD_THEME.textSecondary};
  --td-text-muted: ${TD_THEME.textMuted};
  --td-text-quiet: ${TD_THEME.textQuiet};
  --td-text-title: ${TD_THEME.textTitle};
  --td-text-engraved: ${TD_THEME.textEngraved};
  --td-text-value: ${TD_THEME.textValue};
  --td-text-dim: ${TD_THEME.textDim};
  --td-text-disabled: ${TD_THEME.textDisabled};

  --td-cold: ${TD_THEME.cold};
  --td-lightning: ${TD_THEME.lightning};
  --td-chaos: ${TD_THEME.chaos};
  --td-ethereal: ${TD_THEME.ethereal};
  --td-cell-selection: ${TD_THEME.cellSelection};
  --td-reticle: ${TD_THEME.reticle};

  --td-tex-plaster: ${TD_MATERIALS.plaster};
  --td-tex-basalt: ${TD_MATERIALS.basalt};
  --td-tex-size: ${TD_MATERIALS.size};
  --td-tint: rgba(${T.rgb}, ${T.panel});
  --td-tint-overlay: rgba(${T.rgb}, ${T.overlay});
  --td-overlay-opacity: ${T.overlayOpacity};

  --td-backdrop: linear-gradient(90deg, rgba(${T.rgb}, ${T.menuFade}) 0%, rgba(${T.rgb}, ${(T.menuFade * 0.75).toFixed(2)}) ${T.menuFadeWidth * 0.55}%, rgba(${T.rgb}, ${T.menuBase}) ${T.menuFadeWidth}%, rgba(${T.rgb}, ${T.menuBase}) 100%);

  --td-surface: linear-gradient(var(--td-tint), var(--td-tint)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.panelMain};
  --td-surface-overlay: linear-gradient(var(--td-tint-overlay), var(--td-tint-overlay)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.panelMain};
  --td-surface-topbar: linear-gradient(var(--td-tint), var(--td-tint)), var(--td-tex-basalt) 0 0 / var(--td-tex-size), ${TD_THEME.topbar};
  --td-stone-dark: linear-gradient(rgba(0,0,0,.22), rgba(0,0,0,.22)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.stoneDark};
  --td-stone-darker: linear-gradient(rgba(0,0,0,.36), rgba(0,0,0,.36)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.stoneDarker};
  --td-stone-lit: linear-gradient(rgba(255,255,255,.1), rgba(255,255,255,.1)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.stoneLit};
  --td-stone-plate: linear-gradient(rgba(255,255,255,.07), rgba(255,255,255,.02)), var(--td-tex-plaster) 0 0 / var(--td-tex-size), ${TD_THEME.stonePlate};

  --td-line-dark: ${R.lineDark};
  --td-line-light: ${R.lineLight};
  --td-line-width: ${R.lineWidth};
  --td-line-gap: ${R.lineGap};
  --td-hairline: ${R.hairline};
  --td-engrave: ${R.engrave};
  --td-engrave-icon: ${R.engraveIcon};
  --td-over-image: ${R.overImage};
  --td-panel-recess: ${R.panelRecess};
  --td-panel-drop: ${R.panelDrop};
  --td-raised: ${R.raised};
  --td-raised-quiet: ${R.raisedQuiet};
  --td-raised-lit: ${R.raisedLit};
  --td-raised-plate: ${R.raisedPlate};
  --td-pressed: ${R.pressed};
  --td-well: ${R.well};
  --td-well-shadow: ${R.wellShadow};
  --td-well-soft: ${R.wellSoft};
  --td-well-soft-shadow: ${R.wellSoftShadow};
  --td-well-deep: ${R.wellDeep};
  --td-topbar-edge: ${R.topbarEdge};
  --td-popup-drop: ${R.popupDrop};

  --td-font: ${TD_FONTS.ui};
  --td-font-mono: ${TD_FONTS.mono};
  --td-fs-micro: ${TD_TYPE.micro};
  --td-fs-small: ${TD_TYPE.small};
  --td-fs-body: ${TD_TYPE.body};
  --td-fs-text: ${TD_TYPE.text};
  --td-fs-button: ${TD_TYPE.button};
  --td-fs-lead: ${TD_TYPE.lead};
  --td-fs-title: ${TD_TYPE.title};
  --td-fs-menu: ${TD_TYPE.menu};
  --td-fs-hud: ${TD_TYPE.hud};
  --td-fs-hero: ${TD_TYPE.hero};
  --td-track-caps: ${TD_TYPE.trackCaps};

  --td-sp-1: ${TD_SPACE[0]};
  --td-sp-2: ${TD_SPACE[1]};
  --td-sp-3: ${TD_SPACE[2]};
  --td-sp-4: ${TD_SPACE[3]};
  --td-sp-5: ${TD_SPACE[4]};

  --td-radius: ${TD_SIZE.radius};
  --td-h-button: ${TD_SIZE.button};
  --td-h-button-sm: ${TD_SIZE.buttonSm};
  --td-h-field: ${TD_SIZE.field};
  --td-h-row: ${TD_SIZE.row};
  --td-row-gap: ${TD_SIZE.rowGap};
  --td-close-size: ${TD_SIZE.close};
  --td-icon-btn: ${TD_SIZE.iconBtn};
  --td-icon-sm: ${TD_SIZE.iconSm};
  --td-disabled-opacity: 0.45;
  --td-tool-size: ${TD_SIZE.tool};
  --td-h-menu-item: ${TD_SIZE.menuItem};
  --td-menu-width: ${TD_SIZE.menuWidth};
  --td-h-topbar: ${TD_SIZE.topbar};

  --td-dense-text: ${TD_DENSE.text};
  --td-dense-button: ${TD_DENSE.button};
  --td-dense-lead: ${TD_DENSE.lead};
  --td-dense-title: ${TD_DENSE.title};
  --td-dense-h-button: ${TD_DENSE.buttonHeight};
  --td-dense-h-button-sm: ${TD_DENSE.buttonSmHeight};
  --td-dense-h-field: ${TD_DENSE.field};
  --td-dense-h-row: ${TD_DENSE.row};
  --td-dense-tool: ${TD_DENSE.tool};

  --td-dur-fast: ${TD_MOTION.fast};
  --td-dur-mid: ${TD_MOTION.mid};
  --td-dur-slow: ${TD_MOTION.slow};
  --td-dur-tick: ${TD_MOTION.tick};
  --td-ease-out: ${TD_MOTION.easeOut};

  --td-focus-color: ${TD_THEME.brassLight};
  --td-focus-width: 2px;
  --td-focus-offset: 2px;

  --td-sidebar-width: ${TD_LAYOUT.sidebarWidth};
  --td-sidebar-gutter: ${TD_LAYOUT.sidebarGutter};
  --td-dock-gutter: ${TD_LAYOUT.dockGutter};

  --td-z-marks: ${TD_LAYERS.marks};
  --td-z-hud: ${TD_LAYERS.hud};
  --td-z-dock: ${TD_LAYERS.dock};

  --td-los-depth-ramp: linear-gradient(to right, rgb(0, 0, 178), rgb(64, 64, 134), rgb(128, 128, 89), rgb(192, 192, 45), rgb(252, 252, 1), rgb(255, 255, 0));
  --td-event-vfx: ${TD_THEME.eventVfx};
  --td-event-audio: ${TD_THEME.eventAudio};
  --td-perf-critical: ${TD_THEME.perfCritical};
  --td-perf-warning: ${TD_THEME.perfWarning};
`;

/**
 * Puts TD_CSS_VARS once as a :root rule into the head of the document, before
 * the bootstrap (main.ts). A stylesheet instead of an inline style on <html>,
 * so a rule can override them like any other.
 */
export function installThemeVars(doc: Document): void {
  const id = 'td-theme-vars';
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = `:root {${TD_CSS_VARS}}`;
  doc.head.prepend(style);
}
