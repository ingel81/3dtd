# Review-Handover: Fix-Session 2026-09-14

Fix-Session nach dem Playtest vom 2026-09-14, auf dem Branch
`sprint/night-2026-09-14` (Ende der Nacht 2 plus Playtest-Doku). Auftrag:
die Befunde des Playtests (TODO 1.10, dazu der Korridor in 1.7) und die
fixbaren Befunde der Nacht 2 (TODO 1.9). Alles liegt lokal, `main` ist
unberührt, nichts ist gepusht. DONE.md ist nicht angefasst. In TODO.md hat
jeder bearbeitete Eintrag eine Zeile "Stand (Fix-Session 2026-09-14)"
bekommen, verschoben ist nichts (siehe "TODO-Stand"). Die Runde davor steht
in [REVIEW_SPRINT_2026-09-14.md](REVIEW_SPRINT_2026-09-14.md).

**Reihenfolge für den Playtest:** zuerst die Liste unten ab 501. Danach die
offenen Punkte der älteren Listen: Nacht-2-Liste 301 bis 440 (noch ohne
Ergebnis), Nacht-1-Liste 117, 121, 142, 144, 151, dann 154 bis 231 und 238,
alte Liste 53. Wo diese Session einen alten Punkt ändert, steht es am Anfang
der Playtest-Liste.

**Stand dieses Dokuments:** Code-Stand `633ec1cf` (fixrev2, letzter
Code-Commit der Session), darüber die Handover-Commits.

## Stand

| | |
|---|---|
| Branch | `sprint/night-2026-09-14`, letzter Code-Commit `633ec1cf` |
| Diese Session | 45 Commits `f6a5a0bd..633ec1cf`; 159 Dateien, +5 134 / -1 123 Zeilen. Der Cheat "-HP" (`83f781ff`) liegt davor, sein erstes Gate lief am `f6a5a0bd` grün |
| Tests | Gate am `633ec1cf`: vitest 317 Testdateien, 3 996 Tests grün, 27 übersprungen (Shader-Compile-Tests ohne `glslangValidator`); Sessionbeginn `f6a5a0bd` 312 Dateien, 3 876 Tests. pytest 101 grün am `5ae79d52` (n2rest hat das Backend geändert) |
| Prüfung | Gate am `633ec1cf`: beide tsc, ESLint und Production-Build grün; Initial-Bundle 359,22 kB (Beginn 357,21 kB, +2 kB mit Favoriten und Umzugs-Hinweis) |
| Shader | Geändert haben sich der Suchscheinwerfer-Shader (`aSweep` wird `aBeam`) und die Probehöhe im Shader der LOS-Anzeige (`66569eca`). `npm run shader-check` mit glslang am `633ec1cf` (Lead): 57 von 57 grün |

Nicht in dieser Session: Balance (wartet auf den Run-Dump, TODO 2.2),
Messaufgaben (TODO 1.4 und 1.5: 20k-Benchmark gegen `02278dc` und
`39fbb18`, Ladezeit gegen `412cbff`), der Run-Dump selbst, die
BVH-Entscheidung, der Forschungsbaum-Dialog (Idee in TODO 3.7), Mobile.
Balance-Werte hat kein Commit geändert.

Nichts davon lief im Browser. Was sichtbar oder hörbar ist, ist per Code,
Tests und Rechnung geprüft und steht als Playtest-Punkt unten. Wo ein Befund
nur aus dem Code abgeleitet ist, sagt der jeweilige Abschnitt das.

## Vorgehen

Acht Worker, alle vom `f6a5a0bd`, je ein Thema in einem eigenen Worktree:
research, visuals, portal, controls, hud, location, n2rest (restliches TODO
1.9), corridor. Vor jedem Merge hat der Lead den Diff gelesen. Auf den
Branch-Head rebased haben teils die Worker, teils der Lead (visuals, portal,
controls, hud, location und n2rest zuletzt durch den Lead; Konflikte lösten
die Worker selbst), übernommen wurde per Fast-Forward, nach jedem Merge lief
das Gate (vitest, beide tsc, ESLint,
Production-Build). Danach haben drei Review-Agents den gemergten Stand
gelesen (review-a: research, controls, hud, location; review-b: visuals,
portal, n2rest; review-c: corridor). Ihre Befunde bearbeiten fixrev1 (A1
bis A6, B1, B2) und fixrev2 (C1 bis C4).

Die Worker-Berichte nennen oft Hashes von vor dem Rebase. In diesem Dokument
stehen die Hashes des Branches.

## Entscheidungen zu Beginn (User)

1. Arbeitsweise wie in der Nacht 2.
2. **Onboarding-Tipps:** Ein Worker macht einen Vorschlag und setzt ihn als
   eigenen Commit um (`4a219445`).
3. **Favoriten:** keine Grenze mehr, die Liste scrollt (`a30d8412`).
4. **Research-Queue:** Knoten mit offenen Voraussetzungen sind wieder
   gesperrt, das Verhalten von `7914062f` ist zurückgenommen (`a1bcb3d5`).
