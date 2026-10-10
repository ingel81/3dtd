# Tower Defense - Design System

**Stand:** 2026-10-09

## Übersicht

Getönter Putz, Basalt, Stein und Messing. Panels und Dialoge sind Flächen aus grauem Putz, leicht vertieft, mit
kräftigem Schlagschatten; die Kopfleiste ist Basalt. Knöpfe und Menüeinträge sind erhabene Steinplatten mit
eingravierter Schrift, Trennungen eingeritzte Linien. Messing ist der eine Akzent. Alle Schrift ist Barlow Semi
Condensed; Mono (JetBrains Mono) nur für Codes, Schlüssel und Logs.

Die Auswahl stammt aus dem interaktiven Baukasten (`tmp/ui-design/kit/index.html`, eingelockt in vier Runden,
`tmp/ui-design/LOCKED.md`). Was der Look nicht hat: Gold- oder Messingverläufe als Fläche, abgeschrägte Ecken,
Eckwinkel, Glow, Emoji, Glas. Teile einer Textzeile trennt „ | “ („Paused | Heilbronn | wave 12“), kein Mittelpunkt.

### Vier Ebenen, je eine Quelle

| Ebene | Wo | Was dort steht |
|-------|----|----------------|
| Werte | `src/app/styles/td-theme.ts` | Farben, Materialien (Texturen), Linien, Schatten, Schrift, Größen, Bewegung als `--td-*` |
| Rezepte | `src/app/styles/ui/*.scss` | Mixins je Thema: Fläche, Knöpfe, Felder, Listen, Menü, HUD, Sidebar, Text, Layout |
| Klassen | `src/app/styles/ui/_classes.scss`, einmal eingebunden in `src/styles.scss` | die globalen `td-*`-Klassen, Scrollbar, Fokusring, `[hidden]` |
| Komponenten | ihre Templates und Stylesheets | setzen `td-*`-Klassen; im eigenen SCSS nur Layout |

**Was in ein Komponenten-Stylesheet darf:** Anordnung (Flex, Grid, Position, Größe, Abstand, Überlauf), Zustände, die
eine Token-Farbe wählen (`color: var(--td-...)`), eigene Größen als Custom Property, Daten-
farben aus dem Code (`[style.--tier-color]`, Lane-Farben). **Was nicht:** Farbwerte, Verläufe, Schatten, Schriftart,
Schriftgröße außer über `--td-fs-*`, Radien außer `--td-radius`, `0` und `50%`, `drop-shadow`, `backdrop-filter`,
Übergänge mit eigener Dauer statt `--td-dur-*`, Flächen und Relief eines Rezepts von Hand (`background: var(--td-well)`,
`box-shadow: var(--td-raised)` usw.). Braucht eine Komponente etwas davon, gehört es als Rezept und Klasse ins System;
die wenigen begründeten Ausnahmen stehen in der Spec (`ALLOWED`).

Die Spec `src/app/styles/design-system.spec.ts` prüft das auf der Platte, für jedes Stylesheet, jedes Inline-`styles`
und jedes Template unter `src/app`; dazu, dass jedes `var(--td-*)` ein Token ist (oder eine Größe, die eine Komponente
selbst setzt) und kein Token ungenutzt herumliegt. `td-theme.contrast.spec.ts` prüft die Kontraste.

---

## Tokens

`installThemeVars(document)` in `main.ts` setzt `TD_CSS_VARS` vor dem Bootstrap einmal als `:root`-Regel (ein
`<style id="td-theme-vars">` im Kopf). So sehen auch Overlays außerhalb des Komponentenbaums (`.cdk-overlay-container`:
Dialoge, Tooltips) dieselben Werte. TS-Code, der auf einen Canvas oder in WebGL zeichnet (Globus, Screenshot, Schadens-
zahlen, Tower-Abzeichen, LOS-Zellen), liest `TD_THEME` und `TD_FONTS` direkt.

### Materialien

| Token | Inhalt |
|-------|--------|
| `--td-tex-plaster`, `--td-tex-basalt` | `assets/ui/plaster.jpg` (Poly Haven „Grey Plaster 02“, CC0) und `assets/ui/basalt.jpg` („Dark Rock“, CC0), per Graustufe und Farb-LUT auf die Palette umgefärbt, gekachelt in `--td-tex-size` (512 px). Die URL löst sich gegen das Dokument auf, also unter jeder Base-Href |
| `--td-tint`, `--td-tint-overlay` | Tönung über dem Putz: `rgba(12,15,13,.65)` für Panels, `.55` für Leisten über der Karte |
| `--td-surface` | Panel: Tönung über Putz |
| `--td-surface-overlay` | Leiste über der Karte; der Putz liegt mit `--td-overlay-opacity` (.86) auf einem `::before`, die Karte scheint leicht durch |
| `--td-surface-topbar` | Kopfleiste: Tönung über Basalt |
| `--td-stone-dark`, `--td-stone-darker` | Hauptknopf (Putz −22 %), Nebenknopf, Gefahrknopf, Schließen, Icon-Knöpfe (−36 %) |
| `--td-stone-lit`, `--td-stone-plate` | gewählte Tabellenzeile (Putz +10 %), gewählter Menüeintrag (+7 % nach +2 %) |

Für Kontrast und als Grundfarbe stehen die Flächen auch als Farbe in `TD_THEME`: `panelMain` `#1C201E`, `stoneDark`
`#2E3330`, `stoneDarker` `#262A27`, `stoneLit` `#4F5450`, `stonePlate` `#494E4B`, `well` `#111312`, `topbar` `#282D29`.

### Relief

| Token | Verwendung |
|-------|------------|
| `--td-line-dark`, `--td-line-light`, `--td-line-width`, `--td-line-gap` | Eingeritzte Linie: 2 px dunkel (50 %), 1 px darunter hell (15 %) |
| `--td-hairline` | Haarlinie zwischen Zeilen und unter Sidebar-Köpfen (7 %) |
| `--td-engrave`, `--td-engrave-icon` | Eingravierte Schrift (Titel, Knöpfe), eingravierte Symbole (Werkzeuge) |
| `--td-panel-recess`, `--td-panel-drop` | Panel: vertiefte Füllung, starker Schlagschatten |
| `--td-raised`, `--td-raised-quiet`, `--td-raised-lit`, `--td-raised-plate` | Erhabener Stein: Hauptknopf (Tiefe 2), Nebenknopf (Tiefe 3), gewählte Zeile, gewählter Menüeintrag |
| `--td-pressed` | Gedrückt, eingedrückt (Knopf, aktiver Schalter-Knopf) |
| `--td-well`, `--td-well-shadow`, `--td-well-soft`, `--td-well-soft-shadow`, `--td-well-deep` | Vertieft: Felder, Schalter, Regler (40 %, Tiefe 4); Karten und Kacheln (24 %); gewählte Karte |
| `--td-topbar-edge`, `--td-popup-drop` | Plattenkante unten an der Kopfleiste; Schatten eines Popups |
| `--td-backdrop` | Hintergrund bei offenem Menü und über Game Over: von links 80 % auf 35 % bei 65 % Breite |
| `--td-scrim-bottom`, `--td-leak-vignette`, `--td-hazard`, `--td-los-depth-ramp` | Abdunklung unter der Boss-Karte, roter Rand bei einem Leck, Warnstreifen, Tiefenrampe des LOS-Debuggers |

### Farben

| Token | Wert | Verwendung |
|-------|------|------------|
| `--td-bg-dark`, `--td-bg-surface` | `#0E110F`, `#151A16` | Seite, Vollbild-Grund; Optionen einer Auswahlliste |
| `--td-panel-shadow`, `--td-ink` | `#0B0F0C`, `#0B0F0C` | Tiefstes Dunkel, Umriss |
| `--td-frame-mid`, `--td-frame-light` | `#4A544D`, `#7A8580` | Linien, die nicht eingeritzt sind: Diagramme, Globus, Scrollbar |
| `--td-brass`, `--td-brass-light`, `--td-brass-dark` | `#C9A44C`, `#F2DD9A`, `#A98A45` | Der Akzent: Abschnittsköpfe, Werte, Symbole; Text des Hauptknopfs, Gewähltes, Hover; Menüsymbole in Ruhe |
| `--td-teal`, `-light`, `-dark` | `#6BB6A4`, `#8FD9C6`, `#1F8772` | Laufend, magisch, bestätigt, Anti-Air |
| `--td-green`, `-dark` | `#9ED6A0`, `#6AAB6C` | Positiv, erforscht |
| `--td-health-red` | `#B83E32` | Rot als Fläche (Balken, Marken); als Text zu dunkel |
| `--td-warn-orange`, `--td-warn-text` | `#C96A3A`, `#D98A4A` | Warnung als Fläche, als Text |
| `--td-danger-text`, `--td-danger-edge`, `--td-error-text` | `#E2806F`, `#C8463A`, `#EE8A7A` | Text des Gefahrknopfs; Rand eines Felds mit Fehler; die Meldung darunter |
| `--td-hp-text`, `--td-hp-low`, `--td-gain`, `--td-loss` | `#E87A6A`, `#EE8A5E`, `#9ED6A0`, `#E87A6A` | HQ-Zahl, HQ unter 30 %, Credits plus und minus |
| `--td-knob`, `-light`, `-dark`, `--td-switch-off` | `#BDB39A` … | Griff des Reglers, Knopf des Schalters (aus) |
| `--td-cold`, `--td-lightning`, `--td-chaos`, `--td-ethereal` | | Schadensarten, ätherische Gegner |
| `--td-cell-selection`, `--td-reticle` | `#E69F00`, `#F2F0E8` | Vom Zellbericht gewählte Zellen (auch auf der Karte), Fadenkreuz im bemannten Tower |
| `--td-node*`, `--td-branch-*`, `--td-tree-*` | | Forschungsbaum: Zustände und Stränge tragen Information und bleiben eigene Tokens |
| `--td-event-*`, `--td-perf-*` | | Debug-Fenster |

