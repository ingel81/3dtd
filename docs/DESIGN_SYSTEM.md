# Tower Defense - Design System

**Stand:** 2026-09-11

## Uebersicht

Das Tower Defense UI basiert auf einem **WC3/Ancient Command** inspirierten Design mit Stein-, Metall- und Magie-Aesthetik. Das System verwendet CSS Custom Properties fuer zentrale Farbverwaltung.

**Inspiration:** Warcraft III UI (siehe `public/assets/mocks/ui_mock.png`)

---

## Theme-Datei

**Pfad:** `src/app/styles/td-theme.ts`

Zentrale Theme-Definition mit TypeScript-Konstanten und CSS Custom Properties.

### Verwendung in Komponenten

```typescript
import { TD_CSS_VARS, TD_THEME } from '../styles/td-theme';

@Component({
  styles: [`
    :host {
      ${TD_CSS_VARS}
    }
    .panel {
      background: var(--td-panel-main);
      color: var(--td-text-primary);
    }
  `]
})
```

---

## Farbpalette

### Basisflaechen

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-bg-dark` | `#141815` | Haupt-Sidebar, dunkler Stein |
| `--td-bg-surface` | `#1A201C` | Allgemeine Oberflaeche (Overlay, Loading) |
| `--td-panel-dark` | `#181D19` | Dark Panel Sections (Debugger Selected States) |
| `--td-panel-primary` | `#232B25` | Alias fuer `--td-panel-main` |
| `--td-panel-main` | `#232B25` | Primaere Panel-Flaeche |
| `--td-panel-secondary` | `#1C221E` | Unterpanels, Slots |
| `--td-panel-shadow` | `#0F130F` | Inset-Schatten, Tiefe |

### Rahmen (WC3-Stil)

**Regel:** Hell oben, dunkel unten (klassischer WC3-Look)

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-frame-dark` | `#3A423C` | Unterkante, Schatten |
| `--td-frame-mid` | `#4F5A53` | Haupt-Rahmenfarbe |
| `--td-frame-light` | `#6B756D` | Oberkante, Licht |
| `--td-edge-highlight` | `#8E9A90` | Fokus, Selektion |

### Akzentfarben

**Wichtig:** Sparsam einsetzen! Max. 3 Akzentfarben gleichzeitig sichtbar.

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-gold` | `#C9A44C` | Wichtiges, Buttons, Titel |
| `--td-gold-light` | `#E0C06A` | Button Highlight (Hover, Top-Border) |
| `--td-gold-dark` | `#9E7E32` | Gedrueckt, Inaktiv |
| `--td-teal` | `#6FB7A5` | Magische Akzente |
| `--td-teal-light` | `#5DE8C2` | Button Highlight (Hover, Top-Border) |
| `--td-teal-dark` | `#1A9A7A` | Button Shadow (Bottom-Border) |
| `--td-green` | `#9ED6A0` | Buffs, Positiv |
| `--td-green-dark` | `#6AAB6C` | Gedrueckt, Button-Schatten |

### Statusfarben

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-red` | `#B14436` | Alias fuer `--td-health-red` (allgemeines Rot) |
| `--td-health-red` | `#B14436` | Health, Danger |
| `--td-health-bg` | `#3A1B18` | HP-Bar Hintergrund |
| `--td-warn-orange` | `#C96A3A` | Warnungen |
| `--td-disabled` | `#5B625C` | Deaktivierte Elemente |

### Textfarben