5. **Fähigkeiten** erscheinen erst nach ihrer Forschung in der linken
   Leiste (`586f493e`). Ersetzt die Nacht-2-Entscheidung 3 ("gesperrt
   sichtbar").
6. **Blutmond-Scheinwerfer** zeigen in Schuss- bzw. Blickrichtung des Turms
   und drehen mit ihm (`6a42d3a5`).
7. Balance, Messaufgaben, Run-Dump und Forschungsbaum-Dialog: nicht in
   dieser Session.

## Was sich ändert

### Forschung und Tipps (research, `a1bcb3d5`, `4a219445`, 2 Commits)

- **Queue wieder streng** (`a1bcb3d5`, `git revert 7914062f`): Ein
  gesperrter Knoten ist wieder `disabled`, sein Tooltip sagt nur "Requires:
  ...", seine Meta-Zeile zeigt kein "· queue" mehr. `canQueueResearch()` lehnt fehlende Voraussetzungen
  ab ("Prerequisites not met"). `startQueued()` arbeitet wieder strikt am
  Kopf: Der Kopf wartet auf Slot und Gold, nichts dahinter überholt.
  Entfernen und Abbrechen betreffen nur den einen Eintrag, keine Kaskade.
  Damit gilt der Nacht-1-Playtest 109 wieder.
- **Tipps nach dem Spielablauf** (`4a219445`): 7 statt 4 Tipps, Texte weiter
  Englisch, neuer Key `td_onboarding_v2`. Tipps 1 und 2 kommen sofort, 3 bis
  7 erst, wenn ihr Moment da ist:

  | # | Tipp | kommt | endet bei |
  |---|---|---|---|
  | 1 | Build a tower | sofort | `tower:placed` (kein Research Center) |
  | 2 | Start the first wave | nach 1 | `wave:started` |
  | 3 | Upgrade a tower | nach Welle 1 | `tower:upgraded` (nicht der Research Wing) |
  | 4 | Build a research center | nach Welle 2 | `tower:placed` Research Center |
  | 5 | Start a research | sobald ein Center steht | `research:started` (Öffnen reicht nicht) |
  | 6 | Use an ability | sobald eine Fähigkeit erforscht ist | `ability:used` |
  | 7 | Hire the Mercenary | sobald Mercenary Contract fertig ist | Held angeheuert |

  Geschwindigkeit und Verkaufen stehen als Tastenkappen in Tipp 2 und 3.
  Wer einen Schritt schon getan hat, bevor sein Tipp dran ist, bekommt ihn
  nicht mehr (ein Center in Welle 1 heißt: kein Center-Tipp). Den
  Fortschritt liest der Service aus Bus-Events, er wird nicht gespeichert
  und bei `game:reset` zurückgesetzt. "Skip" überspringt genau den gezeigten
  Tipp.
- Die Schwelle "nach Welle 2" für den Center-Tipp
  (`RESEARCH_TIP_AFTER_WAVE` in `onboarding.ts`) ist aus dem Kurrikulum
  abgeleitet (Start mit 100 Credits, billigste Forschung 400, Welle 1 zahlt
  200, Welle 2 400), nicht gespielt.
- Wer die alten Tipps beendet oder versteckt hat, sieht die neuen einmal;
  der alte Eintrag `td_onboarding_v1` bleibt ungelesen im localStorage.
- Der Cheat "Research" sendet kein `research:started` (`completeAllResearch()`
  meldet je Knoten nur `research:completed`): "Start a research" bleibt dann
  stehen, bis man ihn überspringt oder selbst forscht. Der Cheat "Hero"
  heuert sofort an, der Held-Tipp erscheint dann nicht.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `a1bcb3d5` | stellt `7914062f` wieder her: gesperrte Knoten reihen sich mit ihrer Kette ein | konfliktfrei. Die Vermerke "überholt durch `a1bcb3d5`" aus `b74117f7` in REVIEW_SPRINT-13/-14 und aus dem TODO-Stand in TODO.md stimmen danach nicht mehr; der gedroppte Queue-Test von n2rest fehlt |
| `4a219445` | 4 Tipps, Key `td_onboarding_v1` | konfliktfrei |

### Blutmond und Screenshot (visuals, `6a42d3a5` bis `1997c45b`, 3 Commits)

- **Scheinwerfer folgen dem Turret** (`6a42d3a5`): Der Kegel zeigt dorthin,
  wohin der Turm zielt. `SearchlightRenderer` liest in jedem Frame, in dem
  die Kegel sichtbar sind, `ThreeTowerRenderer.aimHeading(id)` und lädt nur
  hoch, wenn sich ein Turm gedreht hat (ein Bereich über die gezeichneten
  Slots, 8 Byte je Kegel). Der eigene Schwenk ist entfernt (`uTime`,
  `uSweepArc`, `advance()`, `setHeading()`, `sweepArcDeg`, `sweepPeriodS`;
  Attribut `aSweep` wird `aBeam`). Archer, Lightning und Tentacle haben kein
  Turret-Teil: Ihre Zielrichtung dreht jetzt ohne Modell mit, ihr Kegel folgt
  Zielen und Wachrichtung. Feuern unverändert, `isTurretAligned` gibt ohne
  Turret-Teil weiter `true` zurück. Der Kegel eines neuen Turms bleibt
  dunkel, bis sein Modell geladen ist. Im Replay nimmt der Player die
  aufgezeichnete Drehung auch für Türme ohne Turret; aufgezeichnet wird sie
  für Archer und Lightning erst seit `18d7cef7` (fixrev1, B1).
- **Screenshot mit Logo und Adresse** (`2e2b266c`): `stampScreenshot()`
  ersetzt `stampAttribution()`. Das Logo steht halb durchsichtig (0,6) unten
  rechts über der Attributionsleiste, 4 Schriftgrößen hoch (bei 1080p 48 px);
  `https://3dtd.sgeht.net` klein unten links hinter den Anbieter-Logos auf
  deren Mittellinie. DevWorld: beides, die Adresse am Rand. Lädt das Logo
  nicht, steht nur die Adresse. Nur das gespeicherte PNG ändert sich. Höhe,
  Deckkraft und Lage sind gesetzt, nicht am Bild abgestimmt. Wo die
  Attributionsleiste bis unter die Adresse reicht (schmale Bilder, lange
  Attribution), rückt die Adresse seit `794415b3` (B2) eine Zeile höher.
- **Banner wartet auf das Boss-Intro** (`1997c45b`): Ist das Banner fällig,
  während ein Intro läuft, wartet es bis zu dessen Ende. Startet ein Intro,
  während das Banner steht, bricht es ab und läuft danach noch einmal ganz,
  falls es vor 72 % seiner Laufzeit war. Folge: kurz nacheinander einmal
  kurz, dann ganz (gewollt). Die Screenreader-Ansage bleibt beim
  Wellenstart.
- TODO 1.9 "Blutmond: Grenzen des Looks": Die Decals sind schon seit
  `3f1f5fdc` (Nacht 2, fix2) getönt, der TODO-Text ist korrigiert. Die
  übrigen Grenzen (Transparentes und Glasteile ungetönt, Rotstich statt
  Entsättigung, kein Lichtfleck am Boden) sind bewusst so; die Kosten sind
  nicht gemessen.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `6a42d3a5` | Kegel schwenken wieder selbst um die Wachrichtung | Konflikt in `WAVE_SYSTEM.md`, `replay-player.ts` und Spec; mit `18d7cef7` zuerst konfliktfrei |
| `2e2b266c` | Screenshot nur mit Attribution | Konflikt in `DESIGN_SYSTEM.md`, `screenshot.ts` und Spec; mit `794415b3` zuerst konfliktfrei |
| `1997c45b` | Banner wieder beim Wellenstart, auch unter dem Intro | konfliktfrei |
| Block, mit `794415b3`, `18d7cef7` zuerst | alles oben | konfliktfrei |

### Spawn-Portal (portal, `5a061423` bis `8e79069f`, 3 Commits)

- **Ausrichtung an einer Kurve** (`5a061423`): Ursache aus dem Code
  abgeleitet, der Ort der Screenshots ist nicht nachgestellt.
  `spawnPortalPose` zielte auf den ersten Wegpunkt mindestens 4 m vom Start.
  Knickt die Route in den ersten Metern (Kreisverkehr, kurzer Stummel), liegt
  der Knick im Portal (bis Skala 1 10,5 m tief, auf breiten Straßen tiefer),
  und die Route kreuzt die Vorderfläche
  neben der Mitte oder am Pfeiler. Jetzt zielt das Portal auf den Punkt, an
  dem die Route zum ersten Mal so weit vom Start weg ist wie die
  Vorderfläche; dort kreuzt sie die Öffnung mittig. Rein optisch: Weg der
  Gegner, Spawnpunkt, Luft-Ausflug und Boss-Einstellung sind unverändert.
  Grenze: Ein Knick näher als die halbe Tiefe (5,25 m, auf breiten Straßen
  bis etwa 9 m) lässt die Route im
  Volumen weiter seitlich laufen, die Gegner können innen einen Pfeiler
  schneiden. Ausweg ist dann R.
- **Vorschau grün, wenn gültig** (`23483121`): Die Gültigkeit war immer
  richtig, nur die Farbe nicht (gültig war die rote Spawnfarbe `0xef4444`).
  Jetzt grün wie HQ- und Tower-Vorschau, rot nur ungültig.
- **R dreht das Portal beim Setzen** (`8e79069f`): R gehalten dreht die
  Spawn-Vorschau mit 180° je Sekunde wie beim Tower; nur im Spawn-Modus,
  beim HQ dreht nichts. Die Karte unten zeigt dann "R Rotate", die
  Tastenübersicht nennt es in der R-Zeile. Eine gedrehte Richtung gilt über
  Neuaufbauten der Route (Korridor-Messung, Zell-Refresh), bis der Spawn neu
  hinzukommt: neu gesetzt (ohne R wieder automatisch), HQ umgesetzt, Ort
  gewechselt. Sie steht nicht in URL oder Favoriten, ein Reload verliert sie.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `5a061423` | Ausrichtung auf den ersten Wegpunkt ab 4 m | Konflikt in `ARCHITECTURE.md` (`8e79069f` setzt seinen Satz dahinter) |
| `23483121` | Spawn-Vorschau rot an gültigen Stellen | Konflikt in `map-placement.service.ts` und Spec (`8e79069f`, gleiche Stellen) |
| `8e79069f` | keine Drehung beim Spawn-Setzen | Konflikt nur in `map-relocation.service.spec.ts` (location und fixrev1 ändern den Spec); mit `4044c44a`, `f91dd3d8`, `ac5eafee`, `5bdce997` zuerst konfliktfrei. `8e79069f` zusammen mit `23483121` oder `5a061423` ohne diese Kette: derselbe Konflikt |
| Block, mit derselben Kette zuerst | alles oben | konfliktfrei |

### Steuerung (controls, `68f69772` bis `57858cb0`, 5 Commits)

- **U antwortet sichtbar** (`68f69772`): Kauft U etwas, steigt über dem
  Tower in Gold Track und neue Stufe auf ("FIRE RATE LV 4"), die Kachel im
  Tower-Panel blitzt 700 ms. Kauft U nichts, steigt dort der Grund in Orange
  auf ("NEED 120 CREDITS", "NEEDS RESEARCH", "FULLY UPGRADED"), über den
  Kacheln steht 2,5 s eine Zeile ("Need 120 more credits for Damage").
  Fehlen Credits und ist zugleich ein Tier gesperrt, nennt er die Credits.
  Beim Research Center genauso (Research Wing). Unverändert: Ein Klick auf
  eine Kachel zeigt keinen Welttext, U ohne gewählten Tower tut nichts. Der
  Text hängt nicht an der Einstellung "Damage Numbers" und startet 3 m über
  der Schusshöhe, nicht an der gemessenen Modelloberkante.
- **Knopf "Keys"** (`edb6d630`) im Sidebar-Fuß neben "Tips", öffnet die
  Tastenübersicht wie H und ?. Das Padding aller Fuß-Knöpfe sinkt von 6 auf
  4 px, damit fünf Labels in 299 px passen; die Breite ist aus
  Zeichenbreiten gerechnet, nicht gemessen.
- **Intro-Flug nur mit Esc und Maus abbrechen** (`f94813b7`): Esc
  überspringt den Flug, alle anderen Spieltasten wirken während des Flugs
  nicht (auch Pos1, N, WASD, Leertaste, Ziffern, H, P). Klick und Mausrad
  auf dem Canvas und "Skip Intro" brechen weiter ab. Verhaltensänderung:
  Die Leertaste startet im Intro keine Welle mehr.
- **Keine Hover-Reichweite bei gedrückter Taste** (`b1b684dd`): Ein Druck
  auf dem Canvas (jede Maustaste) nimmt die Reichweite weg und verwirft
  einen ausstehenden Pick; beim Loslassen über dem Canvas wird neu gepickt.
- **Vorderster Tower** (`57858cb0`): `ScreenPicker.raycastTowers()` nimmt den
  nächsten Treffer über alle Tower, bei gleichem Abstand den ersten der
  Liste; gilt für Hover und Klick. Kosten: Nach einem Treffer prüft ein
  Pick jetzt alle Tower (begrenzt durch den 100-ms-Takt des Hover-Picks und
  `raycaster.far`); nicht gemessen.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `68f69772` | U ohne Welttext und Kachel-Blitz | konfliktfrei |
| `edb6d630` | Knopf "Keys", Padding wieder 6 px | konfliktfrei |
| `f94813b7` | jede Taste bricht das Intro ab und wirkt | konfliktfrei; die Esc-Zeile aus `a99d0c92` nennt dann weiter den Intro-Flug |
| `b1b684dd` | Reichweite erscheint auch bei gedrückter Taste | konfliktfrei |
| `57858cb0` | erster Treffer in Einfügereihenfolge | konfliktfrei |
| Block | alles oben | konfliktfrei |

### Fähigkeitsleiste, Effekte, Vorschau (hud, `586f493e` bis `909fba4b`, 5 Commits)

- **Knöpfe erst nach der Forschung** (`586f493e`): Die Leiste zeigt nur
  erforschte Fähigkeiten, in der Reihenfolge von `ABILITIES`. Der
  Gesperrt-Zustand mit Schloss, seine Styles und der Tooltip mit Forschung
  und Preis sind entfernt. Ohne Mercenary Contract und ohne erforschte
  Fähigkeit gibt es keine Leiste (der Held-Knopf erscheint schon mit der
  Forschung, vor dem Anheuern); die Haarlinie unter dem Held steht nur, wenn
  eine Fähigkeit folgt. K, F, E und L tun vor der Forschung weiter nichts, die
  Tastenübersicht listet sie weiter. Folge: Vor der ersten Forschung fehlt am
  linken Rand jeder Hinweis auf Fähigkeiten; nur Tipp 4, der Forschungsbaum
  und die Tastenübersicht nennen sie.
- **Leiste aus einer Zahlenquelle** (`49d8e06e`): `ABILITY_BAR_PX` (Rand 12,
  Border 1, Padding 5, Knopf 44) in `ability-button.ts`, das SCSS bekommt die
  Werte per Host-Binding, `ABILITY_BAR_EDGE_PX` (68) wird daraus summiert.
  Keine Verhaltensänderung.
- **Drei Icons auf einer NEXT-Marke** (`f758f544`) in 8 statt 10 px. Heute
  ohne sichtbare Wirkung: Bis W210 trägt keine Marke drei Icons (gerechnet
  mit `peekUpcomingWaves`). Vorsorge.
- **Impact Effects** (`0b1dbdf4`, nur Test): kein Code-Defekt gefunden. Die
  Kette vom Schalter bis zum `ParticleEffectsRenderer` ist verdrahtet, der
  Knochen-Puff beim Split kehrt bei ausgeschaltetem Schalter sofort zurück;
  der neue Test fährt genau diesen Weg (an 12 Partikel, aus 0). Vermutung,
  unbelegt: Gesehen wurde der Todesclip des Skeletts (es fällt in seine
  Knochen) und das Auftauchen der zwei Minions, die der Schalter nicht
  abdeckt.
- **zombie_v2-Vorschau** (`909fba4b`): `previewOffsetY` 0 auf 0,85. Belegt
  ist nur eine Fehlrahmung: Die Vorschau misst die Box direkt nach dem
  Klonen, bevor die Knochen Welt-Matrizen haben; in `zombie_v2.glb` steht
  das Mesh vor den Knochen, gemessen wurden 0,02 m statt 1,70 m Höhe, die
  Kamera zielte auf die Füße. Dass die Figur still steht, ist nicht belegt:
  In jsdom läuft der Clip auf dem Vorschau-Weg (Knochen drehen sich,
  Vertices bewegen sich bis 0,45 m). Die Messung selbst zu korrigieren hätte
  zwölf Vorschauen verschoben; elf davon haben ein gegen die falsche Messung
  eingestelltes Offset, mech keines (MODEL_PREVIEW.md sagt pauschal zwölf).
- Nicht geändert: Bei niedriger Canvas-Höhe berührt die Leiste das
  aufgeklappte Info-Overlay (siehe "Offene Punkte"). Die Offscreen-Pfeile
  halten die 68 px auch dann frei, wenn keine Leiste da ist.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `586f493e` | gesperrte Knöpfe mit Schloss von Anfang an | Konflikt in `ability-bar.component.ts` und `ability-button.spec.ts`; mit `49d8e06e` zuerst konfliktfrei (auch zusammen mit `b74117f7`, dessen Vermerke "überholt durch `586f493e`" dann nicht mehr stimmen) |
| `49d8e06e` | Kante wieder per Kommentar gekoppelt | konfliktfrei |
| `f758f544` | drei Icons in 10 px | konfliktfrei |
| `0b1dbdf4` | nur der Test | konfliktfrei |
| `909fba4b` | zombie_v2 wieder auf die Füße gerahmt | konfliktfrei |
| Block | alles oben | konfliktfrei |

### Ortswechsel, Favoriten, HQ umsetzen (location, `4132607f` bis `ac5eafee`, 4 Commits)

- **Alter Korridor weg beim Ortswechsel** (`4132607f`): STEP 2 des
  Ortswechsels leert jetzt auch das Route-Grid: Zellen, Route-Grid-Overlay,
  Air-Route-Grid-Overlay und die Flughöhen-Röhre. Zwischen STEP 2 und STEP 6
  ist das Grid leer; die Route aus STEP 5 entsteht deshalb wie beim ersten
  Laden (Linie flach auf HQ-Höhe, Portal auf der Terrain-Probe). Dass die
  Overlays am neuen Ort sofort wieder stehen, macht `a99e7095` (fixrev1, A6).
- **Favoriten ohne Grenze** (`a30d8412`): Die Grenze 10 ist weg, die Liste
  scrollt, "Save location" bleibt oben. Speichern öffnet ein Namensfeld,
  vorbefüllt mit dem Header-Namen und markiert; Enter speichert, Esc bricht
  ab, leer speichert ohne Namen (dann wie bisher per Geocoding). Je Zeile
  hoch, runter, umbenennen, löschen. Der Key `td_favorites_v2` bleibt, alte
  Einträge lesen sich wie vorher. Keine Dublettenprüfung, Ordnen nur per
  Pfeil. Die Header-Komponente hat keinen DOM-Test.
- **Zeiten je Schritt** (`5bdce997`): Konsolenzeilen `[Relocation] HQ in
  place: ...` und `[Relocation] HQ outside the streets: ...`.
- **Hinweis während des Umzugs** (`ac5eafee`): Glas-Chip oben mittig mit dem
  Titel "MOVING HQ", darunter der Schritt: erst "Finding the route", dann
  "Measuring the corridor" mit Prozent und Balken, bis Messung und Neuaufbau
  durch sind. Beim Umsetzen außerhalb der geladenen Straßen steht dort
  "Loading streets" bis zum Ladescreen, sofern es keinen Spawn gibt oder der
  alte Spawn mehr als 1,5 km vom neuen HQ liegt (`SPAWN_DISCARD_DISTANCE`);
  sonst behält der Umzug den alten Spawn. Dazu die Zeile `[Relocation] HQ done: paint=
  work= corridor= total=ms` (seit `4044c44a` mit `ended=`). Der Umbau wird
  nicht schneller, er wird nur angezeigt; er beginnt zwei Animation-Frames
  später (bei 60 fps etwa 33 ms), damit der Chip vorher gezeichnet ist. In
  einem Hintergrund-Tab bleibt der Chip stehen, bis der Tab wieder vorne
  ist. Welcher Schritt in Paris die Zeit kostet, ist nicht gemessen
  (Playtest 541, 542).

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `4132607f` | alte Zellen und Overlays bleiben bis zum Neuaufbau stehen | konfliktfrei, auch zusammen mit `a99e7095` (dessen Aufrufe bleiben ohne `4132607f` harmlos) |
| `a30d8412` | Grenze 10, keine Namen, kein Ordnen | konfliktfrei, auch zusammen mit `b74117f7` |
| `5bdce997` | Zeitlogs | Konflikt: `ac5eafee` baut darauf auf; nur nach ihm |
| `ac5eafee` | Chip und Zeile `HQ done` | Konflikt in `LOCATION_SYSTEM.md`, `map-relocation.service.ts`, `path-route.service.ts` und Specs (fixrev1 A1 und A2 bauen darauf); mit `4044c44a`, `f91dd3d8` zuerst konfliktfrei |
| Block, mit `4044c44a`, `f91dd3d8` zuerst | alles oben | konfliktfrei |

### TODO 1.9, Rest (n2rest, `177ba53f` bis `5ae79d52`, 7 Commits)

- **Pause hält alle Loops** (`177ba53f`): Bisher hielt nur der Loop der Ooze
  an; Laufgeräusche und Flammen liefen weiter. Jetzt pausiert
  `SpatialAudioLoops.hold()` alle Loops und gibt das Budget der Gegner-Loops
  frei; ein in der Pause erzeugter Loop startet pausiert. Beim Fortsetzen
  laufen die Loops in Hörweite weiter (Gegner-Loops, soweit das Budget von
  12 reicht, in Erzeugungsreihenfolge), die übrigen beim nächsten
  Positions-Update. Der Ooze-eigene Hold ist entfernt. Boss-Intro und Replay
  pausieren über denselben Weg, dort stehen die Loops jetzt ebenfalls (nicht
  angehört).
- **Lautstärke nach der Pause** (`5ae79d52`): Ein fortgesetzter Loop nimmt die
  aktuelle Master-Lautstärke, nicht die vom Pausieren.
- **Training** (`cc1ee892`, `1b4722cd`): `WaveOutcome.perfect` kommt aus
  `wave:completed` (der Server las ein Feld, das es nicht gab); nur im Log,
  der Reward ändert sich nicht. Der Client meldet `BUILD_VERSION` (heute
  `v0.2.0`) statt fest `'1.0.0'`, das Backend schreibt beim Connect einen
  Eintrag `client_session` ins JSONL.
- **Tastenübersicht** (`821c0cf6`): Esc-Zeile für das Boss-Intro; seit
  `a99d0c92` lautet sie "Skip the intro flight or the boss intro".
- **Wurm-Pfeile** (`66a5468a`): Für die Offscreen-Pfeile ist nur der Kopf
  jedes Wurmstücks ein Boss, nicht jeder Ring.
- **Test** (`8404cd10`): Die Boss-Intro-Sperre in `ReplayService.enter()` hat
  eine Spec; ohne die Bedingung fällt sie (Mutationsprobe).
- Der Test zur Research-Queue ist verworfen, weil `a1bcb3d5` die Regel
  zurückgenommen hat.
- n2rest hat jeden Punkt aus 1.9 eingeordnet, die meisten mit Belegstelle
  im Code (Klassen: behoben, User-Entscheidung, Messung im Browser, bewusst
  so, außer Scope, anderer Worker, entfällt, zurückgestellt). Die
  Entscheidungen stehen unter "Offene Punkte", der Stand je Eintrag in
  TODO.md. Korrektur zu Punkt 17 des Berichts ("ein Sprung lädt die
  Ladungen nicht nach"): Das hält nicht. `GameStateManager.jumpToWave` ruft
  `abilityManager.advanceWaves(skipped)`; der Sprung lädt also nach wie
  abgeschlossene Wellen (nur erforschte Fähigkeiten, höchstens bis voll), wie
  in der Nacht 2 beschrieben (Playtest 381 gilt).

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `177ba53f` | nur die Ooze hält in der Pause an | konfliktfrei; vorher `5ae79d52` zurücknehmen (dessen Spec nutzt `holdLoops`), zusammen konfliktfrei |
| `5ae79d52` | Loop nach der Pause mit alter Lautstärke | konfliktfrei |
| `cc1ee892` | kein `perfect` im Outcome | konfliktfrei |
| `1b4722cd` | `gameVersion` fest `'1.0.0'`, kein `client_session` | konfliktfrei; berührt `training-backend/`, danach pytest |
| `821c0cf6` | keine Esc-Zeile | Konflikt in `hotkey-map.ts` und Spec; mit `a99d0c92` zuerst konfliktfrei |
| `66a5468a` | ein Boss-Pfeil je Ring | konfliktfrei |
| `8404cd10` | nur der Test | konfliktfrei |
| Block, mit `a99d0c92` zuerst | alles oben | konfliktfrei |

### Routenkorridor (corridor, `0e9b9280` bis `7bb91a6e`, 5 Commits)

Alle Aussagen zu Rothenburg und Paris sind aus dem Code abgeleitet, nicht am
Ort gesehen.

- **Breites Stück endet am Knoten** (`0e9b9280`): Jedes Segment hatte runde
  Enden mit seiner vollen Halbbreite. Wo der Korridor schmaler wird, griff
  das breitere Stück bis zu 7 m in das schmalere hinein, also ins Haus; der
  Dach-Check setzte diese Zellen orange auf den Boden. Jetzt reicht das Ende
  an einem Wegpunkt nur so weit, wie ein Gegner dort stehen kann (Grenze des
  schmaleren Segments plus halbe Zelldiagonale). In diesen Zellen konnte
  nach der Herleitung (von review-c nachgerechnet) kein Gegner stehen, sie
  kosteten Zellen, Proben und Optik. Zwei der neuen Builder-Specs sind auf
  dem alten Code rot (vom Worker gegengeprüft). Rest: An der Innenseite eines Knicks reicht das
  runde Ende weiter bis zur schmaleren der beiden Innenbreiten.
- **Zelle auf einem Auto steht auf der Straße** (`33ce898d`): Unter einem Auto
  hat die Photogrammetrie keinen Boden, die Zelle nahm das Dach; der
  Dach-Check griff erst ab 2,5 m. Neu ist ein Stufen-Check: Von der
  Mittellinie nach außen gilt eine Rasterstelle als erreicht, wenn ihr Boden
  höchstens `stepRise` (0,75 m) über dem höchsten erreichten liegt, oder um
  die Querneigung mehr. Liegt die Zelle höher, nimmt sie den Boden der
  letzten erreichten Stelle und wird orange (`clamped`). Abwärts gilt jede
  Stufe, der Gehweg hinter einer Autoreihe zählt wieder. Der Dach-Check hat
  Vorrang. Folgen: mehr orange Zellen, der Korridor bleibt so breit wie
  bisher, Gegner mit großem Seitenversatz laufen durch das Auto statt
  darüber. Review-c fand eine Folge für die Sicht der Tower (C1), die
  fixrev2 behebt (`66569eca`, siehe dort). Kosten nicht gemessen. In
  DevWorld nicht geprüft; per Spec ist nur eine ebene Querneigung abgedeckt.
- **`__corridor.pick()` zeigt mehr** (`8f47fc4b`): je Zeile `columnBottomM`,
  `columnTopM`, `overM` (oberste Fläche über der Zelle), `cameraSees`, dazu
  die OSM-Tags des Ways (`width`, `lanes`, `bridge`, `tunnel`, `covered`,
  `layer`). Nur Konsole. Deutungstabelle in ROUTE_CORRIDOR.md, Abschnitt
  "Linie, Zellen und Gegner verschwinden".
- **Urteilsfrage: Auskragung begrenzt den Korridor** (`a8866f4d`): Treffen
  beide Strahlen und stoppt der obere (3,5 m) höchstens `overhangDepth`
  (1 m) näher als der untere, gilt der nähere Treffer; sonst wie bisher der
  weitere. Gewinn (aus dem Code): weniger orange Randzellen unter
  Auskragungen bis 1 m Tiefe auf Höhe des oberen Strahls; tiefere
  Auskragungen und Traufen über 3,5 m bleiben orange. Preis: Dort fehlt bis 1 m Korridor, auch wo der
  Gehweg darunter begehbar ist; ebenso an flachen Balkonen und an einer
  Baumkrone dicht vor der Fassade. `__corridor.set({ overhangDepth: 0 })`
  misst neu mit der alten Regel.
- **Doku** (`7bb91a6e`): Zeilenverweise in ROUTE_CORRIDOR.md auf
  `route-corridor.ts` und `route-cell-sampler.ts`. Weitere veraltete
  Verweise fand review-c (C3), fixrev2 hat sie nachgezogen (`633ec1cf`).
- Nicht gemacht: Zellen auf Autos aus dem Laufweg nehmen (hieße einen
  Strahl allein als Wand werten, genau das hat der Playtest vom 2026-09-12
  verworfen, `8910463`); Vorgärten (Entscheidung, siehe "Offene Punkte");
  Traufen über 3,5 m (Stellschraube `__corridor.set({ wallMargin: 1 })`);
  Paris (nur Diagnose); zwei Ebenen je Zelle; synchroner Neuaufbau.

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `0e9b9280` | runde Enden mit voller Halbbreite | Konflikt in `ROUTE_CORRIDOR.md`; am `633ec1cf` konfliktfrei nach `633ec1cf`, `9f2e2b47`, `66569eca`, `7bb91a6e`, `33ce898d` |
| `33ce898d` | Zellen auf Autos und Hecken wieder erhöht | am `b74117f7` konfliktfrei; am `633ec1cf` Konflikt in `route-cell-sampler.ts`, Spec und `ROUTE_CORRIDOR.md` (fixrev2 C1 und C2 bauen darauf), mit `633ec1cf`, `66569eca`, `9f2e2b47` zuerst konfliktfrei |
| `8f47fc4b` | `pick()` ohne Säule, Sicht und Tags | am `b74117f7` konfliktfrei; am `633ec1cf` Konflikt in `corridor-console.ts`, Spec und `ROUTE_CORRIDOR.md` (C4), mit `633ec1cf`, `d8298b31` zuerst konfliktfrei |
| `a8866f4d` | Auskragung zählt wieder nicht als Wand | konfliktfrei, auch am `633ec1cf`; ohne Revert per Konsole abschaltbar |
| `7bb91a6e` | Zeilenverweise | am `633ec1cf` Konflikt in `ROUTE_CORRIDOR.md`, mit `633ec1cf` zuerst konfliktfrei |
| Block, mit fixrev2 zuerst | alles oben | konfliktfrei am `633ec1cf` |

### Review-Fixes (fixrev1, `f91dd3d8` bis `b74117f7`, 7 Commits)

Behebt A1 bis A6 (review-a) und B1, B2 (review-b), Details unter "Review".

- `f91dd3d8` (A1): Wirft der Umbau beim HQ-Umsetzen, wird der Chip geräumt
  und der Fehler weitergeworfen. Wie vorher bleibt dann eine halb umgebaute
  Welt, und der Aufrufer behandelt die Ablehnung nicht.
- `4044c44a` (A2): `[Relocation] HQ done` endet mit `ended=commit`,
  `ended=cancel` oder `ended=none`. `commit` heißt gespeichert, neu gebaut
  nur, wenn sich eine Breite ändert (`changed=` in `[Corridor] clearance`).
- `a99d0c92` (A3): Die Esc-Zeile der Tastenübersicht nennt beide Intros.
- `a99e7095` (A6): STEP 6 zeichnet eingeschaltete Route-Overlays und die
  Flughöhen-Röhre gleich auf die neuen Zellen, statt auf den nächsten
  Tile-Load zu warten.
- `18d7cef7` (B1): Der Recorder schreibt für jeden Turm außer passiven
  Gebäuden je Frame eine Stichprobe, auch für Archer und Lightning; ihre
  Kegel drehen im Replay mit. Je Frame statt nur bei Änderung, weil ein
  Sprung nur die Stichproben des aktuellen Frames anwendet. 23 B je Turm und
  Frame, bei 60 Türmen und 10 Frames je Sekunde 13,8 KB/s. Die Reservierung
  je Frame rechnete schon mit einer Stichprobe je Turm; die Stichproben
  zählen aber ins 48-MB-Budget, mit vielen Türmen dünnt eine lange Aufnahme
  früher aus (nicht gemessen). Das Research Center bekommt weiter keine.
- `794415b3` (B2): Würde die Adresse im Screenshot unter der
  Attributionsleiste liegen, steht sie eine Zeile höher über den Logos am
  linken Rand. Nicht behandelt: Auf einem extrem schmalen Bild (Breite unter
  etwa 0,22 der Höhe) könnte sie das Logo rechts erreichen.
- `b74117f7` (A4, A5): LOCATION_SYSTEM.md (Favoriten-Namen,
  `clearMapEntities`) und Vermerke "überholt durch ..." in
  REVIEW_SPRINT_2026-09-13.md (Playtest 146, 109 gilt wieder) und
  REVIEW_SPRINT_2026-09-14.md (Abschnitt Fähigkeitsleiste, Quickfix 10,
  Entscheidungen 3 und 15, Playtest 317 und 339, TODO-Tabelle).

| Commit | Ein Revert nimmt zurück | Probe am `b74117f7` und Abhängigkeiten |
|---|---|---|
| `f91dd3d8` | Chip bleibt nach einer Exception stehen | Konflikt in `map-relocation.service.ts` und Spec (`4044c44a` ändert denselben Doc-Kommentar); mit `4044c44a` zuerst konfliktfrei |
| `4044c44a` | kein `ended=` | konfliktfrei |
| `a99d0c92` | Esc-Zeile nur für das Boss-Intro | konfliktfrei |
| `a99e7095` | Overlays am neuen Ort erst mit dem nächsten Tile-Load | konfliktfrei |
| `18d7cef7` | Archer und Lightning ohne Stichprobe, ihr Kegel steht im Replay | konfliktfrei |
| `794415b3` | Adresse kann unter der Leiste liegen | konfliktfrei |
| `b74117f7` | nur Doku | konfliktfrei |
| Block | alles oben | konfliktfrei |

### Korridor-Review-Fixes (fixrev2, `66569eca` bis `633ec1cf`, 4 Commits)

Behebt C1 bis C4 (review-c), Details unter "Review". Alles aus Code und
Tests abgeleitet, nicht im Browser gesehen.

- `66569eca` (C1, Lead-Entscheidung): `CellSample.stepTop` hält die Höhe,
  von der der Stufen-Check eine Zelle heruntergesetzt hat (das Dach des
  Autos); auf allen anderen Zellen ist sie null, auch auf vom Dach-Check
  geklemmten. `getGroundTargetY(cell)` neben `getAirTargetY` ist die einzige
  Quelle der Boden-Probehöhe: `(stepTop ?? terrainHeight) + 1,5 m`. Die
  sechs Stellen, die sie bisher selbst rechneten (LOS-Registrierung,
  Shader der LOS-Anzeige, LOS-Debug-Service, LOS-Debugger), lesen sie jetzt.
  Folge: Ein Tower sieht eine Zelle am Auto wie vor `33ce898d` über dem
  Dach und zielt auf Gegner, die dort auf Straßenhöhe im Auto gezeichnet
  werden. Unverändert: Zellhöhe, Gegnerhöhe und die Platte der LOS-Anzeige
  (Straßenhöhe), vom Dach-Check geklemmte Zellen, die Air-Probe. Ein Wechsel
  zwischen Dach- und Stufen-Klemmung bei gleicher Höhe fragt die LOS neu an.
- `9f2e2b47` (C2): Am Anfang von `groundInFront` kehrt der Stufen-Check für
  Zellen bis `stepRise` über der Mittellinie sofort zurück; dort konnte er
  nie etwas ändern, das Ergebnis ist gleich. Eine Zähl-Spec (nicht
  committet) auf einer ebenen Straße, 200 m lang, 7 m je Seite, 740 Zellen,
  ohne Säulen-Cache: 3 304 Säulenaufrufe vorher, 1 379 nachher. Im Spiel mit
  Cache nicht gemessen.
- `d8298b31` (C4): `PathAndRouteService.routeLineLift()` ist die eine Quelle
  für den Lift der roten Linie (DevWorld 3 m, sonst 1 m); die Linie und
  `__corridor.pick()` lesen sie, die Konstante der Konsole ist entfernt. Im
  Spiel ändert sich nichts, in DevWorld prüft `cameraSees` jetzt 3 m über der
  Zelle. Kommentar und Doku sagen, dass die rote Linie nur über Zellen der
  Mittellinie läuft.
- `633ec1cf` (C3): 39 Zeilenverweise in ROUTE_CORRIDOR.md gegen den Code
  nach C1, C2 und C4 nachgezogen, die Überblickstabelle nennt bei der
  Zellhöhe "Dach- und Stufen-Check". Jeder spätere Commit in den
  verwiesenen Dateien verschiebt sie wieder.
- Nicht geändert: der Tooltip des Route Grid Overlay, die animierte
  Routenlinie in DevWorld, der Raycast-Rückfall im Kampf (siehe "Offene
  Punkte" 5).

| Commit | Ein Revert nimmt zurück | Probe am `633ec1cf` und Abhängigkeiten |
|---|---|---|
| `66569eca` | Boden-Probe einer Zelle am Auto wieder 1,5 m über Straßenhöhe, also im Objekt, die Zelle meist verdeckt | konfliktfrei |
| `9f2e2b47` | Stufen-Weg auch für Randzellen auf Straßenhöhe | konfliktfrei |
| `d8298b31` | `pick()` mit festem Lift 1 m | konfliktfrei |
| `633ec1cf` | Zeilenverweise | konfliktfrei; stimmt nur mit den drei Code-Commits davor exakt |
| Block | alles oben | konfliktfrei |

## Revert-Probe

Jeder Commit einzeln, jeder Block und einige Paare wurden probeweise mit
`git revert --no-commit` zurückgenommen und danach verworfen: zuerst am
`b74117f7`, nach fixrev2 alle 45 Commits einzeln noch einmal am `633ec1cf`
mit den ersten drei Handover-Commits darüber (sie berühren keine Datei der
Session). Der Faktencheck hat die Einzelprobe am `95353cb0` wiederholt, dem
einzigen Handover-Commit, der eine Datei der Session berührt
(REVIEW_SPRINT-14): dasselbe Ergebnis. Die
Probe zeigt nur Textkonflikte; ob der Stand danach baut und die Tests
besteht, ist nicht geprüft. Bei mehreren Commits hält Git am ersten
Konflikt an.

- Die ganze Session `f6a5a0bd..633ec1cf` geht am Stück konfliktfrei zurück.
- Konfliktfrei als Block: research, controls, hud, fixrev1, fixrev2;
  corridor mit fixrev2 zuerst. visuals, portal, location und n2rest brauchen
  einen späteren Commit zuerst (siehe die Tabellen).
- Am `633ec1cf` gehen 31 der 45 Commits einzeln konfliktfrei zurück,
  darunter alle vier von fixrev2. Die übrigen 14 kollidieren mit einem
  späteren Commit derselben Session und gehen in der genannten Reihenfolge
  sauber zurück: `6a42d3a5` (nach `18d7cef7`), `2e2b266c` (nach
  `794415b3`), `5a061423` und `23483121` (nach `8e79069f`), `8e79069f`
  (nach der Relocation-Kette), `586f493e` (nach `49d8e06e`), `5bdce997`
  (nach `ac5eafee`), `ac5eafee` (nach `4044c44a`, `f91dd3d8`), `821c0cf6`
  (nach `a99d0c92`), `f91dd3d8` (nach `4044c44a`), `7bb91a6e` (nach
  `633ec1cf`), `8f47fc4b` (nach `633ec1cf`, `d8298b31`), `33ce898d` (nach
  `633ec1cf`, `66569eca`, `9f2e2b47`), `0e9b9280` (nach `633ec1cf`,
  `9f2e2b47`, `66569eca`, `7bb91a6e`, `33ce898d`).
- Keine generierten Dateien: Kein Commit dieser Session ändert Charts,
  Wave-Planner, `ai-schema.json` oder ENEMY_MODEL_BUDGET.md. Nach einem
  Revert von `1b4722cd` pytest laufen lassen.

## Offene Punkte und Entscheidungen für dich

**Korridor**

1. **Vorgärten** bleiben im Korridor. Mit Strahlen und Säulen sind sie
   nicht von einem Parkstreifen hinter einer Autoreihe zu trennen.
   Optionen: (a) der untere Strahl allein zählt als Wand, wo die Säule
   dahinter erhöht ist (dann engen Autos und Transporter wieder ein), (b)
   OSM-Flächen (Gebäude, Gärten) als Grenze, nicht geprüft, ob sie für den
   Korridor verfügbar sind, (c) so lassen.
2. **Auskragung** (`a8866f4d`) ist eine Urteilsfrage: weniger orange Zellen
   unter Obergeschossen gegen bis 1 m weniger Korridor an Erkern, Balkonen
   und Kronen. Playtest 561 vergleicht beides; `__corridor.set({
   overhangDepth: 0 })` schaltet ohne Revert zurück, der Commit geht einzeln
   zurück.
3. **Zellen auf Autos** stehen auf Straßenhöhe und bleiben im Laufweg;
   Gegner laufen durch das Auto. Seit `66569eca` sieht ein Tower solche
   Zellen wie vor `33ce898d` über dem Dach und zielt auf Gegner, die im Auto
   gezeichnet werden (Lead-Entscheidung zu C1; wie das aussieht, ist
   ungesehen, Playtest 566). Sie herauszunehmen hieße den Korridor am Auto
   enden lassen (vom Playtest 2026-09-12 verworfen) oder Zellhöhen auf die
   Breite zurückkoppeln.
4. **Paris-Brücke**: nur Diagnose. Fünf Hypothesen aus dem Code: H1 Route
   liegt richtig unter der Brücke (verdeckt, erklärt aber keine fehlenden
   Overlay-Zellen, das Overlay zeichnet ohne Tiefentest), H2 Route auf einem
   Bauwerk ohne Brücken-Tag (Zellen fallen auf die untere Ebene), H3 falsche
   Höhen im Cluster, H4 keine Zellen (unwahrscheinlich), H5 Tunnel-Tag ohne
   Portal-Tile. Playtest 564 liefert die Daten, erst dann ein Fix. Offen
   ist auch, ob mit "Zellen" das Overlay oder die LOS-Anzeige gemeint war.
5. **Restliche orange Zellen**: Traufen über 3,5 m sehen die Strahlen nicht
   (`wallMargin` 0,5 m; zum Probieren `__corridor.set({ wallMargin: 1 })`),
   und an der Innenseite von Knicks bleibt ein Rest-Überstand. Der Tooltip
   des Route Grid Overlay nennt Orange weiter nur für "on the ground under
   a roof", nicht für den Stufen-Check (UI-Text, nicht geändert). In
   DevWorld liegt die animierte Routenlinie 2 m unter der statischen
   (`route-animation.service.ts`, fester Lift 1 m; könnte `routeLineLift()`
   lesen). Der Raycast-Rückfall im Kampf zielt weiter 1,5 m über die
   Gegnerposition; er greift nur, wenn das Grid für die Position keine
   Antwort hat.

**Anzeige und Bedienung**

6. **zombie_v2 steht still**: nicht belegt, behoben ist nur die Rahmung.
   Steht die Figur in Playtest 515 weiter, liegt die Ursache außerhalb dessen,
   was jsdom nachbildet; dann die Konsole nach `[ModelPreview]` durchsuchen.
   Die Box-Messung zu korrigieren verschiebt zwölf Vorschauen; elf Offsets
   müssten im Browser neu eingestellt werden (mech hat keines).
7. **Impact Effects**: kein Code-Defekt gefunden. Zeigt Playtest 514 mit Schalter aus
   nur Zusammenfallen und Minions, war das der Todesclip. Ob der Schalter
   auch Todesanimationen abdecken soll, ist eine Design-Entscheidung.
8. **Leiste gegen Info-Overlay**: Rechnung aus den SCSS-Werten: Leiste mit
   Held und vier Fähigkeiten 258 px hoch, mittig; das aufgeklappte
   Info-Overlay reicht bis etwa 113 px. Überlappung ab einer Canvas-Höhe
   unter etwa 483 px, zugeklappt unter etwa 318 px (Nacht-2-Playtest 323).
   Ein Fix bräuchte eine feste Reserve im SCSS der Leiste, wieder per
   Kommentar gekoppelt.
9. **HQ umsetzen** ist nicht schneller, nur sichtbar. Welcher Schritt
   dauert, zeigen die Zeilen aus Playtest 541 und 542; danach entscheiden
   (etwa A* über den vorhandenen Worker).
10. **Spawn-Drehung** geht bei HQ-Umzug, Ortswechsel, Reload und Favorit
    verloren und steht nicht in der URL.
11. **Center-Tipp nach Welle 2**: abgeleitet, nicht gespielt; eine Konstante
    (`RESEARCH_TIP_AFTER_WAVE`).

**Aus der Einordnung von TODO 1.9 (n2rest)**, alle nicht geändert:

12. **Wurm an scharfen Ecken**: Überschlag, nicht gemessen: Der Außenspalt
    öffnet ab etwa 5° Knick und erreicht bei 90° etwa 3,6 m. Ein Heading aus
    den Nachbarringen halbiert den Winkel je Paar, schließt 90° aber nicht;
    ein längeres `SEG_FRONT` sticht innen durch. Beides braucht Sichtprüfung.
13. **`hero:rejected`** (auch `ability:rejected`) hat keine Anzeige, ein
    Toast-System gibt es nicht; welche Form die Rückmeldung haben soll, ist
    offen. Ohne GLB ist der Held unsichtbar (nur `console.warn`), ein
    Ersatzmodell ist offen.
14. **Boss-Intro**: Ein offener Dialog hält es nicht auf (überspringen oder
    aufschieben?); kein Hindernis-Check der Einstellung.
15. **Laser-Bot-Zählung**: Die Strategie zählt Gegner 0 bis 72 m hinter dem
    Anführer auf demselben Pfad, der Strahl trifft im 5-m-Radius. Die
    Näherung liegt in beide Richtungen daneben; eine Änderung verschiebt die
    Bot-Läufe.
16. **Sockel-Widerspruch**: Der Doc-Kommentar über `hitOf` in
    `utils/route-cell-sampler.ts` und der Kommentar in `onMouseMove` von
    `tower-defense.component.ts` widersprechen sich, ob die Tiles unter
    einem Dach Boden zeigen. Klärt weiter der Nacht-2-Playtest 429.
17. **Boss-Varianten ohne Fairness-Gate**: welche Welle ins Log des
    Collectors gehört, wartet auf den Run-Dump.
18. **Asset- und Feature-Punkte**: Warnsirene des Nuklearschlags, Sounds für
    Frost und EMP, Laser-Ton am Startpunkt, Wurm (Beine, Schwanz, Mandibeln,
    Sound nur am Kopf wäre im Budget, eine Healthbar je Ring), Tod-Sound der
    Schleimklumpen, Mech und Ghost über dem Modell-Budget, Gold-Popup der
    Ooze an der Spitze, Held Stufe 2.
19. **Tooling**: Der Shader-Check braucht `glslangValidator` von Hand.

**Kosten, nicht gemessen**: Picker über alle Tower nach einem Treffer,
Kegel-Upload bei vielen drehenden Türmen, eine Replay-Stichprobe je Turm und
Frame, die Proben des Stufen-Checks (seit `9f2e2b47` nur noch für Zellen
mehr als `stepRise` über der Mittellinie), das Nachführen der Ooze-Loops in
der Pause.

## Review

Drei Review-Agents haben gelesen, alle nur lesend, ohne Browser. Keiner fand
einen Befund der Schwere hoch.

**review-a**, research, controls, hud, location (`f6a5a0bd..5ae79d52`): 6
niedrig, alle behoben (fixrev1).

- A1: Der Umzugs-Chip blieb stehen, wenn der Umbau eine Exception wirft.
  Behoben `f91dd3d8` (räumen, weiterwerfen).
- A2: `[Relocation] HQ done` stand auch nach einer abgebrochenen Messung da
  und sah aus wie nach Messung und Neuaufbau. Behoben `4044c44a` (`ended=`).
- A3: Die Tastenübersicht nannte Esc nur für das Boss-Intro, obwohl Esc seit
  `f94813b7` die einzige Taste im Intro-Flug ist. Behoben `a99d0c92`.
- A4: LOCATION_SYSTEM.md widersprach den Favoriten-Namen und dem neuen
  STEP 2. Behoben `b74117f7`.
- A5: Die Handover der Nächte beschrieben Zurückgenommenes als offene
  Playtest-Schritte (146, 317, 339). Behoben `b74117f7` (Vermerke "überholt
  durch", Historie unverändert).
- A6: Die Flughöhen-Röhre (im Randfall auch die Grid-Overlays) kam nach dem
  Ortswechsel erst mit dem nächsten Tile-Load zurück. Behoben `a99e7095`.
- Beobachtung ohne Handlungsbedarf: Wer im Intro-Flug über die Sidebar in
  den Build-Modus geht, beendet mit dem ersten Esc den Flug, mit dem
  zweiten den Build-Modus.

**review-b**, visuals, portal, n2rest (`f6a5a0bd..5ae79d52`): 2 niedrig,
beide behoben (fixrev1). Keine Simulationswirkung, keine Fehler in der
Audio-Hold-Logik.

- B1: Archer und Lightning bekamen keine Replay-Stichprobe, ihr Kegel stand
  im Replay; Doku und Bericht sagten das Gegenteil. Behoben `18d7cef7`,
  anders als vorgeschlagen: Stichprobe je Frame statt nur bei Änderung,
  weil ein Sprung zurück sonst die Richtung eines späteren Moments zeigte.
- B2: Die Adresse im Screenshot konnte auf schmalen Bildern unter der
  Attributionsleiste liegen. Behoben `794415b3`.

**review-c**, corridor (`5ae79d52..7bb91a6e`): 1 mittel, 3 niedrig, alle
behoben (fixrev2).

- C1 (mittel): Seit `33ce898d` steht eine Zelle auf einem Transporter oder
  einer Hecke auf Straßenhöhe; die Boden-LOS-Probe 1,5 m darüber liegt bei
  Objekten über etwa 1,5 m im Objekt. Tritt der Strahl mehr als 0,5 m davor
  ein, gilt die Zelle für diesen Tower als verdeckt, Gegner dort findet er
  nicht; bei Autos um 1,5 m hängt es vom Blickwinkel ab. Aus dem Code
  abgeleitet, nicht gemessen. Lead-Entscheidung: Bei vom Stufen-Check
  geklemmten Zellen nimmt die LOS-Probe wie vorher die ungeklemmte Höhe; der
  Tower zielt dann auf Gegner im Auto. Behoben `66569eca`.
- C2 (niedrig): Der Stufen-Check läuft auch für jede Randzelle auf
  Straßenhöhe (bis `stepRise` über der Mittellinie), wo er nichts ändern
  kann; Kosten nicht gemessen. Behoben `9f2e2b47`.
- C3 (niedrig): ROUTE_CORRIDOR.md hat weiter veraltete Zeilenverweise, dazu
  fehlt der Stufen-Check in der Überblickstabelle. Behoben `633ec1cf`
  (39 Verweise, mehr als die Tabelle der Review).
- C4 (niedrig): `__corridor.pick()` nimmt den Lift der Linie fest mit 1 m
  an, DevWorld zeichnet sie 3 m hoch; neben der Mittellinie prüft
  `cameraSees` einen Punkt über der Zelle, nicht die Linie. Behoben
  `d8298b31`.

## Playtest-Liste

Nummeriert, damit du mit "505 ok, 512 kaputt" antworten kannst. Punkte mit
gleichem Aufbau stehen hintereinander, so lassen sich vier je Runde
abarbeiten.

**Zuerst: alte Punkte, die diese Session berührt**

- **Alte Liste 14** (Paris-Brücke): siehe 564. **41 und 44** (Autos, orange
  Zellen): siehe 560 bis 563 und 566, 567.
- **Nacht 1, 105** (U, Tastenübersicht): siehe 517 bis 520 und 524. **106**
  (Intro-Flug): 525 bis 528. **107** (Hover beim Ziehen): 521, 522. **126**
  (Impact Effects): 514. **132** (Spawn-Vorschau rot): 531. **145**
  (Screenshot): 557 bis 559. **146** (Tipps): überholt, siehe 502 bis 507.
  **109** (Research-Queue): gilt wieder, dazu 508, 509.
- **Nacht 2, 317** (gesperrte Knöpfe) und **339** (Queue-Ketten): überholt,
  siehe 510 bis 513 und 508, 509. **322** (Pfeil neben der Leiste): siehe
  512. **323** (niedriges Fenster): Befund offen (Offene Punkte 8).
  **364** (Zombie-Loops laufen in der Pause, bekannt): jetzt still, siehe
  545. **373, 374**: Der Schwenk um die Wachrichtung ist durch `6a42d3a5`
  ersetzt (siehe 549 bis 552), Banner, Tönung und Blende gelten weiter.
  364, 373 und 374 tragen in REVIEW_SPRINT-14 einen Vermerk. **381** (Ladung nach einem Sprung): gilt
  weiter.

**Vorab: Werkzeuge**

- Konsole: F12, Reiter Console.
- Dev-Menü: Quick Actions unten rechts, Knopf "Developer options". Gruppe
  **Cheats**: Credits (+1 000, Shift+Klick +100 000), Research (alle
  Forschungen fertig), Max Up, Abilities (alle vier Fähigkeiten erforscht und
  geladen), Hero (Forschung fertig, Söldner kostenlos angeheuert). Gruppe
  **Waves & Inspect**: Waves öffnet Wave Debug (darin "Jump to wave"),
  Enemies öffnet Enemy Debug ("Place enemy on route").
- Quick Actions, Layers: "Route Grid Overlay", "Air Route Grid Overlay",
  "Air-route altitude". Display-Menü: "Blood Moon", "Boss Intro", unter
  Effects "Impact Effects".
- `__corridor.set()` und `reset()` wirken nur ohne Tower, Welle und Gegner
  (sonst "Not changed").

**Vorab**

501. Echten Ort laden, Konsole offen, Intro-Flug abwarten: keine rote Zeile.
     Dann Display "Blood Moon" an, Research-Cheat, eine Cannon an die Route,
     Wave Debug "Jump to wave" 14, Space: Kegel sichtbar, keine Zeile
     `Shader Error` (der Scheinwerfer-Shader ist neu). O, "Save screenshot":
     kein Fehler.
     **Befund (2026-09-14):** keine Fehler, aber der Scheinwerfer zeigt um
     180° verkehrt (entgegen der Zielrichtung des Turrets). Ursache:
     `headingToSearchlightYaw` rechnete `PI - heading` statt `-heading`
     (falsche Achsenannahme seit `7d1b8362`, auch der alte Schwenk war
     verdreht). Fix `a7c29cca`, erneut prüfen, zusammen mit 549 bis 553.

**Tipps und Forschung** (neues Spiel)

502. Konsole `localStorage.removeItem('td_onboarding_v2')`, Reload, Ort
     wählen, Intro abwarten: Box unten mittig "Build a tower", rechts "1/7",
     Tastenkappen LMB, RMB, Wheel, WASD, H. Taste 1, Archer neben die Route:
     "Start the first wave", "2/7", Kappen Space, P, +/-. Space: die Box
     verschwindet und bleibt während Welle 1 weg. **ok**
503. Welle 1 zu Ende: "Upgrade a tower", "3/7", Kappen U und Del. Archer
     anklicken, U: der Tipp ist weg, bis Welle 2 vorbei ist kommt keiner.
     Welle 2 spielen: "Build a research center", "4/7". **ok**
504. Research Center bauen: sofort "Start a research", "5/7". Center
     anklicken, nichts starten: der Tipp bleibt. Eine verfügbare Forschung
     starten (notfalls vorher Cheat Credits): der Tipp ist weg. **ok**
505. Cheat Research (steht "Start a research" noch: Skip): "Use an
     ability", "6/7", Kappen K Nuclear Strike, F Frost Bomb, E EMP, L Orbital
     Laser. Welle starten, K, auf die Route klicken: "Hire the Mercenary",
     "7/7", Kappen G und V. Oberer Knopf der Leiste (Münze), 1 000 Credits:
     keine Tipps mehr. Sidebar-Fuß "Tips": wieder "Build a tower", "1/7".
     **Befund (2026-09-14):** der Ablauf klappt, aber der Wiedereinstieg
     beginnt immer bei "1/7", egal wie weit man war. Ursache laut Code: der
     Knopf "Tips" löschte alle erledigten Schritte; Reload, neues Spiel und
     Ortswechsel behalten den Stand (Test). Fix `1d8d2aaa`: "Tips" beginnt
     beim ersten Schritt, den das laufende Spiel noch nicht getan hat; hat es
     alle sieben getan, kommt die ganze Runde ab 1/7. Erneut prüfen: Key
     löschen, Archer, Welle 1, U, Welle 2: "4/7"; "Hide tips", dann "Tips":
     wieder "4/7", nicht "1/7". Reload: kein "1/7".
506. Key löschen und Reload wie in 502. Archer bauen, Cheat Credits,
     Welle 1 starten und darin ein Research Center bauen: noch in Welle 1
     erscheint "Start a research", "5/7" (bereit, sobald ein Center steht).
     Welle 1 beenden: der Tipp springt zurück auf "Upgrade a tower", "3/7".
     Solange er steht, am Center "Research Wing" kaufen: der Tipp bleibt.
     Dann den Archer upgraden: wieder "Start a research", "5/7"; "Build a
     research center" erscheint auch nach Welle 2 nicht.
     **Per Test bestätigt** (`28aa82cc`, `onboarding-playtest.spec.ts`
     "506: a research center built in wave 1, ...").
507. Bei einem beliebigen Tipp "Hide tips": keine Tipps mehr, auch nicht
     nach Welle 2 oder nach dem Research-Cheat. **Per Test bestätigt**
     (`28aa82cc`, "507: Hide tips at %i/7, no tip afterwards", alle sieben
     Tipps).
508. Neues Spiel, Cheat Credits, Research Center bauen und anklicken. Über
     "Siege Engineering" hovern und klicken: gesperrt, nicht klickbar,
     Tooltip nur "Requires: Gatling Technology", kein "· queue", keine Zeile
     in der Warteschlange. "Gatling Technology" klicken (startet), dann "Ice
     Magic": gestrichelte Zeile "1 Ice Magic" in der Schlange; Siege
     Engineering bleibt gesperrt. **ok**
509. Warten, bis Gatling fertig ist (15 s Spielzeit, mit + schneller): Ice
     Magic startet von selbst und wird erst jetzt bezahlt, Siege Engineering
     ist klickbar. Bei belegtem Slot "Tentacle Biology" und "Toxic
     Compounds" einreihen, bei Tentacle Biology auf X: nur sie verschwindet.
     Die laufende Forschung abbrechen: die Schlange bleibt, wie sie ist,
     solange das Gold unter 450 liegt (in diesem Ablauf etwa 425); mit mehr
     Gold startet Toxic Compounds im freien Slot.

**Fähigkeitsleiste, Effekte, Vorschau**

510. Neues Spiel: am linken Rand keine Leiste. K, F, E, L: nichts passiert.
511. Research Center, dann Ice Magic, Arcane Studies, Frost Bomb (700)
     erforschen: mit Frost Bomb erscheint links mittig die Leiste mit genau
     einem Knopf (Schneeflocke, Kappe F); Tooltip ohne "LOCKED", mit CHARGES
     1/1 und RECHARGE 3 waves.
512. Cheat Abilities: vier Knöpfe, Nuclear Strike (K), Frost Bomb (F), EMP
     (E), Orbital Laser (L), 44 × 44 px, Glasrahmen, 12 px vom Rand wie das
     Info-Overlay (optisch wie vorher; zusammengefallene oder randlose
     Knöpfe: `49d8e06e` melden). Welle starten, Kamera so drehen, dass
     Gegner links außerhalb laufen: rote Pfeile rechts neben der Leiste,
     nicht darunter.
513. Neues Spiel, Cheat Hero (ohne Abilities): Leiste nur mit dem
     Held-Knopf (Figur, Kappe G), keine Haarlinie. Dann Cheat Abilities: die
     Linie erscheint zwischen Held und Fähigkeiten.
514. Display, Effects: "Impact Effects" aus. Enemy Debug: Skeleton auf die
     Route, Archer daneben, beim Kill genau hinsehen: kein Puff heller
     Funken etwa 1 m über dem Boden (Kniehöhe); das Zusammenfallen in Knochen und die
     zwei Minions bleiben. Gegenprobe mit Schalter an: zusätzlich ein kurzer
     Puff aus 12 knochenfarbenen Funken. Kommt der Puff auch mit Schalter
     aus: Reload, prüfen, ob der Haken aus bleibt, und ein Video.
515. Wave Debug, Single, Type "Zombie v2", Count 5, Custom Wave starten. Im
     WAVE-Panel die Vorschau (64 × 64 px): Figur mittig (nicht mehr in der
     oberen Hälfte), dreht sich langsam, bewegt Arme und Beine im
     taumelnden Gang. Vergleich mit "Zombie". Steht sie still: Konsole nach
     `[ModelPreview]` durchsuchen, Screenshot.
516. Optional, keine Änderung erwartet: Sprung auf 20, die Marke W21 zeigt
     Flugzeug und Mond in 10 px.

**U und Tower-Auswahl**

517. Tower bauen und anklicken, genug Credits, U: über dem Tower steigt Gold
     "DAMAGE LV 1" auf (bzw. der erste bezahlbare Track in Panel-Reihenfolge),
     die Kachel dieses Tracks blitzt golden, ihre Stufe steigt. U mehrmals
     schnell: jeder Druck blitzt erneut und bringt einen neuen Text.
518. Credits ausgeben, bis das billigste Upgrade nicht bezahlbar ist, Tower
     wählen, U: orange "NEED n CREDITS" über dem Tower, 2,5 s die Zeile "Need
     n more credits for <Track>" über den Kacheln, nichts gekauft. Cheat
     Credits mit Shift+Klick, U bis alle Tracks auf Stufe 5 sind (ohne
     "Advanced Weaponry"), noch einmal U: "NEEDS RESEARCH", Zeile "Research
     Advanced Weaponry for the next levels".
519. Cheat Max Up, Tower wählen, U: "FULLY UPGRADED", Zeile "Fully
     upgraded". Erst danach ein Research Center bauen (Max Up bringt auch
     den Research Wing eines schon stehenden Centers aufs Maximum),
     anklicken, U: "RESEARCH WING LV n" über dem Center, die Kachel im
     Research-Panel blitzt; ohne Credits steht die Zeile im Research-Panel.
520. Nichts gewählt, U: nichts passiert. Eine Upgrade-Kachel anklicken:
     Kauf wie bisher, kein Text über dem Tower.
521. Ohne Build-Modus die Maus über einen Tower: Reichweite erscheint. Auf
     dem Tower die linke Taste drücken und die Kamera ziehen: die Reichweite
     verschwindet beim Drücken und bleibt beim Ziehen weg; über einem Tower
     loslassen: seine Reichweite kommt nach höchstens etwa 0,1 s. Dasselbe
     mit der rechten Taste.
522. Kurz auf einen Tower klicken: gewählt (Panel, Reichweite). Noch einmal
     klicken zum Abwählen, Maus dort lassen: die Hover-Reichweite bleibt.
523. Zwei Tower bauen, Kamera flach, bis sie sich auf dem Schirm überdecken,
     Maus auf die Überdeckung, klicken: Hover und Auswahl gehen an den
     vorderen. Mit umgekehrter Bau-Reihenfolge wiederholen: dasselbe.
524. Sidebar-Fuß: eine Zeile World, Tips, Keys, Map Key, Attributions, kein
     Label abgeschnitten oder überlappend. Maus über "Keys": Tooltip
     "Keyboard shortcuts (H or ?)". Klick öffnet die Tastenübersicht: in der
     Gruppe "Game" genau eine Esc-Zeile, "Skip the intro flight or the boss
     intro"; in der Gruppe "Towers" die R-Zeile "Hold to rotate while
     building, or the portal while placing a spawn". H oder Esc schließen.

**Intro-Flug** (Ort laden oder Reload)

525. Während des Flugs nacheinander Pos1, N, W, Leertaste, 1, H, P: der Flug
     läuft weiter, keine Welle, kein Build-Modus, keine Übersicht, keine
     Pause. Dann Esc: der Flug endet, die Kamera steht in der Spielansicht;
     Pos1: die Kamera gleitet zum HQ.
526. Nächster Flug: einmal auf die Karte klicken; beim nächsten das Mausrad;
     beim dritten "Skip Intro": jedes Mal endet der Flug.
527. Während eines Flugs den Ortsdialog öffnen ("DEFEND <Ort>" im Header),
     im Suchfeld tippen, Esc: Tippen geht, Esc schließt nur den Dialog, der
     Flug läuft weiter.
528. Während eines Flugs in der Sidebar "Keys": die Übersicht öffnet sich,
     Esc schließt sie, ein zweites Esc überspringt den Flug.

**Spawn-Portal**

529. Ort aus den Screenshots laden (Spawn am Kreisverkehr) oder mit "Set
     spawn" (Kopfleiste, neben "Move HQ") einen Spawn auf den Ring eines
     Kreisverkehrs setzen, Routenlinie an: die rote Linie läuft mittig
     durch die Öffnung hinaus, nicht am Pfeiler. Welle starten: die Gegner
     treten vorn durch die Öffnung. Falls nicht: `__routes.describe()` und
     die ersten Wegpunkte der Route melden.
530. "Set spawn" mitten auf eine gerade Straße: das Portal steht längs der
     Straße wie bisher.
531. "Set spawn", Cursor auf eine Straße zwischen den beiden gestrichelten
     Ringen um das HQ: Vorschau grün, Karte ohne Warnung. Im inneren Ring:
     rot, "Too close to HQ". Abseits jeder Straße: rot, "Too far from
     streets". Zurück auf grün, klicken: der Spawn steht.
532. "Set spawn", Cursor auf eine gültige Straße: die Karte zeigt "R Rotate".
     R halten: die Vorschau dreht (etwa eine halbe Umdrehung je Sekunde),
     loslassen: sie steht; Cursor weiterziehen: die Richtung bleibt;
     klicken: das Portal steht so. 5 bis 10 s warten (die Korridor-Messung
     baut die Route neu), Welle starten: das Portal bleibt gedreht, die
     Gegner laufen ihre Route.
533. "Set spawn" ohne R: das Portal schaut entlang der Route. Spawn wieder
     gedreht setzen, dann "Move HQ" an eine andere Stelle: das Portal folgt
     wieder der Route.
534. "Move HQ", R halten: der Diamant dreht nicht, die Karte zeigt kein "R
     Rotate". Mit P pausieren, "Set spawn", R halten: die Vorschau dreht
     auch in der Pause.

**Ortswechsel und Favoriten**

535. Ort laden, Layers "Route Grid Overlay", "Air Route Grid Overlay" und
     "Air-route altitude" an. Header "DEFEND ...", Tab Showcase, anderer Ort
     (etwa Paris): ab dem Ladescreen keine Zellen, kein Air-Grid, keine
     Röhre des alten Orts, weder während noch nach dem Laden. Nach dem
     Ladeschritt "Generating Route Grid" stehen alle drei an der neuen
     Route, auch die Röhre, ohne dass die Kamera bewegt wird.
536. Dasselbe über das Header-Lesezeichen, Klick auf einen Favoriten.
537. Header-Lesezeichen, "Save location": Namensfeld an dieser Stelle,
     vorbefüllt mit dem Header-Namen, markiert; tippen ersetzt, Enter
     speichert, der Eintrag steht unten, das Menü bleibt offen. Wiederholen
     bis etwa 12 Einträge: "Save location" bleibt oben, die Liste scrollt.
538. Stift an einer Zeile, neuer Name, Enter: umbenannt. Stift an einer
     anderen, Esc: Name bleibt. Stift, Feld leeren, Enter: kurz "Loading...",
     dann die Adresse.
539. Pfeile hoch und runter: die Zeile wandert, oben ist "hoch", unten
     "runter" gesperrt. F5, Menü öffnen: Reihenfolge und Namen wie vorher.
     Favoriten von vor diesem Stand (falls vorhanden): gleiche Namen, laden
     wie vorher.
540. Im Namensfeld W, A, S, D, Leertaste und Esc: die Kamera bewegt sich
     nicht, keine Welle, Esc schließt nur das Feld. Außerhalb des Menüs
     klicken: Menü zu, das offene Feld verworfen.

**HQ umsetzen** (Paris, Konsole mit Filter `/\[Relocation\]|\[Corridor\]/`)

541. Paris (Showcase), Intro abwarten, keine Tower. Header "Move HQ", auf
     eine Straße im geladenen Bereich 300 bis 600 m vom HQ klicken (Vorschau
     grün): sofort oben mittig der Chip "MOVING HQ", darunter "Finding the
     route", eventuell ein Stocken, dann "Measuring the corridor" mit Prozent
     und goldenem Balken, dann ist der Hinweis weg. Konsole: `[Relocation] HQ done: ...
     ended=commit`. Alle Zeilen dieses Umzugs kopieren (`HQ in place`,
     `[Corridor] clearance`, falls vorhanden `[Corridor] rebuild`, `HQ
     done`). Lesen: `work` ist der Stillstand am Stück, `corridor` die
     Messung samt Neuaufbau, `total` die Wartezeit ab Klick.
542. Wie 541, aber so weit weg, dass der alte Spawn keine Route mehr hat
     (andere Seite der Seine): `spawnFrom=random`, `random=` größer 0. Zeilen
     kopieren.
543. Noch einmal umsetzen, während "Measuring the corridor" läuft einen
     Tower bauen: der Hinweis ist sofort weg, `[Corridor] clearance ...
     flushed=tower`, danach `HQ done ... ended=commit`. Tower verkaufen,
     erneut umsetzen, während der Messung per Enemy Debug einen Zombie auf
     die Route setzen: der Hinweis verschwindet, `[Corridor] clearance
     cancelled (enemies are on the map) ...` und `HQ done ... ended=cancel`.
544. HQ weit außerhalb setzen (etwa 3 km, außerhalb des Straßennetzes und
     mehr als 1,5 km vom alten Spawn): Chip "MOVING HQ", darunter "Loading
     streets", bis zum Ladescreen; die Zeile `[Relocation] HQ outside the
     streets: ...` kopieren.

**Pause und Ton**

545. Feuer-Tower an die Route, Welle mit Zombies. Sobald Laufgeräusche und
     Flammenrauschen zu hören sind, P: beide verstummen sofort. P: beide
     laufen weiter.
546. Pausieren, die Kamera über andere Gegner fahren: kein Laufgeräusch setzt
     ein, nach dem Fortsetzen sind sie in Hörweite zu hören. Pausieren, in
     den Audio-Einstellungen SFX deutlich leiser, fortsetzen: die Loops
     kommen mit der neuen Lautstärke zurück.
547. W10 (erster Boss, "Boss Intro" an) mit laufendem Feuer-Tower: während
     Schleier und Einstellung sind Lauf- und Flammen-Loops still, nach dem
     Rückschnitt laufen sie weiter.
548. Enemy Debug: Ooze setzen und starten (oder Sprung auf 45). In der Pause
     steht das Blubbern wie bisher. Fährt die Kamera in der Pause erst an die
     Ooze heran, setzt es erst nach dem Fortsetzen ein.

**Blutmond** (Display "Blood Moon" an, Cheat Research)

549. Cannon und Archer mit etwas Abstand an die Route, "Jump to wave" 14,
     Space: in 3 s rot, auf jedem Turm ein Kegel. Er zeigt, wohin der Turret
     der Cannon schaut, und dreht mit dem Rohr auf jeden Gegner; kein
     eigenes Hin- und Herschwenken mehr.
550. In derselben Welle der Archer: das Modell dreht nicht, der Kegel zeigt
     auf den beschossenen Gegner und wandert mit etwa einer halben
     Umdrehung je Sekunde zum nächsten; der Archer schießt so schnell wie
     vorher.
551. Kein Gegner in Reichweite: der Kegel hält die letzte Richtung. Nach dem
     Wellenende drehen Turret und Kegel zur Wachrichtung, während der Look
     in 4,5 s ausblendet.
552. "Jump to wave" 21, Welle starten, P, einen Turm bauen: sobald das
     Modell steht, hat er einen Kegel in Richtung seines Modells; nach dem
     Fortsetzen dreht er zur Wache bzw. auf ein Ziel.
553. W14 oder W21 mit Research Center, Archer und, soweit verfügbar,
     Lightning zu Ende spielen, im WAVE-Panel "replay W14" (bzw. W21): die
     Kegel von Cannon, Archer und Lightning drehen auf ihre Ziele wie in der
     Welle. Auf dem Fortschrittsbalken an den Anfang springen: die Kegel
     zeigen, wohin sie damals zeigten, nicht in die Endrichtung. Das
     Research Center hat keinen Kegel. Esc: die Live-Kegel wie vor dem
     Replay.
554. "Boss Intro" an, Tempo höchstens 4x, "Jump to wave" 35, Space: "BLOOD
     MOON / Wave 35" erscheint. Tritt der Wurm aus dem Portal, während das
     Banner steht, verschwindet es mit dem Abdunkeln und läuft nach dem
     Intro noch einmal ganz; stand es schon in der Ausblendung, kommt es
     nicht wieder. Intro mit Esc übersprungen: das Banner kommt direkt
     danach.
555. In derselben Welle die Kamera vom Wurm wegdrehen: ein Boss-Pfeil zum
     Wurmkopf statt einer Pfeilgruppe mit großen Zahlen. Ein Segment in der
     Mitte zerstören: ein zweiter Boss-Pfeil zum neuen Kopf. Ringe auf den
     letzten 15 % der Route zeigen normale Pfeile.
556. "Boss Intro" aus, noch einmal W35: das Banner wie früher, einmal, 3,6 s.

**Screenshot**

557. Fenster 1920 × 1080, O (oder Display, "Photo Mode"), "Save screenshot",
     PNG öffnen: unten rechts die Attribution auf heller Leiste, darüber
     rechtsbündig das goldene 3DTD-Logo, halb durchsichtig, etwa 48 px hoch;
     unten links das Google-Logo, daneben klein und hell
     `https://3dtd.sgeht.net` auf dessen Mittellinie. Über hellen Fassaden
     noch lesbar, nicht aufdringlich?
558. DevTools-Gerätemodus hochkant, etwa 390 × 844 mit DPR 3, echter Ort in
     einer Großstadt (lange Attribution), O, "Save screenshot": die Adresse
     steht links über dem Google-Logo, nicht unter der hellen Leiste.
559. DevWorld (`?devworld`), O, "Save screenshot": Logo unten rechts, Adresse
     unten links am Rand, keine Anbieter-Logos.

**Routenkorridor** (Overlay an)

560. Rothenburg wie in alter Liste 44. Stellen suchen, an denen der
     Korridor schmaler wird (Vorgarten oder Parkbucht endet an einem Haus,
     Kreuzung mit einer Gasse): keine orangen Zellen im Grundriss des Hauses
     hinter der Fassadenlinie; der Rand springt am Übergang, statt als
     Viertelkreis bis 7 m ins Haus zu reichen.
561. Rothenburg, Fachwerkfassaden: `__corridor.pick()`, Linksklick auf eine
     orange Randzelle an einer Fassade; in der Tabelle nach "[Corridor] width
     at the nearest route station" die Spalte `rule` lesen (wo die neue Regel
     griff: `overhang: outer face`). Dann `__corridor.set({
     overhangDepth: 0 })` (misst neu), Overlay vergleichen, zurück mit
     `__corridor.reset()`. Erwartet: mit der Vorgabe weniger orange Zellen
     unter auskragenden Obergeschossen. Bleiben dort orange Zellen: einmal
     `__corridor.set({ wallMargin: 1 })`. Urteil: welche Variante besser
     aussieht und spielt.
562. Gasse mit parkenden Autos (alte Liste 41): Zellen auf Autos und dem
     Transporter orange und auf Straßenhöhe, der Gehweg dahinter weiß auf
     seiner Höhe. `__corridor.pick()` auf ein Auto: `clamped: true`,
     `heightM` etwa Straße, `columnBottomM` etwa Autodach. Gegenprobe ohne
     Tower: `__corridor.set({ stepRise: 50 })` zeigt das alte Verhalten,
     `__corridor.reset()` zurück.
563. Straße quer am Hang (Rothenburg oder DevWorld): bergseitige Randzellen
     weiß auf ihrer Höhe, nicht orange und nicht eingegraben. Falls orange:
     `__corridor.pick()` darauf und die Tabelle sichern.
564. Paris, Brücke vor dem Eiffelturm (alte Liste 14), zu beiden Stellen
     zoomen, an denen Linie und Gegner verschwinden. Notieren: Sieht man dort
     die Zellen im Overlay? Dann je Stelle `__corridor.pick()` und
     Linksklick auf die rote Linie; beide Tabellen und das Objekt
     "[Corridor] width at the nearest route station" (mit `tags`) kopieren,
     dazu aus `__routes.describe()` die Zeile des Ways mit derselben
     `way`-Nummer. Deutung nahe `routeM` 0: `cell` true, `heightM` gleich
     `columnBottomM`, `overM` mehrere Meter, `cameraSees` false heißt H1;
     dasselbe mit `layer=1` ohne `bridge` in `tags` heißt H2; `heightM` weit
     weg von `columnBottomM` heißt H3; `cell` false heißt H4; `surface`
     tunnel und `state` unsampled heißt H5.

**Optional: Training**

565. Backend starten (`training-backend/start.bat` oder Skill `/training`),
     Bot verbinden, zwei Wellen laufen lassen. Im neuesten
     `training-backend/logs/training_*.jsonl`: ein Eintrag `"type":
     "client_session"` mit `"game_version": "v0.2.0"`; `wave_result` mit
     `"perfect": true` auf Wellen ohne HP-Verlust, sonst `false`.

**Korridor-Review-Fixes (fixrev2)** (Rothenburg, Overlay an)

566. Gasse mit parkenden Autos und Transporter (alte Liste 41), eine orange
     Randzelle am Transporter oder an einer Hecke: `__corridor.pick()`,
     Linksklick darauf: `clamped: true`, `heightM` etwa Straße,
     `columnBottomM` etwa Oberkante des Objekts. Einen Tower mit Bodenziel in
     Reichweite setzen, der den Transporter schräg von oben frei sieht,
     auswählen, noch einmal `__corridor.pick()` auf dieselbe Zelle: in ihrer
     Zeile `ground: 'visible'`, in der LOS-Anzeige ist ihre Platte auf
     Straßenhöhe grün. Welle starten: der Tower beschießt Gegner, die dort
     mit großem Seitenversatz durch den Transporter laufen; die Schüsse gehen
     ins Auto (so entschieden). Bewerten, wie das aussieht.
567. An einer Fachwerkfassade eine orange Zelle unter einer Traufe, einen
     Tower davor setzen und auswählen, `__corridor.pick()` auf die Zelle: die
     Antwort ist wie vorher (die Probe liegt 1,5 m über dem Boden unter der
     Traufe, meist `blocked`); `__corridor.towerCells()` zählt sie weiter
     unter `clamped`.
568. Quick Actions, Developer options, Kachel "LOS" (Tooltip "LOS
     Cubemap"); mit dem Tower aus 566 ausgewählt über die
     Platte der Zelle am Transporter fahren: der Marker schwebt 1,5 m über
     dem Dach des Transporters, nicht über der Straße; `visible` passt zur
     Farbe der Platte.
569. DevWorld (`?devworld`), `__corridor.pick()`, Linksklick direkt auf die
     rote Linie an einer Stelle, an der die Kamera sie sieht: die Zeile nahe
     `routeM` 0 hat `cameraSees: true`.
570. Optional: Rothenburg ohne Tower, `__corridor.set({ stepRise: 0.75 })`
     (die Vorgabe, baut trotzdem neu): das Overlay zeigt dieselben orangen
     Zellen wie vorher; die Zeile `[Corridor] rebuild: ...` notieren.

## TODO-Stand

Nach DONE.md verschoben ist nichts, das passiert nach deinem OK. Jeder
Eintrag, den diese Session bearbeitet hat, trägt eine Zeile "Stand
(Fix-Session 2026-09-14)" mit Commit und Playtest-Nummer. Korrigiert ist
außerdem der Text von 1.9 "Blutmond: Grenzen des Looks" (die Decals sind
seit `3f1f5fdc` getönt).

| TODO-Eintrag | Stand | Playtest |
|---|---|---|
| 1.7 Routenkorridor: Restpunkte | teilweise: `0e9b9280`, `33ce898d`, `8f47fc4b`, `a8866f4d`, Review-Fixes `66569eca`, `9f2e2b47`, `d8298b31`, `633ec1cf`; offen Vorgärten, Traufen, Knick-Innenseite, zwei Ebenen | 560 bis 563, 566 bis 570 |
| 1.8 Steuerung und HUD: Kleinkram | Queue-Ketten zurückgenommen, `a1bcb3d5` | 508, 509 |
| 1.9 Pause: Loops | behoben, `177ba53f`, `5ae79d52` | 545 bis 548 |
| 1.9 Wurm-Boss: Reste | Pfeile behoben, `66a5468a`; Ecken und Assets offen | 555 |
| 1.9 Fähigkeitsleiste: Kopplung und Platz | Kopplung `49d8e06e`, drei Icons `f758f544`; Overlay-Berührung offen | 512, 516 |
| 1.9 Blutmond: Grenzen des Looks | Banner `1997c45b`, Text korrigiert; Rest bewusst so | 554, 556 |
| 1.9 Boss-Intro: Reste | Esc-Zeile `821c0cf6`, `a99d0c92`; Dialog und Hindernis offen | 524, 528 |
| 1.9 Quickfix-Paket: Reste | Queue entschieden, `a1bcb3d5` | 508, 509 |
| 1.9 Hover-Pick | behoben, `57858cb0` | 523 |
| 1.9 Sprung zu Welle N | keine Änderung; der Sprung lädt Ladungen nach (Korrektur zu n2rest) | |
| 1.9 Replay: Lücken | Test `8404cd10`, Aufnahme je Frame für Türme ohne Turret-Teil `18d7cef7` | 553 |
| 1.9 übrige Einträge | eingeordnet, nicht geändert (Entscheidung, Messung, bewusst so) | |
| 1.10 Route unter einer Brücke | nur Diagnose, `8f47fc4b` | 564 |
| 1.10 Upgrade per U | `68f69772` | 517 bis 520 |
| 1.10 Tastenübersicht | `edb6d630` | 524 |
| 1.10 Intro-Flug | `f94813b7`, `a99d0c92` | 525 bis 528 |
| 1.10 Hover-Reichweite beim Ziehen | `b1b684dd` | 521, 522 |
| 1.10 Screenshot | `2e2b266c`, `794415b3` | 557 bis 559 |
| 1.10 Onboarding-Tipps | `4a219445` | 502 bis 507 |
| 1.10 Fähigkeiten erst nach der Forschung | `586f493e` | 510 bis 513 |
| 1.10 Blutmond-Scheinwerfer | `6a42d3a5`, `18d7cef7` | 549 bis 553 |
| 1.10 HQ umsetzen | teilweise: Hinweis und Zeiten, `5bdce997`, `ac5eafee`, `4044c44a`; nicht schneller | 541 bis 544 |
| 1.10 Alter Korridor beim Ortswechsel | `4132607f`, `a99e7095` | 535, 536 |
| 1.10 Portal an einer Kurve, Spawn drehbar | `5a061423`, `8e79069f` | 529 bis 534 |
| 1.10 Favoriten | `a30d8412` | 537 bis 540 |
| 1.10 zombie_v2 ohne bewegte Vorschau | Rahmung `909fba4b`; Stillstand nicht belegt | 515 |
| 1.10 Spawn-Vorschau immer rot | `23483121` | 531 |
| 1.10 Impact Effects | kein Defekt gefunden, Test `0b1dbdf4` | 514 |