### Text

Nie reines Weiß.

| Token | Wert | Verwendung |
|-------|------|------------|
| `--td-text-primary` | `#E6E1CF` | Namen, Menüeinträge, Feldtext |
| `--td-text-secondary` | `#C4CBC1` | Fließtext in Dialogen |
| `--td-text-muted` | `#9DA69B` | Labels, Nebeninfo |
| `--td-text-quiet` | `#B9C1B6` | Text des Nebenknopfs |
| `--td-text-title`, `--td-text-engraved`, `--td-text-value` | `#E6DCC0`, `#CFC8B2`, `#EFE4C2` | Werte in Zeilen; eingravierte Titel; große Zahlen |
| `--td-text-dim` | `#8E978B` | „Defend“ vor dem Ort |
| `--td-text-disabled` | `#6A726A` | Gesperrt |

Gegenüber dem Baukasten sind zwei Farben für 4,5:1 angehoben: Gefahrtext `#D86A5C` → `#E2806F`, „Defend“ `#717A6F` →
`#8E978B`.

### Schrift, Größen, Abstände, Bewegung

| Token | Wert | Verwendung |
|-------|------|------------|
| `--td-font`, `--td-font-mono` | Barlow Semi Condensed; JetBrains Mono | Alles; Codes, Schlüssel, Logs |
| `--td-fs-micro` bis `--td-fs-hero` | 11, 13, 15, 17, 17, 19, 21, 22, 29, 44 px | micro (Versalien-Labels), small, body (Sidebar, Tooltips), text (Dialoge, Felder, Zeilen), button, lead, title, menu, hud, hero |
| `--td-track-caps` | `.1em` | Laufweite der Versalien-Labels |
| `--td-sp-1` bis `--td-sp-5` | 4, 8, 12, 16, 24 px | Abstände |
| `--td-radius` | 3 px | Knöpfe, Felder, Zeilen, Leisten; Panels und Dialoge sind eckig |
| `--td-h-button`, `-sm`, `--td-h-field`, `--td-h-row`, `--td-h-menu-item`, `--td-h-topbar` | 36, 30, 40, 40, 48, 48 px | Höhen |
| `--td-row-gap`, `--td-close-size`, `--td-icon-btn`, `--td-icon-sm`, `--td-tool-size`, `--td-menu-width` | 4, 24, 32, 26, 32, 320 px | |
| `--td-disabled-opacity` | .45 | Deckkraft von allem, was gerade nichts tut |
| `--td-dense-*` | | Dichte Variante: Text und Knopfschrift 14, Abschnitt 15, Titel 16, Knopf 28 (klein 24), Feld 28, Zeile 26, Werkzeug 24 px; der Container setzt die Schrift auf `--td-fs-small` |
| `--td-dur-fast`, `--td-dur-mid`, `--td-dur-slow`, `--td-dur-tick`, `--td-ease-out` | 120, 250, 450, 900 ms | Hover und Druck; Popup und Balken; eine Ebene ein- und ausblenden; Balken zu einem Sekundenzähler (linear) |
| `--td-focus-color`, `-width`, `-offset` | `#F2DD9A`, 2 px, 2 px | Fokusring |

Barlow Semi Condensed (500, 500 kursiv, 600, 700) und JetBrains Mono (400, 600) kommen als lateinische Untermengen über
`@fontsource` aus `node_modules` und werden in `styles.scss` gebündelt (CSP `font-src 'self'`, die Desktop-App läuft
offline). Zahlen in Spalten tragen `tabular-nums` (`td-num`, `td-value`, `td-figure`).

Codes in Mono stehen immer in 600 (`forms.input-code`), weil Mono nur in 400 und 600 geladen ist. Zeichen außerhalb der
lateinischen Untermenge (≥, →, ▼) kommen in UI-Texten nicht vor, sie fielen in eine Ersatzschrift. Canvas-Texte zeichnen
mit `TD_FONTS.ui`; `main.ts` lädt die drei Gewichte vor dem ersten Bild (`document.fonts.load`).

Layout-Tokens: `--td-sidebar-width` (300 px), `--td-sidebar-gutter` (14 px), `--td-dock-gutter` (18 px), `--td-z-marks`,
`--td-z-hud`, `--td-z-dock`.

---

## Klassen

Global, einmal in `styles.scss`. Die Emulated Encapsulation lässt globale Regeln durch, also gelten sie in jeder
Komponente und in jedem Overlay. Komponenten mit eigenem SCSS nutzen Rezepte nur dort, wo keine Klasse hingeht (`:host`,
fremde Elemente): `@use '.../styles/game-ui' as ui;` leitet alle Rezepte weiter (Knöpfe als `ui.btn-*`, Sidebar als
`ui.side-*`).

Zustände am Element: `.is-on` oder `[aria-pressed='true']` (gedrückt, gewählt), `[aria-selected='true']`,
`[aria-checked='true']`, `.is-selected`, `[aria-current='page']`, `.is-warn`, `.is-error`, `.is-ok`.
Gesperrt sieht überall gleich aus (`base.disabled`: `--td-disabled-opacity`, Sperr-Cursor): `:disabled`,
`[aria-disabled='true']` (bleibt klickbar und fokussierbar, damit der Tooltip den Grund sagt; der Handler weist den Klick
ab) und `.is-locked` (nicht bezahlbar, nicht freigeschaltet). Hover und Druck greifen nur, wo nichts davon gilt
(`base.$enabled`). `.is-busy` ist ein Knopf, der auf etwas wartet, das er gestartet hat (laufende Welle, ladende
Fähigkeit): nicht gedimmt, kein Hover. Ein eingeschalteter Umschalter (`.is-on`, `aria-pressed`, offenes Menü) liegt
bei Neben- und Icon-Knöpfen als tiefe Mulde mit Messing, wie eine gewählte Stufe; der Hauptknopf steht dann gedrückt.
Namen: `td-` gehört dem System. Neue Komponenten-Klassen tragen ein eigenes Kürzel (`bp-`, `mh-` …), Zustände heißen
`is-*`; ältere Komponenten-Klassen mit `td-` (`td-rd-*`, `td-tech-*`) sind Bestand.
Bei `prefers-reduced-motion` springen alle Übergänge (globale Regel); Animationen hält ihr Rezept oder ihre Komponente an.

### Flächen und Text

| Klasse | Rezept |
|--------|--------|
| `td-panel` | Putz, vertieft, starker Schatten |
| `td-overlay` (`is-error`) | Leiste über der Karte: derselbe Putz, leicht durchscheinend, 6 px Unschärfe dahinter; mit Fehler ein dunkelroter Rand |
| `td-popup` | Kleines Popup: Tooltip, Dropdown, Menü am Knopf |
| `td-chip` (`is-error`), `td-chip-slot` | Hinweis über der Karte mit Symbol, Titel, Zeile (Blutmond mit rotem Rand, HQ-Umzug); sein Platz 18 % unter der Oberkante (als Host-Klasse) |
| `td-backdrop` | Verlauf hinter Menü und Game Over |
| `td-well` (`is-deep`), `td-card` | Vertiefte Fläche, tief wie ein Feld; Karte im Raster (gewählt mit Messingkante; als `<button>` ganz anklickbar, Hover hellt den Text) |
| `td-reveal` (`is-up`, `is-fade`, `is-open`) | Popup, das auf Wunsch aufgeht: verborgen, mit `is-open` blendet es ein und rückt an seinen Platz (4 px von oben, `is-up` 8 px von unten, `is-fade` ohne Verschieben) |
| `td-dlg`, `td-dlg-head`, `td-dlg-title`, `td-dlg-body` (`is-loose`), `td-dlg-foot` | Dialog: Panel, steht unter der Kopfleiste; Kopf mit eingeritzter Linie, die vor dem Schließen-Kreuz ausläuft; eingravierter Titel 21 px/700; scrollender Körper als Spalte (12 px, `is-loose` 16 px); Fuß rechtsbündig |
| `td-rule`, `td-line-top`, `td-line-bottom`, `td-line-left`, `td-line-right`, `td-hairline-top`, `td-hairline-bottom`, `td-marked` | Eingeritzte Trennlinie; eingeritzte Linie an einer Seite; Haarlinie über oder unter einem Kopf oder Fuß; Randmarke links in `--td-mark` |
| `td-section`, `td-head` | Abschnittskopf in Messing 700; dasselbe mit Haarlinie (Sidebar) |
| `td-text`, `td-note`, `td-muted`, `td-sub`, `td-name` | Fließtext; leise Zeile (`is-warn`, `is-error`, `is-ok`); gedämpft; Unterzeile; Name halbfett mit Ellipse |
| `td-tone-hurt`, `td-tone-brass`, `td-tone-teal` | Textfarben mit Bedeutung: was dem HQ schadet; worauf eine Welle schwach ist, ein starker Wert; was läuft |
| `td-caps`, `td-value`, `td-value is-sm`, `td-figure`, `td-num`, `td-code` | Versalien-Label; große Zahl (29 px); kleinere Zahl (19 px); Zahl in Messing; feste Ziffernbreite; Raumcode in Mono |
| `td-banner` (`is-warn`, `is-error`, `is-ok`, `is-row`) | Hinweisstreifen, vertieft mit Marke links; `is-row` mit Knopf rechts |
| `td-tag` (`is-caps`, `is-ok`, `is-brass`, `is-warn`, `is-error`) | Kleines Etikett: Host, You, Ready, Optionswert, „capped“, Zähler einer Warteschlange |
| `td-diamond` (`is-sm`), `td-swatch` (`is-round`, `is-lg`, `is-line`), `td-legend`, `td-divided` | Raute als Aufzählung, Stufe, Strang; Farbmuster einer Legende (Punkt, Kartenfarbe mit Rand, Linie); beide färbt `--td-mark`, `[data-branch]` setzt sie global auf die Strangfarbe; Legende als schlichte Liste; Blöcke mit Haarlinien dazwischen |
| `td-trunc` | Eine Zeile mit Auslassungszeichen (in SCSS `ui.truncate`) |
| `td-kbd`, `td-link`, `td-kv`, `td-log`, `td-spin`, `td-sr-only` | Tastenkappe; Link (auch auf `<button>`); Schlüssel-Wert-Zeile (Wert `is-ok`, `is-warn`, `is-error`, `is-hot`, `is-muted`; Zeile `is-sub1..3`); Log in Mono; Drehen beim Laden; nur für Screenreader |

