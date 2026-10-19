# Mehrsprachigkeit: Englisch und Deutsch (TODO E245)

Stand 2026-10-18, Phase 1 (Technik, Inventar, Glossar, Grundgerüst). Phase 2 (Umbau der Komponenten) startet,
sobald die Menü-Runde übernommen ist.

Ziel: Das Spiel spricht Englisch und Deutsch, umschaltbar in Settings ohne Neuladen, Standard nach Browser- bzw.
Systemsprache. Eine weitere Sprache ist danach eine Datei. Ein Build für Web und Desktop-App.

## 1. Bestand

Gezählt mit `node tools/i18n/inventory.mjs` (Heuristik über TS-Literale, Templates per Angular-Compiler, Karten-Index,
Laufplan; `--files` je Datei, `--area <id>` die Texte eines Bereichs). Die Landing-Seite zählt nicht.

| Bereich | Texte | eindeutig | Wörter | übersetzen |
|---|---:|---:|---:|---|
| Editor (`editor/` ohne Agenten-API) | 1511 | 1208 | 7055 | ja |
| HUD und Spiel (Header, Sidebar, Tower-Panel, Banner, Hinweise) | 728 | 604 | 2928 | ja |
| Menüs, Welten, Globus, Laden | 737 | 594 | 3623 | ja |
| Kartenprüfung und Import (`map-ops`, `world/osm`, `world/w3x`, `world/custom-map`) | 446 | 433 | 2794 | was der Spieler sieht (siehe 4.8) |
| Configs (Tower, Gegner, Forschung, Fähigkeiten, Held, Mutatoren, Wellennamen, Quellen) | 399 | 358 | 1759 | ja |
| Coop | 310 | 262 | 1422 | ja |
| Tutorial und Onboarding | 149 | 135 | 1396 | ja |
| Dialoge (Forschung, Läufe, Hotkeys, Referenz) | 134 | 113 | 495 | ja |
| Simulation (Worker: Manager, Director, Simulator) | 83 | 77 | 500 | als Codes (4.4) |
| Fehlermeldungen und Ablehnungen | 41 | 41 | 158 | ja |
| Mitgelieferte Karten (Name, Beschreibung) | 26 | 26 | 333 | ja |
| Desktop-App (Electron-Hauptprozess) | 32 | 18 | 117 | ja |
| Changelog (Was ist neu, aus `CHANGELOG.md`) | 6 | 6 | 14 | nein (4.10) |
| Entwickler (Debug-Fenster, Benchmark, Bots, Showreel, DevWorld-Werkzeuge) | 490 | 437 | 1487 | nein |
| Agenten-API (Werkzeugbeschreibungen für KI-Agenten) | 244 | 241 | 3580 | nein |
| **Summe** | **5336** | **4263** | **27661** | |

Zu übersetzen: rund **3650 eindeutige Texte, 22 600 Wörter**. Dazu 409 `new Error(...)`-Texte, meist intern
(Spalte nicht in der Summe); die wenigen, die der Spieler sieht, werden beim Umbau zu Codes. Die Heuristik zählt
einige Overpass-Abfragen und Klassenlisten mit und übersieht zusammengesetzte Texte; als Größenordnung reicht sie.

## 2. Technik: eigenes Wörterbuch auf Signals

Entschieden: **ein schlankes eigenes Wörterbuch**, TS-Objekte je Sprache, über ein Signal gelesen. Keine neue
Abhängigkeit.

