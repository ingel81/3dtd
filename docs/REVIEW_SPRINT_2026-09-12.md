# Review-Handover: Sprint-Runde 2026-09-12

Zweite Runde auf demselben Branch `sprint/todo-2026-09-11`, gebaut wurden die
in der Review-Runde vom 2026-09-12 entschiedenen TODOs. Alles liegt lokal,
`main` ist unberührt, nichts ist gepusht. Kein TODO-Eintrag ist nach DONE.md
verschoben; welche Einträge erledigt sind, steht unten unter "TODO-Stand".
Die erste Runde steht in [REVIEW_SPRINT_2026-09-11.md](REVIEW_SPRINT_2026-09-11.md).

## Stand

| | |
|---|---|
| Branch | `sprint/todo-2026-09-11`, Head `dae5092` |
| Diese Runde | 52 Commits `02278dc..dae5092`, 193 Dateien, +9 114 / -1 660 Zeilen |
| Gesamt vor `main` | 164 Commits, 356 Dateien |
| Tests | vitest 124 Testdateien mit 1563 Tests (Rundenbeginn 103 mit 1349), pytest 98 |
| Prüfung | beide tsc, ESLint und Production-Build grün |

Nichts davon lief im Browser. Optik, Shader, Laufzeiten und Speicher sind per
Code-Review, Tests und Rechnung aus den Modelldateien geprüft, nicht
angesehen oder gemessen. Wo eine Zahl ungemessen ist, steht das dabei.

## Vorgehen

Acht Worker in eigenen Git-Worktrees, je ein Thema: route, tower, vfx, render,
content, assets, aiui und vat. Vor jedem Merge habe ich den Diff gelesen, bei
Bedarf Nacharbeit angefordert, auf den Sprint-Head rebasen lassen und per
Fast-Forward übernommen (vfx und die Modell-Kandidaten per Cherry-Pick, weil
der Worker gerade weiterarbeitete). Nach jedem Merge liefen vitest, beide tsc,
ESLint und der Production-Build. Unabhängige Review-Agents haben den
gemergten Stand danach gelesen (Bereiche im Abschnitt "Review"), ein
Faktencheck-Agent diesen Handover.

## Was sich ändert

### Routenkorridor nach Straßenbreite (route, `1306460` bis `bfb550c`)

- **Breite pro Abschnitt**: Jedes Routensegment hat eine eigene Halbbreite,
  die halbe Straßenbreite, begrenzt auf 2 bis 7 m. Die Straßenbreite kommt aus
  OSM `width`, sonst `lanes` mal 3 m plus 1 m, sonst aus einer Tabelle je
  `highway`-Klasse (residential 5,5 m, primary 8 m, footway 2 m usw.). Das
  HQ-Endstück erbt die Breite seiner Straße. Das feste `CORRIDOR_WIDTH` (7 m
  ab der Mittellinie) ist entfernt.
- **Zellen**: Eine Zelle gehört zum Korridor, wenn ihr Mittelpunkt innerhalb
  der Halbbreite des Segments liegt. Quer liegen mindestens 2 Zellen.
- **Gegner**: Der Seitenversatz ist ein Anteil der lokalen Breite (Halbbreite
  minus 1,5 m). Damit steht jeder Gegner in einer Route-Zelle, der
  Voraussetzung dafür, dass Tower ihn anvisieren (die Sichtlinie gilt
  weiterhin); ein Integrationstest läuft das auf einer Testroute Sub-Step für
  Sub-Step über Engstellen und Ecken ab. Vor Engstellen rücken Gegner sanft
  ein (höchstens 0,5 m pro Meter Weg). Im Sub-Step kommen ein Index-Lookup und
  drei Vergleiche dazu, ohne Allokation. In Wohnstraßen ohne `width`- oder
  `lanes`-Tag laufen Gegner deutlich enger: höchstens ±1,25 m statt ±3 m bei
  Typen, die bisher 3 m hatten, etwa ±0,8 m bei Typen mit bisher 2 m.