**Regel:** Nie reines Weiss verwenden!

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-text-primary` | `#ECEFE9` | Haupttext |
| `--td-text-secondary` | `#B2BCAF` | Sekundaertext |
| `--td-text-muted` | `#8B948A` | Gedaempfter Text |
| `--td-text-tertiary` | `#7A837A` | Zwischen muted/disabled, fuer pending/inactive Elemente |
| `--td-text-disabled` | `#6A726A` | Deaktivierter Text |

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
+-------------------------------------------------------------------------+
|  INFO-HEADER: TOWER DEFENSE | Erlenbach | HP | Wave | Towers | Enemies  |
+-----------------------------------------------------------+-------------+
|                                                           |  SIDEBAR    |
|                                                           | +---------+ |
|                    3D CANVAS                              | | AKTIONEN| |
|                                                           | | [Tower] | |
|                                                           | | [Start] | |
|                                                           | +---------+ |
|                                                           | +---------+ |
|                                                           | | DEBUG   | |
|                                                           | | (opt.)  | |
|                                                           | +---------+ |
|  Controls Hint              [Camera] [Tilt] [Debug]       |             |
+-----------------------------------------------------------+-------------+
```

### Bereiche

| Bereich | Beschreibung |
|---------|--------------|
| **Info-Header** | Schlanker Header mit Titel, Standort und Spielstatus |
| **Canvas** | 3D-Spielfeld mit Google Photorealistic Tiles |
| **Sidebar** | Rechte Sidebar mit Aktionen und optionalem Debug-Panel |
| **Controls Hint** | Steuerungshinweise unten links (LMB: Pan, RMB: Rotate, Scroll: Zoom) |
| **Quick Actions** | Icon-Buttons unten rechts (Kamera-Reset, Debug) |

### Quick Actions und Dev-Menü

Die Quick Actions reichen vertikal von unterhalb des Kompasses (`top: 112px`) bis zur Unterkante; die Buttons sitzen unten, die leere Fläche darüber ist `pointer-events: none`. Untermenüs klappen nach oben auf.

Das Dev-Menü öffnet als zweispaltiger Block über seinem Toggle, außerhalb des Flusses (wie das Audio-Panel), damit es die übrigen Buttons nicht verschiebt:

| Spalte | Gruppen |
|--------|---------|
| Links: Welt, Rendering, Tools | Terrain & Map, Kamera, Display/Performance/LOS/Audio-Panels, State-Dump + DevWorld |
| Rechts: Gameplay, Simulation | Cheats, Waves & AI (Wave-Spawner, Static Curriculum, Training), Inspektoren (Tower, Enemy, Event Bus) |

Die Höhe ist auf den Platz zwischen Toggle und Kompass begrenzt; bei niedrigem Fenster scrollt das Menü, statt den Kompass zu überdecken. Neue Einträge in die passende Gruppe einsortieren und die Spalten ungefähr gleich hoch halten.

---

## Komponenten-Styles

### Panel (WC3-Rahmen)

```css
.td-panel {
  background: var(--td-panel-main);
  border-top: 1px solid var(--td-frame-light);
  border-left: 1px solid var(--td-frame-mid);
  border-right: 1px solid var(--td-frame-dark);
  border-bottom: 2px solid var(--td-frame-dark);
  color: var(--td-text-primary);
}
```

### Button (Gold-Akzent)

```css
.td-button {
  background: var(--td-gold);
  color: var(--td-bg-dark);
  border: none;
  border-top: 1px solid var(--td-edge-highlight);
  border-bottom: 2px solid var(--td-gold-dark);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.td-button:hover {
  background: #D4B05A;
  transform: translateY(-1px);
}

.td-button:active {
  background: var(--td-gold-dark);
  transform: translateY(1px);
}
```

### Next-Wave-Button (Sidebar)

Primärer Call-to-Action (`.td-wave-btn` in `game-sidebar.component.scss`). Rezept wie `.td-btn-green` bzw. `TD_BUTTON_TEAL_STYLES`: Teal-Verlauf, 1px dunkle Kante, Key-Shadow, `--td-font-mono` 12px/700, Versalien, `letter-spacing: 0.06em`. Ecken 3px wie Tower-Karten und Stat-Kacheln, Höhe 36px wie der Cancel-Button im Build-Mode, Inhalt zentriert, Icon 16px.

Typografie und Höhe bleiben in jedem Zustand gleich, nur Fläche und Farbe wechseln:

| Zustand | Auslöser | Darstellung |
|---------|----------|-------------|
| Bereit | keine Welle, kein Build-Mode | Teal-Verlauf, Hover `--td-teal-glow`, Pressed-Inset, `:focus-visible`-Outline |
| Gesperrt | Build-Mode, Game Over | grauer Verlauf wie `.td-btn:disabled`, `--td-text-disabled` |
| Welle läuft | `waveActive()` | `.td-wave-running`: `--td-panel-shadow` + `TD_BEVEL_INSET`, Text `--td-teal`, Icon `wave` statt `play` |

### Slot (Item, Tower-Auswahl)

```css
.td-slot {
  background: var(--td-panel-secondary);
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-dark);
  border-left-color: var(--td-frame-dark);
}