| Anforderung | Angular `$localize` | Transloco | eigenes Wörterbuch |
|---|---|---|---|
| Umschalten ohne Neuladen | nein, ein Build je Sprache | ja | ja |
| ein Build für Web und Electron | nein (je Sprache ein Ordner, Electron und `/play/` müssten wählen) | ja | ja |
| fehlender Schlüssel = Compile-Fehler | nein (Warnung beim Build) | nein (String-Schlüssel, nur mit Zusatzwerkzeug) | ja, auch überzählige und falsche Platzhalter |
| Plural, Platzhalter | ICU | ICU per Plugin (weitere Abhängigkeit) | Funktionen mit `Intl.PluralRules` |
| Kosten im Hot-Path | null | Pipe oder Signal je Text, Lookup per String | ein Signal-Read und ein Property-Zugriff |
| Texte in Configs, im Worker | nur `$localize` im Code, Worker eigener Build | nein | Configs nach Id, Worker schickt Codes |

`$localize` scheidet am Umschalten zur Laufzeit und am Build je Sprache aus. Transloco brächte Laufzeit-Umschalten,
aber String-Schlüssel ohne Typprüfung, JSON-Dateien neben dem Code und ein Plugin für Plural; was es dazu bietet
(Laden über HTTP, Scopes, Pipes), braucht ein Spiel mit zwei mitgelieferten Sprachen nicht. Das eigene Wörterbuch
ist rund 150 Zeilen, der Compiler prüft jede Sprache gegen die englische Quelle.

## 3. Aufbau (gebaut in Phase 1)

```
src/app/i18n/
├── locale.ts           # LOCALES, Locale, LocalePreference ('system' | Locale), LOCALE_NAMES, detectLocale, resolveLocale
├── format.ts           # formatters(locale): plural, int (Ziffergruppen), fixed (Dezimalen); je Sprache einmal gebaut
├── dictionaries.ts     # wo jede Sprache herkommt: en im Haupt-Bundle, jede andere ein eigener Chunk
├── i18n.service.ts     # I18n: t() (das Wörterbuch), locale(), systemLocale, ready()
├── i18n.spec.ts        # Schlüssel gleich, jede Funktion liefert Text, Typfehler, Erkennung, Umschalten
└── messages/
    ├── en.ts           # Quelle; ihr Typ ist `Messages`
    └── de.ts           # `export const de: Messages = { ... }`
```

- **Typ aus der Quelle**: `type Messages = typeof en`. Eine Sprache ist `const de: Messages`; ein fehlender oder
  überzähliger Schlüssel und ein Text mit anderen Werten sind Compile-Fehler (der Spec prüft das mit
  `@ts-expect-error`). Der Spec prüft zur Laufzeit zusätzlich Schlüssel, Art und Zahl der Werte, leere Texte und
  `undefined`/`NaN` in den Ausgaben.
- **Werte und Plural**: ein Text mit Werten ist eine Funktion, `waves: (n: number) => \`${f.int(n)} ${f.plural(n,
  'wave', 'waves')}\``. `formatters(locale)` baut `Intl.PluralRules` und `Intl.NumberFormat` einmal je Sprache;
  `int` geht unter tausend an `Intl` vorbei. Zahlen im Text immer über `f.int`/`f.fixed` (Deutsch: „1.234“, „2,5“).
- **Lesen**: Komponenten `protected readonly t = inject(I18n).t;`, im Template `{{ t().common.cancel }}`, mit Wert
  `{{ t().units.waves(n()) }}`. Im TS-Code `computed(() => this.t().hud.wave(this.wave()))`.
- **Umschalten**: die Wahl liegt in `UIStore.localePreference` (`'system'` oder eine Sprache, in `td-ui-state`
  gespeichert). `I18n` folgt ihr per `effect`, lädt das Wörterbuch (Deutsch als eigener Chunk, wenige KB gzip), setzt
  `t` und `<html lang>`. Jedes Template, das `t()` liest, folgt ohne Neuladen. Überlappen sich zwei Wechsel, gewinnt
  der letzte. Lädt der Chunk nicht (offline nach einem Update), bleibt die bisherige Sprache.