- **Tile-Messung**: Einmal pro Ortsladung schießt das Spiel alle 2 m
  waagrechte Strahlen zu beiden Seiten. Wo Fassaden oder Bäume näher stehen,
  wird der Korridor schmaler, breiter wird er dadurch nie. Log-Zeile
  `[Corridor] clearance: ...`, Strahlen unter `routeCorridor` in
  `__raycastStats()`.
- **Brücken**: Zellen auf `bridge=*`-Abschnitten nehmen das Deck (`topY`)
  statt des Bodens darunter.
- **Nebenbei behoben**: Der Seitenversatz war auf Ost-West-Straßen bis zu
  1/cos(Breite) zu lang, bei 48° N das 1,5-Fache.
- **Diagnose**: `__routes.describe()` zeigt `widthM`, `widthSource` und
  `corridorM`, `__rg.dumpCellsInBox()` die `surface` je Zelle.
- DevWorld zeichnet Straßen je Klasse in drei Breiten, der Korridor folgt.
- Details und Grenzen: `docs/ROUTE_GEOMETRY_ANALYSIS.md`, Abschnitt
  "Korridor nach Straßenbreite".

### Tower und Platzierung (tower, `c4cb08b`, `9eecf67`, `eb1c8c8`)

- **Turmdrehung**: In der Welle hält ein Turm ohne Ziel seine letzte Richtung,
  statt zurückzuschwenken (vorher bis zu 1 s Drehpause vor dem nächsten Schuss).
  Nach `wave:completed` drehen alle Tower zur Wachrichtung, dem Punkt, an dem
  die Route vom Spawn aus in ihre Reichweite eintritt. Neu platzierte Tower
  schauen von Anfang an dorthin. Neu berechnet bei Platzierung,
  Reichweiten-Upgrade und Routenänderung.
- **Eine Regelquelle für die Platzierung**: `TowerManager.validatePosition`
  und die Prüfung im `StrategicPlacementService` sind entfernt, Bots prüfen
  über `placementChecker()` mit denselben Regeln wie Vorschau und Klick. Bots
  verwerfen Kandidaten außerhalb des Spielbereichs jetzt schon in der Suche,
  und nach einer DevWorld-Regeneration gelten die aktuellen Spawns.
- **Zielwinkel metrisch** (`eb1c8c8`): Die Läufe zeigten bei 48° N bis zu
  etwa 11° neben diagonale Gegner, weil der Winkel aus rohen Grad-Deltas kam.
  Die Treffer betraf das nicht, der Schuss wartet auf die eigene
  Zielrotation. Folgen: leicht andere Drehwinkel zwischen Zielen, der
  Startpunkt der Dual-Gatling-Kugeln verschiebt sich um höchstens etwa 0,2 m,
  der Fire-Tower zeigt jetzt in Flammenrichtung (aus dem Code abgeleitet).

### Wave-Director erklärt sich (aiui, `0f3c364` bis `98676f2`)

- Das Wave-Debug-Fenster zeigt oben "Why this wave": Curriculum-Pin oder
  "ältestes erlaubtes Template", wegen fehlender Fähigkeit zurückgehaltene
  Templates, DPS-Rampe, Fairness-Cap, Leck-Regler, Endgame-HP. Die Gründe
  kommen strukturiert aus Maske, Director, Gate und Wellenbau, nicht aus einer
  Nachanalyse.
- Der alte Explainer behauptete für den Regel-Director Absichten, die er nicht
  hat ("No anti-air towers, sending flying enemies"), und nannte die gerade
  beendete statt der geplanten Welle. Er ist ersetzt, `lastExplanation` ist weg.

### Rendern und Laden (render `aa0bd7a` bis `33aed45`, vat `be5eaa0`, `fd18a10`)

- **Leere Pools werden nicht gezeichnet (R6)**: Gegner, Health-Bars,
  Projektile, Decals, Partikel, Floating Text und Blitze stehen nur noch in
  der Render-Liste, wenn sie etwas zeichnen (`DrawGate`).
- **Shader-Warm-up beim Laden**: `compileAsync` über die Szene, danach ein
  Ladeframe mit allen Pools offen, damit Buffer und VAT-Texturen nicht erst
  beim ersten Spawn hochgeladen werden. Log-Zeile `[Warmup] ...`.
