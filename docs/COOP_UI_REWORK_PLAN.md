# Coop-UI und Standortdialog überarbeiten

**Stand 2026-09-26: P1 bis P5 gebaut, nicht committet.** Entscheidungen des Users in Abschnitt 3 (U1 bis U8), die
Pakete in Abschnitt 4, was beim Bauen anders kam in Abschnitt 6. Die Darstellung beschreibt jetzt
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (Coop, Standortdialog).

Auslöser: Die Coop-Oberfläche ist in wenigen Tagen gewachsen (Dock, Einstieg, Squad, Chat, Lobby, öffentliche
Raumliste, Reiter im Standortdialog). Sie funktioniert, aber sie hat Tastaturfehler, doppeltes SCSS, ein zu großes
Dock, und der Standortdialog zeigt zwei Stilsprachen nebeneinander. Grundlage sind zwei Reviews vom 2026-09-25
(Technik, Design). Die schweren Befunde sind im Code nachgeprüft. Dock, Squad und Chat hat der Designer nur aus
dem Code beurteilt, weil sie erst mit geladener Karte erscheinen; das steht unten als "abgeleitet" dabei.

## 1. Befunde

### Fehler (im Code geprüft)

| # | Ort | Befund |
|---|---|---|
| F1 | `coop-chat.component.ts:195-213` | `document:keydown` fängt Tab (Dock), Enter (Chat) und X (Ping) auch dann ab, wenn der Fokus auf einem Knopf liegt. `ownsKey` lässt nur Textfelder, Select und contenteditable durch. Folge: Tab auf einem Knopf im Dock schließt das Dock, Enter auf einem Knopf im Spiel öffnet den Chat statt den Knopf auszulösen. `mousedown.preventDefault` am Kopf-Chip (`game-header.component.html:146,158`) umgeht nur das Symptom |
| F2 | `coop-entry.component.html:33,138`, `coop-dock.component.html` (Start, Ready, Lane entfernen, Cheats) | `matTooltip` auf Knöpfen mit `[disabled]`. Deaktivierte Knöpfe lösen keine Maus-Events aus, der Grund einer Ablehnung (andere Version, Raum voll, "Take a lane first") erscheint nie |

### Technik

| # | Ort | Befund |
|---|---|---|
| T1 | `coop-dock.component.*` (329 TS, 360 HTML, 728 SCSS) | Macht zu viel: Beitrittsschritte, Raumkopf, Liste, Status, Spieler, Lanes, Optionen, Chat, Fuß. Fachlogik in computeds und Template-Methoden, `step.label.startsWith('Loading')` hängt am Anzeigetext |
| T2 | `coop-dock.scss`, `coop-entry.scss`, `coop-squad.scss`, `coop-chat.component.ts` | Doppelt: Klassen-Mapping `.btn/.btn-xs/.btn-primary/.icon-btn/.inp`, `.blk`, `.sec small`, `.row`, `.note` mit Varianten, `.banner`, `.spin` und `@keyframes coop-spin`, `kbd`, Panelrahmen mit Schatten |
| T3 | `location-dialog.component.scss:240-265, 598-621, 70, 301` | Gold-Knopf zweimal von Hand statt `td.gold-button`; `rgba(201,164,76,…)` ist das alte Gold |
| T4 | `location-dialog.component.ts:64-76`, `models/location.types.ts:69` | Ein `effect` schließt den Dialog nach dem Beitritt, mit festen Werten `'Loading...'` und `'spawn-1'`. Der `CoopService` reist über `MAT_DIALOG_DATA`, das Model importiert dafür den Service-Typ. Unklar: was Cancel während eines laufenden Beitritts tut |
| T5 | `coop-dock.component.ts:242-246`, `coop.service.ts:500` u. a. | Fünf Stellen schreiben `coopDockOpen` |
| T6 | `coop-chat.component.ts:31-162` | Template und Styles inline (DESIGN_SYSTEM erlaubt inline nur `TD_CSS_VARS`), Scrim als `rgba(11,15,12,…)` von Hand |
| T7 | `coop-dock.ts:272-275`, `coop-squad.ts:69`, `coop.service.ts:952` | Lane-Farbe dreimal umgerechnet, ohne Lane reines Weiß |
| T8 | `coop-entry.ts:69-78, 149`, `coop-dock.ts:294` | `started`-Flag im effect statt `linkedSignal`; `setTimeout` ohne Aufräumen beim Destroy; zwei Timer setzen `lanQuiet` |
| T9 | `coop-squad.ts:68,108,155` | Versalien im TS (`'NO LANE'`), Vergleich auf den Anzeigetext |
| T10 | alle Coop-SCSS, Button-Mixins | Kein `:focus-visible`; Input-Fokus nur als schwacher Rand; `.spin`, `ping-in` ohne `prefers-reduced-motion` |
| T11 | `coop-dock.ts:54-61`, `coop-dock.html:342`, `game-header.html:127`, `coop-squad.html:227` | `role="dialog"` ohne Fokusführung und Esc; `role="menu"` ohne Pfeiltasten, Esc, Klick daneben |
| T12 | z-index 5, 6, 7; Breiten 440/820/400 px | Lose Zahlen; Squad (6) auf Höhe der Fähigkeitenleiste |
| T13 | Glyphen `'✓ Ready'`, `'● ISSUE'`, `'—'` | Statt `td-icon` |
| T14 | `tower-defense.component.html:114`, `coop-chat` | Ping-Pfeile mit 8-Hz-Timer auch im Einzelspiel; Chat-Timer läuft weiter, wenn alle Zeilen ausgeblendet sind |
| T15 | Reste | Verwaister Kommentar `game-sidebar.component.scss:118`; Invite-Join im Sidebar-Konstruktor (`game-sidebar.ts:77-81`); `.coop-btn` doppelt in `game-header.scss:295,304`; "Server" statt "Lobby" in `coop.service.ts:127`, `DESIGN_SYSTEM.md:315`; Klassen `.lan-list/.lan-game` auch für Online-Räume |