.td-slot.selected {
  border-color: var(--td-gold);
  box-shadow: inset 0 0 8px rgba(201, 164, 76, 0.3);
}
```

### HP-Bar

```css
.td-hp-bar {
  background: var(--td-health-bg);
  height: 6px;
  border-radius: 2px;
  overflow: hidden;
}

.td-hp-bar-fill {
  background: var(--td-health-red);
  height: 100%;
  transition: width 0.3s ease;
}
```

### Header (mit Stein-Textur)

```css
.td-header {
  background:
    linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
    url('/assets/images/backgrounds/stone-wall.jpg') repeat;
  background-size: auto, 64px 64px;
  border-bottom: 3px solid var(--td-panel-shadow);
  border-top: 1px solid var(--td-frame-light);
  padding: 4px 12px;
}

.td-header-title {
  color: var(--td-gold);
  font-size: 13px;
  font-weight: 700;
}
```

### Header-Stat-Leiste (an der Sidebar ausgerichtet)

Health, Gold und Wave stehen in einer Leiste fester Breite (`.header-stats` in `game-header`) direkt über dem Sidebar-Inhalt: gleiche Breite und Außenkanten wie Next-Wave-Button und Tower-Raster. Drei gleich breite Spalten, Zahlen mit `tabular-nums`, damit wachsende Werte die Nachbarn nicht verschieben. Der Gegnerzähler erscheint nur während einer Welle als eigener Chip (`.enemies-chip`) links neben der Leiste, die Leiste selbst springt dabei nicht.

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

Elemente auf der Stein-Textur benoetigen einen dunklen Hintergrund fuer Lesbarkeit:

```css
.td-text-badge {
  background: var(--td-panel-shadow);
  padding: 4px 10px;
  border: 1px solid var(--td-frame-dark);
  border-top-color: var(--td-frame-mid);
}
```

Verwendung fuer: Header-Titel, Stats, Buttons auf texturiertem Hintergrund.

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
  background: var(--td-panel-main);
  padding: 10px 16px;

  /* WC3-Frame */
  border: 1px solid var(--td-frame-mid);
  border-top-color: var(--td-frame-light);
  border-bottom-color: var(--td-frame-dark);
}

.hint-key {
  background: var(--td-panel-secondary);
  color: var(--td-gold);
  padding: 3px 8px;
  font-size: 11px;
  text-transform: uppercase;

  /* Inset-Effekt */
  border: 1px solid var(--td-frame-dark);
  border-top-color: var(--td-panel-shadow);
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

---

## WC3-Design-Regeln

1. **Max. 3 Akzentfarben gleichzeitig sichtbar**
2. **Gold nur fuer wichtige Elemente** (Buttons, Titel)
3. **Keine weichen Gradients** - Farbstufen bevorzugen
4. **Kontrast ueber Material & Rahmen**, nicht ueber Saettigung
5. **UI immer dunkler & schwerer als das Spielfeld**
6. **Rahmen: hell oben, dunkel unten** (klassischer 3D-Effekt)

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `src/app/styles/td-theme.ts` | Zentrale Theme-Definition (Konstanten + CSS-Vars) |
| `tower-defense.component.ts` | Haupt-UI mit Layout |
| `components/game-header/` | Info-Header mit Spielstatus |
| `components/game-sidebar/` | Rechte Sidebar mit Aktionen, Tower-Slots, Wave-Preview |
| `components/compass/` | Kompass-Anzeige |
| `components/info-overlay/` | FPS / Tile-Stats Overlay (toggle ueber Caret) |
| `components/quick-actions/` | Icon-Buttons (Kamera-Reset, Debug) |
| `components/game-speed/` | Game-Speed-Slider (1x/2x/4x) |
| `components/debug-window/` | Debug-Panel Container + alle Debug-Ansichten (Wave, Camera, Event, Performance, …) |
| `components/context-hint/` | Wiederverwendbare Kontext-Hinweis-Box |
| `components/attributions-dialog/` | Attributions & Lizenzen Dialog |
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