- **R10**: `[Tiles] material type: ...` einmal pro Typ; Beleuchtung unverändert.
- **Raycast-Messung für die BVH-Entscheidung**: `__raycastStats()` zeigt Zeit
  und Anzahl der Tile-Raycasts je Aufrufer. Faustregel des Workers
  (ungemessen): BVH lohnt, wenn im Spiel Bursts regelmäßig über etwa 4 ms
  liegen oder beim Laden die Summe über 0,5 bis 1 s.
- **VAT nur mit sichtbaren Frames**: Todes-Clips werden bis zur sichtbaren
  Dauer gebacken (2 s mal `animationSpeed`), Idle wird gar nicht mehr
  gebacken. VAT-Speicher laut Rechnung aus den Modelldateien 664,6 auf
  516,1 MB, mit dem nächsten Punkt auf 485,6 MB.
- **zombie_v2 `Electrocuted_Fall` entfernt** (`fd18a10`, einzeln verwerfbar):
  Der Sturz beginnt erst nach etwa 3,25 s, der Gegner verschwand also nach 2 s
  zuckend im Stehen.

### Effekte (vfx, `c904b3f` bis `412cbff`, `6512321` bis `b43d2a6`)

- **Explosionen**: Die Cannon zeigte zwei Explosionen pro Treffer
  (`vfx:explosion` zusätzlich zum Impact), jetzt eine. Poison bekommt einen
  grünen statt orangen Burst, Ice verliert seine orangen Partikel. Der
  Feuerball schrumpft nicht mehr auf null, dazu eine Rauchstufe (5 bei der
  Cannon, 6 bei der Rakete). Die Größe folgt dem Explosionsradius (Cannon:
  Splash 6 m; Rakete: rein optischer Radius 8 m, dadurch ein Drittel größer).
  Zurückdrehen in `visual-effects.config.ts`.
- **Kampfspuren (Heatmap Schicht 1)**: Brandflecken unter Cannon-, Raketen-
  und Flammentreffern, höchstens einer pro Route-Zelle, nur am Boden.
  Wiederholte Treffer dunkeln nach, 60 s sichtbar, dann 30 s Ausblenden, Pool
  200, Neustart löscht alles.
- **Screen Shake**: Der alte Shake bewegte die Kamera, dadurch lief in jedem
  geschüttelten Frame die volle Tile-Traversierung, und Raycasts wie die
  Platzierung sahen die wackelnde Kamera. Jetzt verschiebt er nur die
  Projektion während des Zeichnens. Volle Stärke bis 150 m Kameraabstand, bei
  450 m null; HQ-Schaden und Boss-Tod schütteln immer. Neu ist der Versatz in
  beiden Bildschirmachsen gleich stark; der alte Shake bewegte die Kamera
  bewusst nur waagrecht (gegen Übelkeit), bei schräger Kamera wackelte das
  Bild trotzdem teils vertikal. Messhilfe `await __perf.shakeBench(5)`.
- **Partikel einmal pro Frame** (`6512321`): Blut-Splatter und Feuer wurden
  pro Frame zweimal bewegt und gealtert. Blut und Flammen sollen dank
  nachgestellter Werte aussehen wie vorher (Blut per Test gegen die alte
  Schleife, Feuer gerechnet, beides nicht angesehen); HQ-Feuer und
  Game-Over-Inferno dünnen nicht mehr aus und brennen dauerhaft dicht.
- **Partikel-Diebstahl** (`3d5b319`): Ein abgelaufener Effekt löschte Partikel,
  die inzwischen ein anderer Effekt im selben Slot nutzte.
- **Runde Blut- und Eisflecken** (`b43d2a6`) bei gleicher Fläche; der große
  Eisfleck ist 3,7 m rund statt 7 × 2 m.

### Neue Inhalte (content, `0fcacd8` bis `3f9b854`)

