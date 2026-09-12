# Tower Defense - Design System

**Stand:** 2026-09-12

## Uebersicht

Das Tower Defense UI basiert auf einem **WC3/Ancient Command** inspirierten Design mit Stein-, Metall- und Magie-Aesthetik. Das System verwendet CSS Custom Properties fuer zentrale Farbverwaltung.

**Inspiration:** Warcraft III UI (siehe `public/assets/mocks/ui_mock.png`)

---

## Theme-Datei

**Pfad:** `src/app/styles/td-theme.ts`

Zentrale Theme-Definition mit TypeScript-Konstanten und CSS Custom Properties.

### Verwendung in Komponenten

Template und Styles liegen neben der Component (`*.component.html`, `*.component.scss`). Inline bleibt nur, was aus TypeScript kommt: `TD_CSS_VARS` auf `:host` und Werte aus TS-Konstanten.

```typescript
import { TD_CSS_VARS } from '../styles/td-theme';

@Component({
  templateUrl: './panel.component.html',
  styleUrl: './panel.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
```

```scss
// panel.component.scss
@use '../styles/td-mixins' as td;

.panel {
  background: var(--td-panel-main);
  color: var(--td-text-primary);
  overflow-y: auto;
  @include td.scrollbar;
}
```

Angular setzt die Regeln aus `styleUrl` vor die Inline-`styles`. Der `:host`-Block kollidiert damit nicht, solange die `.scss` selbst keine `--td-*` auf `:host` setzt. Wiederverwendbare Style-Rezepte (Scrollbar, Glas) liegen als Sass-Mixins in `styles/_td-mixins.scss`.

---

## Farbpalette

Maßgeblich sind die Werte in `td-theme.ts` (`TD_THEME`), die Tabellen geben sie wieder. Seit den Design Refinements (2026-05) sind die Flächen und Rahmen um etwa eine Helligkeitsstufe gespreizt, Gold ist zu antikem Messing entsättigt, Teal kühler. Die Werte davor stehen in `td-theme.ts` als Kommentar `(was …)`.

### Basisflaechen

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-bg-dark` | `#111613` | Haupt-Sidebar, dunkler Stein |
| `--td-bg-surface` | `#1A201C` | Allgemeine Oberflaeche (Overlay, Loading) |
| `--td-panel-dark` | `#181D19` | Dark Panel Sections (Debugger Selected States) |
| `--td-panel-primary` | `#222A24` | Alias fuer `--td-panel-main` |
| `--td-panel-main` | `#222A24` | Primaere Panel-Flaeche |
| `--td-panel-secondary` | `#1A1F1B` | Unterpanels, Slots |
| `--td-panel-shadow` | `#0B0F0C` | Inset-Schatten, Tiefe |

### Rahmen (WC3-Stil)

**Regel:** Hell oben, dunkel unten (klassischer WC3-Look)

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-frame-dark` | `#2F3631` | Unterkante, Schatten |
| `--td-frame-mid` | `#4A544D` | Haupt-Rahmenfarbe |
| `--td-frame-light` | `#7A8580` | Oberkante, Licht |
| `--td-edge-highlight` | `#A7B3A8` | Fokus, Selektion |

### Akzentfarben

**Wichtig:** Sparsam einsetzen! Max. 3 Akzentfarben gleichzeitig sichtbar.

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-gold` | `#C2A055` | Wichtiges, Buttons, Titel |
| `--td-gold-light` | `#D9BC68` | Button Highlight (Hover, Top-Border) |
| `--td-gold-dark` | `#8E7228` | Gedrueckt, Inaktiv |
| `--td-teal` | `#6BB6A4` | Magische Akzente |
| `--td-teal-light` | `#8FD9C6` | Button Highlight (Hover, Top-Border) |
| `--td-teal-dark` | `#1F8772` | Button Shadow (Bottom-Border) |
| `--td-green` | `#9ED6A0` | Buffs, Positiv |
| `--td-green-dark` | `#6AAB6C` | Gedrueckt, Button-Schatten |

### Runen-Akzente

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-rune-amber` | `#A47A2C` | Trennlinien, Header-Unterstriche, Tier-Marker |
| `--td-rune-amber-muted` | `#6B5320` | Dasselbe gedämpft (z. B. Rüstungskopf im Damage-vs-Armor-Dialog) |