### Design

| # | Befund | Beleg |
|---|---|---|
| G1 | Tab-Leiste springt: Dialog senkrecht zentriert, je Tab andere Höhe (bei 1600x900 y≈155 bis 261) | gesehen |
| G2 | Erster Start heißt "Change Location", "Spawn Only" ausgegraut, Tab-Labels brechen zweizeilig um, weißer Fokusrahmen am ersten Tab | gesehen |
| G3 | Zwei Überschriften-Stile: Standort-Tabs Inter fett mit Icon im Kasten, Coop-Tab Mono-Gold-Versalien mit Linie | gesehen |
| G4 | Lobby-Verwaltung (Zahnrad, Radioliste, Name, wss://, Add, Check) mitten im Beitrittsweg; Zahnrad bei 14 px wie eine Sonne | gesehen |
| G5 | Dock ohne Raum: zwei gleichrangige Gold-Knöpfe "Host LAN game" und "Host online" | abgeleitet |
| G6 | "Lobby antwortet nicht" als Fließtext, Codefeld bleibt aktiv; Kartenschlüssel-Hinweis als abgesetzte Fußnote | gesehen |
| G7 | Raum im Dock sehr dicht, Spieler und Lanes doppeln die Zuordnung, bis zu drei Banner | abgeleitet |
| G8 | Tab "New Location": Suche, Spawn mit Infobox, Showcase-Liste alle offen; zwei Bestätigungsmodelle | gesehen |
| G9 | HUD unten links: Squad (bis ~260 px), Chat, Logos, Hinweise; Überschneidung bei 720p möglich, nicht geprüft | abgeleitet |

### Behalten

Farben nur aus Tokens, Coop-Bausteine zentral in `_coop-ui.scss`, Ecken 0. Beitrittsschritte mit
Kartenfortschritt. Raumzeilen mit Titel, Host, Stadt, Belegung, Tags. Lane-Farbe als Balken links. Squad-Fuß mit
fester Höhe. World-Kugel mit Bestwelle und leerem Zustand. Chat-Muster (Name nur über dem ersten Satz, Systemzeilen
in Mono, alte Zeilen gedimmt). Raum-Chip im Kopf.

## 2. Ziel

### Standortdialog

```
Choose a place  (mit Ort: Change place)              ✕
Place   World   Coop                        einzeilig, fest
──────────────────────────────────────────────────────
[🔍 City, street or address …                    ]
  Coordinates ▾
RECENT | SHOWCASE ──────────────────────────────────
  New York, Times Square
    From Columbus Circle down to Times Square
  Paris, Pont d'Iéna
  …                                         (scrollt)
Spawn: random, 0.5 to 1 km ▾
──────────────────────────────────────────────────────
                            [Cancel]  [Load place]
```

- Feste Höhe `min(640px, 100vh - 48px)`, nur der Inhalt scrollt. Kopf, Tabs und Knopfzeile stehen immer gleich.
- Titel je nach Lage: "Choose a place" ohne Ort, "Change place" mit Ort.
- Tabs kurz und einzeilig: Place, World, Coop. Fokus nur bei Tastatur sichtbar, im Stil der Gold-Unterstreichung.
- "Spawn Only" ist kein Tab mehr (U1). Mit geladenem Ort steht im Place-Tab unter der Suche ein Link "Move the
  spawn by address…", der die heutige Adresssuche für den Spawn aufklappt.
- Spawn im Place-Tab eingeklappt als eine Zeile (U2). Aufgeklappt: Random/Manual wie heute.
- "Load place" erscheint erst, wenn in der Suche ein Ort gewählt ist. Recent und Showcase laden weiter per Klick.
- Ein Abschnittskopf-Mixin für alle Tabs, keine Kästen in Kästen.

### Coop-Einstieg (Dialog-Tab und Dock ohne Raum)

```
Your name [Player                ]
          Every player needs their own map key.       (nur ohne Schlüssel)
[ Online | Same network ]           Lobby: EU ▾   42 ms
OPEN ROOMS ────────────────────────────────────── ⟳
  Ann's room   Stuttgart · 2/4   Lobby         [Join]
  Bob's game   Paris · 4/4       In game · 12  [Join]  (grau, Grund sichtbar)
Code [ABC123] [Join]
[ Host a room ]                               (nur im Dock)
```

- Umschalter Online | Same network (U3), "Same network" nur in der App. Gemerkt wird der zuletzt benutzte Weg.
- Lobby-Wahl als Auswahlliste im Kopf der Online-Seite; letzter Eintrag "Add lobby…" klappt Name und Adresse auf.
  "Check" entfällt, der Ping in der Kopfzeile zeigt den Zustand.
- Offline: eine Warnzeile mit "Retry" statt Fließtext. Beitritt per Code bleibt möglich (die Lobby kann den Code
  trotzdem kennen, wenn nur die Liste hängt); ob das stimmt, prüfe ich im Relay, sonst wird das Feld deaktiviert.
- Warum ein Raum gesperrt ist, steht sichtbar in der Zeile (F2), nicht nur im Tooltip.
- Ein Host-Knopf "Host a room" für den gewählten Weg. Im Dialog-Tab kein Host, dafür eine Zeile: "To host, pick a
  place first, then open Coop in the header."

### Raum im Dock

```
Coop room · Stuttgart · 3 lanes                        ✕
Room code  ABC123   [Code] [Invite link]   Open to new players ●
Waiting on Bob (loading the map)                     ▮▮▯
LANE        LENGTH        PLAYER          READY  PING
▌Spawn 1    ████  820 m   Ann  HOST       ✓      ▂▄▆
▌Spawn 2    ███   610 m   Bob  YOU        ·      ▂▄_   ⌖ ⚑ ✕
▌Spawn 3    █████ 1.1 km  Free · take                  ⌖ ⚑ ✕
Without a lane: Carl (loading the map…)
⚠ Not everyone plays on the same engine            (eine Zeile, schwerste zuerst)
Mode & options ▾   PvE Coop · Normal · Cheats off
[Leave]                                    [⋯] [Start match]
```

- Eine Tabelle Lane und Spieler (U4). Spieler ohne Lane darunter. Freier Platz als letzte Zeile wie heute.
- Banner (Desync, Map wechselt, gemischte Engines) als eine Zeile nach Schwere, ausklappbar bei mehreren.
- Chat rechts bleibt als eigene Spalte.

## 3. Entscheidungen

| # | Thema | Entscheidung |
|---|---|---|
| U1 | Spawn Only | Kein Tab mehr; Adresssuche für den Spawn als aufklappbarer Link im Place-Tab, nur mit geladenem Ort (User, 2026-09-25) |
| U2 | Place-Tab | Suche oben, Recent/Showcase als Hauptliste, Spawn eingeklappt, Bestätigen erst nach Suchauswahl (User, 2026-09-25) |
| U3 | Coop-Einstieg | Umschalter Online / Same network, Lobby als Auswahlliste mit "Add lobby…", ein Host-Knopf, letzter Weg gemerkt (User, 2026-09-25) |
| U4 | Raum im Dock | Eine Tabelle Lane / Spieler / Ready / Ping, Spieler ohne Lane darunter, Banner zu einer Zeile (User, 2026-09-25) |
| U5 | Hotkeys | Auf Knöpfen normales Tab und Enter, Tab bleibt die Dock-Taste, Esc schließt das Dock zusätzlich (User, 2026-09-25). Umgesetzt: Tab und Enter gehören einem Knopf, den der Spieler per Tastatur erreicht hat (`:focus-visible`); nach einem Mausklick behält der Knopf den Fokus, die Spieltasten gehen trotzdem (sonst pingt X nach jedem Klick nicht mehr). Im Dock wandert Tab immer durch die Knöpfe. Esc schließt das Dock als letztes Glied der Esc-Kette im HotkeyService |
| U6 | Dialoghöhe | Feste Höhe, der Inhalt scrollt (User, 2026-09-25) |
| U7 | Mobil | Kein Ziel, nichts dafür bauen (User, 2026-09-25) |
| U8 | Squad-HUD | Erst mit Karte bei 1280x720 per E2E-Screenshot messen, dann straffen (Zeilen 32 px, Chat-Tastenhinweis nach den ersten Nachrichten weg) (User, 2026-09-25) |

## 4. Pakete

Reihenfolge nach Risiko: erst die Fehler, dann die gemeinsame Basis, dann die sichtbaren Umbauten. Nach jedem Paket
`npm run build`, `npm run lint`, `npm test`; E2E, wo ein Klickweg sich ändert.

### P1 Tastatur und gesperrte Knöpfe (F1, F2, T11)

- `coop-chat.onKey`: Hotkeys nur, wenn `event.target` body oder der Canvas ist (U5). Ein Helfer neben `ownsKey`
  in `utils/keyboard-target.ts`, z. B. `isFreeTarget(target)`, mit Spec. Esc schließt das Dock, wenn es offen ist
  und kein Ping scharf ist. Prüfen, wer Esc sonst hört (Platzierung, Turmsteuerung), Reihenfolge festhalten.
- `mousedown.preventDefault` am Kopf-Chip bleibt: es ist die Entscheidung aus PLAYTEST T63 (kein Fokus nach dem Klick), nicht nur ein Umweg um F1.
- Gesperrte Knöpfe: `aria-disabled` plus Guard im Handler, wie DESIGN_SYSTEM es für die Fähigkeitenleiste
  vorschreibt; der Grund zusätzlich als Text in der Zeile, wo Platz ist (Raumliste, LAN-Liste).
- `role="dialog"` am Dock wird `role="region"` mit `aria-labelledby`; `role="menu"` an "More", Spawn-Menü und
  Geschenk-Popover weg (einfacher Knopf mit `aria-expanded`), dazu Esc und Klick daneben.
- Tests: Szenario für Tab und Enter auf einem Knopf im Dock, Spec für den Helfer, Spec für den Guard.

### P2 Gemeinsame Coop-Basis (T2, T6, T7, T8, T9, T10, T12, T13, T14)

- `_coop-ui.scss`: Mixins `note` (Varianten error, ok, warn, with-icon), `banner`, `kbd`, `spinner` (mit
  `prefers-reduced-motion`), `panel-frame`; `@mixin classes` für das gemeinsame Klassen-Mapping, weil die
  View-Encapsulation keine globalen Klassen durchlässt. `:focus-visible` in `btn-shape`, `icon-btn`, `segmented`
  und im Input-Mixin (sichtbarer Gold-Rand statt `--td-gold-dark`).
- Dock, Einstieg, Squad, Chat darauf umstellen, Doppeltes löschen. Chat bekommt eigene `.html` und `.scss`.
- Ein Helfer `laneCss(index)` für alle drei Stellen, Fallback `--td-text-secondary`.
- `coop-entry`: `linkedSignal` statt `started`-Flag; ein Timer für `lanQuiet`, beide beim Destroy aufgeräumt;
  ebenso der Kopier-Timer im Dock.
- Squad: Rohwerte statt Versalien im TS, `text-transform` im CSS.
- Glyphen durch `td-icon` ersetzen.
- z-index-Skala als Layout-Token in `td-theme.ts` (Dock, Squad, Chat, Ping-Pfeile, Fähigkeitenleiste).
- Ping-Pfeile nur mit `coop.inGame()` einbinden; Chat-Timer stoppt, wenn keine Zeile mehr sichtbar ist.

### P3 Standortdialog (G1, G2, G3, G8, T3, T4, U1, U2, U6)

- Rahmen: feste Höhe, Kopf und Knopfzeile fest, Inhalt scrollt. Titel nach Lage. Tabs Place, World, Coop.
- Place-Tab nach Abschnitt 2; Spawn-Only-Modus wird der aufklappbare Link, `LocationDialogMode` verliert
  `'spawn-only'`. Aufrufer von `initialMode: 'spawn-only'` suchen und umstellen.
- Abschnittskopf-Mixin für alle Tabs, Kasten-in-Kasten weg. Gold über `td.gold-button` und `td.frame-button`,
  altes Gold durch `color-mix` aus `--td-gold`.
- Beitritt: `app-coop-entry` meldet `(joined)` mit dem Ort des Hosts; der Dialog schließt im Handler, nicht im
  effect. `joinedPlace(place)` als reine Funktion mit Spec. Den Service über `MatDialogConfig.injector` reichen,
  `models/location.types.ts` verliert den Service-Import.
- Cancel während eines laufenden Beitritts klären: heute prüfen, was passiert; Ziel ist, dass Cancel den
  Beitritt abbricht (`coop.leave()`), nicht nur den Dialog schließt.
- Tests: bestehende Showcase- und World-Specs anpassen, neuer Spec für Titel, Tabs und Spawn-Link.

### P4 Coop-Einstieg (G4, G5, G6, U3)

- Umschalter Online / Same network, gemerkter Weg in localStorage (`3dtd-coop-way`), in der Web-Version nur Online
  ohne Umschalter.
- Lobby-Auswahlliste mit "Add lobby…", Entfernen eigener Lobbys im aufgeklappten Bereich; Check entfällt.
- Ein Host-Knopf, Offline-Warnzeile mit Retry, Grund gesperrter Räume in der Zeile, Kartenschlüssel-Hinweis nur
  ohne Schlüssel und unter dem Namen.
- Klassen neutral: `.game-list`, `.game-row`; `.tag.is-cheats` auf den Chip `is-warn`.
- E2E: Einstieg im Dialog und im Dock, Wechsel des Wegs, Lobby hinzufügen.

### P5 Dock aufteilen und Raumtabelle (T1, T5, T15, G7, G9, U4, U8)

- Reine View-Funktionen nach `coop-dock-view.ts` mit Specs (Vorbild `heroBarView`): Status, Start gesperrt,
  Beitrittsschritte (mit Feld `kind` statt Labelvergleich), Lanes mit Spielern, Banner nach Schwere.
- Unterkomponenten: JoinSteps, RoomHeader, RoomTable, RoomOptions, LobbyChat. Das Dock bleibt Rahmen und Fuß.
- Raumtabelle nach Abschnitt 2 (U4).
- Öffnen und Schließen des Docks an einer Stelle (CoopService oder kleine Coop-UI-Facade), die übrigen vier
  Schreiber gehen über sie. Invite-Join aus dem Sidebar-Konstruktor dorthin.
- Reste aus T15 entfernen, DESIGN_SYSTEM.md nachziehen (Coop-Abschnitt, z-index-Skala, Standortdialog).
- Squad (U8): E2E-Screenshot mit Karte bei 1280x720 in Lobby und Spiel, zwei und vier Spieler. Danach Zeilen
  32 px und Chat-Tastenhinweis ausblenden, falls die Messung eine Überschneidung zeigt.

## 5. Offen

Nichts mehr aus diesem Plan. Die Fragen von hier sind in Abschnitt 6 beantwortet (Code bei stummer Lobby, Esc,
Cancel beim Beitritt); die Nachtests stehen in [PLAYTEST.md](PLAYTEST.md) als T73 bis T75. Esc-Reihenfolge: ein
scharfer Ping (Chat), das Spawn-Menü im Kopf, Zelle, Fähigkeit, Platzierung, Bau (InputHandler), dann die Kette
des HotkeyService mit dem Dock als letztem Glied; ein Feld im Dock schließt es selbst.

## 6. Beim Bauen anders als geplant

- **U5, Tastatur:** `:focus-visible` taugt nicht, um einen per Maus fokussierten Knopf zu erkennen: Chrome schaltet es
  nach einem Klick beim ersten Tastendruck ein (Browser-Test 2026-09-26). Die Herkunft des Fokus merkt sich
  stattdessen `FocusOrigin` (`utils/keyboard-target.ts`): ein Fokus bis 600 ms nach `pointerdown` ist der Maus.
- **Kopf-Chip:** das `mousedown.preventDefault` bleibt, es ist die Entscheidung aus PLAYTEST T63 (kein Fokus nach dem
  Klick). Der E2E-Test zu T54/T63 hat das gezeigt.
- **Cancel beim Start:** Der Startdialog hatte ein Cancel, das die Ortswahl ohne Ort beendete. Beim Start gibt es jetzt
  kein Cancel mehr; der Coop-Einstieg hat beim Verbinden ein eigenes Cancel (`coop.leave()`), das beantwortet die
  offene Frage aus Abschnitt 5.
- **Code bei stummer Lobby:** Liste und Beitritt laufen über denselben Server. Das Codefeld bleibt trotzdem aktiv,
  ein Fehlschlag meldet der Beitritt selbst; die Warnzeile hat Retry.
- **Beitritt aus dem Dialog:** bleibt ein `effect` auf `hostPlace` (das Signal kommt asynchron), aber ohne feste
  Namen: `joinedPlaceResult()` ist eine reine Funktion. Der Dienst kommt über `MatDialogConfig.injector` und das
  Token `COOP`, das Model importiert keinen Service mehr.
- **Dock-Teile:** vier Unterkomponenten statt fünf (JoinSteps, RoomTable, RoomOptions, LobbyChat); Code, Listing
  und Status bleiben im Dock, das ist wenig. Die automatischen Regeln (öffnen beim Raumeintritt, schließen beim
  Spielstart) und der Beitritt per Einladungslink liegen im `CoopService`.
- **Suchfeld:** `address-autocomplete` auf 38px und 13px gebracht, wie die Coop-Felder; es wird nur im Standortdialog
  benutzt.
- **Wettlauf in der Session (gefunden per E2E T36, älter als der Umbau):** `CoopSession` wartet immer nur auf eine
  Antwort. Fragte der Einstieg die Raumliste ab, während ein Beitritt lief, nahm die Liste die Ablehnung des Beitritts
  („does not answer“), und der Beitritt wartete für immer, ohne Fehler. Jetzt lehnt die Session eine zweite Anfrage
  sofort ab, und `refreshPublicRooms` fragt nicht, solange ein Beitritt oder Hosten läuft. Spec in
  `coop.service.scenario.spec.ts`.
- **Esc im Dock:** In einem Feld des Docks (Code, Name, Lobby-Auswahl) schließt Esc das Dock über einen eigenen
  Handler, die Esc-Kette lässt Tasten der Felder aus.
- **Breite:** Im Raum ist das Dock 860px breit (Raumspalte 480px), sonst war der Name in der Tabelle zu schmal.
- **U8 gemessen (DevWorld, Squad über die Dev-API gefüllt, 1280x720 und 1600x900):** Squad-Box, Chat und Logos
  überschneiden sich nicht, aber die Squad-Box lag über den unteren Fähigkeitsknöpfen (bei 4 Spielern ab y 201, die
  Knöpfe bis y 285, beide bei x 12 bis 62). Die Box steht jetzt rechts neben der Leiste wie das Dock, die Zeilen
  sind 36 statt 42px, der Tastenhinweis unter dem Chat geht nach der ersten eigenen Nachricht.
- **Kleinigkeiten danach:** Esc schließt das Spawn-Menü im Kopf; „Copy invite“ am freien Platz zeigt wieder
  „Copied“; der Chat-Timer hat einen Spec.