- **Chaos Tower**: neuer Schadenstyp `chaos` mit 1,0 gegen jede Rüstung,
  auch gegen Ethereal. 200 Gold, 50 Schaden, 1,2 Schuss/s, 60 m, Luft und
  Boden, Einzelziel-Orb in Violett. Forschung "Chaos Rift" für 1 000 Gold und
  30 s nach Siege Engineering und Storm Mastery. Im DPS-Modell 0,30 DPS pro
  Gold gegen jede Rüstung, der beste Spezialist je Rüstung liegt bei 0,56 bis
  0,89; auch im Endausbau überholt er die Spezialisten nicht. Modell: Kenney
  `tower-round-crystals` (CC0), der mittlere Kristall dreht sich zum Ziel
  (neues Config-Feld `turretNode`).
- **Skeleton**: `unarmored`, 20 HP, 6 m/s, 1 Gold, Swarm. Modell Kenney
  Graveyard Kit (CC0). Eigenes Template `skeleton_swarm` auf W19, dort lief
  bisher ein zweites Mal `rat_tide`.
- **Economy**: Mit dem Chaos Tower im Design-Roster sinkt der Gold-Puffer bis
  W30 von 83 % auf 69 %.
- **AI-Schema v5**: 208 Features (Chaos als Tower und Schadenstyp, Skeleton
  als Gegner). Chaos zählt als Anti-Air und Anti-Ethereal und öffnet beide
  Capability-Gates. Bots können Chaos bauen und erforschen.
- Alle Funken-Bursts laufen über `spawnBurstAtGeo(..., palette)`; der Chaos-Orb
  hinterlässt keine Brandflecken und löst keinen Shake aus.

### Gegnermodelle vermessen (assets, `71f0471`, `fdd48e1`, `873ccc8`, `c629ce3`)

- `npm run model-budget` schreibt `docs/ENEMY_MODEL_BUDGET.md`: Vertices,
  Dreiecke, Knochen, Texturen und VAT-Größe je Gegner, Häufigkeit in den
  Wellen, Budgetvorschlag und Optimierungsreihenfolge. Größter Befund: Der
  Hornet hat 69 297 VAT-Vertices pro Instanz, die Hornet-Welle ist mit rund
  14,9 Mio. Vertex-Aufrufen pro Frame die teuerste, zombie_v2 hat fast 7-mal so
  viele Vertices wie das alte Zombie.
- Drei neue CC0-Kandidaten mit `LICENSES.md`: Kenney-Skeleton und
  Kristallturm sind inzwischen im Spiel, der KayKit Skeleton Minion bleibt für
  einen Blender-Pass unter `candidates/` liegen.
- `tools/generated-file.ts`: Der Model-Budget-Generator schreibt nur bei echter
  Änderung und behält die Zeilenenden; die übrigen Generatoren noch nicht.

## Entscheidungen für dich

Von Workern selbst getroffen, bitte im Playtest bewerten:

1. **`lateralSpread` statt `lateralOffset`**: Der Seitenversatz ist ein Anteil
   der Straßenbreite statt einer Meter-Obergrenze. Engere Pulks in
   Nebenstraßen dürften Splash-Tower stärken, das ist nicht untersucht.
2. **Chaos Tower**: 1,0 auch gegen Ethereal, Luft und Boden, Preis 200 Gold.
   Baut man an W16 und W18 nur noch Chaos, schlägt der content-Worker 220 bis
   250 Gold vor, baut ihn niemand, eine billigere Forschung (Vorschlag, nicht
   gerechnet).
3. **Skeleton auf W19** statt der zweiten Rattenwelle.
4. **Idle-Animation ganz entfernt** statt bei Bedarf nachzubacken; der
   Idle-Knopf im Enemy-Debug-Fenster ist weg, "Stop" hält den Gegner nur an.
5. **zombie_v2 ohne `Electrocuted_Fall`** (`fd18a10`, einzeln verwerfbar).
6. **Screen Shake in beiden Bildachsen gleich stark**. Der alte Code bewegte
   die Kamera bewusst nur waagrecht, um Übelkeit zu vermeiden. Default bleibt
   an (steht im Code seit `02d9d43`).
7. **Wachrichtung ohne Sichtlinie**: Liegt der Routeneintritt hinter einem
   Gebäude, schaut der Turm trotzdem dorthin.
8. **Blender-Runde**: Hornet, zombie_v2, Rat, Spider, Wraith optimieren,
   Wallsmasher nach GLB, Dragon-Flug-Clip auf einen Loop kürzen. Braucht
   Blender mit laufendem MCP-Addon.