- **Erkennung**: `'system'` nimmt die erste Sprache aus `navigator.languages`, die das Spiel spricht, nach dem
  Haupt-Tag („de-AT“ → Deutsch), sonst Englisch. In Electron liefert Chromium die Systemsprache in
  `navigator.languages`. Settings zeigt „System (Deutsch)“, „English“, „Deutsch“; die Sprachnamen stehen in
  `LOCALE_NAMES` immer in ihrer eigenen Sprache.
- **Start ohne englisches Aufblitzen**: Phase 2 hängt `provideAppInitializer(() => inject(I18n).ready())` in
  `app.config.ts`; der Chunk lädt parallel zum Rest, das erste Bild kommt in der richtigen Sprache.

### Schlüsselschema

- Erste Ebene nach Bereich: `common`, `settings`, `menu`, `worlds`, `hud`, `tower`, `research`, `waves`, `coop`,
  `dialogs`, `onboarding`, `editor`, `check` (Kartenprüfung), `errors`, `desktop`, `units`.
- Dinge mit Id hängen am Id-Typ der Config: `towers: Record<TowerTypeId, { name; description }>`,
  `enemies: Record<EnemyTypeId, …>`, `research: Record<ResearchId, …>`, `abilities`, `mutators`, `damageTypes`,
  `armorTypes`, `refusals: Record<RefusalCode, …>`. Ein neuer Tower ohne Text ist damit ein Compile-Fehler.
- Schlüssel nach dem, was der Text sagt (`sellFor`), nicht wo er steht (`button3`). camelCase, keine Punkte im Namen.
- Gleiche Wörter in verschiedenen Rollen bekommen eigene Schlüssel, wenn sie im Deutschen auseinandergehen
  („Range“ als Wert „Reichweite“ und als Upgrade „Reichweite +“).

## 4. Regeln je Quelle

1. **Templates und Komponenten**: kein Text mehr im Template, alles über `t()`. `aria-label`, `title`, Tooltips
   genauso. Texte, die eine Komponente zusammensetzt, als Funktion im Wörterbuch, nicht per Verkettung im Template
   (die Wortstellung ist im Deutschen eine andere).
2. **Gemeldete Texte** (`UIStore.notice`, Coop-Meldungen, Ablehnungen): wer meldet, baut den Text in dem Moment mit
   `t()`. Eine Meldung, die schon steht, wechselt die Sprache nicht mehr; sie verschwindet nach Sekunden. Was länger
   steht (`LoadProblem`, `lasting`), trägt einen Code mit Werten statt Text und wird beim Anzeigen übersetzt.
3. **Configs**: `name`, `description`, Upgrade-Namen und Labels gehen aus den Configs ins Wörterbuch, nach Id (3).
   Die Configs behalten Zahlen und Ids. Logs, Bots und das Debug-Fenster lesen `en` direkt, wo sie einen Namen
   brauchen. Beschreibungen mit Werten aus der Config werden Funktionen (`description: (pct) => …`), die Zahl bleibt
   in der Config.
4. **Worker und Simulation**: im Worker liegt kein Wörterbuch. Er schickt Codes mit Werten, die UI übersetzt.
   Heute betroffen: Ablehnungen der Forschung (`research.manager.ts`, „Opens at wave 5“ wird
   `{ code: 'opensAt', wave: 5 }`), die Wellenbeschreibung im Vorschau-Objekt (`WavePeekFacts.name/note/description`).
   Replay- und Save-Ablehnungen sind schon Codes (`ReplayFileRefusal`).
5. **Wellennamen**: der Laufplan (`run-plan.json`) behält `name` als englischen Namen für Run-Log und Debug. Die UI
   übersetzt über `waves.names[name]`; ein Spec prüft, dass jeder Name im Laufplan einen Eintrag hat. Die Notizen
   (`note`) sind Designnotizen und bleiben englisch, die UI zeigt statt ihrer einen eigenen Text aus Codes.