### Knöpfe

| Klasse | Rezept |
|--------|--------|
| `td-btn-primary` | Hauptknopf: dunklerer Stein, erhaben, Text Messing hell eingraviert; Hover heller, gedrückt 1 px tiefer. Eine Hauptaktion je Ort; Symbole nur am Hauptknopf |
| `td-btn-secondary` | Nebenknopf: Stein dunkler, Tiefe 3, Text gedämpft eingraviert, Hover Messing; `.is-on` eingedrückt |
| `td-btn-danger` | Wie Nebenknopf, roter Text; `.is-armed` eingedrückt (erster Klick auf Sell) |
| `td-btn-ghost` | Nur Text, dritte Aktion |
| `td-btn-sm` | Kleine Größe (30 px) zu einem der Knöpfe |
| `td-icon-btn` (`is-sm`) | Quadratischer Steinknopf mit Symbol (`--td-icon-btn` 32 px, klein `--td-icon-sm` 26 px); an bei `aria-pressed`, `aria-expanded`, `.is-on` |
| `td-close` | Schließen: gezeichnetes Kreuz (`td-icon name="close" size=12`), erhaben, 24 px, gedämpft, in der Kopfzeile |
| `td-tool` (`is-sm`), `td-tool-gap` | Eingraviertes Werkzeug ohne Platte (Kopfleiste, Zeilen; klein 26 px); eingeritzter Abstand zwischen Gruppen. Werkzeug und Textknopf zeigen einen Druck nur über die Farbe |
| `td-plate-btn`, `td-plate-label` | Steinplatte mit Name, Zeile und Kosten (Upgrade, Pfad); blitzt nach dem Kauf (`is-flash`, `is-flash-alt`), `is-locked` |

### Felder

| Klasse | Rezept |
|--------|--------|
| `td-field`, `td-label` | Feld mit Beschriftung darüber |
| `td-input` (`is-sm`, `is-code`, `is-group`, `is-error` / `aria-invalid`) | Vertieftes Feld 40 px, Fokus mit Messingrahmen (auch bei Maus); klein 30 px; Code in Mono-Versalien; Feld mit Symbol und Knopf darin (zeigt Fehler und Sperre seines Felds); Fehler mit dunkelrotem Rahmen. Zahlenfelder ohne Pfeile |
| `td-select` (`is-auto`) | Auswahlliste mit Messingwinkel; so breit wie ihr Inhalt |
| `td-error` | Meldung unter einem Feld mit Warnzeichen |
| `td-seg` (`is-compact`, `is-sm`, `is-stacked`) | Stufen: ein Knopf je Wahl, gewählt vertieft mit Messingtext; für Radiogruppen, Reiter, Umschalter; schmal, klein (30 px), zweizeilig (Name über einer Zeile) |
| `td-switch`, `td-check` | Schieber auf einer Checkbox (oder `<span>` mit `.is-on` in einem Umschalt-Knopf); Schieber mit Text, als `<label>` oder als Umschalt-`<button>` (ohne Knopfrahmen, Schriftgröße der Umgebung) |
| `td-slider`, `td-range-row` | Regler mit Skala, Messingfüllung bis zum Griff (Chromium per Border-Image des Griffs, Firefox `::-moz-range-progress`); Zeile aus Name, Regler, Zahl, Einheit |

### Listen und Tabellen

| Klasse | Rezept |
|--------|--------|
| `td-rows`, `td-row` | Zeilen 40 px mit Haarlinie; gewählt (`is-selected`, `aria-selected`) heller und erhaben mit Messingtext; `is-own` die eigene Zeile (Coop, weiche Mulde); `is-gone` ein Spieler, der ging (Name durchgestrichen, Linie gestrichelt); `button.td-row` ganz anklickbar |
| `td-row-main` | Hauptknopf einer Zeile mit Werkzeugen rechts (Speicherplätze, Favoriten) |
| `td-table` | Echte Tabelle im selben Look: schlichter Kopf, `tr.is-selected`, `tr.is-own`, `tr.is-gone` wie in Listen, `.num` rechtsbündig |
| `td-tiles`, `td-tile` (`is-label-under`) | Raster der Kacheln (Spalten legt die Komponente fest); Kennzahl-Kachel: Symbol, Zahl, Versalien-Label in einer Mulde, `is-label-under` wenn das Label im Markup vorn steht |

### Menü, Kopfleiste, Sidebar, Layout

| Klasse | Rezept |
|--------|--------|
| `td-menu`, `td-menu-item`, `td-menu-rule` | Hauptmenü: Einträge 48 px, 22 px/600, Symbol in Messing; Fokus und offene Seite (`aria-current`) als erhabene Steinplatte mit Messingtext, Tastaturfokus mit Ring; steht der Fokus woanders in der Liste, liegt die Platte der offenen Seite flach; Abstand 5 px |
| `td-topbar`, `td-stat`, `td-sunk`, `td-loc-label`, `td-loc-name`, `td-meter` | Kopfleiste in Basalt 48 px mit Plattenkante; Wert mit eingeritztem Trenner davor; vertieftes Ortsfeld mit eingeritzter Kante (als Knopf hellt Hover den Ort); „Defend“ dunkler in Versalien mit Trenner; Ort halbfett; Segmentbalken |
| `td-progress` (`is-edge`, `is-tick`, `is-teal`) | Fortschrittsbalken in einer Mulde, sein Kind ist die Füllung; `is-edge` 2 px an der Unterkante eines Knopfs oder einer Leiste; `is-tick` folgt einem Sekundenzähler; `is-teal` für eine laufende Welle |
| `td-globe-mark`, `td-globe-readout` | Weltkugel hinter dem Menü: Punkt und Name eines Ortes (Rekord und Favorit Messing, der ladende Ort Teal mit Ring, zuletzt gespielt matt), die Anzeige oben rechts in Versalien (Ziel Messing, Status Teal); beide mit dem Schatten `--td-over-image` über dem Bild |
| `td-marker`, `td-marker-btn` | Pfeil am Kartenrand: runde Platte, Ring und Symbol in `--td-mark` (Text `--td-mark-text`), `is-sm` 24 px; der Knopf darum gibt Fokus und Hover an die Platte |
| `td-side`, `td-side-section` (`is-fill`), `td-side-head`, `td-side-name`, `td-side-body` | Sidebar wie die Dialoge; Sektionen durch eingeritzte Linien getrennt, die letzte füllt und scrollt; Kopf mit Haarlinie; Name mit Ellipse (`is-armed` rot); scrollender Körper |
| `td-stack` (`is-loose`), `td-inline`, `td-actions` (`is-start`, `is-split`), `td-group`, `td-setting` | Spalte; umbrechende Zeile; Knopfreihe; Gruppe mit eingeritzter Linie vor der nächsten; Einstellung (Name links, Steuerung rechts) |
| `td-dense` | Dichte Variante: setzt Schrift-, Knopf-, Feld-, Zeilen- und Werkzeuggrößen per Token kleiner; alle Klassen darin werden kompakter, auch Dialogkopf, -körper, -fuß und Tabellenzellen (Debug-Fenster, Benchmark, Engine-Test) |

---

## Muster

### Dialog

MatDialog mit `panelClass: 'td-dialog-panel'`; die cdk-Schale ist durchsichtig, die Fläche zeichnet `td-dlg`.

```html
<div class="td-dlg">
  <header class="td-dlg-head">
    <h2 class="td-dlg-title" [id]="titleId">What's new</h2>
    <button class="td-close" type="button" aria-label="Close" (click)="close()">
      <td-icon name="close" [size]="12"></td-icon>
    </button>
  </header>
  <div class="td-dlg-body">...</div>
  <footer class="td-dlg-foot">
    <a class="td-btn-secondary" ...>Full changelog</a>
    <button class="td-btn-primary" type="button" (click)="close()">Got it</button>
  </footer>
</div>
```

```scss
// Layout of What's new: one group per release
.td-dlg { width: 560px; }
.td-dlg-body { display: flex; flex-direction: column; gap: var(--td-sp-4); }
```

Der Titel ist ein Name, kein Satz, und trägt die `id` für `ariaLabelledBy`. Breitere Dialoge setzen `width` und
`maxWidth` in der Config (Damage vs armor), weil das Overlay-Pane sonst auf 560 px begrenzt ist. Auf diesem Muster
stehen What's new, Attributions, Keyboard shortcuts, Damage vs armor, Runs, Run upload, der Token-Schritt, die Fehler-
und Verbindungs-Dialoge, Game Over und die Seiten des Hauptmenüs. Die Forschung ist dieselbe Fläche über den ganzen
Schirm.

Tooltips: Materials Tooltip als `td-popup` (`styles.scss`, `mat.tooltip-overrides`); der reiche Tooltip
(`tdRichTooltip`) ist eine `td-popup`-Karte. Der Update-Hinweis der Desktop-App liegt per `.td-update-hint-host` über
jedem Dialog.

### Seite, Gruppe, Einstellung

```html
<section class="td-group" aria-labelledby="td-set-audio">
  <h3 class="td-section" id="td-set-audio">Audio</h3>
  <label class="td-setting">
    <span>Start the next wave on its own</span>
    <input class="td-switch" type="checkbox" ...>
  </label>
</section>
```