## Review

Zwei Review-Agents haben gelesen: einer `02278dc..412cbff` (render, aiui,
tower, route, assets, vfx Teil 1), einer die content-Commits `0fcacd8` bis
`3f9b854`. vat (`be5eaa0`, `fd18a10`), die zweite vfx-Charge (`6512321`,
`3d5b319`, `b43d2a6`) und die Fix-Commits lagen in keinem der beiden Bereiche;
der erste Review-Agent hat sie in einem Nachgang gelesen, ohne Befund (Optik
der Blut- und Feuerbögen und der runden Decals nur überflogen). Keiner fand
einen Befund der Schwere hoch.

Gründlich geprüft und in Ordnung: die Reihenfolge von Warm-up, Frame-Waiter
und Shake-Matrix, das DrawGate an allen Stellen, die Zeichenzahlen schreiben,
die Zellüberdeckung des Korridors (auch in Kurven und Tapern), die einheitliche
metrische Heading-Formel für Zielen, Ausrichtung und Wachrichtung, die
Explainer-Texte gegen den Code, der die Welle dimensioniert, Schema v5 in
TypeScript und Python, die Capability-Gates für Chaos. Nur überflogen: die
Optik der Effekte, das Model-Budget-Werkzeug, die Doku-Diffs.

Befunde:

1. **Korridor-Neuaufbau nach dem Laden läuft synchron** (mittel, Vermutung,
   ungemessen): Tile-Strahlen je Station, bei Verengung zweimal A* pro Spawn,
   neue Zellen und ein Höhen-Sweep, möglicherweise bei schon sichtbarer Karte.
   Bei 3 km Route etwa 4 500 Strahlen (je Station ein Säulen- und zwei
   Seitenstrahlen). Nicht geändert. Das `[Corridor]`-Log misst nur die
   Strahlen, der Neuaufbau danach ist ungemessen (Punkt 9 der Playtest-Liste).
2. **Teilgemessene Korridor-Segmente wurden nie nachgemessen** (niedrig).
   Behoben, wirkt heute aber nicht: Die Messung läuft nur einmal pro
   Ortsladung. Stationen ohne feines Tile zu diesem Zeitpunkt bleiben auf
   OSM-Breite und stehen im Log unter `unmeasured`. Das Log zählt jetzt
   `changed=` statt `narrowed=`. Ein zweiter Messlauf, etwa nach weiterem
   Tile-Streaming vor dem ersten Tower, wäre eine Entscheidung für dich.
3. **Rohes NUL-Byte in `tools/model-budget/model-inspect.ts`** (niedrig), grep
   hielt die Datei für binär.
4. **`ScreenShake.reset()` ohne Aufrufer** (niedrig).
5. **Static-Profil W19 spawnte noch Ratten**, obwohl das Curriculum dort
   `skeleton_swarm` hat (niedrig, nur Debug-Pfad ohne Director).
6. **`turretNode` ohne Fallback**, die Doku sagte das Gegenteil (niedrig).
7. **Slot-Test prüfte die Reihenfolge nicht** (niedrig).
8. **Tooltip-Akzent**: `chaos` und `lightning` fehlten, `cold` statt `ice`
   (niedrig).
9. **Toter `radius` in den Burst-Presets, ungenutzter Typ
   `KnownEnemyTypeId`** (niedrig).

Die Befunde 2 bis 9 sind behoben (`72b62bd`, `cfe99cd`, `4b363a1`, `627e425`,
`a340a1b`, `22bfe88`, `45bbfd7`, `ddf78cc`, `dae5092`). Sichtbare Folgen: Das
Static-Profil W19 schickt jetzt 500 Skelette mit denselben 10 HP pro Gegner
wie vorher die Ratten, aber mit 6 statt 10 m/s, also länger in Reichweite.
Die Tooltip-Karte des Ice-Towers ist jetzt eisblau statt gold, Lightning und
Chaos haben eigene Akzentfarben. Ein fehlender `turretNode` warnt einmal pro
Tower-Typ in der Konsole.