6. **Coop und Netz**: über das Netz gehen nie übersetzte Texte, nur Ereignisse, Ids und Codes. Die Meldungen baut
   heute schon jeder Client selbst aus Relay-Ereignissen (`coop.service.ts`), das bleibt so; jeder Spieler sieht
   sie in seiner Sprache. Zu ändern: die Antwort des Relays auf ein Run-Log (`reason: 'too many' | 'busy' | …`, heute
   freier Text in der UI) und der Grund beim Neustart des Relays (`'The coop server restarts'`) werden feste Codes
   im Protokoll. Chat bleibt, was der Spieler schreibt.
7. **Mitgelieferte Karten**: Name und Beschreibung im Wörterbuch nach Karten-Id (`maps.<id>`); `index.json` und
   `map.json` bleiben englisch (Hash unverändert, `maps:bake` unberührt). Ein Spec prüft, dass jede Id im Index
   einen Eintrag hat und das Englische gleich lautet. Eigene Karten zeigen, was ihr Autor schrieb. Wellenereignisse
   vom Typ `message` haben die mitgelieferten Karten heute keine.
8. **Kartenprüfung und Import**: Was die Prüfung im Editor meldet (`map-ops/validation`, Check-Panel), wird Code mit
   Werten und übersetzt. Parserfehler kaputter Dateien (`unterminated string at byte …`) bekommen einen übersetzten
   Satz („Die Karte ist beschädigt“) und behalten das englische Detail darunter.
9. **Electron-Hauptprozess**: 18 Texte (Speichern-Dialog, „Editor verlassen?“, Benachrichtigungen). Ein eigenes
   kleines Wörterbuch `desktop/src/i18n.js` (en/de); die Sprache meldet das Spiel per Preload an den Hauptprozess,
   bis dahin `app.getPreferredSystemLanguages()`.
10. **Bleibt englisch**: Changelog („Was ist neu“, aus `CHANGELOG.md`, zugleich Release-Notes), Debug-Fenster,
    Bots, Showreel, Benchmark-Rohwerte, Agenten-API (Werkzeugbeschreibungen lesen KI-Agenten), Logs, Run-Log-Inhalt.
    Quellenangaben (`attributions.config.ts`) im Wortlaut der Lizenzgeber; nur Überschriften und Erklärsätze
    übersetzt.
11. **Gespeichertes** (Run-Log, Replays, Saves, Bestwerte) enthält Ids und Zahlen, keinen Anzeigetext. Ein Save,
    das einen Text des Spiels ablegt, ist ein Fehler.

## 5. Leistung

- Ein statischer Text kostet im Template einen Signal-Read und einen Property-Zugriff; das Template liest `t()` ohnehin
  nur, wenn es neu zeichnet.
- Texte mit Werten erzeugen nur dann einen String, wenn der Wert sich ändert (Signal-getriebenes Neuzeichnen). Was
  je Frame läuft (Timer, FPS), formatiert per `f.int` an `Intl` vorbei oder bleibt wie heute ohne Wörterbuch.
- Kein Lookup per String-Pfad, keine Pipe je Text, kein Parsen zur Laufzeit. Der Worker lädt kein Wörterbuch.
- Deutsch lädt als eigener Chunk nur, wenn gewählt.

## 6. Ablauf des Umbaus (Phase 2)

Je Paket: Texte ins Wörterbuch (en und de zugleich), Komponenten auf `t()`, betroffene Specs angepasst, der Wächter
(7.2) senkt die Grenze des Bereichs. Reihenfolge nach Sichtbarkeit; Editor zuletzt, weil am größten.

