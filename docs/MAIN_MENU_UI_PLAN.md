# Hauptmenü und Spieloptik (E119 bis E122)

Stand 2026-10-09, Branch `menu/main-menu-2026-10-08`. Ein Konzept für Hauptmenü, Wege in die Spielarten, Ladeanzeige
und die Optik von Menü, Dialogen, Panels und HUD (TODO E121 mit E119, E120, E122). Grundlage sind vier
Bestandsaufnahmen des Codes; die Entscheidungen unten sind ein Vorschlag, gebaut auf dem Branch.

## Ziel

- **Ein Ort für alles, was nicht Spielen ist.** Weiterspielen, neues Spiel, Ort wählen, Coop, Laden, Einstellungen,
  Extras und Beenden laufen über ein Menü. Heute führen Ortsdialog, Continue-Leiste, Coop-Dock, Kopfzeile, Sidebar-Fuß
  und zwei Schnellmenüs je eigene Wege (zehn Wege zu einem Ort, drei zu den Lautstärken, vier zum Tile-Key).
- **Das Spiel lädt hinter dem Menü.** Ort, Tiles, Straßen, Korridor und Simulation laden, während das Menü davor steht;
  der Ladebildschirm geht im Menü auf.
- **Optik aus einem Guss.** Ein SCSS-Fundament mit Platten, Titelplatten, Knöpfen und HUD-Platten; alle Dialoge und
  Panels hängen daran statt an acht kopierten Hüllen. Stil der Projektseite: dunkler Stein, Messing, Oswald.
- **Einheitlich, komfortabel, klar.** Jede Aktion hat einen Weg; Tastatur, Fokus und Esc verhalten sich überall gleich.

## Entscheidungen

### Menü

1. **Eine Komponente, zwei Lagen.** `app-main-menu` ersetzt das Esc-Spielmenü (MatDialog `game-menu`) und den
   Ladebildschirm. Lage **Start**: Vollbild über der Szene, großes Logo links oben, Liste darunter, Unterseiten als
   Platte rechts daneben. Lage **Pause** (Esc im Spiel): dieselbe Liste und dieselben Seiten, Hintergrund abgedunkelt,
   kleineres Logo. Gleicher Code, gleiche Seiten, gleiche Tastatur.
2. **Im Spielbaum.** Das Menü ist ein Overlay im Template von `TowerDefenseComponent` (nicht Root, kein MatDialog):
   `CoopService`, `SAVE_GAME`, `ReplayService` und `BenchmarkService` hängen an deren Injector
   (`integration/injector-scope.spec.ts`). Rolle `dialog`, `aria-modal`, Fokusfalle, Name aus dem Seitentitel.
3. **Zustand** im `UIStore`: `mainMenu: { open: boolean; layer: 'start' | 'pause'; page: MenuPage }`.
   Die heutigen Bedingungen `!loading()` für HUD, Intro, What's new, Steuerungshinweis und Onboarding bekommen
   `&& !menuOpen`; der Intro-Flug startet beim Schließen des Start-Menüs, nicht beim Ende des Ladens.
4. **Liste (Start und Pause gleich, Einträge je nach Lage):**
   - **Continue** (Start: nur mit Autosave oder geladenem Lauf; Pause: zurück ins Spiel). Darunter in Mono
     „Heilbronn · wave 12“. Zeigt der Autosave auf einen anderen Ort als den geladenen: „Continue in Paris · wave 7“
     und eine Rückfrage „Leaves Heilbronn“ (E120).
   - **Play** (Start, wenn ein Ort geladen ist und kein Lauf läuft): startet am geladenen Ort, mit Ladebalken, solange er
     lädt; danach Intro-Flug.
   - **New game**: Seite mit Ortswahl (Suche, Koordinaten, zuletzt gespielt, Favoriten, Schaufenster, Weltkarte,
     „Use my location“, Würfel). Ersetzt den Ortsdialog; die Wahl lädt hinter dem Menü.
   - **Coop**: Seite mit drei Wegen untereinander: **Host online**, **Join online** (Raumliste, Code), **Same network**
     (nur Desktop; im Browser der App-Hinweis). Name und Lobby-Wahl oben auf der Seite.
   - **Save / Load** (nicht im Coop; Speichern nur mit Lauf). Laden geht auch vor dem ersten Ort (`startPlace`).
   - **Settings**: Audio, Graphics, Gameplay, Map key, Privacy (Abschnitte auf einer Seite).
   - **Extras**: Replays und Runs, What's new, Keys, Damage vs armor, Benchmark, Attributions,
     **Legal & privacy** (E119), GitHub.
   - **Restart here** (Pause, solo oder Host).
   - **Quit 3DTD** (nur Desktop).
5. **Start ohne Ort im Link:** Kein ungefragter Start per Geolocation mehr; die Browser-Ortung ist ein Eintrag auf
   „New game“. Hinter dem Menü lädt der Ort, den der Spieler am wahrscheinlichsten will: Ort des Autosaves, sonst der
   zuletzt gespielte Ort (`td_recent_locations_v1`), sonst keiner (Weltkarte als Hintergrund, keine Kartensitzung).
   Mit `?l=` im Link lädt dieser Ort, das Menü zeigt „Play“ zuerst.