Hinweis aus dem zweiten Review: Mit `turretNode` hat der Chaos Tower einen
drehbaren Teil und schießt deshalb erst, wenn der Kristall ausgerichtet ist,
bei einem Zielwechsel um 180° bis zu etwa 1 s später, genau wie Magic. Das
DPS-Modell rechnet das nicht ein.

## Playtest-Liste

Nummeriert, damit du mit "7 ok, 12 kaputt" antworten kannst.

**Aus der letzten Runde noch offen**

1. Intro mit kaltem Cache (DevTools "Disable cache"): Ladebildschirm zeigt
   "Preparing Intro Flight", der Flug startet erst mit Höhen,
   `__flight.state()` hat das Feld `reliable`.
2. Framing nach dem Intro und nach "Reset Camera" (`CAMERA_EDGE_MARGIN` 3 %).
3. Damage-Chart: gesperrte Tower ausgeblendet, passt in die Breite, neue Optik.
4. Balance: Spreizung der Matrix spürbar, ab W31 jede fünfte Welle ein Boss,
   Gold bei W30 (über 150k oder mehr als 20 Tower: Gold W16 bis W30 kürzen).

**Verhaltensprüfung Terrain- und Performance-Umbau (TODO 1.1)**

5. Gift bei Timescale 1× und 10×: gleiche Tick-Zahl und gleicher
   Gesamtschaden in Spielzeit.
6. Frost-Aura, Todesanimation und Health-Bars bei niedriger Framerate.
7. Luft-Einheiten auf richtiger Flughöhe.
8. Terrain-Höhen an einem flachen Ort und in einer Großstadt: Straßen,
   Marker, Route-Linie, Tower-Vorschau sitzen richtig.

**Routenkorridor**

9. Echten Ort laden: Konsole zeigt `[Corridor] clearance: ...`, in einer
   dichten Stadt `changed` über 0 und `unmeasured` klein. Die Dauer am
   Zeilenende notieren (nur die Strahlen; `rays=` zählt zwei pro Station, die
   Säulen-Probe nicht) und bei langen Routen, ob die Karte kurz nach dem Laden
   hängt (Review-Befund 1).
10. `__routes.describe()`: residential 5.5, primary 8, `lanes`-Ways mit Quelle
    `lanes`, verengte Abschnitte mit `corridorM` als Spanne.
11. Debug-Toggle `grid`: in Gassen 2 bis 3 Zellen quer, auf Hauptstraßen
    breiter, deutlich weniger Zellen auf Dächern und Fassaden.
12. Welle: Gegner in Gassen nah an der Mitte, auf Hauptstraßen verteilt, vor
    Engstellen sanftes Einrücken ohne Sprünge.
13. Tower schießen auch in engen Straßen und am HQ-Endstück ohne Aussetzer.
14. Route über eine Brücke: Linie und Gegner auf dem Deck,
    `__rg.dumpCellsInBox` zeigt dort `surface: 'deck'`.
15. DevWorld: Straßen in drei Breiten, Korridor passt dazu.
16. 20k-Benchmark gegen den Stand vor der Runde (`02278dc`).

**Tower**

17. Tower neben die Route setzen: Turm zeigt sofort zum Routeneintritt.
18. In der Welle nach einem Kill: Turm bleibt stehen statt zurückzuschwenken,
    der nächste Gegner wird ohne Drehpause beschossen (am deutlichsten Cannon).
19. Welle endet: alle Türme drehen zur Wachrichtung; Reichweiten-Upgrade
    zwischen den Wellen dreht leicht nach.
20. Diagonal stehende Gegner: Läufe zeigen genau aufs Ziel, Fire-Tower in
    Flammenrichtung.
21. Bots (DevWorld): keine Warnungen "Outside play area".

**Director**

22. Wave-Debug-Fenster: W1 bis W30 "Curriculum: wave N is always X", ab W31
    "Oldest of N allowed templates", Boss ab W35 "Boss wave", ohne Anti-Air
    "Held back, no anti-air", nach einer Custom-Welle der Platzhalter.

**Rendern und Laden**

23. Konsole nach dem Laden: `[Warmup] ... P empty pools drawn for one frame
    (Z ms)`, P etwa Gegnertypen plus 15, Z etwa ein Frame (nicht 1000 ms).