| Paket | Inhalt | eindeutige Texte |
|---|---|---:|
| I0 | App-Initializer, Sprachwahl in Settings, Wächter mit Grundwerten, Pseudo-Sprache für Entwickler (7.3) | 5 |
| I1 | Configs nach Id: Tower, Upgrades, Pfade, Gegner, Forschung, Fähigkeiten, Held, Mutatoren, Schadens- und Rüstungsarten, Veteranenränge; Wellennamen | 360 |
| I2 | Codes statt Texte aus Worker und Relay (4.4, 4.6) | 80 |
| I3 | HUD und Spiel, Fehlermeldungen und Ablehnungen | 645 |
| I4 | Menüs, Welten, Globus, Laden, mitgelieferte Karten | 620 |
| I5 | Dialoge, Tutorial und Onboarding | 250 |
| I6 | Coop | 260 |
| I7 | Editor (in zwei bis drei Teilen: Shell und Browser, Panels, Prüfung) | 1210 + Prüfung |
| I8 | Desktop-App | 18 |
| I9 | Layout-Prüfung und Abnahme (7.4) | |

Die deutschen Texte schreibe ich je Paket mit, im Ton des Glossars (8). Der User nimmt Glossar und Stichproben je
Paket ab, nicht jeden Text.

### Stand und offener Rest (2026-10-19)

Gebaut und auf next: I0 (Sprache vor dem ersten Bild, Sprachwahl in Settings, Pseudo-Sprache xx nur im Dev-Build,
Wächter mit Baseline), I1 (Configs nach Id), I2 (Codes aus Worker und Relay), große Teile von I3 (HUD, Hinweise,
Ladeprobleme, Hotkeys) und I7 (Editor-Shell, Prüfung, fast alle Panels, Werkzeuge, Dienste, Kartenanlage). Turm- und
Gegnernamen bleiben englisch. Zahlen laut `node tools/i18n/inventory.mjs` (Texte, die der Scan noch findet):

- **Menüs, Welten, Globus, Laden** (~760): Settings-Seite (bis auf die Sprachzeile), Hauptmenü und Pausemenü mit
  Saves, Kartenliste, Ladeplatte, Weltmenüs und Pfadleiste (`world-path`: Worlds, Built Worlds, Play/Edit),
  Globen, Token-Dialog, OSM-Rahmen, Update-Hinweis; die Knöpfe des Game-Over-Fußes (`mainMenu.editMapLabel`,
  `restartLabel`, „All worlds“) kommen aus dem Hauptmenü-Dienst.
- **Dialoge** (~100): Forschung, Tech-Tree, Schadensmatrix, Quellen, Hotkeys (Reste), Läufe, Run-Summary/Charts.
- **Coop** (~310): Lobby, Raum-Optionen, Coop-Dienst, Coop-Bausteine.
- **Editor-Reste** (~230): Flächen-Werkzeug und -Panel (neu), Malen, Ansehen, Spawns und HQ (Panel, Werkzeug,
  Schritte), neue Zerstörungsoptionen im Regelpanel (Krater, Abnutzung, Struktur-HP), Himmel und Wetter
  (environment-panel, WEATHERS), Agent-Leiste und -Status, Boden- und Kartenschritte (ground-commands,
  map-operations, describe, doc-mirror), Katalog-Namen und -Kategorien (heute englisch aus catalog.json).
- **Kartenprüfung und Import** (~420): map-repair-, map-file-, osm-, w3x-Texte (Formatprobleme behalten heute
  englische Details), Wellen-Tabellenprüfung (`validateWaveTable`).
- **HUD-Reste** (~270), **Simulation** (~60), **Fehler/Ablehnungen** (~30), **Configs-Reste** (~175: Wellen- und
  Run-Plan-Notizen), **mitgelieferte Karten** (26), **Desktop-App** (32, `desktop/src/i18n.js`).
- **TODO, nicht begonnen:** Wörterbuch nur für die aktive Sprache laden (heute `en.ts` als Fallback im Startpaket,
  rund 107 kB roh); der Editor-Template-Worker bündelt `en.ts` über `EditorDocument.words` mit.
- **I9 Layout-Prüfung**: E2E über Menüs, HUD, Dialoge und Editor in `de` und `xx` (7.4), Bilder zur Abnahme;
  bekannt: „Ungepanzert“ im Wellen-Tooltip abgeschnitten.

