# Tower Defense - Design System

**Stand:** 2026-10-09

## Übersicht

Taktisch-industriell und nüchtern, im Stil der Projektseite: dunkler Stein, Messing, Stahl, Oswald. Menü, Dialoge, Panels und HUD stehen auf einem SCSS-Fundament (`styles/_game-ui.scss`) und lesen ihre Werte aus Tokens (`styles/td-theme.ts`). Keine kopierten Dialoghüllen, keine Hex-Werte in Komponenten, wo es einen Token gibt.

Was der Look nicht hat: Glow, Verläufe als Fläche über ganze Bereiche, Emoji, Dekotext, gleichförmige Kachelraster, runde Ecken. Glas (Blur) nur, wo die Karte durchscheinen muss.

---

## Tokens

**Pfad:** `src/app/styles/td-theme.ts`. `TD_THEME` (Farben), `TD_FONTS`, `TD_TYPE`, `TD_SPACE`, `TD_SHAPE`, `TD_MOTION`, `TD_SHADOWS`, `TD_LAYOUT`, `TD_LAYERS`; daraus der String `TD_CSS_VARS` mit allen `--td-*`.

`installThemeVars(document)` in `main.ts` setzt `TD_CSS_VARS` vor dem Bootstrap einmal als `:root`-Regel (ein `<style id="td-theme-vars">` im Kopf). So sehen auch Overlays außerhalb des Komponentenbaums (`.cdk-overlay-container`: Dialoge, Tooltips) dieselben Werte; `src/styles.scss` liest sie nur. Neue Komponenten setzen `TD_CSS_VARS` nicht mehr auf `:host`. Ältere tun es noch; das ist doppelt, aber gleichwertig, und fällt beim Anfassen der Datei weg.

Kontrast prüft `td-theme.contrast.spec.ts` aus `TD_THEME`: Text auf jeder Fläche 4,5:1, Fokus, Warnstreifen und stille Icons 3:1. Fällt ein Token durch, wird er in `td-theme.ts` geändert.

### Flächen und Platten

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-bg-dark` | `#111613` | Seite, Sidebar, Vollbild-Grund (Forschung, Token-Schritt) |
| `--td-bg-surface` | `#1A201C` | Allgemeine Oberfläche |
| `--td-panel-main` / `--td-panel-primary` | `#222A24` | Panel-Fläche |
| `--td-panel-secondary` | `#1A1F1B` | Unterpanels, Slots, Fläche der Rahmen-Knöpfe |
| `--td-panel-dark` | `#181D19` | Debugger |
| `--td-panel-shadow` | `#0B0F0C` | Vertiefte Fläche, Tiefe |
| `--td-plate` | Verlauf `#262F28` nach `#1D241F` | Fläche einer Platte (`--td-plate-top`, `--td-plate-bottom` einzeln) |
| `--td-plate-head` | Verlauf `#2B332D` nach `#202722` | Titelplatte |
| `--td-plate-danger` | Verlauf `#2A1714` nach `#170E0C` | Game Over, Connection lost |
| `--td-line-steel` | `#4A544D` | 1px-Rand einer Platte, Rahmen-Knöpfe |
| `--td-line-brass` | `#8E7228` | 2px-Kante oben auf einer Titelplatte |
| `--td-frame-dark` / `-mid` / `-light` | `#2F3631` / `#4A544D` / `#7A8580` | Trennlinien, Ränder, Hover-Rand |
| `--td-edge-highlight` | `#A7B3A8` | Auswahl |
| `--td-glass-tint`, `--td-scrim` | `rgba(17,22,19,.78)`, `rgba(8,11,9,.58)` | Glas über der Karte, Abdunklung |

### Akzente und Zustände

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-gold` / `-light` / `-dark` | `#C2A055` / `#D9BC68` / `#8E7228` | Messing: Hauptaktion, Titel, Auswahl |
| `--td-ink` | `#1A140A` | Text auf Messing |
| `--td-brass-lip` | `#4A3A12` | Harte Unterkante des Messingknopfs |
| `--td-teal` / `-light` / `-dark` | `#6BB6A4` / `#8FD9C6` / `#1F8772` | Laufend, magisch, bestätigt |
| `--td-green` / `-dark` | `#9ED6A0` / `#6AAB6C` | Positiv, erforscht |
| `--td-health-red` / `--td-red` | `#B83E32` | Rot als Fläche (Balken, Ränder); als Text zu dunkel |
| `--td-health-bg` | `#2E1614` | Dunkelrote Fläche |
| `--td-warn-orange` | `#C96A3A` | Warnung als Fläche, Rand, Streifen |
| `--td-warn-text` | `#D98A4A` | Warnung als Text |
| `--td-danger-bg` / `-edge` / `-text` | `#3A1410` / `#B83E32` / `#F2C9C2` | Zerstörende Knöpfe, Fehlerbanner |
| `--td-hp-text` | `#E87A6A` | HQ-Zahl |
| `--td-hp-low` | `#EE8A5E` | HQ unter 30 %, Titel von Game Over |
| `--td-gain` / `--td-loss` | `#9ED6A0` / `#E87A6A` | Credits plus und minus |
| `--td-hazard` | Streifen -45°, `--td-warn-orange` und `--td-ink`, je 6px | HQ unter 10 %, Kante von Game Over |
| `--td-cold`, `--td-lightning`, `--td-chaos` | `#5BA4D9`, `#7DD3FC`, `#D946EF` | Schadensarten (Tooltips, `DAMAGE_TYPE_UI`) |
| `--td-rune-amber` / `-muted` | `#A47A2C` / `#6B5320` | Trennlinien, Tier-Marken |

Titelakzent der Tower-Tooltips (`DAMAGE_ACCENT` in `sidebar-tooltips.ts`): `--td-gold-light` (physical, pierce, siege), `--td-teal-light` (magic), `--td-warn-orange` (fire), `--td-green` (poison) und die drei Schadensfarben oben.

### Text

Nie reines Weiß.

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-text-primary` | `#EEF1EB` | Haupttext, Zahlen |
| `--td-text-secondary` | `#B6C0B3` | Fließtext in Dialogen, Menüeinträge in Ruhe |
| `--td-text-muted` | `#929C90` | Labels, Nebeninfo (AA auch auf Titelplatten) |
| `--td-text-tertiary` | `#7A837A` | Nur für Nicht-Text (Icons, Linien); als Text unter AA |
| `--td-text-disabled` | `#6A726A` | Gesperrt |

### Schrift, Größen, Abstände, Formen, Bewegung

| Variable | Wert | Verwendung |
|----------|------|------------|
| `--td-font-display` | Oswald | Titel, Menü, Knöpfe, HUD-Zahlen |
| `--td-font-body` | Inter Tight | Fließtext, Namen, Beschreibungen |
| `--td-font-mono` | JetBrains Mono | Zahlen in Tabellen, Kosten, Hotkeys, Codes, kleine Labels |
| `--td-fs-micro` bis `--td-fs-hero` | 10, 11, 13, 15, 18, 22, 26, 44 px | micro, small, body, lead, title, hud, menu, hero. Nichts unter 10px |
| `--td-track-caps`, `--td-track-title` | `.12em`, `.06em` | Laufweite von Versalien-Labels und Titeln |
| `--td-sp-1` bis `--td-sp-6` | 4, 8, 12, 16, 24, 32 px | Abstände |
| `--td-cut`, `--td-cut-sm` | 10px, 6px | Abgeschrägte Ecke einer Platte, einer kleinen Platte |
| `--td-radius` | 0 | Ecken sind eckig |
| `--td-dur-fast` / `-mid` / `-slow` | 120, 220, 450 ms | Hover und Druck, Wechsel, Ein- und Ausblenden |
| `--td-ease-out` | `cubic-bezier(.2,.7,.2,1)` | Standardkurve |
| `--td-focus-color`, `-width`, `-offset` | `#D9BC68`, 2px, 2px | Fokusring |

Oswald liegt lokal in `src/fonts/` (OFL, dieselbe Datei wie auf der Projektseite, variabel 400 bis 700) und wird in `src/styles.scss` über eine relative URL eingebunden: der Build bündelt sie nach `media/`, sie lädt unter jeder Base-Href und mit CSP `font-src 'self'`. Inter Tight, JetBrains Mono und Roboto (nur Material) kommen über `@fontsource`.

Debug-Farben (`--td-event-vfx`, `--td-event-audio`, `--td-perf-critical`, `--td-perf-warning`), Schatten (`--td-shadow-soft`, `--td-shadow-key`, `--td-inner-highlight`) und Layout-Tokens (`--td-sidebar-width`, `--td-sidebar-gutter`, `--td-z-marks`, `--td-z-hud`, `--td-z-dock`) stehen ebenfalls in `TD_CSS_VARS`.

---

## Fundament (`styles/_game-ui.scss`)

```scss
@use '../../styles/game-ui' as ui;

@include ui.classes;          // .dlg, .btn-primary, ... für das Template

.dlg { width: 520px; }       // die Breite gehört der Komponente
.my-row { @include ui.motion(color); }
```

`_game-ui.scss` leitet `_td-mixins.scss` weiter (`ui.scrollbar`, `ui.sunken`, `ui.keycap`, `ui.section-label`, `ui.focus-ring`, `ui.sr-only` usw.). Die View-Encapsulation lässt keine globalen Klassen durch, deshalb bindet jede Komponente `ui.classes` oder einzelne Mixins selbst ein.

| Mixin | Was es macht |
|-------|--------------|
| `plate($cut, $fill, $edge, $position)` | Platte: Rand `$edge` (Stahl) als Fläche, `::before` 1px innen mit `$fill`, beide mit `cut-shape`; der Rand folgt so der Schräge. `::before` ist belegt. Schatten über `plate-shadow` auf dem Element außen herum, `clip-path` schneidet ihn sonst ab. `$position: null` lässt `absolute` oder `fixed` stehen |
| `cut-shape($cut)` | `clip-path` mit Schräge oben links und unten rechts |
| `plate-head` | Titelplatte: 2px Messingkante oben, `--td-plate-head`, Trennlinie unten, Titel links, Aktionen rechts |
| `title($size: 20px)` | Oswald 600, Versalien, Laufweite .08em, `--td-gold-light` |
| `dialog-shell($width)`, `dialog-head`, `dialog-body`, `dialog-foot` | Dialog als Platte in einer Spalte; nur der Körper scrollt, Fuß rechtsbündig |
| `btn-shape($height)` | Größe und Schrift eines Knopfs: Oswald 14px, Versalien, 38px, 2px-Fokusring |
| `btn-primary` | Messing: Verlauf `--td-gold-light` nach `--td-gold`, Unterkante `0 2px 0` in `--td-brass-lip`, Text `--td-ink`. Hover heller, Druck 1px tiefer. Eine Hauptaktion je Ort |
| `btn-secondary` | Stahlrahmen auf `--td-panel-secondary`, Hover Rand `--td-frame-light` |
| `btn-danger` | `--td-danger-*`: Löschen, Verlassen |
| `btn-ghost` | Nur Text: dritte Aktion, Dateien sichern |
| `btn-done`, `btn-xs` | Bestätigt (Teal); klein für 30px-Zeilen |
| `icon-btn($size: 32px)` | Eckiger Icon-Knopf (Schließen, Zurück, Zeilenwerkzeuge) |
| `menu-list`, `menu-item($size)`, `menu-rule` | Menü: Oswald-Versalien als Text, 3px Messingbalken links bei Hover, Fokus und `.is-active`; ein `<small>` darunter ist die Mono-Unterzeile |
| `stat-plate($cut)`, `caps-label` | HUD-Platte mit kleiner Schräge; Mono-Label 10px Versalien |
| `seg-bar($height, $gap)` | Segmentbalken (HQ, Ladefortschritt): die Kinder sind Segmente, `.is-on` leuchtet |
| `corner-brackets($size, $inset, $color)` | Goldene Eckwinkel über ein `::after`; nur Start-Menü und Game Over |
| `glass-strip` | Glas mit 6px Blur, nur über der Karte |
| `input`, `segmented`, `note`, `banner`, `kbd`, `link`, `spinner` | Formular und Text; `segmented` rahmt die Wahl in Messing |
| `motion($props...)`, `reduced-motion` | Übergänge mit `--td-dur-fast`; bei `prefers-reduced-motion` keine |

`ui.classes` gibt `.dlg`, `.dlg-head`, `.dlg-title`, `.dlg-body`, `.dlg-foot`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost`, `.btn-done`, `.btn-xs`, `.icon-btn` (`.sm`, `.big`), `.inp`, `.seg` (Wahl `.is-on`), `.note` (`.is-warn`, `.is-error`, `.is-ok`), `.banner`, `.spin`, `.section-label`, `.link`, `kbd`, `.sr-only`.

Die älteren Rezepte in `_td-mixins.scss` (`gold-button`, `teal-button`, `frame-button`, `bevel-glass`) nutzen Sidebar und HUD noch; neue Teile nehmen die Knöpfe aus `_game-ui`.

### Dialoge

MatDialog mit `panelClass: 'td-dialog-panel'`. Die cdk-Schale ist durchsichtig, ohne Blur und Radius, und wirft nur den Schatten (`drop-shadow` auf `.mat-mdc-dialog-container`, in `styles.scss`); die Platte zeichnet der Dialog selbst:

```html
<div class="dlg">
  <header class="dlg-head">
    <h2 class="dlg-title" [id]="titleId">What's new</h2>
    <button class="icon-btn" type="button" aria-label="Close" (click)="close()">
      <td-icon name="cross" [size]="16"></td-icon>
    </button>
  </header>
  <div class="dlg-body">...</div>
  <footer class="dlg-foot">
    <a class="btn-secondary" ...>Full changelog</a>
    <button class="btn-primary" type="button" (click)="close()">Got it</button>
  </footer>