6. **Ladeanzeige im Menü:** Unten rechts eine Platte mit Ortsname, Messingbalken (Prozent aus `loadingSteps`) und dem
   aktuellen Schritt mit Meta; die zehn Schritte als aufklappbare Liste. Der Eintrag „Play“ / „Continue“ zeigt den
   Balken mit, solange der Ort lädt, und ist erst danach klickbar (Klick vorher merkt sich den Wunsch und startet,
   sobald fertig). Feldtipps rotieren unter der Liste. Versions-Chip unten links.
7. **Ortswechsel im Spiel** (Kopfzeilen-Ortsknopf, Würfel, Favorit, Laden eines Saves an anderem Ort, Coop-Gast folgt):
   öffnet das Menü in Lage Start mit Ladeanzeige; nach dem Laden „Play“. Ein Lade- oder Straßenfehler steht als Banner
   in der Menüplatte mit Aktion (Retry, Other place, Map key), nicht als Vollbild-Overlay; das alte Fehler-Overlay
   bleibt nur für den Fall ohne Menü (Engine-Ausnahme beim allerersten Start) und nutzt dieselbe Platte.
8. **Pause:** Solo pausiert das Menü in beiden Lagen (wie heute das Spielmenü). Im Coop pausiert es nie; es ist ein
   Overlay, das Spiel läuft weiter (Raumregel `pause` bleibt beim Pause-Knopf).
9. **Token-Dialog** bleibt ein eigener Schritt vor dem Menü (ohne Key gibt es nichts zu laden), in der neuen Optik.
10. **Automatisierung:** `?bot=…` außer `bot=manual`, `&benchmark` und `&menu=skip` überspringen das Start-Menü
    (Bot-Läufe, Perf-Läufe). Die E2E-Helfer klicken „Play“ (prüft das Menü mit).

### Wege, die wegfallen oder umziehen

| Heute | Neu |
|---|---|
| Esc-Spielmenü (MatDialog `game-menu`) | Menü Lage Pause |
| Ladebildschirm `loading-screen` | Ladeplatte im Menü |
| Continue-Leiste `continue-bar` | Eintrag „Continue“ |
| Ortsdialog (Start-Öffner und Spiel-Öffner) | Seite „New game“ (der Ortswähler wird eine eingebettete Komponente) |
| Coop-Reiter im Startdialog | Seite „Coop“, „Join online“ ohne eigenen Ort |
| Kopfzeile „Coop“ ohne Raum | öffnet Menü-Seite „Coop“; mit Raum bleibt der Raum-Chip und öffnet das Dock |
| Schnellmenüs Display und Audio | Settings; in der Leiste bleibt ein Knopf „Settings“ (öffnet die Seite), Ebenen und Entwickler bleiben |
| Sidebar-Fuß World, Runs, GitHub | Menü (New game → Weltkarte, Extras → Runs, GitHub); Fuß behält Menü, Tips, Version |
| Map key über Menü More, Fehler-Overlay, `?tokensetup` | Settings → Map key (öffnet den Token-Schritt), `?tokensetup` bleibt |

Die Lobby eines Coop-Raums bleibt das Dock neben der Karte: der Host würfelt dort noch und setzt Spawns (D26). Squad,
Chat, Ping, Raum-Chip, Banner, „Continue alone“ bleiben im Spiel.

### Optik

1. **Fundament** `src/app/styles/_game-ui.scss` (übernimmt die allgemeinen Teile aus `coop-ui/_coop-ui.scss` und die
   Rezepte aus `_td-mixins.scss`): `plate`, `plate-head`, `dialog-shell/head/body/foot`, `btn-primary`,
   `btn-secondary`, `btn-danger`, `btn-ghost`, `icon-btn`, `menu-list`, `menu-item`, `stat-plate`, `seg-bar`,
   `corner-brackets`, `glass-strip`, `focus-ring` (2 px), `motion`. Keine kopierten Dialoghüllen mehr.
2. **Tokens** einmal auf `:root` (aus `TD_CSS_VARS`); neu: Typo-Skala, Abstände, Ecken (`--td-cut` 10 px,
   `--td-cut-sm` 6 px), Platten-Verläufe, Messing- und Stahllinie, Danger, HUD-Zustände, Bewegung, Fokus.
   `styles.scss` ohne Hex-Literale.
3. **Schrift:** Oswald (lokal gebündelt, OFL, wie die Projektseite) für Titel, Menü, Knöpfe, HUD-Zahlen; Inter Tight für
   Text; JetBrains Mono nur für Zahlen in Tabellen, Kosten, Hotkeys, Codes. Labels nicht kleiner als 10 px.
4. **Form:** Platten mit abgeschrägter Ecke oben links und unten rechts, 1 px Stahlrand, Titelplatte mit 2 px
   Messingkante und Oswald-Versalien. Goldene Eckwinkel nur am Start-Menü und an Game Over. Glas nur, wo die Karte
   durchscheinen muss. Die cdk-Schale der Dialoge wird transparent (kein doppelter Blur).