## 7. Prüfung

1. **Wörterbuch-Spec** (`src/app/i18n/i18n.spec.ts`, gebaut): jede Sprache hat genau die Schlüssel des Englischen,
   jeder Eintrag dieselbe Art und Zahl der Werte, jeder liefert nicht-leeren Text; Compile-Fehler bei fehlendem,
   überzähligem oder falsch getyptem Schlüssel; Erkennung, Plural, Ziffern, Umschalten, „der letzte Wechsel gewinnt“.
2. **Wächter gegen neue harte Texte** (gebaut, `tools/i18n/guard.spec.ts`): der Spec führt `tools/i18n/scan.mjs`
   über die Quellen und vergleicht jeden gefundenen Text mit `tools/i18n/baseline.json` (Texte je Datei). Ein Text,
   der dort fehlt, ist rot, mit Datei und Text. Verschwundene Texte warnen nur; nach jedem Paket schreibt
   `node tools/i18n/baseline.mjs` die Liste neu und sie schrumpft. Entwickler- und Agenten-Bereich sind ausgenommen.
3. **Pseudo-Sprache** (gebaut, nur Entwickler-Build, in Settings wählbar, `src/app/i18n/pseudo.ts`): `xx` macht aus jedem englischen Text „[Ŝéttîñĝš ~~~~]“, rund 40 %
   länger. Was dann noch normal aussieht, ist nicht übersetzt; was bricht, bricht im Deutschen auch.
4. **Layout**: deutsche Texte sind rund 30 % länger. Ein E2E-Spec geht jede Menüseite, das HUD, Tower-Panel,
   Dialoge und die Editor-Panels in `de` und `xx` durch, meldet jedes Element mit Text, dessen `scrollWidth` über
   `clientWidth` liegt (abgeschnitten, umgebrochen wo nicht erlaubt), und legt Vorher/Nachher-Bilder je Seite ab.
   Die Bilder bekommt der User zur optischen Abnahme.

## 8. Glossar EN/DE

Ton: locker und knapp, du statt Sie, Verben im Infinitiv auf Knöpfen („Welle starten“), kein Amtsdeutsch.
Spielbegriffe wie in deutschen TD-Spielen. **Eigennamen** bleiben in jeder Sprache englisch (User-Entscheid):
Turm- und Gegnernamen (Archer Tower, Iron Bastion, Herbert, Skarnax), Marken (OpenStreetMap, Cesium ion). Übersetzt
werden Beschreibungen und Gattungswörter im Fließtext („Turm bauen“, „der Turm feuert“). `de.ts` übernimmt den
Namensblock als `const names = en.names`.

### Grundbegriffe