Seiten des Menüs setzen ihren Host per `host: { class: 'td-stack is-loose' }`, Sidebar-Sektionen per
`host: { class: 'td-side-section' }`: so stehen die Hosts selbst als Geschwister in der Spalte, und die Linie zwischen
Sektionen greift.

### Über der Karte

Alles, was auf dem Canvas liegt (Fähigkeitenleiste, Replay-Leiste, Info-Overlay, Hinweisbox, Boss-Leiste, Chips,
Squad, Chat, Kompass, Pfeile am Rand), ist `td-overlay`: derselbe Putz wie die Panels, die Karte scheint leicht durch.
Knöpfe darauf sind dieselben Steinknöpfe.

---

## Game Over und Connection lost

Ein Dialog (`td-dlg`) über `td-backdrop`. Game Over: „HQ lost“ als eingravierter Titel, darunter Ort und Welle
(`td-note`), die [Bilanz](#game-over-bilanz), Coop-Tabelle (`td-table`, eigene Zeile in Messing) und Diagramme; der
Körper scrollt, Kopf und Fuß stehen. Im Fuß links „Save the run log“ (und im Coop „Save the replay“), rechts Main menu,
„Replay wave N“ (solange angeboten) und als Hauptknopf „Restart here“ (nur allein oder als Host). Connection lost:
derselbe Dialog mit „Start over alone“ und „Continue alone“. Einblenden steht bei `prefers-reduced-motion` still.

---

## UI-Layout

```
+------------------------------------------------------------------------------+
| KOPFLEISTE Logo | [Defend <Ort>] | Werkzeuge        [Gegner] HQ | Credits | Wave |
+------------------------------------------------------+-----------------------+
| Info-Overlay        [Game Speed]           Kompass   | SIDEBAR               |
|                                                      | Welle                 |
| [Held]                                               | Build, Tower oder     |
| [K]              3D CANVAS                           | Research              |
|                                                      |                       |
|                                  [Quick Actions]     |                       |
| Logos  Controls Hint                  Attribution    | Menu  Tips  Version   |
+------------------------------------------------------+-----------------------+
```

### Bereiche

| Bereich | Beschreibung |
|---------|--------------|
| **Kopfleiste** | Logo, Ortsfeld („Defend Straße, Stadt, Land“; der Name kommt aus `formatAddressShort`, höchstens 34 % der Fensterbreite, danach Ellipse; Klick öffnet die Menüseite New game), Werkzeuge (Link kopieren, Favoriten, Zufallsort, HQ versetzen, Spawn setzen, Spawn hinzufügen, Coop), rechts HQ, Credits und Wave, während einer Welle links davon die Gegnerzahl (siehe [Kopfleiste](#kopfleiste)) |
| **Canvas** | 3D-Spielfeld mit Google Photorealistic Tiles |
| **Sidebar** | Rechts: Welle, darunter Build, Tower-Detail, Held oder Research (siehe [Sidebar](#sidebar)) |
| **Info-Overlay** | Oben links: FPS, per Caret aufklappbar. Misst seine Unterkante (`ResizeObserver`, `UIStore.infoOverlayBottom`), die Fähigkeitenleiste bleibt darunter |
| **Game Speed** | Oben mittig, in Bauphase und Welle: Pause (`td-icon-btn`, gedrückt solange pausiert) und Tempo (`td-btn-secondary`, 1x, 2x, 4x reihum; über 1x gedrückt). In der Bauphase beschleunigt es die Forschung, die in Spielzeit läuft. Pausiert ein Chip „Paused“ darunter. In derselben Spalte (`.td-hud-top`) die Boss-Leiste; während eines [Boss-Intros](#boss-intro-canvas) blendet die Spalte aus (`.td-hud-muted`, 250 ms) |
| **Kompass** | Oben rechts, runde Platte; Klick setzt die Kamera zurück, der Knopf am Rand nach einer Drehung die Ausrichtung |
| **Fähigkeitenleiste** | Linker Rand: Held und ein Knopf je erforschter Fähigkeit, siehe [Fähigkeitenleiste](#fähigkeitenleiste-canvas) |
| **Controls Hint** | Unten mittig (LMB Pan, RMB Rotate, Scroll Zoom, WASD/Pfeile Move, H Shortcuts), verschwindet nach 15 s oder per Klick; solange ein [First-Run-Tipp](#first-run-tipps) steht, bleibt er weg |
| **Quick Actions** | Steinknöpfe unten rechts, siehe unten |
| **Sidebar-Fuß** | Menu (Zahnrad in Messing, Esc), Tips (die First-Run-Tipps von vorn), die Version (öffnet What's new), als stille Knöpfe über einer Haarlinie |

### Quick Actions und Entwicklermenü

Steinknöpfe (`td-icon-btn`) in einer Reihe, von links: Route-Animation, Settings (Menüseite), Photo Mode (O), Layers
(sieben Overlay-Schalter, die nach oben aufklappen: Route Grid, Gebäude, Straßen, Routen, Flughöhe der Air-Route, Air
Route Grid, Per-Tower-LOS-Filter), Kamera-Reset, Developer. Aktive Schalter und offene Menüs stehen gedrückt mit
Messingsymbol. Es ist immer nur eines der beiden Menüs offen (`UIStore.openMenu`, `toggleMenu()`).

Die Quick Actions reichen von unterhalb des Kompasses (`top: 112px`) bis 36 px über der Unterkante; die Knöpfe sitzen
unten, die leere Fläche darüber nimmt keine Klicks.

Das Entwicklermenü (`.qa-dev`) ist eine `td-overlay`-Leiste über der Reihe, rechtsbündig, 260 px breit, mit drei
Spalten Kacheln (`td-icon-btn` mit Symbol über einer Beschriftung in `td-caps`), gegliedert in Gruppen:

| Gruppe | Kacheln |
|--------|---------|
| Map | Height, Points, Recast, Dump |
| View & Panels | Camera, Frame, Display, Perf, LOS, Audio, DevWorld (nur mit `?devworld`) |
| Cheats | Kill, Credits, +HP, Research, Max Up, Abilities, Hero |
| Waves & Inspect | Waves, Bots, Towers, Enemies, Events, Cells, Snapshot |

Fenster offen oder Schalter an: gedrückt. Cheats haben keinen Aktiv-Zustand, Symbol und Text in der Farbe der Wirkung
(Kill und +HP rot, Credits Messing, Research und Max Up Teal, Abilities Orange, Hero Grün). Die Kacheln „+HP“ und
„Credits“ nehmen drei Eingaben (`debug-cheat-amount.ts`): Klick +1000 (Shift +100.000), Rechtsklick −10 (Shift −1000),
Mausrad ±100 je Raste (Shift ±1000). Die Höhe ist auf den Platz zwischen Reihe und Kompass begrenzt; bei niedrigem
Fenster scrollt die Leiste. Snapshot zeigt seinen letzten Stand als Statuszeile (`td-note`) unter der Gruppe; Inhalt
der Datei: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#__corridor-devtools).

**Zellbericht** (Kachel Cells, `app-cell-report-panel`): eine `td-overlay`-Leiste oben in der Mitte, 120 px unter der
Oberkante, mit Titel, Zahl der Zellen in `--td-cell-selection` (dieselbe Farbe wie die gewählten Zellen auf der Karte),
Bedienung, Notizfeld und Copy JSON (Hauptknopf), Clear, Done. Das Rechteck eines Shift-Ziehens ist ein gestrichelter
Rahmen in derselben Farbe. Bedienung und JSON: [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#__corridor-devtools).

### Boss-Leiste

Solange ein Boss lebt (`EnemyTypeConfig.isBoss`, oder ein Wurm über `worm:spawned`, dessen Balken alle Teile
zusammenzählt, zerfallen als „Skarnax ×3“), steht oben mittig `app-boss-bar`: eine `td-overlay`-Leiste,
`min(420px, 56vw)` breit, links der Name, rechts die HP („12,340 / 40,000“), darunter ein `td-progress` in
`--td-health-red`. Bei mehreren Bossen zeigt der große Balken den mit den meisten HP, die übrigen stehen als dünne
Balken darunter, höchstens vier, danach „+N“ (`boss-bar.ts`). Nimmt keine Klicks.

Bosse kommen über `enemy:spawned` in eine kurze Liste; ein 8-Hz-Timer außerhalb von Angular liest ihre HP und wirft die
heraus, die gestorben, durchgekommen oder entfernt sind. Das Signal ändert sich nur, wenn sich die Leiste ändert.

### Boss-Intro (Canvas)

Tritt ein Boss aus seinem Portal, schneidet die Kamera aufs Portal und `app-boss-intro` zeigt seinen Namen; Auslöser,
Pause und Zeitplan in [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-intro). Die Komponente liegt über dem Canvas (`z-index` 25)
und ist ohne Intro durchsichtig und klickdurchlässig.

- Schleier in `--td-panel-shadow`, blendet vor jedem Schnitt ein und danach aus (`BOSS_INTRO_TIMING`)
- Titelkarte im unteren Drittel über `--td-scrim-bottom`: „Boss, wave n“ (`td-caps` in Messing), der Name
  (`--td-fs-hero`, 700, Versalien, `--td-text-engraved`), der Beiname (`td-caps`), eine kurze eingeritzte Linie und
  „Esc or click to skip“ mit `td-kbd`
- Die Karte steigt 8 px auf und blendet ein; die Laufweite des Namens setzt sich in 0,9 s. Bei
  `prefers-reduced-motion` nur Deckkraft
- Bis die Sicht zurück ist, liegt ein durchsichtiger Knopf über der Fläche („Skip the boss intro“)
- Die Karte ist `aria-hidden`; der `LiveAnnouncer` sagt „Boss: <Name>, wave <n>. Escape skips.“

---

## Kopfleiste

`components/game-header/`: `td-topbar` in Basalt, 48 px, Plattenkante unten. Links das Logo (SVG), das Ortsfeld
(`td-sunk`: Ortsnadel in Messing, „Defend“ als `td-loc-label`, der Ort als `td-loc-name`; Hover färbt den Ort Messing),
dann die Werkzeuge als `td-tool` (eingraviert, gedämpft, 32 px, 4 px Abstand), Gruppen durch `td-tool-gap` getrennt.
Aktive Werkzeuge (Favoriten offen, HQ oder Spawn setzen) stehen in Messing.

Rechts HQ, Credits und Wave als `td-stat` ohne Platte, eingeritzte Linie zwischen ihnen: Symbol 20 px, Beschriftung in
Versalien (`td-caps`), Zahl `td-value` (29 px, 700). Ihre rechte Kante schließt mit dem Sidebar-Inhalt ab (rechtes
Padding `--td-sidebar-gutter`). Jede Zahl hält Platz für so viele Ziffern, wie `header-stats.ts` sie genau zeigt
(HQ 4, Credits 6, Wave 3, als `min-width` in `ch`), damit wachsende Werte die Nachbarn nicht verschieben.

| Wert | Zustände |
|------|----------|
| HQ | Zahl und zehn Segmente (`td-meter` an der Unterkante) in `--td-hp-text`, ein Segment je angefangenem Zehntel. Unter 30 % (`low`) Zahl `--td-hp-low` mit langsamem Puls (2,4 s), unter 10 % (`critical`) zusätzlich der Warnstreifen `--td-hazard` am Fuß. Verliert das HQ Gesundheit, blitzt der Wert 450 ms auf und ruckt 2 px (höchstens alle 300 ms) |
| Credits | Münze in Messing. Eine neue Summe zählt über 250 ms hoch. Jede Änderung steigt als „+25“ (`--td-gain`) oder „−150“ (`--td-loss`) 900 ms lang unter dem Wert auf, als `td-popup` über der Karte; Änderungen innerhalb von 250 ms addieren sich (`CreditsDeltaTracker`). Wird ein Kauf mangels Credits abgelehnt (`refuseForCredits()`), blitzt die Zahl 600 ms rot |
| Wave | Symbol in Teal; ein Teal-Balken an der Unterkante zeigt den Anteil der laufenden Welle, der weg ist. Startet eine Welle, leuchtet die Zahl 600 ms in Messing |

Reduced motion: Farben und Streifen bleiben, nichts bewegt sich. Jede Zahl muss in ihre Spalte passen, auch nach Cheats
(`header-stats.ts`): über einer Schwelle kurz über `formatCompact` („101k“); die kurze Zahl ist `aria-hidden`,
Screenreader lesen die exakte aus `td-sr-only`, der Tooltip ebenso. Hinter der HQ-Zahl steht das Maximum („/500“);
passt es nicht, fällt es ganz weg, bevor die Zahl gekürzt wird.

Die Gegnerzahl (`.enemies-chip`) erscheint nur während einer Welle, als `td-stat` in `--td-warn-text`.

### Favoriten-Menü

Das Lesezeichen-Werkzeug klappt ein `td-popup` auf (320 px): oben „Save this place“, darunter die Favoriten als
`td-rows`, ab `min(60vh, 440px)` scrollend. Zeile: `td-row-main` mit Name über den Koordinaten (Klick lädt), rechts vier
`td-tool` (hoch, runter, umbenennen, löschen; jeweils mit `aria-label`). Das Namensfeld (`td-input`) ersetzt beim
Speichern den Knopf, beim Umbenennen die Zeile; Enter speichert, Esc bricht ab, Tasten im Feld erreichen das Spiel
nicht. Klick außerhalb schließt. Ablauf: [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#favorites-system).

---

## Sidebar

`components/game-sidebar/`: `td-side`, wie die Dialoge. Die Panels sind eigene Components, ihre Hosts tragen
`td-side-section` (Build, Tower, Held, Research und Gebäude zusätzlich `is-fill`); zwischen zwei Sektionen eine
eingeritzte Linie. Köpfe sind `td-side-head` (Messing mit Haarlinie, Name und Werkzeuge in einer Zeile), der scrollende
Rest `td-side-body`.

| Component | Inhalt |
|-----------|--------|
| `wave-panel/` | Gegnergruppen der laufenden Welle, Warnungen, Wellen-Knopf, Optionen darunter, die Zeitleiste „Next“ |
| `build-panel/` | Kopf „Build“ mit Damage vs armor, Karten (`td-card`) im 2er-Raster, im Build-Mode Hinweis und Cancel, „Research tree“ fest darunter |
| `tower-panel/` | Kopf mit Name, Sell und Damage vs armor; sieben Kennzahlen (`td-tile`, drei über vier); Veteranenrang; Zielwahl als `td-seg`; Upgrades und Pfade als `td-plate-btn` |
| `hero-panel/` | Kopf mit Name und Stufe, Weg zur nächsten Stufe (`td-progress`), drei Kennzahlen, Munition als `td-seg` mit zwei Zeilen, Hinweis mit `td-kbd` |
| `building-panel/` | Kopf mit Name und Sell, Beschreibung, je Fähigkeit eine `td-row` mit Name, Taste und Zustand |
| `research-panel/` | Kopf mit „Research Center, level n“ und Sell, Zusammenfassung, laufende Forschungen (Mulde mit `td-progress` und Abbrechen), „Research tree“ als Hauptknopf (das Einzige, wofür dieses Panel da ist), Upgrades |

Eine Upgrade-Platte, die gerade nicht kaufbar ist, bleibt klickbar (`aria-disabled`): der Klick kauft nichts und nennt
den Grund wie U ([Tastenkürzel](#tastenkürzel)). Verkaufen braucht zwei Klicks ohne Dialog: der erste setzt Sell auf
`is-armed` und den Namen im Kopf auf „Click again to sell“ (`td-side-name is-armed`), der zweite innerhalb von 2,5 s
verkauft (`SellConfirmService`).

### Wellen-Knopf

`td-btn-primary` über die ganze Breite, zugleich Kopf der Sektion: links Symbol und „Wave N“, rechts die Tastenkappe
„Space“ (`aria-hidden`, die Taste steht in `aria-keyshortcuts`). Der Name für Screenreader sagt die Aktion.

| Zustand | Auslöser | Darstellung |
|---------|----------|-------------|
| Bereit | keine Welle | Hauptknopf |
| Gesperrt | Game Over | gesperrt, ohne Tastenkappe |
| Countdown | Auto-Start an, Welle vorbei | rechts „{n}s“, unten ein 2 px-Balken in Messing, der mit der Wartezeit schrumpft; ein Klick startet sofort |
| Coop bereit | dieser Spieler sagte bereit | `.is-on`, Haken, `aria-pressed` |
| Welle läuft | `waveActive()` | `is-busy` und gedrückt (`aria-disabled`, behält den Fokus), Text Teal, rechts „{n} left“, unten ein Teal-Balken mit dem Anteil der Gegner, die noch kommen |

Darunter links der Schalter „Auto start in 10 s“ (`td-check` mit `td-switch`, ein Knopf mit `aria-pressed`; im Coop nicht
da, die Spieler sagen bereit), rechts zwischen den Wellen „Replay wave N“ und „Load replay“ als `td-link`. Der Countdown
läuft in Spielzeit, beginnt nach `wave:completed`, jeder Wellenstart, Game Over und ein Neustart beenden ihn; Zahl und
Balken liefert `waveButtonView()` aus `GameStore.autoWaveSecondsLeft`. Ein Start aus dem Build-Mode lässt den Build-Mode
an.

### Wellenwarnung

Bringt die nächste oder übernächste Welle Lufteinheiten, ätherische oder getarnte Gegner mit, steht in der Bauphase
über dem Knopf je Art ein `td-banner is-error is-row` (`wave-panel/wave-alert.ts`): Symbol (Flugzeug rot, Geist in
`--td-ethereal`, durchgestrichenes Auge für Camo), Art und Welle als Titel mit „next wave“ oder „in 2 waves“, darunter
die Abwehr („N towers hit air“, „N scouts“, oder als Warnung „No tower hits air yet“, „No scout yet“). Gezählt werden
gebaute Tower, die laut `canTargetAirEffective` Luft treffen, laut `isAntiEtherealTower` ätherisch verletzen bzw. Tarnung
aufdecken; der Tooltip nennt sie. Beim ersten Erscheinen spielt je Art ein kurzer Ton (`UI_SOUNDS.airAlert`,
`etherealAlert`, `camoAlert`, synthetisiert in `utils/alert-tone.ts`, mit SFX-Lautstärke).

### Next (Zeitleiste)

Unter den Optionen die nächsten fünf Wellen (`wave-panel/wave-timeline.component.*`, Daten aus `upcoming-waves.ts`):
Kopf „Next“, eine eingeritzte Linie durch die Marken (je Welle eine Raute, darunter die Nummer, darüber Symbole:
Totenkopf in Messing für Boss-Wellen, Flugzeug für Lufteinheiten, Mond in Rot für Blutmond-Wellen). Die erste Marke ist
die Welle, die der Knopf als Nächstes startet. Darunter eine Mulde (`td-well`) für eine Marke: die unter dem Zeiger oder
mit dem Fokus, sonst die zuletzt geklickte, sonst die erste; diese Marke ist gefüllt (Messing, `aria-pressed`). Oben der
Name (Boss in Messing hell), rechts ein Mutator; unten „N enemies“, „Air“, die Rüstung, rechts „weak“ und die
Schwächen als Symbole der Schadensarten in Messing (`DAMAGE_TYPE_ICON`). Der Tooltip ist eine reiche Karte mit Gegnern,
HQ-Kosten, Bannern je Mutator und den Kontern je Rüstung.

- Anzahl: die Zahl, die die Quelle für diese Welle nennt (`count` aus `upcoming-waves.ts`), sonst keine
- Weak to: die Schadensarten mit dem besten Multiplikator gegen die HP der Welle (`bestDamageTypesAgainst`)
- Kennt die Quelle eine Welle erst bei ihrem Start, zeigt die Mulde deren Notiz (`peek.note`; beim Budget-Source „HP
  set against the defense when the wave starts“)

### Helden-Panel

Steht, solange der Held gewählt ist, an der Stelle des Tower-Details (`heroPanelView()`). Solange er gewählt ist, zeigt
die Hinweisbox „Click Send“, „V Ammo“, „G Camera“, „Esc Let go“ und die Warnung „No route within 30 m“. Auf der Karte:
Ring unter ihm, kleinerer auf seinem Posten, Bewegungsring unter dem Zeiger in Messing auf dem Routenpunkt, rot ohne.

### Veteranen-Rang

Tower sammeln mit Kills kosmetische Ränge ([TOWER_CREATION.md](TOWER_CREATION.md#veteranen-ränge)). Das Tower-Panel
zeigt den Rang in einer Mulde zwischen Kennzahlen und Zielwahl: Abzeichen (Winkel, zwei Winkel, drei Winkel, Stern),
Rangname in Versalien, rechts „57 / 150 kills“, darunter ein `td-progress`. Bis Elite in Silber
(`--td-text-secondary`), ab Champion in Messing; unter dem ersten Rang gedämpft. Werte aus `veteranView()`. Über dem
Tower in der Welt steht dasselbe Abzeichen (`TowerBadgeRenderer`, Farben aus `TD_THEME`).

---

## Forschungsbaum (Dialog)

`components/research-dialog/` über `openResearchDialog`, Vollbild (`panelClass: ['td-dialog-panel',
'td-research-panel']`). Erreichbar über den Knopf im Panel des Centers, „Research tree“ unter dem Build-Raster und Q.

Eine Putzfläche (`td-panel`) über den ganzen Schirm. Kopf: eingravierter Titel, „Researched n/21“ mit einem Segment je
Forschung (erforscht grün, laufend Messing), Slots, Credits (Messing), Schließen. Darunter die Rubrik („Tower tech“; im
Coop davor Reiter je Spieler als `td-seg`). Das Brett liegt vertieft (`--td-tree-well`, `--td-well-shadow`) mit der
Tier-Spalte links; rechts Warteschlange und Detail mit Köpfen wie in der Sidebar (`td-head`); unten Legende und die
Zählung je Strang (`td-tag` mit Raute in der Strangfarbe).

Der Graph ist `components/tech-tree/`, eine darstellende Komponente ohne Fachwissen. Geometrie aus
`utils/dag-layout.ts`. Knoten sind Steinplatten (`--td-raised-quiet`, Radius `--td-radius`) mit dem Symbol in einer
Mulde; Zustand und Strang tragen Information und kommen aus eigenen Tokens:

| Zustand | Aussehen |
|---|---|
| `completed` | `--td-node-done`, Rand `--td-node-done-edge`, grüne Marke links, Fuß grün |
| `active` | `--td-node-active`, Rand Teal, Restzeit und `td-progress` |
| `queued` | gestrichelt in Messing dunkel, Position als `td-tag` in der Ecke |
| `available` | Messingmarke links, Kosten in Messing hell, Hover hebt um 1 px |
| `poor` | dieselbe Form, wärmer (`--td-node-poor-*`), Kosten in Warnfarbe |
| `pending`, `locked` | versenkt (`--td-node-locked`) |

Die Marke links zeichnet ein `::before` aus `--node-mark`. Kanten: `done` grün, `active` Teal wandernd, `open` Messing,
`pending` Teal gestrichelt, `locked` grau gestrichelt; zeigt der Zeiger auf einen Knoten, leuchtet die Kette bis zur
Wurzel in Messing und alles andere blendet auf 30 % ab. Das Brett scrollt in beide Richtungen und lässt sich ziehen
(`tech-tree/drag-scroll.directive.ts`).

---

## Fähigkeitenleiste (Canvas)

`app-ability-bar`: eine `td-overlay`-Leiste am linken Rand, direkt unter dem Info-Overlay. Oben der Held, sobald es
einen gibt, eine eingeritzte Linie, dann ein Knopf je Fähigkeit, deren Forschung fertig ist und deren Abschussort steht
([ABILITIES.md](ABILITIES.md#fähigkeitenleiste)). Rand, Innenabstand, Knopfgröße und Abstand kommen aus `ABILITY_BAR_PX`
(`ability-button.ts`) als Host-Bindings; die Pfeile am Kartenrand rechnen mit `ABILITY_BAR_EDGE_PX`. Ist das Spielfeld
zu niedrig, schrumpft die Leiste und scrollt ohne sichtbare Scrollbar.

Knopf: `td-icon-btn`, 44 px, oben rechts die Taste (`td-caps`), unten ein Strich je Welle bis zur nächsten Ladung
(Messing, sobald die Welle geschafft ist); mehr als eine Ladung oben links als `td-figure`.

| Zustand | Darstellung |
|---------|-------------|
| Bereit (geladen, Welle läuft) | Symbol Messing hell |
| Zielt | gedrückt (`aria-pressed`) |
| Wartet (keine Welle) | Symbol gedämpft |
| Unterwegs | Symbol in Warnfarbe |
| Lädt | Symbol gesperrt, die Striche zählen |

Der Held-Knopf ist ein Schalter, gedrückt solange gewählt; bis zum Anheuern als Münze. Ohne Wirkung bleibt ein Knopf
klickbar (`aria-disabled`), die Hinweisbox nennt den Grund ([Ablehnung](#hinweisbox)). Der Tooltip (`tdRichTooltip`)
trägt Name, Zustand, Tastenkappe, Ladungen und Beschreibung (`abilityTooltip()`). Auf der Karte ist der Zielring Messing,
wo der Schlag landen würde, rot, wo er abgelehnt würde.

---

## Coop: Dock, Squad, Chat (Canvas)

Plan [COOP_PLAN.md](COOP_PLAN.md) C8, überarbeitet nach [COOP_UI_REWORK_PLAN.md](archive/COOP_UI_REWORK_PLAN.md).
Lane-Farben aus `SPAWN_COLORS` wie auf der Karte, als CSS über `laneCss()`. Dazu `app-ping-bars` (vier Balken, Grenzen
40/90/160 ms, Orange bei Lag) und `chatView()`.

Ein Knopf, der gerade nichts tut, trägt `aria-disabled` statt `disabled`, sonst erschiene sein Tooltip mit dem Grund nie.
Tasten: Tab (Dock), Enter (Chat) und X (Markierung) hört `app-coop-chat` auf dem Dokument; ob der Fokus von der Tastatur
kam, sagt `FocusOrigin` (`utils/keyboard-target.ts`). Stapelung über `--td-z-marks`, `--td-z-hud`, `--td-z-dock`.

| Teil | Ort | Inhalt |
|------|-----|--------|
| Raum-Chip | Kopfleiste, nach den Werkzeugen | Code (`td-code`), ein Quadrat je Spieler in seiner Lane-Farbe, `n/4`; öffnet das Dock |
| Dock `app-coop-dock` | rechts neben der Fähigkeitenleiste, 440 px, im Raum 860 px | `td-panel` mit Dialogkopf und -fuß. Beim Beitritt die Schritte (`td-rows`, der laufende gewählt); im Raum Code, Einladung, Sperre und Listing (Schalter), Status als `td-banner` mit `td-meter`, eine Warnung (weitere hinter „+n“), Raumtabelle, Optionen, Chat als zweite Spalte (`td-line-left`); Fuß: Leave (Gefahr), mehr (`td-popup`), Start match oder Ready up |
| Menüseite Coop `app-coop-ways` | Hauptmenü | Name, Lobby, dann Host online, Join online (Codefeld `td-input is-code`, Räume als `td-table`), Same network (nur App) |
| Raumtabelle | im Dock | eine `td-row` je Lane (48 px): Farbbalken, Lane mit Länge, Spieler (Name, `td-tag` Host und You, was sein Client tut), Ready, Ping, Werkzeuge (`td-tool`). Freie Lanes „Free, take it“ als `td-link` |
| Squad `app-coop-squad` | unten über der Logo-Zeile | `td-overlay`: Kopf mit Code oder Problem, „Cheats on“ (`td-tag is-warn`), Einklappen; Zeilen 36 px, man selbst zuerst; Geschenk-Leiste; Fuß: auf wen die Welle wartet |
| Chat `app-coop-chat` | unter der Squad-Box | `td-overlay`-Streifen: Verlauf, offenes Feld, Markier-Hinweis, Tastenzeile bis zur ersten eigenen Nachricht |

---

## Hauptmenü

Ein Menü für alles, was nicht Spielen ist (`components/main-menu/`, Plan [MAIN_MENU_UI_PLAN.md](MAIN_MENU_UI_PLAN.md)),
als Overlay über dem ganzen Fenster, Rolle `dialog` mit dem Namen der Seite, Fokusfalle. Hintergrund `td-backdrop`.

- **Start** (vor einem Lauf, bei jedem Ortswechsel): Logo 240 px, „Tower defense on real streets“, die Liste auf einer
  Putzplatte (`td-panel`, 320 px) darunter; unten links ein Feldtipp und die Version, unten rechts die Ladeplatte.
  Kopfleiste und Sidebar sind ausgeblendet.
- **Pause** (Esc, Zahnrad im Sidebar-Fuß, „Main menu“ am Game Over): kleineres Logo, über der Liste „Paused | Ort | wave n“
  (im Coop „Coop“ statt „Paused“).

Die Liste (`pages/home`) ist ein `role="menu"` aus `td-menu-item` mit Symbol je Eintrag (`HOME_ENTRY_ICON`), ein
Tab-Halt, Pfeile wandern ohne zu wählen (`tdRovingGroup`), der Zeiger nimmt den Fokus mit. Der Eintrag mit dem Fokus und
der der offenen Seite stehen als Steinplatte. Continue und Play tragen darunter, was sie spielen, und während der Ort
lädt einen dünnen Messingbalken. Rückfragen (Autosave an anderem Ort, Restart, Quit) stehen als `td-banner is-warn`
in der Platte unter den Einträgen. Unter einer eingeritzten Linie in der Pause New game, Coop, Restart here, Quit.

Eine Seite öffnet als `td-dlg` rechts neben der Liste, mit Titel und Schließen-Kreuz („Back (Esc)“). Esc geht eine Seite
zurück, auf der Liste der Pause zurück ins Spiel.

Weltkugel (`components/globe-backdrop`, [GLOBE_PLAN.md](GLOBE_PLAN.md)): hinter der Start-Lage die Erde, ihr Mittelpunkt
17 % der Breite rechts der Mitte, unter `td-backdrop`; Ortsmarken `td-globe-mark`, oben rechts `td-globe-readout`
(„Target | Ort“, Koordinaten, „Alt … km | Status“). Reine Kulisse, keine Eingabe.

Ladeplatte (`loading/menu-loading`): `td-panel` mit Ort als Titel, Prozent, `td-meter` mit zehn Segmenten, laufender
Schritt mit „4 of 10“, „Show steps“. Ein Fehler steht statt des Balkens als `td-banner is-warn` mit Retry, Other place
und (bei Engine-Fehler) Map key.

### Menüseiten

Die Hosts der Seiten tragen `td-stack is-loose`; Inhalt aus `td-group`, `td-section`, `td-setting`, `td-rows`, `td-seg`.

- New game (`app-place-picker`): Warnung bei laufendem Lauf; Search (Adresssuche als `td-input is-group`, Links
  Coordinates, Use my location, Roll a random city, Move the spawn), nach einer Wahl Spawn und „Load place“; darunter
  Reiter Recent, Favorites, Showcase, World und die Liste, World mit Globus
- Save und Load (`app-save-slots`): Slots als `td-row` mit `td-row-main` und Werkzeugen, Rückfragen ersetzen die Liste
- Settings (`app-settings-sections`): Audio (Regler mit Wert und Stumm-Knopf), Graphics (Preset als Stufen, Schalter in
  zwei Spalten, Color grading, Frame limit, Fullscreen), Gameplay, Map, Coop (Name, Lobbys), Privacy
- Extras (`app-extras-list`): Zeilen in Gruppen (Replays and runs, The game, About)
- Coop (`app-coop-ways`, im Browser der Website nur `app-coop-app-hint`)

---

## Hinweisbox

`app-context-hint`: eine `td-overlay`-Leiste unten mittig. Optional Titel mit Zähler, Text, eine Warnung (Rand in
`--td-danger-edge`, Text `--td-error-text`, Versalien), die Tasten als `td-kbd` mit Beschreibung, Aktionen als
`td-btn-ghost td-btn-sm` hinter einer eingeritzten Linie. Mit Aktionen nimmt die Box Klicks an. Nur Tasten ohne Text
(die Kamera-Tasten am Anfang) stehen in einer Zeile mit dem Knopf. Das Spiel zeigt immer nur eine Box: Ablehnung vor
Build-Modus vor Platzierungsmodus vor Zielmodus vor gewähltem Helden vor First-Run-Tipp.

```html
<app-context-hint [hints]="[{ key: 'R', description: 'Rotate' }]" [warning]="validationError" />
```

**Ablehnung** (`RefusalHintService`): tut ein Druck auf eine Fähigkeit oder den Helden nichts, steht 2,5 s eine Box mit
dem Namen als Titel und dem Grund als Warnung („Only during a wave“, „No charges, recharges in 3 waves“, „Need 600
credits“). Gründe, auf die der Spieler nichts tun kann, zeigt sie nicht.

### First-Run-Tipps

Sieben kurze Tipps in der Hinweisbox, entlang des Spielablaufs (Tower bauen, erste Welle, Upgrade, Research Center,
Forschung, Fähigkeit, Held). Zustandsmaschine in `services/onboarding/onboarding.ts`, Zustand in `OnboardingService`
(localStorage `td_onboarding_v2`). Ein Tipp verschwindet, wenn der Spieler tut, was er sagt, oder per „Skip“; „Hide
tips“ beendet alle; spätere Tipps warten auf ihren Moment. „Tips“ im Sidebar-Fuß startet sie von vorn, ohne die Schritte,
die das laufende Spiel schon getan hat. Die Tipp-Box sitzt über dem Band der Pfeile am Kartenrand.

---

## Weitere Teile über der Karte

| Teil | Darstellung |
|------|-------------|
| Leck-Vignette `app-leak-vignette` | `--td-leak-vignette`, 650 ms, höchstens alle 900 ms (`PulseThrottle`), `z-index` 4 |
| Blutmond `app-blood-moon-banner` | `td-chip` mit rotem Rand, 18 % unter der Oberkante: Mond, „Blood Moon“, „Wave N“ mit Mutator; 3,6 s, `aria-hidden` (der `LiveAnnouncer` sagt es). Wartet ein Boss-Intro ab ([WAVE_SYSTEM.md](WAVE_SYSTEM.md#blutmond-wellen)) |
| HQ-Umzug `app-relocation-status` | `td-chip` an derselben Stelle: Nadel in Messing, „Moving HQ“, Schritt mit Prozent, ein 2 px-Balken in Messing an der Unterkante; `role="status"` |
| Pfeile am Rand `app-offscreen-indicators` | runde `td-overlay`-Platten mit Chevron, rot (Gegner nahe am HQ), Messing und größer mit Boss; die Zahl als kleiner Chip zur Bildmitte. Klick fährt die Kamera hin. Logik in `utils/offscreen-indicators.ts`, 8-Hz-Timer außerhalb von Angular |
| Ping-Pfeile `app-coop-ping-arrows` | runde Platten mit Rand und Chevron in der Farbe des Spielers, sein Name als Chip darunter |
| Sichtlinien-Legende `app-los-legend` | `td-overlay` mit einer Farbfläche je Zustand |
| Spurlängen `app-lane-length-panel` | `td-overlay` unter dem Kompass, solange ein Spawn gesetzt wird: je Lane Farbe, Länge, Balken |
| Update-Hinweis `app-update-hint` | `td-overlay` im CDK-Overlay über allem: „Update ready“, Notizen, Restart now (Hauptknopf), Later |
| Turmsteuerung `app-tower-control-hud` | Fadenkreuz als SVG (Striche auf dunkler Unterlage, `--td-reticle`, Messing auf einem Ziel), Trefferkreuz (Kill rot und größer), Nachladering per `stroke-dasharray`; unten eine `td-overlay`-Zeile mit Tower-Name und Tasten. Regeln in [TOWER_CONTROL.md](TOWER_CONTROL.md) |
| Photo Mode | `td-overlay`-Leiste oben mittig: Save screenshot (Hauptknopf), Exit mit Esc. Der Screenshot stempelt Logos, Attribution (Streifen in `TD_THEME.panelMain`, Text `--td-text-muted`, Schrift `TD_FONTS.ui`) und das Zeichen des Spiels (`stampScreenshot`) ins Bild |
| Kartenattribution | `td-overlay td-note` unten rechts |

### Replay der letzten Welle

Technik in [REPLAY.md](REPLAY.md). Einstieg über „Replay wave N“ unter dem Wellen-Knopf oder im Fuß von Game Over. Die
Leiste unten mittig (bis 760 px) ist `td-overlay` mit zwei Zeilen: oben „Replay“ mit Pfeilen zur vorigen und nächsten
Welle (`td-tool`), „Wave N“ in Messing, HQ und Gegner im gezeigten Moment, Save und Exit; unten Play/Pause
(`td-icon-btn`), der Fortschritt als `td-slider` mit Marken in Teal an den Befehlen des Spielers, die Zeit und die
Geschwindigkeiten als `td-seg is-compact`. Tab bleibt in der Leiste.

---

## Debug-Fenster

Alle Debug-Fenster nutzen `app-draggable-debug-panel`: ein `td-dlg td-dense`, verschiebbar am Kopf, in der Größe änderbar
am Griff unten rechts, Position und Größe in `localStorage` (`DebugWindowService`, `DEFAULT_POSITIONS`, `DEFAULT_SIZES`,
Mindestgröße `DEBUG_PANEL_MIN_SIZE`). Inhalt aus `td-group`, `td-section`, `td-kv`, `td-range-row`, `td-seg`,
`td-check`, `td-log`, Knöpfen und Feldern des Systems, dicht gesetzt. Logs, die mitwachsen sollen, als Flex-Spalte mit
`height: 100%`, dem Log `flex: 1; min-height: 0`. Benchmark und Engine-Test nutzen dieselbe dichte Variante, das
DevWorld-Panel dieselben Klassen.

---

## Tastenkürzel

Zuordnung in `services/hotkey-map.ts` (`resolveHotkey`), ausgeführt vom `HotkeyService` nach dem `InputHandlerService`
(Kamera, Build- und Platzierungsmodus, Debug-Tasten). Hotkeys ruhen, während getippt wird, ein Dialog oder das
Hauptmenü offen ist oder das Spiel lädt; Strg/Alt/Meta und gehaltene Tasten lösen nichts aus, außer Strg+U.

| Taste | Aktion | Prüfung wie |
|-------|--------|-------------|
| 1 bis 9 | Karte an dieser Stelle im Build-Panel wählen | Karten-Button (`canPickTowerCard`) |
| U | Erstes bezahlbares, freigeschaltetes Upgrade des gewählten Towers; über dem Tower steigt der Track mit neuer Stufe auf, die Platte blitzt. Kauft U nichts, steigt der Grund auf (Warnfarbe) und über den Platten steht 2,5 s ein `td-banner is-warn`. Ein Klick auf eine Upgrade-Platte antwortet genauso | Upgrade-Platten (`TowerUpgradeService`, `UpgradeHintService`) |
| Entf / Backspace | Verkaufen, zweimal drücken | Sell (`SellConfirmService`) |
| Leertaste | Nächste Welle | `store.canStartWave` |
| Shift+U / Strg+U | Mehrere Upgrades nacheinander (`UPGRADE_MANY`) | wie U |
| P | Pause | Pause-Knopf |
| M | Ton an/aus | Stumm-Knöpfe in Settings |
| + / = / - | Geschwindigkeit hoch, runter (1x, 2x, 4x) | `stepGameSpeed` |
| H / ? | Übersicht als Dialog | |
| Pos1 | Kamera zum HQ | nicht im Intro-Flug |
| N | Kamera zum nächsten Spawnpunkt, reihum | nicht im Intro-Flug |
| Taste der Fähigkeit (K für den Nuclear Strike, [ABILITIES.md](ABILITIES.md)) | Zielmodus an, nochmal aus; kann sie nicht feuern, nennt die Hinweisbox den Grund | Knopf der Fähigkeitenleiste |
| G | Held wählen, gewählt: Kamera zu ihm | Held-Knopf |
| V | Nächste Munition | Munition im Helden-Panel |
| O | Photo Mode | Quick Actions |
| Q | Forschungsbaum; still ohne Research Center | Knopf im Build- und Research-Panel |
| C | In den gewählten Tower steigen, im Tower: aussteigen | Gamepad-Knopf der Zielwahl |
| Esc | Photo Mode verlassen, sonst Quick-Menü schließen, sonst Verkauf abbrechen, sonst Held loslassen, sonst Tower abwählen | |

Während eines Boss-Intros überspringt Esc das Intro, alle anderen Spieltasten warten. Während des Intro-Flugs ebenso
(`IntroCameraFlightService.handleKeyDown`). Im Replay steuern Leertaste und P die Pause, + und - die Geschwindigkeit,
Esc führt zurück (`HotkeyService.runInReplay`). Im bemannten Tower wirken nur Leertaste, P, +/-, M, C und Esc
(`HotkeyService.runInTower`). Die Übersicht (`components/hotkey-help-dialog/`) liest `HOTKEY_HELP` aus derselben Datei.

---

## Damage-vs-Armor-Dialog

`components/damage-matrix-dialog/`, geöffnet über das Info-Werkzeug im Build- und Tower-Kopf der Sidebar; aus dem
Tower-Kopf ist die Zeile des gewählten Towers hervorgehoben (heller Stein, Name in Messing).

- Liest nur Configs (`DAMAGE_MATRIX`, `EFFECTIVENESS_THRESHOLDS`, `EFFECTIVENESS_COLORS`); die Stufenfarben sind Daten
  (`--tier-color` je Zelle). `weak` und `normal` nur als Textfarbe, `strong` und `devastating` gerahmt, `devastating`
  getönt und fett
- `td-table` mit festem Layout, Kopf sticky, darunter die Gegner je Rüstung als leise Zeile; Tower-Spalte mit Name und
  Schadensart (Marke in `DAMAGE_TYPE_UI.color`). Legende links im Fuß
- Nur freigeschaltete Tower, reaktiv; solange Tower gesperrt sind, „More towers unlock through research.“
- Breite `min(880px, 92vw)` über die Dialog-Config. Esc schließt nur den Dialog (`isEscapeForDialog`)

---

## Game-Over-Bilanz

`components/run-summary/` im Game-Over-Dialog (`runSummary` aus dem Run-Log, `GameStore.runSummary`):

- Kennzahlen als fünf `td-tile`: Wave, Kills, Time, Earned, Spent (Zahl `td-value` über dem Label)
- Leaks per wave: ein Balken je Welle in `--td-hp-text`, Höhe relativ zur schlimmsten Welle; Wellen ohne Leak als
  dünner Strich. Der Tooltip nennt Leaks und HQ-Schaden
- Top towers by damage als `td-table` (verkaufte mit „sold“)

Hat der Lauf den Rekord des Ortes geschlagen, steht darunter `app-world-record` hinter einer eingeritzten Linie: Globus
auf den Ort gedreht, „World map“, „New record for <Ort>: wave N“, „Best before: wave M“ oder „First run here“, Skip. Er
blendet 1,2 s nach dem Dialog ein. Details: [LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#weltkarte-beste-welle-je-ort).

---

## Regeln

1. **Werte nur aus Tokens, Look nur aus Klassen.** Ein Komponenten-Stylesheet legt nur aus; die Spec hält das
2. **Eine Hauptaktion je Ort** als Hauptknopf; alles andere Nebenknopf, Werkzeug oder Link
3. **Messing ist der Akzent**: Köpfe, Werte, Hauptaktion, Gewähltes. Teal für Laufendes, Rot nur für Gefahr
4. **Flächen statt Kästen in Kästen**: ein Panel, darin Köpfe, eingeritzte Linien, Mulden
5. **Titel sind Namen**, eingraviert; Labels in Versalien ab 11 px; Trenner in einer Zeile „ | “, keine Mittelpunkte, keine Emoji
6. **Bewegung kurz** (120 bis 450 ms), bei `prefers-reduced-motion` nur Farbe
7. **Daten dürfen färben**: Stufen, Lanes, Schadensarten, Zustände des Baums kommen als Wert aus dem Code oder als
   eigener Token, nicht als Literal im Stylesheet

---

## Accessibility

Fokus: 2 px `--td-focus-color` mit 2 px Abstand bei `:focus-visible`, global für Knöpfe, Links, `summary` und
`[tabindex]`; Felder zeigen ihn als 2 px-Rahmen innen auch bei Maus (`forms.focus-edge`); Menüeinträge als Steinplatte
und für die Tastatur mit Ring. Plattenknöpfe und Karten, die in scrollenden Sektionen liegen, zeichnen den Ring innen,
damit er nicht abgeschnitten wird. Kein `outline: none` ohne Ersatz. Overlays mit `aria-modal` halten den Fokus
(`cdkTrapFocus`). Gewählte Zeilen und Menüplatten hellen gedämpften Text auf. Kontraste prüft
`td-theme.contrast.spec.ts`.

### Icon-Buttons

`matTooltip` setzt nur `aria-describedby`, keinen Namen. Reine Icon-Buttons brauchen zusätzlich einen englischen Namen:

- `aria-label`, in der Regel mit dem Tooltip-Text; dynamisch per `[attr.aria-label]`
- Umschalter mit sichtbarem Aktiv-Zustand: `[attr.aria-pressed]` (das Rezept zeigt ihn gedrückt)
- Buttons, die ein Menü aufklappen: `[attr.aria-expanded]`
- Radiogruppen und Reiter tragen `tdRovingGroup` (`components/roving-group.directive.ts`)

`td-icon` rendert ohne `ariaLabel` ein `role="presentation"`-SVG.

---

## Dateien

| Datei | Beschreibung |
|-------|--------------|
| `src/app/styles/td-theme.ts` | Tokens (`TD_THEME`, `TD_MATERIALS`, `TD_RELIEF`, `TD_TINT`, `TD_FONTS`, `TD_TYPE`, `TD_SPACE`, `TD_SIZE`, `TD_DENSE`, `TD_MOTION`, `TD_LAYOUT`, `TD_LAYERS`, `TD_CSS_VARS`, `installThemeVars`) |
| `src/app/styles/ui/_base.scss` | Bewegung, Fokus, eingeritzte Linien, Scrollbar, `sr-only`, Spinner |
| `src/app/styles/ui/_surface.scss` | Panel, Leiste über der Karte, Chip, Popup, Dialog, Titel, Linie, Köpfe, Mulde, Karte |
| `src/app/styles/ui/_buttons.scss` | Haupt-, Neben-, Gefahr-, Textknopf, Icon-Knopf, Werkzeug |
| `src/app/styles/ui/_forms.scss` | Feld, Label, Eingabe, Auswahl, Textfeld, Fehler, Stufen, Schalter, Regler |
| `src/app/styles/ui/_lists.scss` | Zeilen, Zeilenkopf, Hauptknopf der Zeile, Tabelle |
| `src/app/styles/ui/_menu.scss`, `_hud.scss`, `_sidebar.scss`, `_text.scss`, `_layout.scss` | Menü; Kopfleiste, Werte, Balken; Sidebar, Kacheln, Plattenknopf; Text, Banner, Etikett, Tastenkappe, Schlüssel-Wert; Layout |
| `src/app/styles/ui/_classes.scss` | Alle `td-*`-Klassen, die dichte Variante, globale Regeln |
| `src/app/styles/_game-ui.scss` | Leitet die Rezepte weiter (`@use ... as ui`) |
| `src/app/styles/design-system.spec.ts`, `td-theme.contrast.spec.ts` | Wächter des Systems, Kontraste |
| `src/styles.scss` | Schriften, Klassen, Material (Tooltip, Dialog-Schale, Spinner) |
| `public/assets/ui/plaster.jpg`, `basalt.jpg` | Texturen (Poly Haven, CC0, umgefärbt; in `attributions.config.ts` genannt) |
| `public/assets/images/logo/logo.svg` | Logo als SVG (`tools/logo/vectorize_logo.py`); `public/favicon.svg` ist das Zeichen daraus |
| `components/icon/icon.component.ts` | Symbole (`td-icon`), darunter `close`, das Kreuz des Schließen-Knopfs |

---

## Referenzmaterial

- `tmp/ui-design/LOCKED.md` und `tmp/ui-design/kit/index.html`: die eingelockte Auswahl und der Baukasten, aus dem die
  Werte stammen