</div>
```

Der Titel ist ein Name, kein Satz, und trägt die `id` für `ariaLabelledBy`; ein Icon im Kopf nur, wenn es etwas sagt. Das Overlay-Pane von MatDialog ist per Klasse auf 560px begrenzt: breitere Dialoge setzen `width` und `maxWidth` in der Config und geben `.dlg` `width: 100%` (Damage vs armor). Auf dem Fundament stehen What's new, Attributions (mit „Legal & privacy“, `SITE_URL/legal.html`), Keyboard shortcuts, Damage vs armor, Runs, Run upload, der Token-Schritt und die Forschung (Vollbild, eigener dunkler Grund, ohne Schattenfilter).

Tooltips: der Material-Tooltip über `mat.tooltip-overrides` in `styles.scss` (Glas aus `--td-bg-dark` zu 94 %, Ecken 0, Inter Tight 12px, Rand `--td-line-steel`). `.td-tooltip-multiline` setzt Mono 11px links ausgerichtet, ohne `!important`: zwei Klassen schlagen Materials eine.

### Game Over und Connection lost

Ein Overlay über der abgedunkelten Karte (`--td-panel-shadow` zu 72 %) mit goldenen Eckwinkeln, darin eine Gefahr-Platte (`plate(14px, --td-plate-danger, --td-danger-edge)`) mit Warnstreifen (`--td-hazard`, 6px) oben. Game Over: „HQ lost“ in Oswald 56px/700 `--td-hp-low`, darunter Ort und Welle (12px Mono, Versalien), die [Bilanz](#game-over-bilanz), Coop-Tabelle und Diagramme, dann eine Knopfreihe: Restart here (Messing, nur allein oder als Host), Replay wave N (solange angeboten), Main menu (`TowerDefenseComponent.openMainMenu`). Run und Coop-Replay sichern darunter stille Knöpfe. Die Platte steht, ihr Inhalt scrollt (`.td-gameover-scroll`). Connection lost: dieselbe Platte, Titel 28px, Continue alone und Start over alone. Titel-Ruck und Einblenden stehen bei `prefers-reduced-motion` still.

---

## UI-Layout

```
+------------------------------------------------------------------------------+
| HEADER  Logo | DEFEND <Ort> | Aktionen         [Enemies] HQ | CREDITS | WAVE |
+------------------------------------------------------+-----------------------+
| Info-Overlay        [Game Speed]           Kompass   | SIDEBAR               |
|                                                      | WAVE                  |
| [Held]                                               | BUILD, Tower oder     |
| [K]              3D CANVAS                           | Research              |
|                                                      |                       |
|                                  [Quick Actions]     |                       |
| Logos  Controls Hint                  Attribution    |                       |
+------------------------------------------------------+-----------------------+
```

### Bereiche

| Bereich | Beschreibung |
|---------|--------------|
| **Info-Header** | Logo, Standort ("DEFEND Straße, Stadt, Land"; der Name kommt aus `formatAddressShort`, seit 2026-09-20 mit Land. Die Zeile wird höchstens 34 % der Fensterbreite breit, danach schneidet sie hinten ab; Klick öffnet den Standort-Dialog) mit Aktionen (Link kopieren, Favoriten, Zufallsort, HQ versetzen, Spawn setzen), rechts die drei Stat-Platten HQ / CREDITS / WAVE, während einer Welle links davon der Gegner-Chip (siehe [Header-Stat-Platten](#header-stat-platten)). Der Ortsname gibt auf schmalen Fenstern zuerst nach |
| **Canvas** | 3D-Spielfeld mit Google Photorealistic Tiles |
| **Sidebar** | Rechte Sidebar: WAVE-Panel, darunter BUILD, Tower-Detail oder Research (siehe [Sidebar-Panels](#sidebar-panels)) |
| **Info-Overlay** | Oben links: FPS, per Caret aufklappbar um Tiles, Sounds und Streets. Misst seine Unterkante (`ResizeObserver`, `UIStore.infoOverlayBottom`), die Fähigkeitenleiste bleibt darunter |
| **Game Speed** | Oben mittig, in Bauphase und Welle (ausgeblendet beim Laden und nach Game Over): Pause-Button und ein Button, der 1x, 2x und 4x durchschaltet. In der Bauphase beschleunigt er die Forschung, die in Spielzeit läuft. Pausiert zeigt der Pause-Button das Play-Icon eingelassen in `--td-gold-light` mit `--td-gold-dark`-Rand, darunter ein Glas-Chip "PAUSED" (10px Mono-Versalien). In derselben Spalte (`.td-hud-top`) darunter die Boss-Leiste, siehe [Boss-Leiste](#boss-leiste). Während eines [Boss-Intros](#boss-intro-canvas) blendet die Spalte aus (`.td-hud-muted`, 200 ms), ihre Komponenten bleiben bestehen |
| **Kompass** | Oben rechts, Klick setzt die Kamera zurück |
| **Fähigkeitenleiste** | Linker Rand, senkrecht mittig zwischen Info-Overlay und Logos: Held (sobald es einen gibt) und ein Knopf je erforschter Fähigkeit (der Nuclear Strike nur mit stehendem Missile Silo), siehe [Fähigkeitenleiste](#fähigkeitenleiste-canvas) |
| **Controls Hint** | Unten links neben den Logos (LMB: Pan, RMB: Rotate, Scroll: Zoom, WASD/Pfeile: Move, H: Shortcuts), verschwindet nach 15 s oder per Klick. Solange ein [First-Run-Tipp](#first-run-tipps) steht, bleibt er weg: der erste Tipp trägt dieselben Tasten |
| **Quick Actions** | Sechs Icon-Buttons unten rechts, siehe unten |
| **Sidebar-Fuß** | Eine Zeile mit drei Zellen: Menu (Zahnrad in `--td-gold`, öffnet das Menü, Esc), Tips (die First-Run-Tipps von vorn), die Version (öffnet What's new). Weltkarte, Läufe und GitHub stehen im Menü (New game, Extras). 30px hoch, 11px Mono, Trennlinien aus dem 1px-`gap` über `--td-frame-dark` |

### Quick Actions und Dev-Menü

Sechs Buttons in einer Reihe (je 32px, `gap` 4px, zusammen 212px), von links:

| Button | Funktion |
|--------|----------|
| Route-Animation | Spielt die Routen-Animation ab; oranger Rand (`--td-warn-orange`) |
| Settings | Öffnet die Seite Settings des Menüs (Effekte, Audio, Grafik); Output `settingsRequested` |
| Photo Mode | Schaltet den [Photo Mode](#photo-mode) ein (Taste O) |
| Layers | Sieben Overlay-Schalter, die senkrecht nach oben aufklappen: Route Grid, Gebäude, Straßen, Routen, Flughöhe der Air-Route, Air Route Grid, Per-Tower-LOS-Filter (schaltet beide, Boden, Luft durch) |
| Kamera-Reset | Setzt die Kamera zurück |
| Dev | Dev-Menü mit Kachel-Raster (unten beschrieben) |

Effekte, Anzeige und Lautstärken stehen nur noch auf der Seite Settings des Menüs; die früheren Klappmenüs Display und Audio der Leiste gibt es nicht mehr. Aktive Layer-Schalter stehen im Teal-Verlauf, die offenen Toggles Layers und Dev im Gold-Verlauf, je mit 1px-Rand in der Farbe statt Glow. Alle Knöpfe und Kacheln tragen den 2px-Fokusring.

Die Quick Actions reichen vertikal von unterhalb des Kompasses (`top: 112px`) bis 36px über der Unterkante (`bottom: 36px`); die Buttons sitzen unten, die leere Fläche darüber ist `pointer-events: none`. Untermenüs klappen nach oben auf. Es ist immer nur eines der beiden Menüs (Layers, Dev) offen: `UIStore.openMenu` ist die einzige Quelle, `toggleMenu()` schließt beim Öffnen das andere, gespeichert wird nur das zuletzt offene (ein gespeichertes `display` oder `audio` öffnet keines mehr). Das Dev-Panel spannt die ganze Leiste und würde die anderen sonst überdecken.

Das Dev-Menü (`.td-dev-menu`) ist ein Glas-Panel (Mixin `bevel-glass`) über der Leiste: genau so breit wie sie (212px), rechtsbündig, Unterkante 4px über den Buttons, außerhalb des Flusses. Innen ein Raster mit vier Spalten (`gap` 4px, `padding` 6px), gegliedert in Gruppen, deren Titel über die volle Breite laufen (8px/600, `letter-spacing: 0.16em`, `--td-text-muted`):

| Gruppe | Kacheln |
|--------|---------|
| Map | Height, Points, Recast, Dump |
| View & Panels | Camera, Frame, Display, Perf, LOS, Audio, DevWorld (nur mit `?devworld`) |
| Cheats | Kill, Credits, +HP, Research, Max Up, Abilities, Hero |
| Waves & Inspect | Waves, Static, AI, Towers, Enemies, Events, Cells (Zellbericht, siehe unten), Snapshot (Korridor als JSON-Download) |

Kachel (`.td-dev-tile`): 44px hoch, Icon 18px über einer Beschriftung in 8px Versalien (`letter-spacing: 0.06em`), Fläche `rgba(11,15,12,0.6)`, Rahmen `--td-frame-dark`.

| Zustand | Darstellung |
|---------|-------------|
| Hover | Rahmen `--td-frame-mid`, Text `--td-text-primary` |
| Aktiv (Fenster offen, Schalter an) | Fläche `rgba(194,160,85,0.16)`, Rahmen `--td-gold-dark`, Inset `rgba(217,188,104,0.18)`, Text `--td-gold-light` |
| Cheat (`.td-dev-cheat`) | kein Aktiv-Zustand; Icon und Text in der Farbe der Wirkung (Kill und +HP `--td-health-red`, Credits `--td-gold`, Research und Max Up `--td-teal`, Abilities `--td-warn-orange`, Hero `--td-green`), beim Hover nur der Rahmen in dieser Farbe |

Die Tooltips nennen die volle Funktion (z. B. "+1000 Credits (Shift+Click: +100k)"), die `aria-label`s ebenso. Die Kacheln "+HP" und "Credits" nehmen dieselben drei Eingaben (`debug-cheat-amount.ts`): Klick +1000 (Shift +100.000), Rechtsklick -10 (Shift -1000), Mausrad über der Kachel ±100 je Raste (Shift ±1000); Rechtsklick und Rad scrollen das Panel nicht und öffnen kein Kontextmenü. Das HQ bleibt bei 0 HP stehen (Spielende im nächsten Sub-Step), die Credits fallen nicht unter 0. Beschriftungen kurz halten: in der Mono-Ersatzschrift (Consolas) sind 8 Zeichen bei 8px rund 39px breit, die Kachel innen 44,5px. Der Dev-Toggle zeigt geöffnet das Gold-Rezept mit `--td-gold-glow`, wie der Layers-Toggle.

Die Höhe ist auf den Platz zwischen Leiste und Kompass begrenzt; bei niedrigem Fenster scrollt das Panel, statt den Kompass zu überdecken. Neue Einträge in die passende Gruppe einsortieren.

Snapshot leuchtet im Aktiv-Zustand, solange er liest. Was er zuletzt sagt (Fortschritt, Dateiname, Grund ohne Datei), steht als Statuszeile (`.td-dev-status`) über die volle Breite unter der Gruppe: 9px Mono, `--td-text-muted`, bricht lange Dateinamen um, `role="status"`. Inhalt der Datei: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#__corridor-devtools).

**Zellbericht** (Kachel Cells, `app-cell-report-panel` in `components/cell-report-panel/`): Solange er an ist, steht oben in der Mitte, 120px unter der Oberkante der Canvas-Fläche und damit unter Game Speed und Boss-Leiste, eine Glas-Leiste (`ui.glass-strip`, eckig, 300px breit). Oben der Titel "CELL REPORT" (Oswald 14px/600, Versalien), rechts die Zahl der Zellen in `#e69f00` (Okabe-Ito-Orange, die Rahmenfarbe der gewählten Zellen auf der Karte), darunter die Bedienung (10px Mono, `--td-text-muted`), ein Notizfeld (Input-Rezept) und die Knöpfe Copy JSON (Gold-Rezept), Clear und Done (Rahmen-Rezept), zuletzt eine Statuszeile. Nur das Panel nimmt Klicks. Das Rechteck eines Shift-Ziehens ist ein gestrichelter Rahmen in derselben Farbe. Bedienung und JSON: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#__corridor-devtools).

### Boss-Leiste

Solange ein Boss lebt (`EnemyTypeConfig.isBoss`: Herbert, Skarnax, die Ooze), steht oben mittig unter Game Speed und PAUSED-Chip `app-boss-bar` (`components/boss-bar/`): Glas-Leiste (`ui.glass-strip`, eckig), `min(420px, 56vw)` breit, links der Name des Typs (Oswald 14px/600, Versalien, `--td-text-primary`), rechts die HP ("12,340 / 40,000", 10px Mono, `--td-text-muted`), darunter ein 8px-Balken als vertiefte Fläche mit Füllung in `--td-health-red`. Bei mehreren Bossen zeigt der große Balken den mit den meisten HP, die übrigen stehen als 3px-Balken darunter, höchstens vier, danach "+N" (Auswahl in `boss-bar.ts`). `pointer-events: none`.

Bosse kommen über `enemy:spawned` in eine kurze Liste; ein 8-Hz-Timer außerhalb von Angular liest ihre HP und wirft die heraus, die gestorben, durchgekommen oder entfernt sind (ein Reset und das Debug-Fenster senden kein `enemy:died`, geprüft wird `active && alive`). Das Signal ändert sich nur, wenn sich die Leiste ändert; pausiert bleibt es also stehen.

### Boss-Intro (Canvas)

Tritt ein Boss einer Welle aus seinem Portal, schneidet die Kamera aufs Portal und `app-boss-intro` (`components/boss-intro/`) zeigt seinen Namen; Auslöser, Pause und Zeitplan in [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-intro). Die Komponente liegt immer über dem Canvas-Bereich (`z-index` 25, über der oberen HUD-Spalte und dem Game-Over-Overlay mit 20) und ist ohne Intro durchsichtig und klickdurchlässig; so hat die erste Blende eine Deckkraft, von der sie ausgeht.

- Schleier: ganze Fläche in `--td-panel-shadow`, blendet vor jedem Schnitt in 220 ms ein (ease-in) und danach in 320 ms aus (ease-out); die Dauern kommen aus `BOSS_INTRO_TIMING`, damit Blende und Schnitt zusammenpassen
- Titelkarte im unteren Drittel, zentriert, nur während der Portal-Einstellung, über einer weichen Abdunklung der unteren 45 % (`rgba(8,11,9,0.72)` nach transparent): oben "BOSS · WAVE n" (11px/700 Mono-Versalien, Laufweite 0.32em, `--td-gold`, als Trenner eine 4px-Raute in `--td-gold-dark`), darunter der Name des Typs (`EnemyTypeConfig.name`, Inter Tight 700, `clamp(30px, 4.6vw, 54px)`, Versalien per CSS, Laufweite 0.16em, `--td-text-primary` mit Textschatten), eine 88px-Haarlinie im Gold-Verlauf und der Hinweis "Esc or click to skip" (10px Mono, `--td-text-muted`, Tastenkappe wie in der Photo-Leiste)
- Die Karte steigt 8px auf und blendet ein, 140 ms nachdem der Schleier zu weichen beginnt; die Laufweite des Namens setzt sich in 0,9 s von 0.3em auf 0.16em. Bei `prefers-reduced-motion` nur Deckkraft, keine Bewegung (auch die Kamera fährt dann nicht heran)
- Bis die Sicht zurück ist, liegt ein durchsichtiger Knopf über der ganzen Fläche ("Skip the boss intro"): ein Klick überspringt und erreicht weder Karte noch HUD noch den Pause-Knopf darunter. Während der Schleier danach weicht, nimmt die Karte wieder Klicks
- Die Karte ist `aria-hidden`; der `LiveAnnouncer` sagt beim Start "Boss: <Name>, wave <n>. Escape skips."

---

## Komponenten-Styles

### Rezepte (Panel, Buttons, Slots)