| EN | DE | Anmerkung |
|---|---|---|
| Tower | Turm, Türme | entschieden: „Turm“ im Fließtext; die Turmnamen selbst bleiben englisch |
| Wave | Welle | „Welle starten“, „Nächste Welle“, „Welle 12“ |
| HQ | HQ | kurz und bekannt; „Hauptquartier“ zu lang für das HUD |
| Credits | Credits | Währung. Im Englischen steht stellenweise „gold“ (Coop: „sent you 50 gold“): in beiden Sprachen auf Credits vereinheitlichen |
| Build | Bauen | |
| Sell / Sell for {} | Verkaufen / Für {} verkaufen | |
| Upgrade | Aufrüsten (Verb), Ausbaustufe (Nomen) | „Max-upgrade all towers“ → „Alle Türme voll aufrüsten“ |
| Level {} of {} / Tier | Stufe {} von {} / Stufe | |
| Path (Tower-Pfad) | Pfad | |
| Range | Reichweite | |
| Damage | Schaden | |
| Fire rate | Feuerrate | |
| Armor | Rüstung | |
| Weak to | Schwach gegen | |
| Kills | Abschüsse | |
| Enemies | Gegner | |
| Boss | Boss | |
| Leak | Durchbruch | Gegner erreicht das HQ |
| Spawn | Spawn | in Spielen üblich; „Startpunkt“ nur im Erklärtext |
| Portal | Portal | |
| Route | Route | |
| Lane | Weg | Coop: „Weg zurückgeben“, „sein Weg schließt“ |
| Line of Sight (LOS) | Sichtlinie (Sicht) | |
| Air / Ground | Luft / Boden | „Nur Luft“, „Nur Boden“, „Beides“ |
| Camo | Tarnung, getarnt | |
| Research | Forschung | |
| Research tree | Forschungsbaum | |
| Research Center / Research Wing | Forschungszentrum / Forschungsflügel | |
| Abilities | Fähigkeiten | |
| Hero | Held | |
| Veteran rank | Veteranenrang | |
| Blood moon | Blutmond | |
| Trial wave | Probewelle | |
| Pause / Speed | Pause / Tempo | |
| Photo mode | Fotomodus | |
| Replay | Replay | „Wiederholung“ klingt nach Fernsehen |
| Run / Runs | Lauf / Läufe | |
| Run log | Laufbericht | |
| Benchmark | Benchmark | |

### Menüs und Welten

| EN | DE | Anmerkung |
|---|---|---|
| Worlds / All worlds | Welten / Alle Welten | |
| Real places | Echte Orte | |
| Built Worlds | Gebaute Welten | Welt der Editor-Karten |
| OpenStreetMap | OpenStreetMap | Name |
| DevWorld (Dev world) | DevWorld | Name der Entwicklerwelt |
| Custom maps | Eigene Karten | |
| Map / Map editor | Karte / Karteneditor | |
| Showcase | Bekannte Orte | kuratierte Plätze („Prag, Altstädter Ring“): Ortsnamen auf Deutsch |
| Defended places | Verteidigte Orte | |
| Recent | Zuletzt | |
| Favorites | Favoriten | |
| Continue | Weiterspielen | als Menüpunkt; im Dialog „Weiter“ |
| New game / Load game / Save game | Neues Spiel / Spiel laden / Spiel speichern | |
| Autosave | Autosave | |
| Settings | Einstellungen | |
| Extras | Extras | |
| Main menu | Hauptmenü | |
| Quit 3DTD | 3DTD beenden | |
| Map key | Kartenschlüssel | Zugang zu den Tiles (Cesium ion, Google) |
| Roll a random city | Zufällige Stadt | |
| Picture quality | Bildqualität | |
| Privacy | Datenschutz | |
| Language / System (Deutsch) | Sprache / System (Deutsch) | |

### Coop

| EN | DE | Anmerkung |
|---|---|---|
| Coop | Koop | so schreibt es der User auch im Deutschen |
| Room / Room code | Raum / Raumcode | |
| Host a room / Host | Raum eröffnen / Host | |
| Join | Beitreten | |
| Ready / Not ready | Bereit / Nicht bereit | |
| Squad | Trupp | |
| Mark a place | Markieren | |
| Same network | Gleiches Netzwerk | |
| Out of step / Back in step | Nicht mehr synchron / Wieder synchron | |

### Tower

Turmnamen bleiben englisch (Archer Tower, Iron Bastion, Sentinel Laser, Missile Silo …); nur ihre Beschreibungen
werden übersetzt.

### Gegner

| EN | DE | EN | DE |
|---|---|---|---|
| Zombie | Zombie | Zombie Soldier | Zombiesoldat |
| Rat | Ratte | Penguin | Pinguin |
| Bat | Fledermaus | Spider | Spinne |
| Wallsmasher | Mauerbrecher | Tank | Panzer |
| Skeleton / Skeleton Minion | Skelett / Skelettdiener | Ghost | Geist |
| Wraith | Schemen | Hornet | Hornisse |
| Mech | Mech | Bear | Bär |
| Mammoth | Mammut | Stone Golem | Steingolem |
| Golem King | Golemkönig | Dragon | Drache |
| Dragon Matriarch | Drachenmutter | Ooze | Schleim |
| Slime Clump | Schleimklumpen | Herbert | Herbert |
| Skarnax / Segment / Tail | Skarnax / Skarnax-Segment / Skarnax-Schwanz | | |