### Statusfarben

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-red` | `#B83E32` | Alias fuer `--td-health-red` (allgemeines Rot) |
| `--td-health-red` | `#B83E32` | Health, Danger |
| `--td-health-bg` | `#2E1614` | Dunkelrote Fläche für Fehler und Gefahr (Warnbox im Standort-Dialog, Danger-Button im Training-Debugger) |
| `--td-warn-orange` | `#C96A3A` | Warnungen |
| `--td-disabled` | `#5B625C` | Deaktivierte Elemente |

### Schadenstyp-Farben

Titel-Akzent der Tower-Tooltips (`DAMAGE_ACCENT` in `sidebar-tooltips.ts`), dazu
`--td-gold-light` (physical, pierce, siege), `--td-teal-light` (magic),
`--td-warn-orange` (fire) und `--td-green` (poison).

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-cold` | `#5BA4D9` | Ice |
| `--td-lightning` | `#7DD3FC` | Lightning, wie `DAMAGE_TYPE_UI` |
| `--td-chaos` | `#D946EF` | Chaos, wie `DAMAGE_TYPE_UI` |

### Textfarben

**Regel:** Nie reines Weiss verwenden!

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-text-primary` | `#EEF1EB` | Haupttext |
| `--td-text-secondary` | `#B6C0B3` | Sekundaertext |
| `--td-text-muted` | `#8E988C` | Gedaempfter Text |
| `--td-text-tertiary` | `#7A837A` | Zwischen muted/disabled, fuer pending/inactive Elemente |
| `--td-text-disabled` | `#6A726A` | Deaktivierter Text |

### Glas, Schatten, Glow

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-glass-tint` | `rgba(17,22,19,0.78)` | Fläche der Glas-Overlays mit Backdrop-Blur (Mixin `bevel-glass`, Quick Actions, Dialoge) |
| `--td-scrim` | `rgba(8,11,9,0.58)` | Abdunklung hinter Overlays |
| `--td-shadow-soft` | `0 6px 20px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.5)` | Schlagschatten erhöhter Flächen (Dialoge, Popover) |
| `--td-shadow-key` | `0 1px 0 rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)` | Kante unter Buttons |
| `--td-inner-highlight` | `inset 0 1px 0 rgba(255,255,255,0.06)` | Lichtkante oben auf erhöhten Flächen |
| `--td-gold-glow` | `0 0 14px rgba(194,160,85,0.28), …` | Hover/Aktiv der Gold-Buttons |
| `--td-teal-glow` | `0 0 14px rgba(107,182,164,0.32), …` | Hover/Aktiv der Teal-Buttons |

Das Glas-Overlay ist der Sass-Mixin `bevel-glass` in `styles/_td-mixins.scss`. Kanten für erhöhte Panels und vertiefte Flächen stehen unter [Rezepte](#rezepte-panel-buttons-slots).

### Schriften

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-font-mono` | `'JetBrains Mono', ui-monospace, monospace` | Stats, HP, Kosten, Hotkeys, Wave-Zähler, Section-Header |
| `--td-font-body` | `'Inter Tight', system-ui, -apple-system, sans-serif` | Tower-Namen, Tooltip-Text, Dialogtitel, Hinweise |
| `--td-font-display` | `'Cinzel', 'Inter Tight', serif` | Titel im Token-Setup (`token-setup`); laut `td-theme.ts` für Game Over / Victory gedacht |

**Hinweis (offene Entscheidung):** Geladen werden nur Inter Tight (400 bis 700) und Roboto (für Angular Material), selbst gehostet über `@fontsource` in `src/styles.scss`. JetBrains Mono wird nicht geladen, weder als Paket noch per `@font-face`. Alle Mono-Texte, auch die vielen Komponenten mit fest verdrahtetem `'JetBrains Mono', monospace`, erscheinen deshalb in der Ersatzschrift des Browsers (`monospace`, unter Windows Consolas). Ob JetBrains Mono nachgeladen oder die Ersatzschrift festgeschrieben wird, ist nicht entschieden; bis dahin Breiten an der Ersatzschrift messen. Cinzel wird ebenfalls nicht geladen, der Token-Setup-Titel steht deshalb in Inter Tight.

### Debug & Performance

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-event-vfx` | `#a855f7` | Event-Debugger: VFX-Events (lila) |
| `--td-event-audio` | `#3b82f6` | Event-Debugger: Audio-Events (blau) |
| `--td-perf-critical` | `#ff4444` | Performance-Profiler: Kritische Schwelle |
| `--td-perf-warning` | `#ff8844` | Performance-Profiler: Warnung/Bottleneck |

