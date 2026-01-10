# Tower Defense - Design System

**Stand:** 2026-01-08

## Uebersicht

Das Tower Defense UI basiert auf einem **WC3/Ancient Command** inspirierten Design mit Stein-, Metall- und Magie-Aesthetik. Das System verwendet CSS Custom Properties fuer zentrale Farbverwaltung.

**Inspiration:** Warcraft III UI (siehe `public/assets/games/tower-defense/mocks/ui_mock.png`)

---

## Theme-Datei

**Pfad:** `styles/td-theme.ts`

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
| `--td-gold-dark` | `#9E7E32` | Gedrueckt, Inaktiv |
| `--td-teal` | `#6FB7A5` | Magische Akzente |
| `--td-green` | `#9ED6A0` | Buffs, Positiv |
| `--td-green-dark` | `#6AAB6C` | Gedrueckt, Button-Schatten |

### Statusfarben

| Variable | Hex | Verwendung |
|----------|-----|------------|
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
| `--td-text-disabled` | `#6A726A` | Deaktivierter Text |

### Bars (HP, Mana, Progress)

| Variable | Hex | Verwendung |
|----------|-----|------------|
| `--td-hp-fill` | `#B14436` | HP-Balken Fuellung |
| `--td-hp-bg` | `#3A1B18` | HP-Balken Hintergrund |
| `--td-mana-fill` | `#4FB3C2` | Mana/Energy Fuellung |
| `--td-mana-bg` | `#1A2B30` | Mana Hintergrund |
| `--td-xp-fill` | `#9ED6A0` | XP/Progress Fuellung |

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
  background: var(--td-hp-bg);
  height: 6px;
  border-radius: 2px;
  overflow: hidden;
}

.td-hp-bar-fill {
  background: var(--td-hp-fill);
  height: 100%;
  transition: width 0.3s ease;
}
```

### Header (mit Stein-Textur)

```css
.td-header {
  background: url('/assets/games/tower-defense/images/425.jpg') repeat;
  background-size: 64px 64px;
  border-bottom: 2px solid var(--td-frame-dark);
  border-top: 1px solid var(--td-frame-light);
  padding: 4px 12px;
}

.td-header-title {
  color: var(--td-gold);
  font-size: 13px;
  font-weight: 700;
}
```

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
| `styles/td-theme.ts` | Zentrale Theme-Definition |
| `tower-defense.component.ts` | Haupt-UI mit Layout |
| `components/debug-panel.component.ts` | Debug-Panel (nutzt Theme) |

---

## Erweiterung

### Neues Theme erstellen

```typescript
// styles/td-theme-dark.ts
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
// oder
import { TD_CSS_VARS } from '../styles/td-theme-dark';
```

---

## Referenzmaterial

- `public/assets/games/tower-defense/mocks/ui_mock.png` - WC3-Style Mockup
- `public/assets/games/tower-defense/mocks/ui_mock.txt` - Farbpalette Spezifikation
