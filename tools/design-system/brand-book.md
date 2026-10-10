Tower defense on real streets. The UI is a game's equipment, not an app: tinted plaster and dark basalt, stone that is raised or sunk, lines cut into the surface, brass as the one accent. Everything is dark; there is no light theme.

## Content fundamentals

- **Language:** English UI, short and concrete. Sentence case for buttons, titles and labels ("Restart here", "Save the run log", "Load game"); caps only through `td-caps` and the HUD labels ("CREDITS", "DEFEND").
- **Voice:** the game speaks plainly and names things the player sees: places, waves, towers. "The streets of York did not load." "Need 600 credits." No exclamation marks, no jokes in system text, no "please", no emoji.
- **Separator:** " | " between parts of one line ("York | wave 3", "HQ lost | York | wave 23"). Never a middle dot, never an em dash.
- **Buttons say what happens:** a verb and its object ("Host a room", "Replay wave 12"); a confirmation repeats it ("Restart here?" → "Restart").
- **Numbers:** tabular (`td-num`); large figures short ("18.4k") with the exact one for screen readers; times as "41:08".
- **Big words are rare:** GAME OVER is the only shout in the whole UI.

## Visual foundations

**Materials.** Two textures make every surface (assets: Textures). Panels, dialogs, the sidebar and strips over the map are plaster under `--td-tint` (`td-panel`, `td-dlg`, `td-side`, `td-overlay`); the top bar is basalt (`--td-surface-topbar`). Stone buttons are the same plaster, darker (`--td-stone-dark`, `--td-stone-darker`) or lit (`--td-stone-plate` for a chosen plate). No flat fills, no gradients of your own.

**Color.** Ground `td-bg-dark`. Text: `td-text-primary` for running text, `td-text-title` for titles and figures, `td-text-secondary` and `td-text-muted` for quieter lines, `td-text-disabled` only for what cannot act. Brass is the single accent: `td-brass` for icons and heads, `td-brass-light` for chosen and hovered text, never as a large fill. Teal (`td-teal`, `td-teal-light`) means running, magic or confirmed; green (`td-green`) positive or researched; `td-danger-text` and `td-danger-edge` loss and errors; `td-warn-text` caution. Semantic colours never decorate. Debug colours (`td-event-*`, `td-perf-*`) stay in debug windows.

**Relief.** Three states of stone, always from tokens:
- raised: `--td-raised` (main buttons), `--td-raised-quiet` (secondary, icon buttons), `--td-raised-plate` (the chosen menu entry, the chosen segment), `--td-raised-over-map` (a stone alone on the map);
- sunk: `--td-well` with `--td-well-shadow` (fields, segment groove, cards), `--td-well-deep` (a toggle that is on);
- engraved: lines `--td-line-dark` 2px with `--td-line-light` 1px below (`td-rule`, `td-line-*`); text `--td-engrave`; the deeper grooves `--td-sep-*` (top bar values) and `--td-edge-*` (sidebar against the map).

**Type.** Barlow Semi Condensed for everything (`--font-ui`), JetBrains Mono only for room codes, keys and logs (`--font-mono`). Sizes from the scale only, nothing under `micro` (11px): `micro` caps labels, `small` notes, `body` sidebar and tooltips, `text` dialogs and fields, `lead` small figures, `title` dialog titles, `menu` menu entries, `hud` top bar figures, `hero` the boss name, `gameover` GAME OVER. Weights 500 (text), 600 (labels, buttons), 700 (figures, titles).

**Spacing and size.** Steps `td-sp-1` … `td-sp-5` (4, 8, 12, 16, 24px). Heights: buttons `--td-h-button`, fields `--td-h-field` (40px), rows `--td-h-row` (40px), top bar `--td-h-topbar` (48px). Menu 320px (`--td-menu-width`), sidebar 300px (`--td-sidebar-width`).

**Radius.** One radius, `td-radius` (3px), for buttons, fields, plates and segments. Circles only for markers and the knob of a switch. No pills, no large rounding.

**Shadows.** Panels `--td-panel-recess` and `--td-panel-drop`; popups `--td-popup-drop`; text over pictures `--td-over-image`. Nothing else casts a shadow.

**States.** Hover lightens text to `td-brass-light` only on controls that act. Disabled is one look for all (dim, no hover). A toggle that is on sinks into a deep well with brass. A button that waits gets `is-busy`. **No focus ring on controls** (buttons, links, checkboxes, radios, sliders): the game is driven by hotkeys and the browser would ring every clicked button. Text fields keep a 2px brass edge inside; menu entries show focus as their stone plate. A menu gives focus back quietly when it closes (no tooltip, the next Esc belongs to the game).

**Motion.** Durations `--td-dur-fast` and `--td-dur-slow` with `--td-ease-out`; reveals lift a few pixels. One loud moment exists: the game over slam. Under `prefers-reduced-motion` every transition jumps and every animation stands still.

**Layout.** In the game: top bar across, sidebar right, the map in between; HUD strips on the map are `td-overlay`, single controls on the map are stones (`td-stone-chip`, `td-icon-btn is-over-map`). Menus: the list left on a plate, a page as a dialog beside it. Dialogs stand under the top bar.

## Iconography

The game's own inline SVG set (`td-icon`): 24px viewBox, 1.5px stroke, round caps and joins, `currentColor`; a few shapes follow Lucide (ISC). Icons at 16–22px, brass in menus and heads, text colour elsewhere; an icon never carries meaning alone (a label or `aria-label` goes with it). No emoji, no icon fonts. Logos: assets Logos, always on dark.

## Rules for building

- Take every colour, shadow, radius, size and duration from a token or a `td-*` class; components only lay out.
- One primary button per group, brass text on dark stone; everything else secondary or ghost.
- Two to five exclusive choices are a `td-seg`; settings that apply at once are a `td-switch`.
- Over the map: a strip is `td-overlay`, a single control is a stone; nothing over the map without one of the two.
- Text pairs that read: `td-text-primary`, `td-text-title` and `td-brass-light` on plaster and basalt; `td-text-muted` only for side lines on plaster.