24. Zeilen `[Tiles] material type: ...` notieren (lit oder unlit).
25. Erste Welle: kein Ruckler und alles sichtbar beim ersten Spawn je Typ,
    ersten Pfeil, Raketen- und Magie-Schuss, ersten Decal, ersten Blitz.
26. Debug-Schalter "Gegner" und "Health-Bars" an und aus, auch mit Gegnern.
27. `__raycastStats(true)` nach dem Laden, dann eine Welle mit Platzieren,
    dann `__raycastStats()`: Werte für die BVH-Entscheidung.
28. Gegner sterben lassen (W1 zombie_v2, Penguin, Zombie Soldier, Mammoth,
    Stone Golem): kein Sprung auf Frame 0, zombie_v2 verschwindet liegend.
29. Optional: Ladezeit und GPU-Speicher gegen `412cbff`.

**Effekte**

30. Cannon und Rakete auf 100 bis 200 m: Blitz, Feuerball, Rauch, Rakete
    größer, keine Überbelichtung; Poison grün, Ice ohne Orange.
31. Kampfspuren unter Einschlägen und Flammenzielen, nicht auf Dächern oder
    unter Fliegern, Blut darüber, kein Z-Fighting.
32. Screen Shake nah ja, fern nein, Platzier-Cursor wackelt nicht; vertikales
    Zittern angenehm?
33. `await __perf.shakeBench(5)` (echte Tiles, Pause, Kamera still): `shake`
    sieht bei `traversals` und `tilesUpdateMs` aus wie `off`.
34. HQ unter halbe HP: Feuer bleibt dicht; Game-Over-Inferno voll, nicht zu
    hell.
35. Blut- und Eisflecken rund, etwa so groß wie vorher.

**Neue Inhalte**

36. Chaos Rift erscheint nach Siege Engineering und Storm Mastery.
37. Chaos Tower: Kristallturm in Welt und Build-Menü, Größe passt, der
    mittlere Kristall dreht sich, der Orb kommt aus der Spitze.
38. Chaos-Balance an W16 und W18: nur noch Chaos oder gar nicht?
39. Skeleton auf W19: läuft vorwärts, Beine passen zum Tempo, Größe lesbar,
    liegt nach dem Tod kurz und verschwindet.
40. Credits-Dialog: beide Kenney-Einträge.

## Befunde, offen

Neu in TODO.md unter 1.7 eingetragen.

## TODO-Stand

Erledigt auf dem Sprint-Branch, nach deinem OK nach DONE.md zu verschieben:

| TODO-Eintrag | Stand | Commits |
|---|---|---|
| 1.0 Routenkorridor nach Straßenbreite | umgesetzt inklusive Brücken; Tunnel nicht angefasst | `1306460` bis `bfb550c` |
| 1.5 R6 und R10 | umgesetzt (R10 nur Log) | `aa0bd7a` bis `33aed45` |
| 1.6 Platzierungsregeln zusammenlegen | umgesetzt | `9eecf67` |
| 1.6 Decision-Explainer | umgesetzt | `0f3c364` bis `98676f2` |
| 3.1 Explosions-Partikel | umgesetzt, Sichtprüfung offen | `c904b3f` bis `6686dc1` |
| 3.1 Screen Shake | umgesetzt, Messung per `shakeBench` offen | `142193c` |
| 3.1 Turmdrehung | umgesetzt | `c4cb08b` |
| 3.1 Kampfspuren Schicht 1 | umgesetzt | `e404806`, `412cbff` |
| 3.3 Chaos Tower | umgesetzt | `0fcacd8` bis `12e9f1e` |
| Backlog zombie_v2 / alle Gegnermodelle | vermessen, VAT gekürzt; Mesh-Optimierung offen (Blender) | `fdd48e1`, `be5eaa0`, `fd18a10` |
| Backlog BVH | Messung eingebaut, Entscheidung nach Playtest | `072d29f` |
| Enemy-Ideen Skeleton | umgesetzt | `a177026`, `3f9b854` |
| Enemy-Ideen Ghost | war schon im Spiel (`ghost`, ethereal, W13/W18/W23) | |