5. **Knöpfe:** primär Messing mit harter Unterkante, sekundär Stahlrahmen, gefährlich dunkelrot, Menüeintrag als Text
   mit Messingbalken links bei Hover und Fokus.
6. **HUD-Kopfleiste:** drei Platten HQ, Credits, Wave mit gefüllten Icons und Zahlen in Oswald 22 px. HQ: zehn
   Segmente, unter 30 % warm und pulsierend, unter 10 % Warnstreifen. Credits: „+25“ / „−150“ steigt kurz auf, ein
   Fehlkauf blitzt rot. Wave: Fortschritt der laufenden Welle als Balken, Wellenstart als kurze Messingkante.
   Reduced motion: nur Farbe und Streifen.
7. **Logo:** als SVG nachgezogen (einfarbig Gold, aus dem 480-px-PNG vektorisiert), damit es im Start-Menü groß und
   scharf steht; `favicon.svg` aus derselben Form.
8. **Kontrast:** HP-Zahl #E36A5A statt #B83E32 (5,9:1), Warntext #D98A4A; `textTertiary` nur für Nicht-Text.

### Gestaltung vorab

Varianten für Start-Menü, Pause-Menü, eine Unterseite, Kopfleiste und einen Standarddialog liegen im Claude-Design-
Canvas „3DTD Hauptmenü und HUD“. Gebaut wird Variante A (linke Spalte mit Logo und Liste, Szene rechts frei, Ladeplatte unten rechts); B (zentrierte Spalte) bleibt als Vergleich. Die Dateien liegen auch lokal unter `tmp/ui-design/`.

## Bauplan

Vier Arbeitspakete auf eigenen Worktrees, gemergt per cherry-pick auf den Branch:

| Paket | Inhalt |
|---|---|
| **A Fundament und Dialoge** | Tokens auf `:root`, Oswald, `_game-ui.scss`, Logo-SVG und Favicon, cdk-Schale; alle Standarddialoge (What's new, Attributions, Keys, Damage matrix, Runs, Run upload, Research, Token-Setup, Tooltips, Coop-Dock/Squad/Chat, Game Over, Connection lost) auf das Fundament; Kontrast-Spec; `DESIGN_SYSTEM.md` |
| **B Menü-Kern und Ladefluss** | `app-main-menu` (Hülle, Liste, Lagen, Tastatur, Fokus, Esc), `UIStore.mainMenu`, Start ohne ungefragte Ortung, Laden hinter dem Menü, Ladeplatte, Fehlerbanner, Pause-Regel, Intro beim Schließen, Ortswechsel öffnet Menü, Fixes im Ladefluss (`loading=false` im Fehlerfall, Meldung bei Overpass-Ausfall am Start), Entfernen von `game-menu`, `loading-screen`, `continue-bar`; E2E-Helfer und Hotkeys |
| **C Menü-Seiten** | Seiten als eigene Komponenten unter `main-menu/pages/`: New game (Ortswähler aus dem Ortsdialog herausgelöst), Coop (Wege aus `coop-entry`), Save/Load (aus `game-menu`), Settings (Audio, Graphics, Gameplay, Map key, Privacy), Extras (inkl. Legal & privacy), Continue mit Ortsvergleich und Rückfrage (E120, HQ in den Slot-Metadaten) |
| **D HUD und Spielflächen** | Kopfleiste (Platten, Zustände, Credits-Delta, Wave-Balken), Kopfzeilen-Knöpfe mit Fokus, Sidebar und ihre Panels, Canvas-Leisten (Intro-Skip, Context-Hint, Game-Speed, Boss-Bar, Zellbericht, Replay-Leiste, Lane-Length, LOS-Legende), Schnellleiste ohne Display/Audio, Sidebar-Fuß |

Schnittstelle B/C: B legt `MenuPage` und eine leere Seitenkomponente je Seite an; C füllt sie. Seiten bekommen keine
Inputs außer `layer` und melden Navigation über `MainMenuService` (`open(page)`, `back()`, `close()`).

## Prüfung

- Je Paket: betroffene Specs, `tsc` app und spec, Lint, Build.
- Zwei Review-Runden über den gemergten Stand (Kreuz-Review der Pakete), Fixes je Befund.
- **Bildtour** `e2e/tests/ui-tour.e2e.ts` in DevWorld (keine Kartensitzung): jede Menüseite in beiden Lagen, Ladeplatte,
  Fehlerbanner, HUD-Zustände (voll, niedrig, kritisch, Credits-Delta, Welle), Dialoge, Coop-Seite, Game Over, je in
  1600×900 und 1280×720; Bilder nach `tmp/ui-shots/after/`. Dazu eine Tastatur-Probe (Tab, Pfeile, Esc, sichtbarer
  Fokus ≥ 2 px).
- Volle E2E-Suite auf echter Karte einmal am Ende.

## Offen nach dem Bau

- Playtest: Laden hinter dem Menü auf echter Karte (Zeit bis „Play“), Gefühl der HUD-Rückmeldungen, Desktop-App
  (Quit, LAN-Seite, Legal-Link im System-Browser).