### Schaden und Rüstung

Physical → Physisch, Pierce → Durchschlag, Siege → Belagerung, Magic → Magie, Fire → Feuer, Ice → Eis,
Poison → Gift, Lightning → Blitz, Chaos → Chaos. Unarmored → Ungepanzert, Light → Leicht, Heavy → Schwer,
Fortified → Befestigt, Ethereal → Ätherisch.

### Fähigkeiten, Held, Mutatoren

Nuclear Strike → Atomschlag, Frost Bomb → Frostbombe, EMP → EMP, Orbital Laser → Orbitallaser.
Mercenary → Söldner; Standard / Explosive / Rune rounds → Standard- / Spreng- / Runenmunition.
Swift → Flink, Swarm → Schwarm, Regeneration → Regeneration, Bounty → Kopfgeld.

### Forschung

| EN | DE | EN | DE |
|---|---|---|---|
| Gatling Technology | Gatling-Technik | Ice Magic | Eismagie |
| Biology | Biologie | Tentacle Biology | Tentakelbiologie |
| Toxic Compounds | Giftstoffe | Siege Engineering | Belagerungstechnik |
| Fire Alchemy | Feueralchemie | Arcane Studies | Arkane Studien |
| Storm Mastery | Sturmbeherrschung | Rocketry | Raketentechnik |
| Flak Artillery | Flakartillerie | Laser Optics | Laseroptik |
| Cybernetics | Kybernetik | Rotisserie | Drehspieß |
| Chaos Rift | Chaosriss | AA Retrofit | Flak-Nachrüstung |
| Scouting | Aufklärung | Incendiary Arrows | Brandpfeile |
| Ballista Bolts | Ballistenbolzen | Multirole Warheads | Mehrzweck-Sprengköpfe |
| Binding Sigils | Bannsiegel | Caustic Compounds | Ätzstoffe |
| Mercenary Contract | Söldnervertrag | Advanced Weaponry | Bessere Waffen |
| Advanced Engineering | Bessere Technik | Master Engineering | Meistertechnik |
| Transcendent Tech | Transzendente Technik | | |

Die Fähigkeiten-Forschungen (Nuclear Strike, Frost Bomb, EMP, Orbital Laser) heißen wie die Fähigkeit.

## 9. Entscheidungen (User)

1. „Turm“ im deutschen Fließtext, nicht „Tower“.
2. Turm-, Gegner- und andere Eigennamen englisch in allen Sprachen (`const names = en.names`).
3. „Koop“ statt „Coop“ im deutschen Spiel.
4. Changelog nur englisch.
5. Benchmark-Panel: Überschriften und Knöpfe übersetzt, Messwerte und Bericht englisch.
6. Währung heißt in beiden Sprachen „Credits“.

Offene Fragen:

- Fähigkeiten (Nuclear Strike, Frost Bomb, EMP, Orbital Laser), der Held (Mercenary) und die Mutatoren sind im Deutschen
  vorerst übersetzt (Atomschlag, Frostbombe, Söldner, Flink …), weil sie Gattungswörter sind. Englisch lassen?

Balance-Hash: Seit I1 stehen Namen und Beschreibungen nicht mehr in den Configs, die `balanceConfigHash` liest; der Hash
umfasst nur noch Zahlen, Ids und Regeln. Er hat sich mit I1 einmal geändert (Changelog-Entwurf: „Balance-Hash neu, weil
die Texte aus den Configs ins Wörterbuch gewandert sind; keine Balance-Änderung“).