---

## UI-Layout

```
+------------------------------------------------------------------------------+
| HEADER  Logo | DEFEND <Ort> | Aktionen         [Enemies] HQ | CREDITS | WAVE |
+------------------------------------------------------+-----------------------+
| Info-Overlay        [Game Speed]           Kompass   | SIDEBAR               |
|                                                      | WAVE                  |
|                                                      | BUILD, Tower oder     |
|                  3D CANVAS                           | Research              |
|                                                      |                       |
|                                  [Quick Actions]     |                       |
| Logos  Controls Hint                  Attribution    |                       |
+------------------------------------------------------+-----------------------+
```

### Bereiche

| Bereich | Beschreibung |
|---------|--------------|
| **Info-Header** | Logo, Standort ("DEFEND …", Klick öffnet den Standort-Dialog) mit Aktionen (Link kopieren, Favoriten, Zufallsort, HQ versetzen, Spawn setzen), rechts die Stat-Leiste HQ / CREDITS / WAVE, während einer Welle links davon der Gegner-Chip |
| **Canvas** | 3D-Spielfeld mit Google Photorealistic Tiles |
| **Sidebar** | Rechte Sidebar: WAVE-Panel, darunter BUILD, Tower-Detail oder Research (siehe [Sidebar-Panels](#sidebar-panels)) |
| **Info-Overlay** | Oben links: FPS, per Caret aufklappbar um Tiles, Sounds und Streets |
| **Game Speed** | Oben mittig, nur während einer Welle: ein Button, der 1x, 2x und 4x durchschaltet |
| **Kompass** | Oben rechts, Klick setzt die Kamera zurück |
| **Controls Hint** | Unten links neben den Logos (LMB: Pan, RMB: Rotate, Scroll: Zoom, WASD/Pfeile: Move), verschwindet nach 15 s oder per Klick |
| **Quick Actions** | Sechs Icon-Buttons unten rechts, siehe unten |

### Quick Actions und Dev-Menü

Sechs Buttons in einer Reihe (je 32px, `gap` 4px, zusammen 212px), von links:

| Button | Funktion |
|--------|----------|
| Route-Animation | Spielt die Routen-Animation ab; oranger Rand (`--td-warn-orange`) |
| Display | Panel mit Effekt- und Anzeige-Einstellungen (unten beschrieben) |
| Audio | Lautstärke und Mute für Musik und SFX |
| Layers | Sieben Overlay-Schalter, die senkrecht nach oben aufklappen: Route Grid, Gebäude, Straßen, Routen, Flughöhe der Air-Route, Air Route Grid, Per-Tower-LOS-Filter (schaltet beide, Boden, Luft durch) |
| Kamera-Reset | Setzt die Kamera zurück |
| Dev | Dev-Menü mit Kachel-Raster (unten beschrieben) |

Geöffnet leuchten Display und Audio (wie die aktiven Layer-Schalter) im Teal-Verlauf mit `--td-teal-glow`, Layers und Dev im Gold-Verlauf mit `--td-gold-glow`.

Die Quick Actions reichen vertikal von unterhalb des Kompasses (`top: 112px`) bis 36px über der Unterkante (`bottom: 36px`); die Buttons sitzen unten, die leere Fläche darüber ist `pointer-events: none`. Untermenüs klappen nach oben auf. Es ist immer nur eines der vier Menüs (Display, Audio, Layers, Dev) offen: `UIStore.openMenu` ist die einzige Quelle, `toggleMenu()` schließt beim Öffnen die anderen, gespeichert wird nur das zuletzt offene. Das Dev-Panel spannt die ganze Leiste und würde die anderen sonst überdecken.

Das Dev-Menü (`.td-dev-menu`) ist ein Glas-Panel (Mixin `bevel-glass`) über der Leiste: genau so breit wie sie (212px), rechtsbündig, Unterkante 4px über den Buttons, außerhalb des Flusses. Innen ein Raster mit vier Spalten (`gap` 4px, `padding` 6px), gegliedert in Gruppen, deren Titel über die volle Breite laufen (8px/600, `letter-spacing: 0.16em`, `--td-text-muted`):

| Gruppe | Kacheln |
|--------|---------|
| Map | Height, Points, Recast, Dump |
| View & Panels | Camera, Frame, Display, Perf, LOS, Audio, DevWorld (nur mit `?devworld`) |
| Cheats | Kill, Credits, +HP, Research, Max Up |
| Waves & Inspect | Waves, Static, AI, Towers, Enemies, Events |

Kachel (`.td-dev-tile`): 44px hoch, Icon 18px über einer Beschriftung in 8px Versalien (`letter-spacing: 0.06em`), Fläche `rgba(11,15,12,0.6)`, Rahmen `--td-frame-dark`.

| Zustand | Darstellung |
|---------|-------------|
| Hover | Rahmen `--td-frame-mid`, Text `--td-text-primary` |
| Aktiv (Fenster offen, Schalter an) | Fläche `rgba(194,160,85,0.16)`, Rahmen `--td-gold-dark`, Inset `rgba(217,188,104,0.18)`, Text `--td-gold-light` |
| Cheat (`.td-dev-cheat`) | kein Aktiv-Zustand; Icon und Text in der Farbe der Wirkung (Kill und +HP `--td-health-red`, Credits `--td-gold`, Research und Max Up `--td-teal`), beim Hover nur der Rahmen in dieser Farbe |

Die Tooltips nennen die volle Funktion (z. B. "+1000 Credits (Shift+Click: +100k)"), die `aria-label`s ebenso. Beschriftungen kurz halten: in der Mono-Ersatzschrift (Consolas) sind 8 Zeichen bei 8px rund 39px breit, die Kachel innen 44,5px. Der Dev-Toggle zeigt geöffnet das Gold-Rezept mit `--td-gold-glow`, wie der Layers-Toggle.

Die Höhe ist auf den Platz zwischen Leiste und Kompass begrenzt; bei niedrigem Fenster scrollt das Panel, statt den Kompass zu überdecken. Neue Einträge in die passende Gruppe einsortieren.

Das Display-Menü ist ein Panel über seinem Toggle (`.td-display-panel`, 212px breit), ebenfalls außerhalb des Flusses. Sein Wrapper spannt die volle Höhe der Quick Actions, damit das Panel wie das Dev-Menü vor dem Kompass endet und bei niedrigem Fenster scrollt; der Wrapper selbst lässt Klicks auf die Karte durch.

| Bereich | Inhalt |
|---------|--------|
| Effects | Preset-Leiste Low / Medium / High, darunter die Schalter, die ein Preset setzt (Muzzle Flash, Projectile Trails, Impact Effects, Ground Marks, Bloom) und Color Grading als Select. Passt kein Preset, steht "Custom" rechts im Kopf. |
| General | Freeze Tint, Screen Shake, Health Bars, Damage Numbers, Frame Limit (Off / 60 / 30) |

Zeilen sind Checkbox-Labels wie im Display-Debugfenster (Akzent `--td-teal`), Kopfzeilen 10px Versalien in `--td-text-tertiary`, Schrift `--td-font-mono` 12px. Preset und Frame Limit sind Segmente: `--td-panel-secondary`, 1px `--td-frame-dark`, aktiv im Teal-Verlauf der aktiven Quick-Buttons, `aria-pressed`. Jede Effektzeile sagt im Tooltip, was sie abschaltet. Was die Schalter technisch tun: [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#vfx-einstellungen).

---

## Komponenten-Styles

### Rezepte (Panel, Buttons, Slots)

Für Panels, Buttons, Slots und Inputs gelten feste Rezepte. Es gibt sie nicht als gemeinsame Konstante oder Mixin: die Komponenten schreiben die Werte in ihrem SCSS aus (z. B. `.td-wave-btn` in `wave-panel.component.scss`, `.td-btn` in `tower-defense.component.scss`). Die früheren String-Rezepte in `td-theme.ts` (`TD_PANEL_STYLES`, `TD_BUTTON_STYLES` usw.) hatte keine Komponente eingebunden; sie sind entfernt.

| Rezept | Inhalt |
|--------|--------|
| Panel (erhöht) | `--td-panel-main`, 1px `--td-frame-dark`, Inset-Kanten `inset 0 1px 0 rgba(122,133,128,0.2)` und `inset 0 -1px 0 var(--td-panel-shadow)`, Text `--td-text-primary` |
| Vertiefte Fläche (Slots, Inputs, HP-Hintergrund) | 1px `--td-frame-dark`, `inset 0 1px 2px rgba(0,0,0,0.5)` und `inset 0 -1px 0 rgba(74,84,77,0.13)` |
| Gold-Button | Gold-Verlauf `--td-gold-light` → `--td-gold` → `--td-gold-dark`, Text `#1A140A`, 1px dunkle Kante, Inset-Kanten plus `--td-shadow-key`, `--td-font-mono` 12px/700, Versalien, `letter-spacing: 0.06em` |
| Teal-Button | Dasselbe im Teal-Verlauf, Text `#0E1612` |
| Rahmen-Button (Abbrechen u. Ä.) | `--td-panel-main`, `--td-text-secondary`, 1px `--td-frame-dark` |
| Slot, Radio-/Checkbox-Option | `--td-panel-secondary` mit den Kanten des erhöhten Panels |
| Dialog | Panel mit `--td-font-body` |
| Input | Vertiefte Fläche auf `--td-panel-shadow`, `--td-font-mono` |

Die dunkle Scrollbar kommt aus Sass-Mixins in `styles/_td-mixins.scss`: `scrollbar` (Firefox) gehört in die scrollende Regel, `webkit-scrollbar`, `webkit-scrollbar-track`, `webkit-scrollbar-thumb`, `webkit-scrollbar-thumb-hover` und `webkit-scrollbar-corner` in die passenden `::-webkit-scrollbar*`-Regeln.

Die globalen Buttons `.td-btn` (`tower-defense.component.scss`) folgen dem Gold-Rezept, Hover mit `--td-gold-glow` statt Verschiebung, `:disabled` als grauer Verlauf mit `--td-text-disabled`. Die Sidebar-Sektionen (`.td-panel`) sind flach, ohne Rahmen (`_sidebar-panel.scss`).

### Sidebar-Panels

Die Sidebar (`components/game-sidebar/`) liefert Rahmen, Footer und die Wahl des Panels. Jede Sektion ist eine eigene Component mit gekapselten Styles:

| Component | Inhalt |
|-----------|--------|
| `wave-panel/` | WAVE: Gegnergruppen der laufenden Welle mit Preview, Next-Wave-Button, COMING UP |
| `build-panel/` | BUILD: Tower-Karten mit Preview, Build-Mode-Hinweis und Cancel |
| `tower-panel/` | Detail des gewählten Towers: Stats, Targeting, Upgrades, Verkauf |
| `research-panel/` | Research Center: laufende Forschungen, Forschungsbaum, Upgrades, Verkauf |

Die Host-Elemente haben `display: contents`, die `<section class="td-panel">` bleibt damit Flex-Item der Sidebar-Spalte. Regeln, die mehrere Panels brauchen (Section, Header, Content, Scroll-Fläche, Tower-Header mit Sell-Button, `i`-Button, Upgrade-Kacheln), stehen einmal als Mixins in `_sidebar-panel.scss`; ein Panel bindet per `@include panel.<name>` ein, was sein Template nutzt. Die 1px-Trennlinie trägt nur das WAVE-Panel, die übrigen sind immer die letzte sichtbare Sektion. Tooltip-Aufbereitung (Tower-Karten, Gegnergruppen) liegt als reine Funktionen in `sidebar-tooltips.ts`.

### Next-Wave-Button (Sidebar)

Primärer Call-to-Action (`.td-wave-btn` in `game-sidebar/wave-panel/wave-panel.component.scss`) mit der Beschriftung "Start Wave N", N ist die kommende Welle (dieselbe Nummer wie im Panel-Kopf). Gold-Button-Rezept: Verlauf `--td-gold-light` → `--td-gold` → `--td-gold-dark`, Text `#1A140A`, 1px dunkle Kante, Key-Shadow, `--td-font-mono` 13px/700, Versalien, `letter-spacing: 0.08em`. Ecken 3px wie Tower-Karten, Höhe 44px, Inhalt zentriert mit 10px Abstand, Icon `play` 16px.

Typografie und Höhe bleiben in jedem Zustand gleich, nur Fläche, Farbe und Inhalt wechseln:

| Zustand | Auslöser | Darstellung |
|---------|----------|-------------|
| Bereit | keine Welle, kein Build-Mode | Gold-Verlauf, Hover `--td-gold-glow`, Pressed-Inset, `:focus-visible`-Outline in `--td-gold-light` |
| Gesperrt | Build-Mode, Game Over | grauer Verlauf wie `.td-btn:disabled`, `--td-text-disabled`, weiter "Start Wave N" |
| Welle läuft | `waveActive()` | `.td-wave-running`: `--td-panel-shadow` mit den Kanten der vertieften Fläche; links Icon `wave` und "Wave N" in `--td-teal`, rechts "{n} left" (11px, `--td-text-muted`, keine Versalien), unten ein 2px-Balken in `--td-teal`, so breit wie der Anteil der Gegner, die weder getötet noch durchgekommen sind |

Beschriftung, Restzahl und Balkenbreite liefert `waveButtonView()` (`wave-panel/wave-button.ts`) aus zwei Store-Werten: `waveEnemyTotal` (von `wave:started` angekündigte Größe) und `waveEnemiesLeft` (lebende plus noch nicht gespawnte Gegner). Beide pflegt `GameStateSyncService` aus `wave:started`, `enemy:died`, `enemy:reached-base` und `debug:kill-all`. Manuelle Debug-Wellen kündigen keine Größe an, dann fehlen Zahl und Balken.

### Header (mit Stein-Textur)

```css
.header {
  background:
    linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
    url('./src/styles/textures/stone-wall.jpg') repeat;
  background-size: auto, 64px 64px;
  border-bottom: 3px solid var(--td-panel-shadow);
  border-top: 1px solid var(--td-gold-dark);
}
```

Die Textur liegt unter `src/styles/textures/stone-wall.jpg` und wird 64px gekachelt; die Landing Page hat eine eigene Kopie (`landing/media/stone-wall-128.jpg`). Die obere Kante ist Messing (`--td-gold-dark`) wie der Wave-Button, die untere die dunkle Schattenkante. Einen Titeltext gibt es nicht, links steht das Logo.

### Header-Stat-Leiste (an der Sidebar ausgerichtet)

HQ, Credits und Wave stehen in einer Leiste fester Breite (`.header-stats` in `game-header`) direkt über dem Sidebar-Inhalt: gleiche Breite und Außenkanten wie Next-Wave-Button und Tower-Raster. Drei gleich breite Spalten, Zahlen mit `tabular-nums`, damit wachsende Werte die Nachbarn nicht verschieben. Der Gegnerzähler erscheint nur während einer Welle als eigener Chip (`.enemies-chip`) links neben der Leiste, die Leiste selbst springt dabei nicht.

Jede Zelle: Icon 16px, daneben eine kleine Spalte mit Label (`HQ`, `CREDITS`, `WAVE`; 8px, `line-height: 9px`, `letter-spacing: 0.16em`, `--td-text-muted`) über der Zahl (15px, `line-height: 17px`, 700). Zell-Padding 3px 8px, Abstand 7px. Mit diesen Zeilenhöhen bleibt die Leiste 34px und der Header 46px hoch. Die Labels benennen die Werte, die Icons sind Deko und tragen kein `aria-label`.

Grundlage sind zwei Layout-Tokens aus `TD_LAYOUT` (`td-theme.ts`), die Header und Sidebar gemeinsam nutzen:

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-sidebar-width` | `300px` | Breite der Sidebar (`.td-sidebar`) |
| `--td-sidebar-gutter` | `14px` | Seitlicher Innenabstand der Sidebar-Sektionen, rechtes Padding des Headers |

```css
.header {
  padding: 4px var(--td-sidebar-gutter) 4px 12px;
}

.header-stats {
  box-sizing: border-box;
  /* 1px = border-left der Sidebar */
  width: calc(var(--td-sidebar-width) - 2 * var(--td-sidebar-gutter) - 1px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
```

Im Dialog-Modus (`isDialog`) sitzt rechts noch der Close-Button, dort gilt die Ausrichtung nicht.

### Text auf Stein-Textur (Lesbarkeit)

Elemente auf der Stein-Textur benoetigen einen dunklen Hintergrund fuer Lesbarkeit. Im Header tragen ihn die Stat-Leiste (`.header-stats`), der Gegner-Chip (`.enemies-chip`) und der Standort-Button (`.location-btn`):

```css
.header-stats,
.enemies-chip {
  background: var(--td-panel-shadow);
  border: 1px solid var(--td-frame-dark);
  box-shadow:
    inset 0 1px 0 rgba(122, 133, 128, 0.13),
    inset 0 -1px 2px rgba(0, 0, 0, 0.5);
}
```

Der Standort-Button hat dieselbe Fläche mit 1px `--td-frame-dark` und heller Oberkante (`--td-frame-mid`).

### Debug-Panels

Alle Debug-Fenster nutzen `app-draggable-debug-panel` (`components/debug-window/`) und verhalten sich gleich: verschiebbar, in der Größe änderbar über den Griff unten rechts, Position und Größe in `localStorage` gespeichert.

- Die Größe liegt pro `windowId` im `DebugWindowService`; das Panel liest und schreibt sie selbst. Ein neuer Debugger braucht dafür keine eigene Verdrahtung, nur einen Eintrag in `DEFAULT_POSITIONS` und `DEFAULT_SIZES`.
- Gemeinsame Mindestgröße `DEBUG_PANEL_MIN_SIZE` (300 x 200 px), gilt für CSS, Resize und geladene Werte. Größen sind Außenmaße (`box-sizing: border-box`).
- Default-Größe so wählen, dass der Inhalt ohne horizontales Scrollen passt (Inhalts-`min-width` + 16 px Padding + 8 px Scrollbar + 2 px Rahmen). Höherer Inhalt scrollt im Panel.
- Logs und Listen, die mitwachsen sollen, als Flex-Spalte mit `height: 100%` bauen und dem Log `flex: 1; min-height: 0` geben (Event-Bus, Sound).

### Context-Hint-Box

Wiederverwendbare Hinweis-Box fuer kontextabhaengige Aktionen (z.B. Build-Modus):

```css
.context-hint-container {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 4px;
  font-family: var(--td-font-body);

  /* Glas wie der Mixin bevel-glass */
  background: var(--td-glass-tint);
  backdrop-filter: blur(8px) saturate(1.1);
  border: 1px solid var(--td-frame-mid);
  box-shadow: inset 0 1px 0 rgba(122, 133, 128, 0.33), var(--td-shadow-soft);
}

/* Mit Warnung: roter Rand und roter Glow */
.context-hint-container.has-warning {
  border-color: var(--td-health-red);
}

.hint-key {
  background: var(--td-panel-shadow);
  color: var(--td-gold-light);
  padding: 3px 8px;
  border-radius: 3px;
  font-family: var(--td-font-mono);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.warning-text {
  color: var(--td-health-red);
  text-transform: uppercase;
}
```

Verwendung:
```html
<app-context-hint
  [hints]="[{key: 'R', description: 'Rotate'}]"
  [warning]="validationError"
/>
```

### Damage-vs-Armor-Dialog

Hilfe-Dialog in `components/damage-matrix-dialog/`, geöffnet über den `i`-Button (`.td-matrix-btn`) rechts im BUILD-Header und im Tower-Header der Sidebar. Aus dem Tower-Header wird die Zeile des gewählten Towers hervorgehoben.

- Liest nur Configs (`DAMAGE_MATRIX`, `EFFECTIVENESS_THRESHOLDS`, `EFFECTIVENESS_COLORS`, Tower, Enemies). Ein Rebalancing braucht keine UI-Änderung.
- Stufen wie bei den Schadenszahlen, Farben ebenso bis auf `normal`: in der Tabelle neutral (`--td-text-secondary`), weil das Rot der Schadenszahlen in einer Matrix als "schlecht" gelesen wird und 1.00× hinter den Abweichungen zurücktreten soll.
- Aufbau: Kopf mit Titel und Einzeiler ("Multiplier on every hit"), Rüstungskopf sticky mit Bernstein-Unterstrich (`--td-rune-amber-muted`), darunter die Gegner je Rüstung als gedämpfte Zeile. Tower-Spalte mit Name und Schadensart, davor ein 6px-Punkt in `DAMAGE_TYPE_UI.color` (gedämpft). Werte: `weak` und `normal` nur als Textfarbe, `strong` und `devastating` als Chip mit leichtem Tint und Rand in der Stufenfarbe, `devastating` fett. Legende kompakt links im Footer.
- Nur freigeschaltete Tower (`ResearchStore.isTowerUnlocked`, dieselbe Prüfung wie das Baumenü). Die Liste ist reaktiv: eine Forschung, die bei offenem Dialog fertig wird, fügt die Zeile sofort ein. Solange noch Tower gesperrt sind, steht unter der Tabelle "More towers unlock through research."
- Breite `min(880px, 92vw)` über die Dialog-Config (`width`/`maxWidth`), nicht per CSS: das Overlay-Pane von MatDialog ist per Klasse auf 560px begrenzt, nur der Inline-Style der Config hebt das auf. Die Tabelle hat `table-layout: fixed` (Tower-Spalte 150px, Rüstungsspalten gleich breit), Gegnerlisten brechen um; horizontal gescrollt wird erst unter 600px Tabellenbreite.
- Esc schließt nur den Dialog: `isEscapeForDialog` (`utils/dialog-key-guard.ts`) hält Esc vom globalen Key-Handler fern, solange ein Dialog offen ist oder Esc schon verbraucht hat.

---

## WC3-Design-Regeln

1. **Max. 3 Akzentfarben gleichzeitig sichtbar**
2. **Gold nur fuer wichtige Elemente** (Buttons, Titel)
3. **Keine weichen Gradients** - Farbstufen bevorzugen
4. **Kontrast ueber Material & Rahmen**, nicht ueber Saettigung
5. **UI immer dunkler & schwerer als das Spielfeld**
6. **Rahmen: hell oben, dunkel unten** (klassischer 3D-Effekt)

---

## Accessibility (Icon-Buttons)

`matTooltip` setzt nur `aria-describedby`, keinen Namen. Reine Icon-Buttons (Header, Sidebar, Quick-Actions, Kompass, Dialoge) brauchen deshalb zusätzlich einen englischen Namen:

- `aria-label`, in der Regel mit dem Tooltip-Text; dynamisch per `[attr.aria-label]` (z. B. Sell-Wert, LOS-Filter-Modus)
- Umschalter mit sichtbarem Aktiv-Zustand: `[attr.aria-pressed]` (Layer-Toggles, Segmente im Display-Panel, Mute, Targeting, Move HQ / Set spawn)
- Buttons, die ein Menü aufklappen: `[attr.aria-expanded]` (Favoriten, Display, Audio, Layers, Developer)
- Deko-SVGs in gelabelten Links: `aria-hidden="true"`

`td-icon` rendert ohne `ariaLabel` ein `role="presentation"`-SVG, das Icon selbst trägt also nichts zum Namen bei. Debug-Fenster sind nachrangig, die meisten ihrer Buttons haben ein `title` als Fallback.

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `src/app/styles/td-theme.ts` | Zentrale Theme-Definition (Konstanten + CSS-Vars) |
| `tower-defense.component.ts` | Haupt-UI mit Layout |
| `components/game-header/` | Info-Header mit Spielstatus |
| `components/game-sidebar/` | Rechte Sidebar mit Aktionen, Tower-Slots, Wave-Preview (Panels siehe [Sidebar-Panels](#sidebar-panels)) |
| `components/compass/` | Kompass-Anzeige |
| `components/info-overlay/` | FPS / Tile-Stats Overlay (toggle ueber Caret) |
| `components/quick-actions/` | Quick Actions: Route-Animation, Display-, Audio-, Layer- und Dev-Menü, Kamera-Reset |
| `components/game-speed/` | Game-Speed-Button (1x/2x/4x, nur während einer Welle) |
| `components/debug-window/` | Debug-Panel Container + alle Debug-Ansichten (Wave, Camera, Event, Performance, …) |
| `components/context-hint/` | Wiederverwendbare Kontext-Hinweis-Box |
| `components/attributions-dialog/` | Attributions & Lizenzen Dialog |
| `components/damage-matrix-dialog/` | Damage-vs-Armor-Tabelle (Hilfe-Dialog aus der Sidebar) |
| `components/location-dialog/` | Location-Auswahl Dialog |
| `components/address-autocomplete.component.ts` | Adress-Autocomplete (Nominatim) |
| `components/engine-test/` | Standalone Engine-Test-View |

---

## Erweiterung

### Neues Theme erstellen (Beispiel fuer zukuenftige Erweiterung)

**Hinweis:** Diese Datei existiert noch nicht, dient als Vorlage fuer zukuenftige Theme-Varianten.

```typescript
// styles/td-theme-dark.ts (noch nicht implementiert)
export const TD_THEME_DARK = {
  ...TD_THEME,
  bgDark: '#0a0a0a',
  panelMain: '#1a1a1a',
  // ...
};
```

### Theme wechseln

```typescript
// In Komponente
import { TD_CSS_VARS } from '../styles/td-theme';
// Zukuenftig moeglich:
// import { TD_CSS_VARS } from '../styles/td-theme-dark';
```

---

## Referenzmaterial

- `public/assets/mocks/ui_mock.png` - WC3-Style Mockup
- `public/assets/mocks/ui_mock.txt` - Farbpalette Spezifikation