Rezepte sind Mixins, siehe [Fundament](#fundament-stylesgame-uiscss). Die älteren in `styles/_td-mixins.scss` gelten weiter, wo sie stehen:

| Mixin | Inhalt |
|-------|--------|
| `sunken` | Vertiefte Fläche (Slots, Inputs, Balken-Hintergrund): 1px `--td-frame-dark`, Inset-Schatten |
| `gold-button`, `teal-button` | Verlauf mit Kanten, Text `#1A140A` bzw. `#0E1612` (Sidebar, `.td-btn`) |
| `frame-button` | Rahmen-Knopf im Panel-Material |
| `bevel-glass` | Glas mit Blur für Canvas-Leisten |
| `keycap`, `section-label`, `sr-only` | Tastenkappe, Abschnittskopf in Mono-Versalien mit Linie, nur für Screenreader |
| `scrollbar`, `webkit-scrollbar*` | Dunkle Scrollbar: `scrollbar` in die scrollende Regel, die `webkit-*` in die `::-webkit-scrollbar*`-Regeln |

Die globalen Buttons `.td-btn` (`tower-defense.component.scss`, Fehler-Overlays) folgen `gold-button`. Die Sidebar-Sektionen (`.td-panel`) sind flach, ohne Rahmen (`_sidebar-panel.scss`).

### Sidebar-Panels

Die Sidebar (`components/game-sidebar/`) liefert Rahmen, Footer und die Wahl des Panels. Jede Sektion ist eine eigene Component mit gekapselten Styles:

| Component | Inhalt |
|-----------|--------|
| `wave-panel/` | WAVE: Gegnergruppen der laufenden Welle mit Preview, Next-Wave-Button mit Auto-Start-Schalter, NEXT-Zeitleiste |
| `build-panel/` | BUILD: Tower-Karten mit Preview, Build-Mode-Hinweis und Cancel |
| `tower-panel/` | Detail des gewählten Towers: Stats, Targeting, Upgrades, Verkauf. Eine Upgrade-Kachel, die gerade nicht kaufbar ist (Gold fehlt, Stufe noch nicht erforscht), ist grau, bleibt aber klickbar (`aria-disabled`): der Klick kauft nichts und nennt den Grund wie U, siehe [Tastenkürzel](#tastenkürzel) |
| `hero-panel/` | Held, solange er gewählt ist, an der Stelle des Tower-Details, siehe [Helden-Panel](#helden-panel-sidebar) |
| `building-panel/` | Gewähltes passives Gebäude ohne eigenes Panel (Missile Silo): Kopf wie das Tower-Detail mit Verkauf, darunter `description` in `--td-font-body` 11px `--td-text-secondary`, dann je Fähigkeit, die von ihm startet, eine Zeile auf `--td-panel-secondary` mit 1px `--td-frame-dark`: Name, Tastenkappe (Gold auf `--td-panel-shadow` wie im Helden-Panel), rechtsbündig der Zustand ihres Knopfs ("ready", "recharges in 2 waves", `buildingAbilityRows`). Keine Stats, kein Targeting, keine Upgrades |
| `research-panel/` | Research Center: Zusammenfassung ("3/21 researched", Slots), laufende Forschungen mit Balken und Abbrechen-Knopf, der Knopf in den [Forschungsbaum](#forschungsbaum-dialog), Upgrades, Verkauf. Läuft nichts, steht dort, wie viele Forschungen gerade offen sind, statt einer leeren Fläche. Der Knopf folgt dem Gold-Rezept, weil er das Einzige ist, wofür dieses Panel da ist; alles andere darin ist Status. Baum, Warteschlange und die Wahl selbst liegen im Dialog. Die Upgrade-Kachel (Research Wing) verhält sich wie die im Tower-Detail |

Die Host-Elemente haben `display: contents`, die `<section class="td-panel">` bleibt damit Flex-Item der Sidebar-Spalte. Regeln, die mehrere Panels brauchen (Section, Header, Content, Scroll-Fläche, Tower-Header mit Sell-Button, `i`-Button, Upgrade-Kacheln), stehen einmal als Mixins in `_sidebar-panel.scss`; ein Panel bindet per `@include panel.<name>` ein, was sein Template nutzt. Die 1px-Trennlinie trägt nur das WAVE-Panel, die übrigen sind immer die letzte sichtbare Sektion. Die Köpfe (`.td-panel-header`) sind Titelplatten wie die der Dialoge, nur kleiner: 2px `--td-line-brass` oben, `--td-plate-head`, 1px `--td-frame-dark` unten, mindestens 36px hoch, Titel in Oswald 15px/600 Versalien `--td-gold-light` (der Tower-Name in `--td-teal-light`); der `i`-Button (Damage vs armor) ist `ui.icon-btn` 24px ganz rechts. Upgrade-Kacheln sind Steinflächen (`--td-plate`) mit 1px Messingrand und 3px Messingkante links, Name in Oswald 15px, Preis als Messingschild in Mono; Hover hellt den Rand auf. Keine Radien, kein Glow, Labels mindestens 10px. Tooltip-Aufbereitung (Tower-Karten, Gegnergruppen) liegt als reine Funktionen in `sidebar-tooltips.ts`.

Sell ist der gefährliche Knopf des Fundaments (`ui.btn-danger`, 26px hoch, Wert in Mono). Verkaufen braucht zwei Klicks, ohne Dialog: der erste füllt den Sell-Button ganz rot (`--td-danger-edge`, Text `--td-text-primary`) und ersetzt den Namen im Header durch "Click again to sell", der zweite innerhalb von 2,5 s verkauft. Danach oder bei einem anderen Tower fällt der Button in den Normalzustand zurück. Der Zustand liegt im `SellConfirmService` (`services/sell-confirm.service.ts`), den Tower- und Research-Panel teilen.

### Next-Wave-Button (Sidebar)

Primärer Call-to-Action (`.td-wave-btn` in `game-sidebar/wave-panel/wave-panel.component.scss`) und zugleich Kopf des WAVE-Panels: eine Kopfzeile "WAVE N" gibt es nicht, der Knopf nennt die Welle. Links Icon `play` 16px und "Wave N" (Versalien), N ist die kommende Welle; rechts die Tastenkappe "Space" (`.td-wave-key`, 10px/600 Mono, Tinte `rgba(26,20,10,0.75)` auf `rgba(26,20,10,0.08)`, Rand `rgba(26,20,10,0.35)`, `aria-hidden`, die Taste steht in `aria-keyshortcuts`). Der Name für Screenreader sagt die Aktion ("Start wave N"). Der primäre Knopf des Fundaments (`ui.btn-primary`): Messingverlauf `--td-gold-light` → `--td-gold`, Text `--td-ink`, harte Unterkante `--td-brass-lip`, Oswald 16px/600 Versalien, keine Ecken. Höhe 44px, Inhalt an beiden Enden (`space-between`) mit 10px Abstand. Das Panel beginnt 12px unter der Oberkante, so weit wie die Köpfe der anderen Panels. Die frühere Kopfzeile trug bei gemischten Wellen "MIX · N"; die Gruppenliste zeigt die Gruppen ohnehin einzeln.

Typografie und Höhe bleiben in jedem Zustand gleich, nur Fläche, Farbe und Inhalt wechseln:

| Zustand | Auslöser | Darstellung |
|---------|----------|-------------|
| Bereit | keine Welle, auch im Build-Mode | Messing, Hover heller, gedrückt 1px tiefer, Fokusring 2px `--td-focus-color` |
| Gesperrt | Game Over | `--td-frame-dark`, `--td-text-disabled`, weiter "Wave N", ohne Tastenkappe |
| Countdown | Auto-Start an, Welle vorbei | wie Bereit, rechts "{n}s" statt der Tastenkappe (11px, 75 % Deckkraft, keine Versalien), unten ein 2px-Balken in `rgba(26,20,10,0.45)`, so breit wie der Rest der Wartezeit; ein Klick startet sofort |
| Welle läuft | `waveActive()` | `.td-wave-running`: `--td-panel-shadow` mit den Kanten der vertieften Fläche; links Icon `wave` und "Wave N" in `--td-teal`, rechts "{n} left" (11px, `--td-text-muted`, keine Versalien), unten ein 2px-Balken in `--td-teal`, so breit wie der Anteil der Gegner, die weder getötet noch durchgekommen sind |

Direkt unter dem Button schaltet ein kleiner Schalter "auto 10s" (`.td-auto-toggle`, ein Knopf mit `aria-pressed`, 5px Abstand zum Button; rechts daneben zwischen den Wellen der Replay-Link, siehe [Replay der letzten Welle](#replay-der-letzten-welle)) den Auto-Start, Standard aus, gespeichert in `td-ui-state` (`UIStore.autoStartWaves`). Aus: vertiefte eckige Spur 18 × 10px auf `--td-panel-shadow` mit Rand `--td-frame-dark`, eckiger Knopf 6px in `--td-text-disabled`, Text 10px Mono in `--td-text-muted`. An: Spur `rgba(31,135,114,0.35)` mit Rand `--td-teal-dark`, der Knopf gleitet nach rechts und wird `--td-teal-light`, Text `--td-text-secondary`. Tooltip und Name nennen die 10 s. Teal war schon der Akzent der Checkbox, die der Schalter ersetzt. Der Countdown läuft in Spielzeit: bei 4x ist die Pause kürzer, pausiert steht er. Er beginnt nach `wave:completed` (wird er mitten in der Bauphase eingeschaltet, sofort), jeder Wellenstart, Game Over und ein Neustart beenden ihn, mit aktivem Bot bleibt er aus. Zahl und Balken liefert `waveButtonView()` aus `GameStore.autoWaveSecondsLeft`, das `GameLoopFacadeService` nur bei Änderung schreibt.

Ein Start aus dem Build-Mode lässt den Build-Mode an: Vorschau und gewählter Tower bleiben, gebaut werden darf auch während der Welle.

### Wellenwarnung (WAVE-Panel)

Bringt die nächste oder übernächste Welle Lufteinheiten oder ätherische Gegner mit (so weit die Quelle sie vorab kennt), steht in der Bauphase über dem Next-Wave-Button je Art eine Zeile (`.td-wave-alert`, Logik in `wave-panel/wave-alert.ts`, dieselbe Regel für beide Arten). Luft: Fläche `--td-health-bg`, 1px Rand in `--td-health-red` bei 55 % Deckkraft, links das Icon `plane` in `--td-health-red`. Daneben "Air · Wave N" (11px/700, Versalien, `--td-text-primary`) mit "· next wave" bzw. "· in 2 waves" in `--td-text-muted`, darunter die Abwehr (10px): "N towers hit air" in `--td-text-secondary` oder "No tower hits air yet" in `--td-warn-orange`. Gezählt werden gebaute Tower, die laut `canTargetAirEffective` Luft treffen (der Archer tut das von Anfang an, der Dual Gatling nach AA-Forschung). Der Tooltip nennt alle Tower, die Luft treffen.

Ätherisch (`.td-wave-alert-ethereal`): dieselbe Zeile, Rand violett (`rgba(168,85,247,0.5)`), Icon `ghost` in `#b58cf5`, "Ethereal · Wave N", darunter "N towers hurt ethereal" oder "No tower hurts ethereal yet". Gezählt werden Tower, die laut `isAntiEtherealTower` durchkommen (Magic, Ice, Lightning, Chaos); der Tooltip nennt sie.

Beim ersten Erscheinen für eine Welle spielt je Art ein kurzer Ton (Luft zwei fallende Noten, `UI_SOUNDS.airAlert`; ätherisch drei tiefe, absteigende, `UI_SOUNDS.etherealAlert`, beide in `audio.config.ts`), im Code synthetisiert (`utils/alert-tone.ts`) und über `playGlobal` abgespielt, also mit der SFX-Lautstärke und stumm bei SFX-Mute. Zeigt der Alert in der nächsten Bauphase noch auf dieselbe Welle, bleibt es still.

Beschriftung, Restzahl und Balkenbreite liefert `waveButtonView()` (`wave-panel/wave-button.ts`) aus zwei Store-Werten: `waveEnemyTotal` (von `wave:started` angekündigte Größe) und `waveEnemiesLeft` (lebende plus noch nicht gespawnte Gegner). Beide pflegt `GameStateSyncService` aus `wave:started`, `enemy:died`, `enemy:reached-base` und `debug:kill-all`. Manuelle Debug-Wellen kündigen keine Größe an, dann fehlen Zahl und Balken.

### NEXT (WAVE-Panel)

Unter dem Auto-Start-Schalter die nächsten fünf Wellen als Zeitleiste (`wave-panel/wave-timeline.component.*`, Daten aus `wave-panel/upcoming-waves.ts`, `NEXT_WAVE_MARKS`), darüber das Label "NEXT" (9px Mono, `letter-spacing: 0.18em`, `--td-text-muted`). Eine 1px-Linie in `--td-frame-mid` läuft durch die Marken: je Welle eine 7px-Raute (Fläche `--td-bg-dark`, Rand `--td-frame-light`), darunter die Nummer (9px Mono, `--td-text-muted`), darüber kleine Icons (10px, 2px Abstand; stehen drei auf einer Marke, 8px, damit sie in die 28px der Marke passen, `markIconSize`), `skull` in `--td-gold` für Boss-Wellen, `plane` in `--td-text-muted` für Lufteinheiten, `moon` in `--td-health-red` für Blutmond-Wellen (ab W14 jede siebte, siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#blutmond-wellen); nicht, solange "Blood Moon" in Settings aus ist). Der Name der Marke endet dann auf "blood moon", der Tooltip der Detailzeile beschreibt den Look. Ihren Mutator nennt die Marke im Namen auch mit ausgeschaltetem Look. Die erste Marke ist die Welle, die der Button als Nächstes startet (Rand `--td-gold-dark`, Nummer `--td-text-secondary`); während einer Welle ist das die folgende.

Unter der Linie steht ein Detailkasten für eine Marke (`shownPeek`): die unter dem Mauszeiger oder mit dem Tastaturfokus, sonst die zuletzt geklickte, solange sie noch kommt, sonst die erste. Diese Marke ist gefüllt (`--td-gold`, Rand `--td-gold-light`, Nummer fett in `--td-gold-light`, `aria-pressed`). Der Kasten ist eine Slot-Fläche (`--td-panel-secondary`, 1px `--td-frame-dark`, Kanten des erhöhten Panels) mit zwei Zeilen. Oben der Name (Inter Tight 12px/600, `--td-text-primary`, Boss-Wellen `--td-gold-light` fett, kürzt mit Ellipse), rechts bei einem Mutator ein Tag mit seinem Namen (9px, Großbuchstaben, 1px-Rahmen und Text in `--td-health-red`, `td-next-mut`). Unten in 10px Mono, `--td-text-muted`: "N enemies" (die Zahl fett in `--td-text-secondary`), bei Lufteinheiten `plane` in `--td-health-red` mit "Air", die Rüstung als `shield` mit Namen (bei mehreren die erste und "+N"), rechtsbündig "WEAK" (9px, Versalien) und die Schwächen als Icons der Schadensarten in `--td-gold` (`DAMAGE_TYPE_ICON` in `components/icon/damage-type-icon.ts`, ein eigenes Icon je Art; Name für Screenreader "Weak to …").

Der Tooltip des Kastens ist eine Rich-Tooltip-Karte (`tdRichTooltip`, Aufbau in `upcoming-waves.ts`): Kopf mit Name und "WAVE N" (Boss-Wellen in Gold), Stats "ENEMIES" und "HQ MAX" (was die ganze Welle samt Split-Kindern kostet), je Mutator und für den Blutmond-Look ein Banner mit rotem Streifen (`banners`), dann die Liste "Enemies" (je Typ ein Punkt in der Rüstungsfarbe, "6× Mammoth", Rüstung und "air" gedämpft, rechts die HQ-Kosten je Gegner, darunter klein, was er außer Laufen kann: Split, Regen, Phasing), dann "Weak to" mit einer Zeile je Rüstung der Welle und ihren Kontern als Icon mit Namen in der Farbe der Schadensart, zuletzt kursiv die Beschreibung der Quelle. Banner und Listen (`TdTooltipBanner`, `TdTooltipSection` in `tooltip-data.types.ts`) kann jede Rich-Tooltip-Karte nutzen. Emojis gibt es im Panel nicht: auch die Gegnergruppen der laufenden Welle zeigen die Rüstung als `shield` in `--td-text-muted` vor dem Namen. `ARMOR_TYPE_UI` führt deshalb kein Emoji mehr.

- Anzahl: vom Minimum des Templates bis zum Höchstwert, den der Director bei der aktuellen Tower-DPS schicken kann (`dpsScaledCountMax` in `templates.ts`, dieselbe Funktion, die `WaveDirector` nutzt; ab 500 DPS die volle Spanne). Das Überlebbarkeits-Deckel kann darunter bleiben, nie darüber; der Tooltip sagt beides. Die DPS (`calculateTotalDPS`, dieselbe Zahl, die der Director liest) wird neu gerechnet, wenn Tower gebaut oder verkauft werden, der gewählte Tower ein Upgrade bekommt oder eine Forschung fertig wird.
- Weak to: die Schadensarten mit dem besten Multiplikator gegen die HP der Welle, nach Rüstung gewichtet (Template-Anteil × Basis-HP, `bestDamageTypesAgainst` in `damage-matrix.config.ts`): alle ab `strong` (1,2), höchstens drei; erreicht keine 1,2, die besten über 1,0, höchstens zwei. Bei einer Rüstung ergibt das dieselbe Liste wie der frühere handgepflegte `weakTo`-Text in `ARMOR_TYPE_UI`, der entfernt ist; die Gegnergruppen der laufenden Welle lesen jetzt ebenfalls aus der Matrix. Bei mehreren Rüstungen nennt der Tooltip die Konter je Rüstung.
- Nach W30 wählt der Director das Template beim Wellenstart. Die Detailzeile zeigt dort "Director's pick" oder auf Boss-Wellen (ab W31 jede fünfte) "Boss wave", dazu "Template picked at wave start" (`--td-text-muted`, kursiv). Die nächste Boss-Welle steht als Totenkopf auf der Leiste: fünf Marken hintereinander enthalten nach W30 immer eine Boss-Welle; ihre Nummer nennt auch der Tooltip.

### Helden-Panel (Sidebar)

`hero-panel/` steht, solange der Held gewählt ist, an der Stelle des Tower-Details. Keine Kacheln:

- Kopf wie das Tower-Detail: Name in `--td-text-primary`, rechts "LV N" in `--td-gold-light` mit "/5" in `--td-text-muted`
- "Next level" mit "12 / 70 kills" (oben "Top level"), darunter ein 4px-Balken als vertiefte Fläche mit Füllung in `--td-gold`
- Kills, DPS (geladene Munition mit Stufe, vor der Matrix) und Range in einer Zeile mit Haarlinien (`--td-frame-dark`), Labels 9px Versalien in `--td-text-muted`
- "Ammo" mit Tastenkappe V, darunter drei Segmente (Standard, Explosive, Rune): Name 11px/700 Versalien mit 6px-Punkt in der Farbe der Schadensart (`DAMAGE_TYPE_UI`), darunter die Schadensart 9px; aktiv im Teal-Verlauf mit `--td-teal-glow`, `role="radio"`; der Tooltip nennt, wogegen die Munition von seinen drei am besten ist (aus `DAMAGE_MATRIX`)
- Hinweis in `--td-font-body` 11px: Zustand ("Holding his post" / "On his way"), wie man ihn schickt, Tastenkappen G und Esc

Die Werte liefert `heroPanelView()` (`hero-panel/hero-panel.ts`).

Solange der Held gewählt ist, zeigt die Kontext-Hinweis-Box "Click Send", "V Ammo", "G Camera", "ESC Let go" und die Warnung "No route within 30 m", solange unter dem Cursor keine Route in Reichweite ist. Auf der Karte: goldener Ring unter ihm, kleinerer auf seinem Posten, Bewegungsring unter dem Cursor gold (`--td-gold`) auf dem Routenpunkt, rot (`--td-health-red`) ohne.

### Forschungsbaum (Dialog)

`components/research-dialog/` über `openResearchDialog`, Vollbild (`100vw` x `100vh`,
`panelClass: ['td-dialog-panel', 'td-research-panel']`). Erreichbar an drei Stellen, sobald ein
Research Center steht: Knopf im Panel des Centers, Knopf "Research tree" fest unter dem Turmraster des
BUILD-Panels (scrollt nicht mit, zeigt die Anzahl in der Warteschlange), Taste `Q`. Erforschte Knoten sind grün
(`--td-green`), laufende teal, offene gold.

Aufbau von oben nach unten: Kopfleiste mit "Researched n/21" und einem Segment je Forschung, Slots,
Credits und Close; die Rubrik-Leiste (bisher nur "Tower Tech"); darunter das Brett mit der
Tier-Spalte links, dem Graphen in der Mitte und Warteschlange plus Detail rechts; unten Legende und
die Zählung je Strang.

Der Graph ist `components/tech-tree/`, eine darstellende Komponente ohne Fachwissen: Knoten und
Kanten rein, Klick und Hover raus. Die Geometrie rechnet `utils/dag-layout.ts` aus den
Vorbedingungen (Ebene = längster Weg von einer Wurzel), es stehen keine Koordinaten in der Config.
Der Heldenbaum (TODO G2) soll dieselben zwei Schichten benutzen. Alle Farben des Baums sind Tokens (`--td-node*` je Zustand, `--td-branch-biology`/`-engineering` als Strangfarbe, Arkan ist Teal, `--td-tree-line`, `--td-tree-well`); die Kontrast-Spec prüft Titel und Fuß auf ihren Knoten.

| Zustand eines Knotens | Aussehen |
|---|---|
| `completed` | `--td-node-done`, Rahmen `--td-node-done-edge`, grüne Kante links (`--td-green-dark`), Fuß "RESEARCHED" in Versalien |
| `active` | Rahmen `--td-teal`, Restzeit und Balken im Fuß |
| `queued` | gestrichelt in `--td-gold-dark`, Position als Gold-Kappe in der Ecke |
| `available` | Gold-Kante links (`inset 3px 0 0 var(--td-rune-amber)`), Hover hebt den Knoten um 1 px |
| `poor` | dieselbe Form, wärmer: Rahmen `--td-node-poor-edge`, Kante und Plattenrahmen `--td-node-poor-mark`, Kosten in Warnorange; offen, aber die Credits fehlen |
| `pending` | wie `locked`, aber jede fehlende Vorbedingung läuft oder wartet schon |
| `locked` | versenkt: `--td-node-locked`, Rahmen `--td-node-locked-edge`, Titel `--td-node-locked-title` |

Kanten lesen sich aus dem Paar, das sie verbinden: `done` (Teal, Ziel erforscht), `active` (Teal,
laufend, wandernde Strichelung), `open` (`--td-rune-amber`, Quelle erforscht), `pending`
(gestrichelt Teal, Quelle läuft oder wartet), `locked` (grau gestrichelt). Am Ziel sitzt eine kleine
Raute. Zeigt der Zeiger auf einen Knoten, leuchtet die Kette bis zur Wurzel in Gold und alles andere
blendet auf 30 % ab.

Das Brett scrollt in beide Richtungen und lässt sich ziehen (`tech-tree/drag-scroll.directive.ts`).
Der Zeiger wird erst gefangen, wenn der Zug ein paar Pixel überschreitet: ein Fang beim Drücken
leitet den folgenden Klick auf den Rahmen um und macht jeden Knoten unklickbar.

Kopfleiste, Rubrik-Leiste, Warteschlange, Detail und Fuß sind Platten mit kleiner Schräge (`plate(--td-cut-sm)`), die Kopfleiste eine Titelplatte mit Messingkante; Close und die Aktionen im Detail sind Knöpfe des Fundaments. Weil die cdk-Schale durchsichtig ist, malt `.td-rd` den dunklen Grund selbst.

Zwei Eigenheiten von MatDialog, die der Dialog ausräumen muss: `mat-dialog-content` bringt eine
eigene Scrollfläche mit (`max-height: 65vh`), und der Surface scrollt ebenfalls. Beides steht in
`styles.scss` unter `.td-research-panel`, weil der Surface über der Komponente liegt.

### Header (mit Stein-Textur)

```css
.header {
  padding: 6px var(--td-sidebar-gutter) 6px 12px;
  background:
    linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
    url('./src/styles/textures/stone-wall.jpg') repeat;
  background-size: auto, 64px 64px;
  border-bottom: 3px solid var(--td-panel-shadow);
  border-top: 1px solid var(--td-gold-dark);
}
```

Die Textur liegt unter `src/styles/textures/stone-wall.jpg` und wird 64px gekachelt; die Landing Page hat eine eigene Kopie (`landing/media/stone-wall-128.jpg`). Die obere Kante ist Messing (`--td-gold-dark`) wie der Wave-Button, die untere die dunkle Schattenkante. Einen Titeltext gibt es nicht, links steht das Logo. Alles, was auf der Textur Text trägt (Stat-Platten, Gegner-Chip, Standort-Button), hat eine eigene dunkle Fläche.

### Header-Stat-Platten

HQ, Credits und Wave stehen als drei Platten (`.header-stats` in `game-header`, Vorlage `tmp/ui-design/Hud.dc.html`) rechts im Header. Ihre rechte Kante schließt bündig mit dem Sidebar-Inhalt darunter ab (rechtes Header-Padding = `--td-sidebar-gutter`); die Platten brauchen mehr Platz, als die Sidebar breit ist, deshalb reicht die Leiste mit `--td-hud-stats-width` (400px) nach links über die Canvas. Drei gleich breite Spalten (`minmax(0, 1fr)`) mit 4px Fuge, damit wachsende Werte die Nachbarn nicht verschieben. Platten 42px hoch, der Header 54px (6px Padding oben und unten).

Jede Platte ist `ui.stat-plate` (Stahlkante `--td-line-steel`, Steinfläche `--td-plate`, Ecken `--td-cut-sm` abgeschrägt). Alle drei haben denselben Aufbau: links ein gefülltes Icon 20px (`hqSolid`, `coinSolid`, `waveSolid`), daneben eine linksbündige Spalte mit dem Label (`ui.caps-label`, 10px Mono) über der Zahl in Oswald (`--td-fs-hud`, 22px auf 21px Zeile, 600, `tabular-nums`) über einem 4px-Balken (`.stat-bar`: HQ die Segmente, Wave der Fortschritt, Credits eine leere Zeile, damit alle drei gleich stehen). Label, Zahl und Balken liegen damit auf allen Platten auf derselben Höhe. Die Labels benennen die Werte, die Icons sind Deko.

| Platte | Zustände |
|--------|----------|
| HQ | Zahl und zehn Segmente in `--td-hp-text` (#E36A5A, 5,9:1); ein Segment je angefangenem Zehntel der Startgesundheit. Unter 30 % (`hqLevel` `low`) Kante `--td-health-red`, Fläche `--td-hp-plate`, Zahl `--td-hp-low`, langsames Pulsieren (2,4 s). Unter 10 % (`critical`) dazu der Warnstreifen `--td-hazard` 4px am Fuß. Verliert das HQ Gesundheit, blitzt die Platte 450 ms auf und ruckt 2px (höchstens alle 300 ms); ein Reset oder der +HP-Cheat heben sie ohne Blitz |
| Credits | Zahl in `--td-gold-light`, Münze in `--td-gold`. Eine neue Summe zählt über 250 ms hoch. Jede Änderung steigt als "+25" (`--td-gain`) oder "−150" (`--td-loss`) 900 ms lang unter der Platte rechtsbündig zur Unterkante auf, auf einem dunklen Schild über der Karte (`.credits-delta` neben der Platte in `.credits-cell`, weil der Schnitt der Platte es abschneiden würde); so verdeckt es weder Label noch Zahl, auch nicht bei "+10,000" und fünfstelligen Credits; Änderungen innerhalb von 250 ms addieren sich (`CreditsDeltaTracker`). Wird ein Kauf mangels Credits abgelehnt (`refuseForCredits()` in `services/credits-refusal.ts`: Bau-Taste, Upgrade, Pfad, Held), blitzt die Kante 600 ms rot |
| Wave | Zahl in `--td-text-primary`, Icon in `--td-teal`. Der Balken zeigt den Anteil der laufenden Welle, der weg ist (getötet oder durch), aus `waveEnemyTotal` und `waveEnemiesLeft`; zwischen den Wellen leer. Startet eine Welle, wird die Kante 600 ms Messing (`--td-gold`) |

Reduced motion: Farben und Streifen bleiben, nichts bewegt sich (kein Puls, kein Ruck, die Credit-Änderung steht still und blendet aus, die Zahl springt).

Jede Zahl muss in ihre Platte passen, auch nach Cheats (`header-stats.ts`): unter einer Schwelle je Platte exakt, darüber kurz über `formatCompact` ("101k", "1.2M"). Credits bleiben bis 999.999 exakt, Wave und Gegner-Chip bis 99.999, die HQ-Gesundheit bis 9999 (mehr gibt es nur per Cheat). Die kurze Zahl ist `aria-hidden`, Screenreader lesen die exakte aus einem `.sr-only`-Span; zeigt die Platte weniger als den exakten Wert, steht er auch im Tooltip ("101,100 / 500"). Hinter der HQ-Zahl steht das Maximum (`/500`, 11px Mono, `--td-text-muted`); passt es nicht mehr, bricht es in eine verdeckte zweite Zeile um und fällt ganz weg, bevor die Zahl gekürzt wird. Balken, Segmente, Streifen und die aufsteigende Änderung sind `aria-hidden`.

Der Gegner-Chip (`.enemies-chip`) erscheint nur während einer Welle links neben den Platten, als eigene kleine Platte mit Zahl in Oswald 18px und `--td-warn-text`.

### Header-Knöpfe

Der Standort-Button ist ein Rechteck (keine abgeschrägte Platte, die würde den Fokusring abschneiden) mit Stahlrand und `--td-plate`: Label "DEFEND" als `ui.caps-label`, der Name in Oswald 16px `--td-gold-light`; Hover färbt den Rand gold. Die Aktionsknöpfe (Link, Favoriten, Würfel, HQ, Spawn, Coop) sind 34px groß und durchsichtig, Hover und aktiv mit Messingrand. Alle tragen `ui.focus-ring` (2px `--td-focus-color`, Abstand 2px), die Zeilen in Favoriten- und Spawn-Menü einen nach innen versetzten.

### Favoriten-Menü (Header)

Der Lesezeichen-Knopf klappt unter sich ein Panel auf (`.fav-dropdown`, 300px breit, Rezept "Panel (erhöht)" mit `--td-shadow-soft`). Oben "Save location" (Icon `plus`), darunter die Favoriten als Liste (`.fav-list`), die ab `min(60vh, 440px)` scrollt (Scrollbar-Mixins); eine Obergrenze gibt es nicht. Ohne Favoriten "No favorites".

- Zeile: links Name (11px, eine Zeile, Ellipse) über den Koordinaten (9px, 60 % Deckkraft), ein Klick lädt den Ort. Rechts vier Werkzeugknöpfe (`.fav-tool`, Icons 14px, `--td-text-secondary` bei 50 % Deckkraft, Hover voll in `--td-gold`, Löschen im Hover `--td-health-red`): `caretU` hoch, `caret` runter (am Anfang bzw. Ende gesperrt, 20 %), `edit` umbenennen, `cross` löschen. Jeder trägt Tooltip und einen `aria-label` mit dem Namen des Favoriten
- Namensfeld (`.fav-edit`): ersetzt beim Speichern den Knopf "Save location", beim Umbenennen die Zeile. Input im Rezept der vertieften Fläche auf `--td-panel-shadow`, `--td-font-mono` 11px, Fokus-Outline `--td-gold-dark`; daneben Haken (speichern) und Kreuz (abbrechen). Das Feld nimmt beim Öffnen den Fokus, der Vorschlag ist markiert; Enter speichert, Esc bricht ab. Tasten im Feld erreichen das Spiel nicht (`ownsKey`)
- Klick außerhalb schließt das Menü und verwirft ein offenes Namensfeld. Ablauf und Speicher: [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#favorites-system)

### Leak-Vignette (Canvas)

Erreicht ein Gegner das HQ (`enemy:reached-base`), blendet `app-leak-vignette` (`components/leak-vignette/`) einen roten Rand über dem Canvas ein und wieder aus: radialer Verlauf von transparent (58 %) zu `rgba(184,62,50,0.42)` an den Rändern, 650 ms, `pointer-events: none`, `z-index` 4 unter den HUD-Elementen. Ein neuer Puls startet höchstens alle 900 ms (`PulseThrottle`, Wanduhr); ein Schwarm, der auf einmal durchbricht, pulsiert also etwa im Sekundentakt, statt dauerhaft zu glühen. Der Handler läuft im Game-Loop außerhalb von Angular und macht pro Leak nur einen Zeitvergleich. Er reagiert auch, wenn das HQ schon bei 0 steht und nichts mehr zu verlieren ist.

### Blutmond-Banner (Canvas)

Startet eine Blutmond-Welle ([WAVE_SYSTEM.md](WAVE_SYSTEM.md#blutmond-wellen)), steht `app-blood-moon-banner` (`components/blood-moon-banner/`) 3,6 s über dem Canvas: mittig, 18 % unter der Oberkante und damit unter der Spalte mit Game Speed und Boss-Leiste. Glas-Leiste (`ui.glass-strip`, eckig) mit Rand `rgba(184,62,50,0.55)` wie der Air-Alert, links `moon` (18px) in `--td-health-red`, daneben "BLOOD MOON" (Oswald 14px/600, Versalien, `letter-spacing: 0.2em`, `--td-text-primary`) über "Wave N", mit Mutator "Wave N · Swift" (10px Mono, `--td-text-muted`). Einblenden in gut 0,4 s, Ausblenden in 1 s (Web Animation, Wanduhr), `pointer-events: none`, `z-index` 5. Der Chip ist `aria-hidden`, Screenreader hören "Blood moon, wave N." und den Satz des Mutators über den `LiveAnnouncer`. Ist "Blood Moon" in Settings aus, kommt das Banner nur für einen Mutator. Im Photo Mode verschwindet es mit dem HUD, der Look der Szene bleibt. Ein Boss-Intro (W35 ist Blutmond und Welle des Wurms) hält es vom Schirm (`BloodMoonBannerTiming` in `blood-moon-banner.ts`): Ist das Banner fällig, während ein Intro läuft, wartet es bis zu dessen Ende; startet ein Intro, während es steht, verschwindet es und läuft nach dem Intro noch einmal ganz, sofern es noch nicht ausblendete. Ein Neustart verwirft ein wartendes Banner.

### Umzugs-Hinweis (Canvas)

Solange das HQ umzieht, steht `app-relocation-status` (`components/relocation-status/`) an der Stelle des Blutmond-Banners (mittig, 18 % unter der Oberkante; die beiden treffen sich nicht, der Umzug setzt das Spiel zurück). Glas-Leiste (`ui.glass-strip`, eckig, mindestens 220px breit), links `pin` (18px, das Icon von "Move HQ") in `--td-gold`, daneben "MOVING HQ" (Oswald 14px/600, Versalien, `letter-spacing: 0.12em`, `--td-text-primary`) über dem Schritt (10px Mono, `--td-text-muted`): "Finding the route", "Loading streets" oder "Measuring the corridor" mit der Prozentzahl in `--td-text-secondary`. Während der Messung an der Unterkante ein 2px-Balken in `--td-gold` auf `rgba(194,160,85,0.18)`, so breit wie der gemessene Anteil. `pointer-events: none`, `z-index` 5. Der Host ist `role="status"`: Screenreader hören den Schritt, die Prozentzahl ist `aria-hidden`. Ablauf in [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#rückmeldung-hinweis-über-der-karte).

### Fähigkeitenleiste (Canvas)

`app-ability-bar` (`components/ability-bar/`) steht am linken Rand des Spielfelds, oben direkt unter dem Info-Overlay (User, 2026-09-25): eine Glas-Leiste (`ui.glass-strip`, eckig, Innenabstand und `gap` 5px), `left` 12px wie das Info-Overlay, zusammen 56px breit. Oben der Knopf des Helden, sobald es einen gibt, darunter eine Haarlinie in `--td-frame-dark`, dann ein Knopf je Fähigkeit, deren Forschung fertig ist und deren Abschussort steht (Nuclear Strike: Missile Silo), in der Reihenfolge von `ABILITIES` (Aufbau und Held-Schnittstelle in [ABILITIES.md](ABILITIES.md#fähigkeitenleiste)). Vor der Forschung hat eine Fähigkeit keinen Knopf, der Nuclear Strike auch nicht ohne Silo. Die Linie steht nur zwischen Held und Fähigkeiten; ohne Held und ohne erforschte Fähigkeit fehlt die Leiste. `z-index` 6: über der Leck-Vignette (4) und den Off-Screen-Pfeilen (5), unter dem Game-Over-Overlay (20). Im Photo Mode verschwindet sie mit dem übrigen HUD, beim Laden und bei Fehlern fehlt sie.

Platz: Der Host spannt die Höhe des Canvas-Bereichs. Oben steht das Panel `ABILITY_BAR_PX.clear` (8px) unter der Unterkante des Info-Overlays, die das Overlay aufgeklappt und zugeklappt selbst misst (Eingang `topInset` aus `UIStore.infoOverlayBottom`); darunter bleibt der Rest frei, mindestens bis 8px über der Logo-Zeile (`--td-logo-bottom` plus `--td-logo-height` am Canvas-Bereich, dieselben Variablen, mit denen die Logos stehen). Ist das Spielfeld zu niedrig für die ganze Leiste, schrumpft das Panel und scrollt (Mausrad, Tastaturfokus) ohne sichtbare Scrollbar, die die Leiste über `ABILITY_BAR_EDGE_PX` hinaus verbreitern würde. Das Panel ist dafür immer ein Scroll-Container: der Gold-Glow eines Knopfs endet an seinem Innenrand.

Knopf: Quadrat 44 × 44px, Fläche und Kanten wie die laufende Welle (`--td-panel-shadow`, vertiefte Kanten, Ecken 3px), Icon aus der Config (20px, Held 22px). Oben rechts die Taste (8px Mono, `--td-text-muted`), unten ein 2px-Strich je Welle bis zur nächsten Ladung: `--td-gold`, sobald die Welle geschafft ist, sonst `--td-frame-mid`; solange die Ladung steht, sind alle hell. Hält eine Fähigkeit mehr als eine Ladung, steht die Zahl oben links (8px, `--td-gold-light`); der Nuklearschlag hält eine.

| Zustand | Auslöser | Darstellung |
|---------|----------|-------------|
| Bereit | geladen, Welle läuft | Rand `--td-gold-dark`, Icon `--td-gold-light`, Hover 1px-Rand `--td-gold` |
| Zielt | Zielmodus an | Gold-Verlauf wie der Next-Wave-Button, Icon, Taste und Striche `#1A140A`, 1px-Rand `--td-gold`, `aria-pressed` |
| Wartet | geladen, keine Welle | Icon `--td-text-muted` |
| Unterwegs | Schlag zwischen Befehl und Einschlag | Icon `--td-warn-orange` |
| Lädt | Ladung verbraucht | Icon `--td-text-disabled`, die Striche zählen die geschafften Wellen |

Der Held-Knopf ist ein Schalter: Icon `--td-text-secondary`, Hover `--td-text-primary`, ausgewählt im Aktiv-Rezept der Dev-Kacheln (Fläche `rgba(194,160,85,0.16)`, Rand `--td-gold-dark`, Icon `--td-gold-light`, `aria-pressed`). Er erscheint mit der fertigen Forschung `mercenary-contract`: bis zum Anheuern als Münze (`coin`) ohne Taste, der Tooltip nennt Preis und fehlende Credits; danach der Held (`user`) mit G, Tooltip mit Stufe und Munition. Inhalt aus `heroBarView()` (`ability-bar/hero-bar.ts`).

Ohne Wirkung bleibt ein Knopf klickbar und trägt `aria-disabled`, sonst erschiene sein Tooltip nicht; ein Druck darauf schaltet nichts scharf, die Kontext-Hinweis-Box nennt den Grund ([Ablehnung](#context-hint-box)). Der Tooltip (`tdRichTooltip`, rechts daneben) trägt im Kopf Name, Zustand in Versalien ("RECHARGES IN 2 WAVES") und die Tastenkappe, darunter CHARGES und RECHARGE, dann die Beschreibung. Welche Knöpfe es gibt, Zustand, Striche und Texte liefern `abilityBarIds()`, `abilityButtonView()` und `abilityTooltip()` (`ability-bar/ability-button.ts`) aus `GameStore.abilities`.

Im Zielmodus zeigt die Kontext-Hinweis-Box "Click" mit dem `aimHint` der Fähigkeit (Nuklearschlag: "Strike") und "ESC Cancel", dazu die Warnung "No route within 30 m", solange keine Route-Zelle in Reichweite ist. Auf der Karte ist der Zielring gold (`--td-gold`), wo der Schlag landen würde, und rot (`--td-health-red`), wo er abgelehnt würde; der Marker während der Vorwarnung ist orange (`--td-warn-orange`) mit goldenem Countdown-Ring (`--td-gold-light`). Beim Orbitallaser zeigt ein Band so breit wie der Strahl den Weg, den er brennen würde: im Zielmodus in `--td-gold` (20 % Deckkraft), während der Vorwarnung in `--td-warn-orange` (22 %).

### Coop: Dock, Squad, Chat (Canvas)

Nach dem Design-Handover vom 2026-09-25 (`tmp/coop-design/test3.zip`, Plan [COOP_PLAN.md](COOP_PLAN.md) C8, D37 bis D46), überarbeitet nach [COOP_UI_REWORK_PLAN.md](archive/COOP_UI_REWORK_PLAN.md) (U1 bis U8). Ecken 0, Farben nur aus `td-theme.ts`, Lane-Farben aus `SPAWN_COLORS` wie auf der Karte, als CSS über `laneCss()` (`coop/lane-color.ts`; ohne Lane durchsichtig oder `--td-text-secondary`, nie Weiß). Knöpfe, Eingabe, Segment, Hinweis, Banner, Tastenkappe und Spinner kommen aus dem [Fundament](#fundament-stylesgame-uiscss); `components/coop-ui/_coop-ui.scss` leitet es weiter und hat nur, was der Coop allein braucht: `.btn` (Rahmen-Knopf), Tag, Pille, Chip, Listenzeile, Name mit Unterzeile und `panel-frame` (eine Platte mit Schräge, leicht durchsichtig). `@include ui.classes` gibt einer Komponente die Klassen des Fundaments plus `.btn`, `.tag`, `.pill`, `.chip`, `.row`. Dazu `app-ping-bars` (vier Balken, Grenzen 40/90/160 ms, Orange bei Lag) und `chatView()` (Name und Zeit nur über der ersten Zeile eines Schwalls).

Ein Knopf, der gerade nichts tut, trägt `aria-disabled` statt `disabled` und prüft im Handler selbst: sonst erschiene sein Tooltip mit dem Grund nie (die Button-Rezepte färben `[aria-disabled='true']` wie `:disabled`). Wo Platz ist, steht der Grund zusätzlich als Text in der Zeile (Raumliste: warum ein Raum nicht beitretbar ist, in `--td-warn-orange`).

Tasten: Tab (Dock), Enter (Chat) und X (Markierung) hört `app-coop-chat` auf dem Dokument. Tab und Enter gehören einem Knopf, den der Spieler per Tastatur erreicht hat; nach einem Mausklick behält der Knopf den Fokus, die Spieltasten gehen trotzdem. Ob der Fokus von der Tastatur kam, sagt `FocusOrigin` (`utils/keyboard-target.ts`: ein Fokus bis 600 ms nach `pointerdown` ist der Maus), nicht `:focus-visible`, das Chrome nach einem Klick beim ersten Tastendruck einschaltet. Im Dock wandert Tab immer durch die Knöpfe; Esc schließt es als letztes Glied der Esc-Kette des `HotkeyService`. Stapelung über die Layout-Tokens `--td-z-marks` (5, Ping-Pfeile), `--td-z-hud` (6, Fähigkeitenleiste, Squad) und `--td-z-dock` (7) aus `TD_LAYERS`.

| Teil | Ort | Inhalt |
|------|-----|--------|
| Raum-Chip | Kopf, nach den Werkzeugen | Code in Mono, ein Quadrat je Spieler in seiner Lane-Farbe, `n/4`; Klick oder Tab öffnet das Dock. Ohne Raum das Zwei-Personen-Icon |
| Dock `app-coop-dock` | rechts neben der Fähigkeitenleiste, oben auf ihrer Höhe, bis über die Logo-Zeile, 440px, im Raum 860px (Raum 480px, der Chat als zweite Spalte) | Nur mit Raum oder beim Beitritt (Hosten und Beitreten beginnen auf der Menüseite Coop); beim Beitritt `app-coop-join-steps` (Schrittliste mit Fortschritt der Karte); im Raum Code (28px Mono, Code und Einladung kopieren, Sperre), Listing, Statuszeile, eine Warnung (die schwerste, weitere hinter „+n“), `app-coop-room-table`, `app-coop-room-options`, `app-coop-lobby-chat`; Fuß (Leave, ⋯ Resend map, Start match oder Ready up). Was es zeigt, rechnen die reinen Funktionen in `coop-dock/coop-dock-view.ts`. Kein Dialog, kein Schleier, `role="region"` (`UIStore.coopDockOpen`; von selbst öffnet und schließt es nur der `CoopService`: beim Betreten eines Raums auf, beim Spielstart zu) |
| Menüseite Coop `app-coop-ways` | Seite „Coop“ des Hauptmenüs | Name und Lobby-Auswahl (mit Ping) oben, darunter drei Wege untereinander: Host online (Raum auf dem geladenen Ort, „Change place“ zu New game, Rückfrage, wenn das den Solo-Lauf beendet), Join online (Codefeld, öffentliche Räume als Tabelle Room, Place, Players, alle 5 s neu; eine Lobby ohne Antwort als Warnzeile mit Retry), Same network (nur App: gefundene Spiele, „Host on this network“, nach 4 s Stille IP-Feld und Checkliste; im Browser ein Hinweis auf die App). Im Browser der Website nur `app-coop-app-hint`. Lobby-Adressen kommen in Settings dazu. Beim Verbinden eine Zeile mit Cancel |
| Raumtabelle `app-coop-room-table` | im Dock | Eine Zeile je Lane (Rezept Listenzeile 48px): Farbbalken, Lane mit Länge und Balken, Spieler (Name, Host, You, was sein Client tut), Ready (Haken im Quadrat, nur in der Lobby), Ping, Werkzeuge (Hinfliegen; in der Lobby Lane zurückgeben, beim Host Versetzen, Entfernen, Rauswerfen). Freie Lanes „Free · take“ in `--td-gold`. Spieler ohne Lane danach mit gestricheltem Rand |
| Squad `app-coop-squad` | unten über der Logo-Zeile, rechts neben der Fähigkeitenleiste wie das Dock, 400px | Kopf SQUAD mit Code oder Problem (Versalien per CSS), CHEATS ON (Orange), Einklappen; Zeilen 36px, man selbst zuerst; Fuß: auf wen die Welle wartet oder was nicht stimmt |
| Chat `app-coop-chat` | unter der Squad-Box | ein Verlauf auf einem Scrim, ältere Zeilen gedimmt, Systemzeilen in Mono; Enter schreibt, X markiert die Karte, Tab öffnet das Dock (erst nach dem ersten Klick auf die Seite: davor bringt Tab den Fokus in die Seite); die Tastenzeile darunter nur bis zur ersten eigenen Nachricht |

Kopf des Docks als Titelplatte (Messingkante, `title(18px)`). Warntext in `--td-warn-text`, Fehler in `--td-danger-text`, keine eigenen Hex-Werte.

### Menüseiten

Der Inhalt der Seiten des Hauptmenüs (`components/main-menu/pages/`); Platte und Titelplatte stellt das Menü. Die
gemeinsamen Teile stehen in `pages/_menu-page.scss` (`page.classes`, darin `ui.classes`): Abschnitte `.mp-sec` mit
Mono-Label `.mp-label` (10px, Messing, Versalien) und Haarlinie zwischen den Abschnitten, Listen `.mp-list` mit Zeilen
`.mp-row` (Name links, Mono-Detail rechts, Messingbalken links bei Hover), Segmente `.mp-seg` für `role="radio"` und
`role="tab"` mit `tdRovingGroup`, Feldzeilen `.mp-field` (Name links, Bedienelement rechts), Warnzeile `.mp-banner`
(`is-error` rot), Textlinks `.mp-link`. Knöpfe, Eingaben und Notizen sind die des Fundaments (`btn-primary`,
`btn-secondary`, `btn-danger`, `btn-xs`, `inp`, `note`). Keine Kartenraster.

- New game (`app-place-picker`): Warnzeile bei laufendem Lauf; Abschnitt Search (Adresssuche, Links „Coordinates or
  link“, „Use my location“, „Roll a random city“, mit Ort „Move the spawn by address…“, nach einer Wahl die
  Spawn-Zeile und „Load place“); darunter Umschalter Recent / Favorites / Showcase / World und die Liste, World mit
  Globus links
- Save und Load (`app-save-slots`): Slots als Liste, Rückfragen (Overwrite, Load, Pick file, Delete) ersetzen die Liste
  auf der Seite, darunter die Statuszeile `.mp-status`; Load mit Datei-Download und Delete je Zeile und „Load from a
  file“
- Settings (`app-settings-sections`): Audio (vier Regler mit Wert und Stumm-Knopf), Graphics (Preset als Segmente, die
  Schalter in zwei Spalten, Color grading, Frame limit, Fullscreen), Gameplay (Tempo, Auto-Start), Map (Anbieter,
  „Change key“), Coop (Name, Lobby-Liste, „Add lobby“), Privacy (Run-Log-Upload)
- Extras (`app-extras-list`): Zeilen in drei Gruppen (Replays and runs, The game, About); Legal & privacy und GitHub als
  Links mit `target="_blank"`
- Coop (`app-coop-ways`): siehe Coop oben

### Off-Screen-Pfeile (Canvas)

Während einer Welle zeigt `app-offscreen-indicators` (`components/offscreen-indicators/`) am Rand des Canvas Pfeile zu Gegnern, die die Kamera nicht zeigt: Bosse (`isBoss`) überall auf der Route, vom Wurm nur der Kopf jedes Stücks (`isArrowBoss`), alle anderen erst auf den letzten 15 % ihres Wegs (`NEAR_HQ_PROGRESS`, `utils/offscreen-indicators.ts`). Die Richtungen fallen in acht Sektoren um die Bildmitte, je Sektor ein Pfeil mit Anzahl, höchstens sechs; Sektoren mit Boss zuerst, dann die volleren. Ein Klick auf einen Pfeil fährt die Kamera wie Home und N (`CameraControlService.focusGeo`) zu seinem Ziel: dem Boss im Sektor, der am weitesten auf seiner Route ist, sonst dem Gegner, der am weitesten ist; dorthin, wo er beim Klick steht, sie folgt ihm nicht.

Pfeil: Glas-Chip 22px (`--td-glass-tint`, `--td-shadow-soft`), 1px Rand und Chevron (`caretR`, 14px) in `--td-health-red`; mit Boss 26px, Rand `--td-gold`, Chevron `--td-gold-light`. Er sitzt 26px innerhalb des Rands, dort, wo der Strahl von der Bildmitte in seine Richtung den Rand trifft; am linken Rand 26px rechts der Außenkante der [Fähigkeitenleiste](#fähigkeitenleiste-canvas) (`ABILITY_BAR_EDGE_PX` 68px, zusammen 94px), auf der ganzen Höhe. Ab zwei Gegnern steht die Zahl (10px Mono, `--td-text-primary` mit Schatten) 20px zur Bildmitte hin. `z-index` 5; die Ebene hat `pointer-events: none`, nur die Pfeile nehmen Klicks (`<button>` mit `aria-label`, Hover vergrößert den Chip auf 115 %, Fokus: 1px `--td-gold-light`). Ein Klick auf einen Pfeil erreicht den Canvas nicht, baut also nichts und wählt nichts aus.

Die Komponente läuft auf einem eigenen 8-Hz-Timer außerhalb von Angular: ein Durchlauf über die lebenden Gegner sucht die Bedrohungen (keine Allokation pro Gegner), ein zweiter projiziert sie durch die Kamera, und das Signal ändert sich nur, wenn sich ein Pfeil ändert. Pausiert entfällt der Durchlauf, die zuletzt gefundenen Gegner werden neu projiziert, die Pfeile folgen also weiter der Kamera. Ohne Rendering (Headless-Modus) und außerhalb von Wellen bleibt die Ebene leer.

### Debug-Panels

Alle Debug-Fenster nutzen `app-draggable-debug-panel` (`components/debug-window/`) und verhalten sich gleich: verschiebbar, in der Größe änderbar über den Griff unten rechts, Position und Größe in `localStorage` gespeichert.

- Die Größe liegt pro `windowId` im `DebugWindowService`; das Panel liest und schreibt sie selbst. Ein neuer Debugger braucht dafür keine eigene Verdrahtung, nur einen Eintrag in `DEFAULT_POSITIONS` und `DEFAULT_SIZES`.
- Gemeinsame Mindestgröße `DEBUG_PANEL_MIN_SIZE` (300 x 200 px), gilt für CSS, Resize und geladene Werte. Größen sind Außenmaße (`box-sizing: border-box`).
- Default-Größe so wählen, dass der Inhalt ohne horizontales Scrollen passt (Inhalts-`min-width` + 16 px Padding + 8 px Scrollbar + 2 px Rahmen). Höherer Inhalt scrollt im Panel.
- Logs und Listen, die mitwachsen sollen, als Flex-Spalte mit `height: 100%` bauen und dem Log `flex: 1; min-height: 0` geben (Event-Bus, Sound).

### Context-Hint-Box

Wiederverwendbare Hinweis-Box für kontextabhängige Aktionen (z.B. Build-Modus):

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

Optional: `title` (mit `counter` rechts daneben), `message` darunter, `actions` als Textbuttons unten (Output `actionClicked` mit der Id), `live` setzt `role="status"`. Mit Actions nimmt die Box Klicks an (`pointer-events: auto`), sonst lässt sie sie durch. Steht unter der Warnung nichts mehr, fällt ihre Linie weg. Das Spiel zeigt immer nur eine Box: Ablehnung vor Build-Modus vor Platzierungsmodus vor Zielmodus einer Fähigkeit vor gewähltem Helden vor First-Run-Tipp.

**Ablehnung** (`RefusalHintService`): Tut ein Druck auf eine Fähigkeit oder den Helden nichts, steht 2,5 s (`UPGRADE_HINT_MS`, so lange wie die Zeile der U-Ablehnung) eine Box mit dem Namen als Titel und dem Grund als Warnung, ohne Tasten, mit `live`: "Nuclear Strike" über "ONLY DURING A WAVE", "NO CHARGES, RECHARGES IN 3 WAVES" oder "NO ROUTE WITHIN 30 M"; "Hire Mercenary" über "NEED 600 CREDITS" oder, ohne Route zum Stehen, "NO ROUTE TO STAND ON"; "Mercenary" über "NO WAY THERE ALONG THE ROUTES" (Befehl an den angeheuerten Helden). Quellen: die eigene Prüfung des Zielmodus, bevor er scharf schaltet (Taste und Knopf der Leiste), und `ability:rejected` und `hero:rejected` der Manager, nicht für Befehle des Bots. Gründe, auf die der Spieler nichts tun kann, zeigt sie nicht: `locked` (vor ihrer Forschung bleibt die Taste einer Fähigkeit still wie bisher), `hired`, `no-hero`, `unknown-ammo`, `unknown`. Startet danach ein Zeigermodus (Build, Platzierung, Zielmodus, Held gewählt), endet sie sofort; ein Neustart räumt sie weg. Rot wie jede Warnung der Box, nicht orange wie der aufsteigende Text der U-Ablehnung: der steht über seinem Tower, eine Fähigkeit vor dem Zielen und der Held vor dem Anheuern haben keinen solchen Ort.

### Hauptmenü

Ein Menü für alles, was nicht Spielen ist (`components/main-menu/`, Plan in
[MAIN_MENU_UI_PLAN.md](MAIN_MENU_UI_PLAN.md)), als Overlay über dem ganzen Fenster, Rolle `dialog` mit dem Namen der
Seite ("Menu", "Settings" ...), Fokusfalle; schließt es, geht der Fokus zurück. Zwei Lagen mit derselben Liste und
denselben Seiten:

- **Start** nach dem Token-Schritt, vor einem Lauf und bei jedem Ortswechsel: großes Logo links oben, Zeile "Tower
  defense on real streets", Liste darunter, links nach rechts auslaufender dunkler Verlauf über der Szene. Unten links
  ein Feldtipp (wechselt alle 8 s) und der Versions-Chip, unten rechts die Ladeplatte, solange der Ort lädt oder ein
  Laden scheiterte. Das HUD ist darunter ausgeblendet.
- **Pause** (Esc als letzter Schritt, Zahnrad im Sidebar-Fuß, "Main menu" am Game Over): kleines Logo, darunter
  "Paused · Heilbronn · wave 12" (im Coop "Coop · ..."), Szene gleichmäßig abgedunkelt, das HUD bleibt darunter.

Die Liste (`pages/home`) ist ein `role="menu"` aus Textknöpfen (`role="menuitem"`, Oswald in Versalien), ein Tab-Halt,
Pfeile wandern ohne zu wählen (`tdRovingGroup`); Hover und Fokus zeigen links den Messingbalken. Der erste Eintrag der
Start-Lage ist größer. Continue und Play tragen darunter in Mono, was sie spielen ("Heilbronn · wave 12"), und während
der Ort lädt einen dünnen Messingbalken; ein Klick dann merkt sich den Wunsch ("Starts when loaded"). Ein Autosave an
einem anderen Ort heißt "in Paris · wave 7" und fragt unter der Liste "Leaves Heilbronn: the save plays in Paris."
(Continue anyway, Cancel). Restart here und Quit fragen bei laufendem Lauf ebenso. Unter einer Linie stehen in der
Pause New game, Coop, Restart here, Quit; im Start nur Quit (Desktop-App).

Eine Seite öffnet als Platte rechts neben der Liste, mit Titelplatte und "Esc" als Zurück; Esc geht eine Seite
zurück, auf der Liste der Pause zurück ins Spiel, auf der Liste des Starts tut es nichts.

Ladeplatte (`loading/menu-loading`): Ortsname in Oswald, Prozent in Mono, zehn Segmente in Messing, der laufende Schritt
mit Detail und "4 of 10", "Show steps" klappt die Liste auf. Ein Fehler steht statt des Balkens mit orangem Strich und
Retry, Other place und (bei Engine-Fehler) Map key.

### Tastenkürzel

Zuordnung Taste → Aktion in `services/hotkey-map.ts` (`resolveHotkey`, reine Funktion), ausgeführt vom `HotkeyService`, den die Spielkomponente nach dem `InputHandlerService` aufruft. Der `InputHandlerService` behält Kamera (WASD/Pfeile), Build- und Platzierungsmodus (R, Esc) und die Debug-Tasten (T, Shift+P); was er behandelt, ist `defaultPrevented` und für die Hotkeys tabu. Hotkeys ruhen, während getippt wird, ein Dialog oder das Hauptmenü offen ist oder das Spiel lädt; Strg/Alt/Meta und gehaltene Tasten (Repeat) lösen nichts aus.

| Taste | Aktion | Prüfung wie |
|-------|--------|-------------|
| 1 bis 9 | Karte an dieser Stelle im BUILD-Panel wählen | Karten-Button (`canPickTowerCard`) |
| U | Erstes Upgrade des gewählten Towers, das bezahlbar und freigeschaltet ist. Über dem Tower steigt der Track mit neuer Stufe auf ("FIRE RATE LV 4", der Name des Tracks in Versalien, `--td-gold-light`), die Kachel blitzt. Kauft U nichts, steigt dort der Grund auf (`--td-warn-orange`: "NEED 120 CREDITS", "NEEDS RESEARCH", "FULLY UPGRADED"), und über den Kacheln steht 2,5 s eine Zeile mit Rand in `--td-warn-orange` ("Need 120 more credits for Damage", "Research Advanced Weaponry for the next levels", "Fully upgraded"). Ohne gewählten Tower tut U nichts. Ein Klick auf eine Upgrade-Kachel (Tower-Detail und Research Wing) antwortet genauso, für genau diese Kachel: gekauft steigt ihr Track auf und sie blitzt, sonst steigt ihr Grund auf ("NEED 400 CREDITS" für diese Kachel, auch wenn eine andere bezahlbar wäre) und die Zeile erscheint | Upgrade-Kacheln (Klick: `upgradeTrackRefusal`; U: `firstAffordableUpgrade`, Grund aus `upgradeRefusal`; Kauf und Antwort für beide in `TowerUpgradeService`, Panel-Anzeige über `UpgradeHintService`) |
| Entf / Backspace | Verkaufen, zweimal drücken | Sell-Button (`SellConfirmService`) |
| Leertaste | Nächste Welle | `store.canStartWave` |
| P | Pause | Pause-Button |
| + / = / - | Geschwindigkeit hoch, runter (1x, 2x, 4x, ohne Umlauf) | `stepGameSpeed` |
| H / ? | Übersicht als Dialog | |
| Pos1 (Home) | Kamera gleitet zum HQ | nicht während des Intro-Flugs |
| N | Kamera gleitet zum nächsten Spawnpunkt, reihum | nicht während des Intro-Flugs |
| Taste der Fähigkeit (`AbilityConfig.hotkey`, K für den Nuclear Strike, alle in [ABILITIES.md](ABILITIES.md)) | Zielmodus der Fähigkeit an, nochmal drücken schaltet ihn ab (nicht im Photo Mode). Kann sie gerade nicht feuern, nennt die Kontext-Hinweis-Box den Grund ("Build a Missile Silo first", "Only during a wave", "No charges, recharges in 2 waves"); vor ihrer Forschung bleibt die Taste still | Knopf in der Fähigkeitenleiste (`AbilityTargetingService.start`) |
| G | Held wählen; ist er gewählt, gleitet die Kamera zu ihm (nicht im Photo Mode, nicht während des Intro-Flugs) | Held-Knopf in der Fähigkeitenleiste, Klick auf den Helden (`HeroControlService.summon`) |
| V | Nächste Munition des Helden, reihum (auch ohne ihn zu wählen) | Segmente im Helden-Panel (`HeroControlService.cycleAmmo`) |
| O | Photo Mode an und aus | Knopf Photo Mode der Quick Actions (`PhotoModeService`) |
| Q | [Forschungsbaum](#forschungsbaum-dialog) als Dialog; still, solange kein Research Center steht | Knopf im BUILD-Panel und im Panel des Centers (`ResearchStore.centerLevel`) |
| C | In den gewählten Tower steigen und selbst feuern, im Tower: aussteigen (nur Projektil-Tower) | Gamepad-Knopf in der Zielwahl-Zeile des Tower-Panels (`TowerControlService`) |
| Esc | Photo Mode verlassen, sonst Quick-Menü schließen, sonst Verkauf abbrechen, sonst Held loslassen, sonst Tower abwählen | |

Während eines [Boss-Intros](#boss-intro-canvas) fragt die Spielkomponente vor InputHandler und HotkeyService den `BossIntroService`: Esc überspringt das Intro (vor Build- und Zielmodus), alle anderen Spieltasten warten, bis die Sicht zurück ist. Tippen in einem Feld und ein Esc, das ein Dialog schon genommen hat, bleiben unberührt.

Während des Intro-Flugs nach dem Laden gilt dasselbe über `IntroCameraFlightService.handleKeyDown`: Esc überspringt ihn wie "Skip Intro" und ein Klick oder das Mausrad auf der Karte, alle anderen Spieltasten wirken während des Flugs nicht, auch Pos1, N und WASD.

Während des Replays der letzten Welle steuern Leertaste und P dessen Pause, + und - dessen Geschwindigkeit, Esc führt zurück ins Spiel; Kamera-Tasten und H bleiben, alles andere ruht (`HotkeyService.runInReplay`, siehe [Replay der letzten Welle](#replay-der-letzten-welle)).

Im bemannten Tower wirken nur Leertaste, P, +/-, M, C und Esc (`HotkeyService.runInTower`, siehe [Tower bemannen](#tower-bemannen)); Esc gibt dort die gefangene Maus frei, das zählt als Aussteigen.

S bleibt Kamera (WASD), deshalb verkauft Entf. Die Übersicht (`components/hotkey-help-dialog/`) liest `HOTKEY_HELP` aus derselben Datei wie die Zuordnung; H, ? und Esc schließen sie. Hinweise im UI: Tastenkappe im Rich-Tooltip der Tower-Karten (`TdTooltipData.hotkey`, Gold auf `--td-panel-shadow` wie in der Übersicht), "(P)" und "(+/-)" in den Tooltips des Game Speed, Tastenkappe im Tooltip der Knöpfe der Fähigkeitenleiste, `aria-keyshortcuts` an Wave-, Pause-, Sell-, Strike- und Kartenbuttons, "H: Shortcuts" im Controls Hint. Im Menü öffnet Extras, Keys dieselbe Übersicht. Das Helden-Panel zeigt V, G und Esc als Tastenkappen, seine Munitionswahl trägt `aria-keyshortcuts`.

### First-Run-Tipps

Sieben kurze Tipps in der Context-Hint-Box, entlang des Spielablaufs: Tower bauen, erste Welle starten, Tower upgraden, Research Center bauen, Forschung starten, Fähigkeit einsetzen, Held anheuern. Zustandsmaschine in `services/onboarding/onboarding.ts`, Zustand in `OnboardingService` (localStorage `td_onboarding_v2`).

- Ein Tipp verschwindet, wenn der Spieler tut, was er sagt (Events `tower:placed`, `wave:started`, `tower:upgraded` auf einen Tower außer dem Research Center, `research:started`, `ability:used`, `hero:state-changed` mit `hired`), oder per "Skip"; "Hide tips" beendet alle. Schon erledigte Schritte zählen, bevor ihr Tipp dran ist
- Die späteren Tipps warten auf ihren Moment im laufenden Spiel (`isReady`): Upgrade nach Welle 1, Research Center nach Welle 3 (`RESEARCH_TIP_AFTER_WAVE`; die billigste Forschung kostet 400, etwa was Welle 2 zahlt, der Tipp wartet eine Welle länger, Entscheidung E1 des Users nach dem Playtest vom 2026-09-15), Forschung starten, sobald ein Center steht, Fähigkeit, sobald eine ihren Knopf in der Leiste hat (erforscht, der Nuclear Strike mit Missile Silo), Held, sobald er angeheuert werden kann. Den Fortschritt liest der Service aus `wave:completed`, `wave:jumped`, `research:state-changed`, `ability:state-changed` und `hero:state-changed`; er wird nicht gespeichert, `game:reset` setzt ihn zurück. Gezeigt wird der erste offene Tipp, dessen Moment gekommen ist, sonst keiner (etwa während Welle 1)
- Kopf "1/7" rechts neben dem Titel; der erste Tipp zeigt die Kamera-Tasten und H (Shortcuts) als Tastenkappen, der Controls Hint wartet so lange. Der Wellen-Tipp zeigt Space, P und +/-, der Upgrade-Tipp U und Del (Verkauf), der Fähigkeiten-Tipp die Tasten der erforschten Fähigkeiten, der Helden-Tipp G und V
- Nicht über Ladescreen, Token-Screen, Fehler, Intro-Flug, Game Over, Photo Mode und Replay
- Die Tipp-Box sitzt 56px über der Unterkante statt 20px wie die Build-Hinweise: oberhalb des Bands der Offscreen-Pfeile (26px vom Rand, Chips bis 26px), damit kein Pfeil darunter verschwindet
- "Tips" im Sidebar-Footer startet die Tipps von vorn, ohne die Schritte, die das laufende Spiel schon getan hat (ohne Skips): in Welle 12 kommt nicht "Build a tower". Hat das Spiel alle sieben getan, kommt die ganze Runde ab 1/7. Neues Spiel oder Reload setzen den gespeicherten Stand nicht zurück, nur den Spielfortschritt
  Grenzen: "Tips" kennt nur, was der Dienst in diesem Spiel über Events gesehen hat. Der Forschungs-Cheat sendet kein `research:started`; wer cheatet, ohne vorher selbst eine Forschung gestartet zu haben, bekommt nach "Tips" wieder "Start a research" (wenn ein Center steht). Wartet der nächste offene Schritt noch auf seinen Moment (während Welle 1, oder nach gestarteter Forschung ohne erforschte Fähigkeit), erscheint nach dem Klick zunächst kein Tipp.

### Damage-vs-Armor-Dialog

Hilfe-Dialog in `components/damage-matrix-dialog/`, geöffnet über den `i`-Button (`.td-matrix-btn`) rechts im BUILD-Header und im Tower-Header der Sidebar. Aus dem Tower-Header wird die Zeile des gewählten Towers hervorgehoben.

- Liest nur Configs (`DAMAGE_MATRIX`, `EFFECTIVENESS_THRESHOLDS`, `EFFECTIVENESS_COLORS`, Tower, Enemies). Ein Rebalancing braucht keine UI-Änderung.
- Stufen wie bei den Schadenszahlen, Farben ebenso bis auf `normal`: in der Tabelle neutral (`--td-text-secondary`), weil das Rot der Schadenszahlen in einer Matrix als "schlecht" gelesen wird und 1.00× hinter den Abweichungen zurücktreten soll.
- Aufbau: Titelplatte mit „Damage vs armor“, Einzeiler („Multiplier on every hit“) und Schließen, Rüstungskopf sticky mit Bernstein-Unterstrich (`--td-rune-amber-muted`), darunter die Gegner je Rüstung als gedämpfte Zeile. Tower-Spalte mit Name und Schadensart, davor ein 6px-Punkt in `DAMAGE_TYPE_UI.color` (gedämpft). Werte: `weak` und `normal` nur als Textfarbe, `strong` und `devastating` als Chip mit leichtem Tint und Rand in der Stufenfarbe, `devastating` fett. Legende kompakt links im Footer.
- Nur freigeschaltete Tower (`ResearchStore.isTowerUnlocked`, dieselbe Prüfung wie das Baumenü). Die Liste ist reaktiv: eine Forschung, die bei offenem Dialog fertig wird, fügt die Zeile sofort ein. Solange noch Tower gesperrt sind, steht unter der Tabelle "More towers unlock through research."
- Breite `min(880px, 92vw)` über die Dialog-Config (`width`/`maxWidth`), nicht per CSS: das Overlay-Pane von MatDialog ist per Klasse auf 560px begrenzt, nur der Inline-Style der Config hebt das auf. Die Tabelle hat `table-layout: fixed` (Tower-Spalte 150px, Rüstungsspalten gleich breit), Gegnerlisten brechen um; horizontal gescrollt wird erst unter 600px Tabellenbreite.
- Esc schließt nur den Dialog: `isEscapeForDialog` (`utils/dialog-key-guard.ts`) hält Esc vom globalen Key-Handler fern, solange ein Dialog offen ist oder Esc schon verbraucht hat.

### Photo Mode

Blendet das HUD aus, die Kamera bleibt frei (Maus, WASD). Einstieg über den Knopf Photo Mode der Quick Actions oder Taste O, Ausstieg über Esc, O oder "Exit". Zustand in `UIStore.photoMode` (nicht gespeichert), Ablauf in `PhotoModeService` (vom Spiel-Component bereitgestellt).

- Beim Einstieg enden Build- und Platzierungsmodus, die Tower-Auswahl (Reichweite, LOS) und das offene Quick-Actions-Menü; die Veteranen-Abzeichen über den Towern sind bis zum Ausstieg aus. Im Photo Mode wählen Klicks auf die Karte nichts aus, Hover zeigt keine Reichweite, die Zifferntasten wählen keine Karte
- O und Esc sind Hotkeys (`hotkey-map.ts`, `HotkeyService`, siehe [Tastenkürzel](#tastenkürzel)); Esc verlässt den Photo Mode vor allem anderen
- Header und Sidebar verschwinden, der Canvas wird größer; `ThreeTilesEngine.fitToCanvas()` zieht den Zeichenpuffer nach dem nächsten Render nach. Sichtbar bleiben Canvas, Google-Logo und Kartenattribution, die Leiste und blockierende Screens (Laden, Token, Fehler, Game Over)
- Leiste oben mittig (Glas, `bevel-glass`): "Save screenshot" und "Exit" mit `Esc`-Kappe
- Screenshot: `captureFrame()` kopiert den nächsten gezeichneten Frame synchron in `RenderLoop.onNextFrameRendered()`, weil der Renderer ohne `preserveDrawingBuffer` läuft. Logos und Attribution werden ins Bild gestempelt (auf dem Schirm sind sie HTML), dazu das Zeichen des Spiels (`stampScreenshot` in `utils/screenshot.ts`) als ein Block unten rechts, rechtsbündig mit der Attributionsleiste und eine Randbreite über der unteren Zeile (Anbieter-Logos links, Leiste rechts, die höhere zählt): oben das Logo (`assets/images/logo/logo.png`) als Wasserzeichen, viermal so hoch wie die Schrift der Attribution (48 px bei 1080p) mit 60 % Deckkraft, darunter mittig `https://3dtd.sgeht.net` in 1,25-facher Schriftgröße (15 px bei 1080p, 35 px bei 1170 × 2532), 500 `--td-font-body`, `--td-text-primary` mit 90 % Deckkraft über einer Kontur in `--td-panel-shadow` mit 60 % Deckkraft, ein Fünftel der Schriftgröße breit (3 px bei 1080p). Weil der Block über der ganzen unteren Zeile steht, bleibt er auch im Hochformat frei, wo die Leiste bis zu 60 % der Breite einnimmt. In der DevWorld (keine Anbieter-Logos, keine Attribution) steht er auf dem unteren Rand; ohne geladenes Logo steht die Adresse allein rechts. Dann PNG-Download als `3dtd-<ort>-<datum>-<zeit>.png`
- Tab bleibt in der Leiste (`cycleTab` in `utils/focus-cycle.ts`, geteilt mit dem Replay)

### Replay der letzten Welle

Technik in [REPLAY.md](REPLAY.md). Zustand in `UIStore.replayMode`, Ablauf in `ReplayService` (vom Spiel-Component bereitgestellt). `UIStore.viewOnly` fasst Photo Mode und Replay zusammen: Klicks und Hover wählen dann nichts aus.

- **Einstieg im WAVE-Panel:** in der Zeile unter dem Wellen-Button (`.td-wave-options`, 3px nach oben gezogen wie zuvor der Schalter) links der Auto-Start-Schalter, rechts zwischen den Wellen der Link „replay W12“ (`.td-replay-link`): kein Rahmen, Icon `replay` 12px, dann Text 10px Mono in `--td-text-muted` wie beim Schalter, Hover `--td-text-secondary`, `:focus-visible`-Outline in `--td-teal-light`. Name „Replay wave 12“, Tooltip nennt freie Kamera, Pause und 0,25x bis 4x. Er erscheint, sobald eine Welle aufgenommen ist, und verschwindet mit dem Start der nächsten
- **Einstieg auf dem Game-Over-Screen:** unter Restart „Replay wave N“ (`.td-gameover-replay`) als Rahmen-Button (`--td-panel-main`, 1px `--td-frame-dark`, Inset-Kante, `--td-text-secondary`, 11px Mono-Versalien), 12px Abstand, leiser als das grüne Restart
- Beim Einstieg enden Build-, Platzierungs- und Zielmodus, die Tower- und die Helden-Auswahl, das offene Quick-Menü und ein laufender Photo Mode; die Veteranen-Abzeichen sind aus, das Spiel pausiert. Während eines Boss-Intros startet das Replay nicht. Header, Sidebar und alle Overlays des Canvas verschwinden wie im Photo Mode, hier auch der Game-Over-Screen (er kommt nach dem Replay wieder). Beim Ausstieg kehren Kamera, Pause, Menü und Fokus zurück
- **Leiste** unten mittig, 30px über der Unterkante (über Logo und Attribution), bis 760px breit, 16px Rand zu den Seiten, Glas (`ui.glass-strip`), zwei Zeilen in `--td-font-mono`:
  - Oben „REPLAY“ (10px Versalien, `letter-spacing: 0.18em`, `--td-text-muted`) mit „Wave N“ in `--td-gold-light` fett; rechts HQ-Leben (`heart`) und Gegner auf der Route (`skull`) im gezeigten Moment, 11px `tabular-nums` in `--td-text-secondary`, Icons in `--td-text-muted`; ganz rechts „Exit“ mit `Esc`-Kappe im Rezept der Photo-Mode-Knöpfe
  - Unten Play/Pause (30px breit, Icon in `--td-gold-light`; am Ende `refresh`, „Play the replay again“), der Fortschrittsbalken, die Zeit „0:42 / 2:13“ (11px `tabular-nums`) und die Geschwindigkeiten 0.25x bis 4x als Segmente (10px, `--td-text-muted` auf `--td-panel-secondary`; die aktive eingedrückt wie der Pause-Knopf: `--td-panel-shadow`, Rand `--td-gold-dark`, Text `--td-gold-light`, `aria-pressed`)
  - Fortschrittsbalken: `input type="range"`, Spur 4px als vertiefte Fläche, bis zum gezeigten Moment in `--td-gold-dark` gefüllt, Griff 10 × 14px im Gold-Verlauf. Darunter 1px-Marken in `--td-teal-light` (75 %) an den Stellen, an denen der Spieler Befehle gab; Marken, die sich berühren würden, werden eine. Tooltip „Drag to jump. Ticks mark your orders: builds, sales, upgrades, abilities, the hero“
  - Unter 640px Breite rücken die Geschwindigkeiten in eine eigene Zeile
- Tab bleibt in der Leiste; der Fokus liegt beim Einstieg auf Play/Pause

### Tower bemannen

Technik und Regeln in [TOWER_CONTROL.md](TOWER_CONTROL.md). Zustand in `GameStore.mannedTowerId`, Ablauf in `TowerControlService` (vom Spiel-Component bereitgestellt), HUD in `components/tower-control-hud/`.

- Einstieg: Gamepad-Knopf (`gamepad`, 18px) rechts neben "Hold fire" in der Zielwahl-Zeile des Tower-Panels, nur bei Projektil-Towern, Tooltip mit Taste C; oder C
- Sidebar und Overlays des Canvas gehen (`.td-tower-control`, wie im Photo Mode), Header (Welle, HQ, Credits) und Info-Overlay (FPS) bleiben. Auswahl- und Hover-Ring samt Reichweite sind weg (auch wenn die Maus beim Einsteigen über dem Tower stand), das Abzeichen (Rang, Hold-Fire-Pause) des eigenen Towers ist aus, die der anderen bleiben
- Fadenkreuz mittig: vier Striche 2 × 9px mit 7px Lücke und ein 2px-Punkt, weiß mit 90 % Deckkraft und dunklem Schatten; `--td-gold-light`, solange ein angreifbarer Gegner auf dem Strahl liegt. Je Schuss springen die Striche auf 1,6-fach und gehen in 120 ms zurück (aus bei `prefers-reduced-motion`)
- Treffer: weißes Kreuz, 45° gedreht, 22px, Mitte ausgespart, 160 ms, ein hoher Tick. Kill: dasselbe in `--td-health-red`, 30px, 420 ms, zwei steigende Ticks
- Nachlade-Ring 14px unter dem Fadenkreuz, `conic-gradient` in der Farbe des Fadenkreuzes, verschwindet, sobald der Schuss bereit ist
- Zeile unten mittig, 28px über der Unterkante, Glas wie "Skip Intro": Tower-Name (Versalien, `--td-gold-light`, 700), dann `LMB` fire, `RMB` zoom, `Esc` get out als Kappen; solange die Maus nicht gefangen ist "Click the map to aim" und `C` get out

### Game-Over-Bilanz

`components/run-summary/` im Game-Over-Overlay unter Ort und Welle, über der Knopfreihe (siehe [Game Over](#game-over-und-connection-lost)). Die Zahlen rechnet `runSummary` (`run-log/run-summary.ts`) aus dem Run-Log, aufgerufen vom `GameStateSyncService`; bei `game:over` landet die Zusammenfassung in `GameStore.runSummary`, `game:reset` leert sie.

- Kennzahlen in einer Zeile dunkler Zellen (4px Fuge), die Zahl in Oswald 26px über dem Mono-Label: Wave, Kills, Time (Spielzeit ab Reset, Bauphase eingeschlossen), Earned (Kill-Belohnungen und Wellenboni, ohne Rückerstattungen und Cheat-Credits), Spent (Tower, Upgrades, Forschung, abzüglich Rückerstattungen)
- Leaks per wave: ein Balken je Welle, Höhe relativ zur schlimmsten Welle, `--td-hp-text`; Wellen ohne Leak als 2px-Strich in `--td-frame-dark`. Der Tooltip je Balken nennt Leaks und HQ-Schaden der Welle
- Top towers by damage: bis zu drei Tower, verkaufte mit dem Stand beim Verkauf (Zusatz "sold"); Tower ohne Schaden und Kills (Research Center) fehlen

Hat der Lauf den Rekord des Ortes geschlagen, steht unter den Knöpfen der Hinweis `app-world-record` (`components/world-globe/`): Haarlinie oben, links ein Globus mit 112px auf den Ort gedreht und gold umringt, rechts "WORLD MAP" (9px Mono-Versalien, `--td-text-muted`), "New record for <Ort>: wave N" (13px/600, `--td-gold-light`) und "Best before: wave M" oder "First run here" (10px Mono, `--td-text-muted`), ganz rechts "Skip". Er blendet 1,2 s nach dem Overlay ein (400 ms, bei `prefers-reduced-motion` ohne Animation), Restart bleibt dabei stehen. Details: [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#weltkarte-beste-welle-je-ort).

Den Schaden je Tower zählt `CombatComponent.damageDealt`: `DamageApplicationService` addiert pro Treffer die tatsächlich abgezogenen HP (ohne Overkill). Das Tower-Panel zeigt ihn als Kachel "Dealt" neben Kills (Raster drei über vier Kacheln) und liest ihn alle 250 ms neu, statt pro Treffer `selectedTowerRevision` zu erhöhen.

### Veteranen-Rang

Tower sammeln mit Kills kosmetische Ränge (Leiter und Technik in [TOWER_CREATION.md → Veteranen-Ränge](TOWER_CREATION.md#veteranen-ränge)). Das Tower-Panel zeigt den Rang in einer Zeile zwischen Stat-Kacheln und Targeting (`.td-rank-row`):

- Fläche `--td-panel-secondary`, 1px `--td-frame-dark`, Ecken 3px wie die Kacheln, `--td-font-mono`
- Links das Abzeichen als td-icon 16px, gezeichnet wie über dem Tower: `caretU` (ein Winkel), `chevrons2`, `chevrons3`, `star` (gefüllt). Daneben der Rangname, 11px/700, Versalien, `letter-spacing: 0.06em`
- Rechts "57 / 150 kills" bis zum nächsten Rang, 10px, `--td-text-muted`, `tabular-nums`; im obersten Rang nur "1234 kills"
- An der Unterkante ein 2px-Balken in `--td-frame-dark`, gefüllt mit dem Weg vom aktuellen zum nächsten Rang
- Silber bis Elite: Icon `--td-edge-highlight`, Name `--td-text-primary`, Balken `--td-edge-highlight`. Ab Champion Icon und Name `--td-gold-light`, Balken `--td-gold`. Unter dem ersten Rang ("Recruit") Icon `--td-text-disabled`, Name `--td-text-secondary`
- Tooltip mit der Leiter: "Rank from killing blows, cosmetic only: Blooded 10 · Veteran 50 · …". Die Kachel Kills sagt im Tooltip "Killing blows since it was built"

Die Werte liefert `veteranView()` (`tower-panel/tower-stats.ts`) aus `stats().kills`, neu gerechnet mit `selectedTowerRevision`, die bei jedem Kill des gewählten Towers hochzählt.

Über dem Tower in der Welt steht dasselbe Abzeichen, 24 CSS-Pixel groß: Winkel oder Stern in Silber (`--td-edge-highlight`) oder Gold (`--td-gold-light`) mit dunklerem Innenrand und dunklem Außenrand (`--td-panel-shadow`) für helle Tiles, ohne Plakette dahinter. Der Photo Mode blendet es aus, ein bemannter Tower nur sein eigenes (`TowerBadgeRenderer.hideFor`), auch die Hold-Fire-Pause.

---

## Regeln

1. **Eine Hauptaktion je Ort** in Messing; alles andere Stahl oder Text
2. **Akzente sparsam**: Messing für Aktion und Titel, Teal für Laufendes, Rot nur für Gefahr
3. **Platten statt Kästen in Kästen**: eine Platte, darin Abschnittsköpfe und Linien
4. **Titel sind Namen** in Oswald-Versalien, Labels Mono ab 10px, Text Inter Tight
5. **Kein Glow, kein Blur** außer über der Karte; Ecken eckig oder abgeschrägt
6. **Bewegung kurz** (120 bis 450 ms), bei `prefers-reduced-motion` nur Farbe

---

## Accessibility

Fokus: 2px `--td-focus-color` mit 2px Abstand, nur bei `:focus-visible` (`focus-ring`); Menüeinträge zeigen ihn als Messingbalken links. Kein `outline: none` ohne Ersatz.

### Icon-Buttons

`matTooltip` setzt nur `aria-describedby`, keinen Namen. Reine Icon-Buttons (Header, Sidebar, Quick-Actions, Kompass, Dialoge) brauchen deshalb zusätzlich einen englischen Namen:

- `aria-label`, in der Regel mit dem Tooltip-Text; dynamisch per `[attr.aria-label]` (z. B. Sell-Wert, LOS-Filter-Modus)
- Umschalter mit sichtbarem Aktiv-Zustand: `[attr.aria-pressed]` (Layer-Toggles, Mute, Targeting, Move HQ / Set spawn)
- Buttons, die ein Menü aufklappen: `[attr.aria-expanded]` (Favoriten, Layers, Developer)
- Deko-SVGs in gelabelten Links: `aria-hidden="true"`
- Radiogruppen und Tab-Leisten (Munition des Helden, Raumoptionen, Forschung je Spieler, Kartenanbieter) tragen `tdRovingGroup` (`components/roving-group.directive.ts`): ein Tab-Halt auf der Wahl, Pfeiltasten wählen das vorige oder nächste Element (umlaufend, `aria-disabled` übersprungen), Home und End das erste und letzte; die Pfeile schwenken dabei keine Kamera

`td-icon` rendert ohne `ariaLabel` ein `role="presentation"`-SVG, das Icon selbst trägt also nichts zum Namen bei. Debug-Fenster sind nachrangig, die meisten ihrer Buttons haben ein `title` als Fallback.

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `src/app/styles/td-theme.ts` | Tokens (Konstanten, `TD_CSS_VARS`, `installThemeVars`) |
| `src/app/styles/_game-ui.scss` | Fundament: Platten, Dialoge, Knöpfe, Menü, HUD-Platten |
| `src/app/styles/_td-mixins.scss` | Ältere Rezepte, Scrollbar, Fokusring |
| `src/fonts/` | Oswald (OFL) |
| `public/assets/images/logo/logo.svg` | Logo als SVG (einfarbig `#C2A055`, aus dem PNG nachgezogen mit `tools/logo/vectorize_logo.py`); `public/favicon.svg` ist das Zeichen daraus |
| `tower-defense.component.ts` | Haupt-UI mit Layout |
| `components/game-header/` | Info-Header mit Spielstatus |
| `components/game-sidebar/` | Rechte Sidebar mit Aktionen, Tower-Slots, Wave-Preview (Panels siehe [Sidebar-Panels](#sidebar-panels)) |
| `components/compass/` | Kompass-Anzeige |
| `components/ability-bar/` | Fähigkeitenleiste am linken Rand (Held, Fähigkeiten) |
| `components/info-overlay/` | FPS-Anzeige in drei Stufen (Caret schaltet weiter): nur FPS; aufgeklappt mit Tempo und Worker-Last (Tempo in `--td-perf-critical` unter dem eingestellten), Tiles, Cache, Sounds je Sekunde angefordert / gespielt, Straßen; breit mit einer Spalte rechts: Ticks, Speicher-Modus, Kosten je Paket, Gegner, Mini-Charts |
| `benchmark/benchmark-panel.component.*` | Benchmark oben mittig: Fortschritt, Tabelle, Kopierknopf (Gold), Schließen (Rahmen-Button) |
| `components/quick-actions/` | Quick Actions: Route-Animation, Settings, Photo Mode, Layer- und Dev-Menü, Kamera-Reset |
| `components/game-speed/` | Pause und Game-Speed (1x/2x/4x), Bauphase und Welle |
| `components/boss-intro/` | Schleier und Titelkarte des Boss-Intros |
| `components/relocation-status/` | Hinweis "Moving HQ" mit Schritt und Messfortschritt |
| `components/debug-window/` | Debug-Panel Container + alle Debug-Ansichten (Wave, Camera, Event, Performance, …) |
| `components/context-hint/` | Wiederverwendbare Kontext-Hinweis-Box |
| `components/attributions-dialog/` | Attributions & Lizenzen Dialog |
| `components/damage-matrix-dialog/` | Damage-vs-Armor-Tabelle (Hilfe-Dialog aus der Sidebar) |
| `components/main-menu/pages/` | Inhalt der Menüseiten: Ortswahl, Slots, Settings, Extras, Coop-Wege (siehe [Menüseiten](#menüseiten)) |
| `components/world-globe/` | Weltkarte: Globus (2D-Canvas), Rekord-Hinweis im Game-Over-Overlay |
| `components/address-autocomplete.component.ts` | Adress-Autocomplete (Nominatim) |
| `components/engine-test/` | Standalone Engine-Test-View |

---

## Referenzmaterial

- `public/assets/mocks/ui_mock.png` - WC3-Style Mockup
- `public/assets/mocks/ui_mock.txt` - Farbpalette Spezifikation
