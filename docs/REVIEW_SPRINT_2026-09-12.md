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
   **ok** (Playtest 2026-09-12, nach Fix: Flugkurve waagrecht, weicher
   Einflug von der Totalen zum HQ; Kamera-Zeitleiste im Dev → Dump)
2. Framing nach dem Intro und nach "Reset Camera" (`CAMERA_EDGE_MARGIN` 3 %).
   **ok** (Playtest 2026-09-12, nach Fix: Framing mit echter Linse statt
   75°-Default, Marker mit Höhe im Fit, Totale als Frame gespeichert;
   Laden, Intro-Ende, Abbruch und Reset zeigen denselben Ausschnitt)
   **Nachtrag** (Playtest 2026-09-12, Stuttgart Königstraße): Totale und Reset
   viel zu nah, am Boden klebend. Laut Dump saß der Frame auf der Einzelprobe
   unter dem HQ, -748,8 m in einem Mesh-Loch (Zellen-Median 296 m); die
   Kamera landete unter dem Gelände. Fix: Boden der Totalen ist der Median
   der Route-Zellen unter ihren Punkten.
   Zweiter Fall (kalter Cache, früh abgebrochen, 2 von 4 bis 5 Versuchen):
   beim Laden gab es noch gar keinen Boden (`framing.noTerrain`), gespeichert
   wurde die Startpose (y 400 bei Boden 296, Blick auf y 0). Fix: ohne Frame
   wird nichts gespeichert; Reset, Abbruch und Intro-Start rechnen die Totale
   frisch, bevorzugt aus Zellen feiner Tiles (bis 20 m Fehler). **ok** nach
   Fix (Playtest 2026-09-12, kalter Cache und früher Klick; HQ-Marker sitzt
   richtig).
3. Damage-Chart: gesperrte Tower ausgeblendet, passt in die Breite, neue Optik.
   **ok** (Playtest 2026-09-12)
4. Balance: Spreizung der Matrix spürbar, ab W31 jede fünfte Welle ein Boss,
   Gold bei W30 (über 150k oder mehr als 20 Tower: Gold W16 bis W30 kürzen).
   **Zurückgestellt** (Playtest 2026-09-14): erst mit einem Run-Dump je Welle
   sinnvoll prüfbar, siehe TODO 2.2 "Run-Dump je Welle als Feedbackschleife
   fürs Balancing".

**Verhaltensprüfung Terrain- und Performance-Umbau (TODO 1.1)**

5. Gift bei Timescale 1× und 10×: gleiche Tick-Zahl und gleicher
   Gesamtschaden in Spielzeit.
   **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`: Custom Wave 1
   Tank, Poison-Tower, "Damage dealt" bei 1× und 10× genau gleich, je 186)
6. Frost-Aura, Todesanimation und Health-Bars bei niedriger Framerate.
   **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`, FPS 30)
7. Luft-Einheiten auf richtiger Flughöhe.
   **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`, Custom Wave Bat
   über flachem Gelände und Hügel, nach dem Steigflug aus dem Tor)
8. Terrain-Höhen an einem flachen Ort und in einer Großstadt: Straßen,
   Marker, Route-Linie, Tower-Vorschau sitzen richtig.
   **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)

**Routenkorridor**

9. Echten Ort laden: Konsole zeigt `[Corridor] clearance: ...`, in einer
   dichten Stadt `changed` über 0 und `unmeasured` klein. Die Dauer am
   Zeilenende notieren (nur die Strahlen; `rays=` zählt zwei pro Station, die
   Säulen-Probe nicht) und bei langen Routen, ob die Karte kurz nach dem Laden
   hängt (Review-Befund 1).
   **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, kein Hänger
   gemeldet). Erste Messung vor den feinen Tiles misst nichts (`unmeasured`
   = alle Stationen, `rays=0`), die zweite misst:
   - Dorf: 58 Segmente, 484 Stationen, `unmeasured=2`, `rays=1928`,
     `changed=true`, 796,5 ms in 242 Scheiben, Wanduhr 1684,6 ms.
   - Größere Stadt: 79 Segmente, 742 Stationen, `unmeasured=1`, `rays=2964`,
     1254,5 ms in 385 Scheiben, Wanduhr 2770,8 ms.
   - Chiyoda (Tokio): 49 Segmente, 604 Stationen, `unmeasured=2`,
     `rays=2408`, 1164,2 ms in 455 Scheiben, Wanduhr 3570,9 ms.
   Die 1 bis 2 übrigen Stationen stehen jeweils als `noTile=` in der Zeile.
10. `__routes.describe()`: residential 5.5, primary 8, `lanes`-Ways mit Quelle
    `lanes`, verengte Abschnitte mit `corridorM` als Spanne.
    **ok** (Playtest 2026-09-12: residential 5,5, `lanes` × 3 + 1, `width`-Tags
    übernommen, Spannen wie "6.4-14.0"; `corridorM` meist 14,0, der
    gemessene Freiraum mit Deckel 7 m je Seite)
11. Debug-Toggle `grid`: in Gassen 2 bis 3 Zellen quer, auf Hauptstraßen
    breiter, deutlich weniger Zellen auf Dächern und Fassaden.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
12. Welle: Gegner in Gassen nah an der Mitte, auf Hauptstraßen verteilt, vor
    Engstellen sanftes Einrücken ohne Sprünge.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
13. Tower schießen auch in engen Straßen und am HQ-Endstück ohne Aussetzer.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
14. Route über eine Brücke: Linie und Gegner auf dem Deck,
    `__rg.dumpCellsInBox` zeigt dort `surface: 'deck'`.
    **Befund, Diagnose offen** (Playtest 2026-09-14 auf
    `sprint/night-2026-09-14`): Paris, Brücke vor dem Eiffelturm. Die Route
    läuft hier nicht über das Deck, sondern am Quai entlang an den
    Brückenköpfen vorbei; an zwei größeren Stellen dort verschwinden Gegner,
    Zellen und Routenlinie. Vermutung (unbelegt): Die Straße führt unter den
    Brückenrampen durch, OSM markiert das nicht als Tunnel, und die
    Tile-Geometrie verdeckt alles darunter. Nächster Schritt: an beiden Stellen
    `__corridor.pick()` (Klick auf die Stelle), `__routes.describe()` (Tags
    `bridge`, `tunnel`, `covered`, `layer`) und
    `__rg.dumpCellsInBox({xMin, xMax, zMin, zMax})` um die Pick-Koordinaten.
    Ein Ort mit einer Route über ein Brückendeck steht für den eigentlichen
    Punkt noch aus.
15. DevWorld: Straßen in drei Breiten, Korridor passt dazu.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
16. 20k-Benchmark gegen den Stand vor der Runde (`02278dc`).
    **Nach TODO verschoben** (Playtest 2026-09-14): Messaufgabe gegen einen
    alten Stand, kein Klicktest; steht in TODO 1.4.

**Tower**

17. Tower neben die Route setzen: Turm zeigt sofort zum Routeneintritt.
    **Befund** (Playtest 2026-09-12): Turm bewusst in Gegenrichtung gesetzt,
    er sprang nach 800 ms hart zur Wachrichtung, statt zu drehen. Ursache:
    die Wachrichtung wurde gerechnet, aber nicht auf den Turm-Knoten gesetzt.
    Fix: Der Turm macht zuerst die Referenzfahrt (75° links, 75° rechts,
    zurück) um den gesetzten Stand und dreht dann mit Zielgeschwindigkeit zur
    Wachrichtung. **ok** nach Fix (Playtest 2026-09-12).
18. In der Welle nach einem Kill: Turm bleibt stehen statt zurückzuschwenken,
    der nächste Gegner wird ohne Drehpause beschossen (am deutlichsten Cannon).
    **ok** (Playtest 2026-09-12)
19. Welle endet: alle Türme drehen zur Wachrichtung; Reichweiten-Upgrade
    zwischen den Wellen dreht leicht nach.
    **ok** (Playtest 2026-09-12)
20. Diagonal stehende Gegner: Läufe zeigen genau aufs Ziel, Fire-Tower in
    Flammenrichtung.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
21. Bots (DevWorld): keine Warnungen "Outside play area".
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)

**Director**

22. Wave-Debug-Fenster: W1 bis W30 "Curriculum: wave N is always X", ab W31
    "Oldest of N allowed templates", Boss ab W35 "Boss wave", ohne Anti-Air
    "Held back, no anti-air", nach einer Custom-Welle der Platzhalter.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)

**Rendern und Laden**

23. Konsole nach dem Laden: `[Warmup] ... P empty pools drawn for one frame
    (Z ms)`, P etwa Gegnertypen plus 15, Z etwa ein Frame (nicht 1000 ms).
    **ok** (Playtest 2026-09-12: 16 neue Shader, 6,2 ms Compile im Main
    Thread, bereit nach 16,7 ms; 36 Pools, Ladeframe 166,5 ms)
24. Zeilen `[Tiles] material type: ...` notieren (lit oder unlit).
    **ok** (Playtest 2026-09-12: beide Typen, `MeshBasicMaterial` unlit und
    `MeshStandardMaterial` lit; Anteil unbekannt, R10-Entscheidung offen)
25. Erste Welle: kein Ruckler und alles sichtbar beim ersten Spawn je Typ,
    ersten Pfeil, Raketen- und Magie-Schuss, ersten Decal, ersten Blitz.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
26. Debug-Schalter "Gegner" und "Health-Bars" an und aus, auch mit Gegnern.
    **ok** (Playtest 2026-09-12)
27. `__raycastStats(true)` nach dem Laden, dann eine Welle mit Platzieren,
    dann `__raycastStats()`: Werte für die BVH-Entscheidung.
    **ok, gemessen** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`).
    Laden (156 s ab Reset): `streets` 24 406 Aufrufe / 3209 ms (Burst 502 ms),
    `routeGrid` 22 516 / 1924 ms (Burst 696 ms), `routeCorridor` 4078 / 935 ms,
    `cameraControls` 3117 / 448 ms. Welle mit Platzieren (101 s):
    `towerFootprint` 6055 / 1606 ms (0,265 ms je Strahl, Burst 11,5 ms),
    `towerRange` 3440 / 963 ms (Burst 110,8 ms), `heightAtGeo` 1693 / 498 ms,
    `streets` 1895 / 468 ms, `screenPick` 613 / 274 ms, `routeGrid` 1335 /
    246 ms (Burst 110,1 ms), `cameraControls` 454 / 143 ms. Auswertung in TODO
    "Performance: BVH für Terrain-Raycasts".
28. Gegner sterben lassen (W1 zombie_v2, Penguin, Zombie Soldier, Mammoth,
    Stone Golem): kein Sprung auf Frame 0, zombie_v2 verschwindet liegend.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
29. Optional: Ladezeit und GPU-Speicher gegen `412cbff`.
    **Nach TODO verschoben** (Playtest 2026-09-14): Messaufgabe gegen einen
    alten Stand, kein Klicktest; steht in TODO 1.5.

**Effekte**

30. Cannon und Rakete auf 100 bis 200 m: Blitz, Feuerball, Rauch, Rakete
    größer, keine Überbelichtung; Poison grün, Ice ohne Orange.
    **ok** (Playtest 2026-09-12). Anmerkung: Die Explosion wirkt erst groß und
    zerfällt dann in mehrere kleine. Das sind die 50 Feuer-Sprites einer
    einzigen Explosion, die mit 5 bis 20 m/s auseinanderfliegen und auf 40 %
    schrumpfen. Kompakter über `EXPLOSION_LOOK.fire.speedMax` bzw. `sizeEnd`.
31. Kampfspuren unter Einschlägen und Flammenzielen, nicht auf Dächern oder
    unter Fliegern, Blut darüber, kein Z-Fighting.
    **ok** (Playtest 2026-09-13 auf `sprint/night-2026-09-13`)
32. Screen Shake nah ja, fern nein, Platzier-Cursor wackelt nicht; vertikales
    Zittern angenehm?
    **ok** (Playtest 2026-09-12), Wunsch: Wackeln soll viel früher
    verschwinden. Umgesetzt in zwei Schritten: volle Stärke bis 40 m statt
    150 m, keins ab 100 m statt 450 m (`SCREEN_SHAKE_CONFIG`).
33. `await __perf.shakeBench(5)` (echte Tiles, Pause, Kamera still): `shake`
    sieht bei `traversals` und `tilesUpdateMs` aus wie `off`.
    **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`): `off` 719
    Frames, 6,95 ms, P95 7,6 ms, `tilesUpdateMs` 0,01, 0 Traversierungen;
    `shake` 720 Frames, 6,95 ms, P95 7,7 ms, 0,01, 0; zum Vergleich
    `camera-move` 1,75 ms Render, 0,74 ms Tiles-Update, 720 Traversierungen.
34. HQ unter halbe HP: Feuer bleibt dicht; Game-Over-Inferno voll, nicht zu
    hell.
    **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`; HP per
    Rechtsklick auf den Cheat +HP gesenkt)
35. Blut- und Eisflecken rund, etwa so groß wie vorher.
    **ok** (Playtest 2026-09-12)

**Neue Inhalte**

36. Chaos Rift erscheint nach Siege Engineering und Storm Mastery.
    **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`). Offen als
    Entscheidung: ob ein gesperrter Knoten anklickbar sein und seine fehlenden
    Voraussetzungen mit einreihen soll (Nachtschicht 2, Commit `7914062f`),
    entscheidet der User später; steht in TODO 1.9.
37. Chaos Tower: Kristallturm in Welt und Build-Menü, Größe passt, der
    mittlere Kristall dreht sich, der Orb kommt aus der Spitze.
    **ok** (Playtest 2026-09-12; ein eigenes Modell kommt später)
38. Chaos-Balance an W16 und W18: nur noch Chaos oder gar nicht?
    **Zurückgestellt** (Playtest 2026-09-14): Balance erst mit dem Run-Dump je
    Welle bewertbar, siehe TODO 2.2 "Run-Dump je Welle als Feedbackschleife
    fürs Balancing".
39. Skeleton auf W19: läuft vorwärts, Beine passen zum Tempo, Größe lesbar,
    liegt nach dem Tod kurz und verschwindet.
    **Befund** (Playtest 2026-09-12): sonst ok, Beine deutlich zu schnell.
    `animationSpeed` 1,25 ließ die Füße mit etwa 8 m/s laufen (Sprint ±90°,
    3,2 m Schritt je 0,5-s-Zyklus), jetzt 0,93 für 6 m/s. Die Animation
    skaliert mit der aktuellen Geschwindigkeit, der Wert gilt also bei jedem
    Tempo. **ok** nach Fix (Playtest 2026-09-12).
40. Credits-Dialog: beide Kenney-Einträge.
    **ok** (Playtest 2026-09-12)

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

## Nachtrag: nach dem ersten Playtest (2026-09-12, nachmittags)

Nach deinen Screenshots zum Korridor und deiner Wahl im Design-Canvas ging es
auf demselben Branch weiter. Stand: Head `48e8e02`, 40 Commits seit `aaa6835`,
102 Dateien, +6 122 / -1 758 Zeilen, 205 Commits vor `main`. vitest 131
Testdateien mit 1690 Tests, beide tsc, ESLint und Production-Build grün.
Auch hier lief nichts im Browser.

### Korridor

- **Breite aus dem gemessenen Freiraum, je Seite getrennt** (`331c7a3`): links
  und rechts der Route gilt jeweils der Freiraum bis zur ersten Wand, geklemmt
  auf höchstens 7 m. OSM-Breite und `highway`-Tabelle gelten nur noch, wo nicht
  gemessen werden konnte, und als Obergrenze auf dem Endstück zum HQ. Kurze
  Einbrüche (bis etwa 4 m) werden geschlossen, kurze Ausbuchtungen (bis etwa
  8 m) abgeschnitten. Gegner verteilen sich je Seite.
- **Engstelle mit einer Zelle** (`0185249`): Die Zellen, durch die die
  Mittellinie läuft, gehören immer zum Korridor, die kleinste Halbbreite ist
  1 m. An solchen Stellen laufen Gegner auf der Mittellinie.
- **Dach-Check** (`04d5d86`): Liegt die gemessene Höhe einer Zelle mehr als
  2,5 m über dem Boden der Mittellinie daneben, bekommt sie diesen Boden und die
  Markierung `clamped` (nicht auf Brückendecks und in Tunneln). Unter einer
  Traufe dürfte so eine Zelle in der Tower-Anzeige meist rot am Boden statt
  grün auf dem Dach erscheinen (aus dem Code abgeleitet).
- **Parkende Autos** (`8910463`): gemessen wird in 1 m und 3,5 m Höhe, als Wand
  zählt nur, was beide Strahlen trifft; 0,5 m Abstand zur Wand. Nebenwirkung:
  Hecken und Mauern unter 3,5 m begrenzen den Korridor nicht mehr.
- **Nachmessen** (`30bc473`): Die erste Messung lief etwa 2 s nach dem Laden,
  ohne auf die feinen Tiles entlang der Route zu warten. Stationen auf groben
  Tiles fielen auf die OSM-Breite zurück. Das passt zu deiner schmalen
  Abzweigung, ist aber nur aus dem Code abgeleitet. Jetzt werden nach jedem
  Tile-Schub die Stationen nachgemessen, die noch auf groben Tiles standen,
  und neu gebaut wird nur, wenn das den Korridor ändert; nur ohne Tower,
  Gegner und Welle, nicht im Intro, höchstens alle 3 s.
- **LOS-Anzeige** (`88bd5cd`): Die Anzeige eines ausgewählten Towers färbte
  ihre Zellen nach der Sicht eines anderen Towers, wenn dieser die gemeinsame
  Cubemap beim Tile-Streaming neu gerendert hatte. Behoben. Ob das zu deiner
  fehlenden Mittelreihe beitrug, ist offen.
- **Werkzeuge:** `__corridor.get()` / `.set({...})` / `.reset()` zum Tunen ohne
  Tower (`9367158`), `__corridor.towerCells()` (`7e5b57b`), `__corridor.pick()`
  mit Klick auf die Karte: Zellen im Umkreis und die Herkunft der Breite an der
  nächsten Station (`6094f2e`, `b86c8c9`). Das Route Grid Overlay ist
  kräftiger, zeichnet jede Zelle mit einer Kontur nach Zustand: weiß normal,
  orange `clamped`, blau Brückendeck, rosa ohne Höhenprobe (`25da3d2`).
- **Konzept route-parallele Zellen** (`a866e63`,
  `docs/ROUTE_ALIGNED_CELLS_CONCEPT.md`): Empfehlung, erst den breiten
  Korridor zu testen. Stören die Treppenkanten dann vor allem optisch, reicht
  ein Band entlang der Route nur für die Anzeige (2 bis 3 Tage); echte
  Routenzellen (8 bis 12 Tage) oder eine Mischform (6 bis 8) erst, wenn auch
  das Spielverhalten an der Treppe stört.
- **Auslöser getestet** (`cb925c6`): Wann gemessen, nachgemessen und neu
  gebaut wird, entscheidet jetzt eine kleine Klasse `CorridorRefit` mit 13
  Tests (Sperren bei Tower, Gegner, Welle, Intro, DevWorld, 3-s-Drosselung,
  `__corridor.set`). Verhalten unverändert.
- **Zeitmessung des Neuaufbaus** (`f9fe730`): Jeder Neuaufbau schreibt
  `[Corridor] rebuild: routes= grid= heights= lines= overlays= total= ms
  spawns= cells=`. Die Zeile erscheint nur bei einem Neuaufbau, also nach
  einer Messung mit `changed=true` oder nach `__corridor.set`/`reset`.
  Zahlen aus dem Spiel gibt es noch keine.
- **Tunnel und überdachte Durchgänge** (`db2eb51`): `tunnel=*` (außer `no`)
  und `covered=yes` werden nicht vermessen (OSM-Breite), die Zellhöhe wird
  zwischen den Böden 2 m vor den beiden Mündungen interpoliert, die Zellen
  tragen `surface: 'tunnel'` (gelbe Kontur im Overlay); liegt an einer der
  beiden Mündungen noch kein Tile, bleiben sie ohne Höhe (dann rosa). Überschneidet sich
  ein Tunnel mit einer anderen Route, gewinnt die Tunnelzelle; eine
  Überführung über einem Tunnel sackt dort auf die Sohle ab. Deine
  Entscheidung: Tower sehen und schießen in Tunnel nur so weit, wie die Tiles
  es zulassen, also meist nur an den Mündungen; keine Sonderregel.
- **Offen:** die Ursache der fehlenden Mittelreihe; die Kosten des
  Neuaufbaus nach der Messung (synchron, jetzt messbar).

### Design aus dem Canvas

- **Header** (`7207384`): goldene Oberkante, die Stat-Leiste zeigt `HQ`,
  `CREDITS`, `WAVE` klein über den Zahlen, bleibt 271 px breit und bündig über
  dem Button.
- **Next-Wave-Button** (`143dfb3`, `5ef87cf`): Gold, 44 px, "START WAVE N".
  Während einer Welle "WAVE N" und "x left" mit einem Teal-Balken für den
  Anteil der verbleibenden Gegner (lebende plus noch nicht gespawnte). Der
  Gegner-Chip im Header zählt nur lebende, die Zahlen weichen deshalb ab.
  Manuelle Debug-Wellen zeigen weder Zahl noch Balken.
- **Dev-Menü** (`6deed16`): Kachel-Raster in Breite der Quick-Actions-Leiste,
  Gruppen MAP, VIEW & PANELS, CHEATS, WAVES & INSPECT; der aktive Dev-Toggle
  ist sauber gold (vorher gold mit Teal-Glow).
- **Nur ein Menü offen** (`80ee3e9`): Display, Audio, Layers, Dev schließen
  sich gegenseitig; nach dem Laden ist das zuletzt offene wieder offen.

### Aufräumen und VFX-Einstellungen

- **Debug-Fenster laden bei Bedarf** (`eddeb82`): ein gemeinsamer Lazy-Chunk,
  Spielstart netto etwa 147 kB weniger (statische Import-Hülle des Builds,
  unkomprimiert). Der Event-Debugger loggt
  erst ab dem Laden des Chunks.
- **Tote Reste entfernt** (`71f41ec`), `poison-glob` im Sound-Budget
  (`3047750`), Generatoren schreiben nur bei echter Änderung (`9f4b0a5`),
  aria-labels (`ef2e626`), Charts neu erzeugt (`881a7a7`).
- **VFX-Einstellungen** (`8eb765f` bis `de1b57d`): Panel im Display-Menü mit
  Preset Low/Medium/High und Schaltern für Muzzle Flash, Trails, Impact
  Effects, Ground Marks, Bloom, Color Grading, Freeze Tint. Abgeschaltete
  Effekte werden nicht erzeugt. Ein Preset setzt Screen Shake und Freeze Tint
  nicht. Alle Display-Optionen liegen jetzt in `td_display_options`. Der
  FPS-Gewinn je Schalter ist ungemessen.

### Kleinkram

- **Streaks der Projektile in Metern** (`482f4e1`): Der Trail-Streak bestand
  aus den letzten Positionen je Render-Frame. Bei 30 FPS oder höherer
  Spielgeschwindigkeit wurde das Düsenglühen der Rakete dadurch länger (bei
  30 FPS oder 2x etwa 12 m statt 6 m). Jetzt hat jeder Streak-Typ eine feste
  Länge in Metern, übernommen aus dem Bild bei 60 FPS und 1x. Das betrifft
  alle Streak-Typen.
- **Verzögerter Rauch** (`bd5112d`): Rauchpuffs, die noch warten, werden
  nicht mehr gezeichnet; mögliche 1-px-Punkte vor dem Rauch sind damit weg.
- **Wachrichtung nach Debug-Gegnern** (`d6a5b06`): Außerhalb einer Welle
  drehen die Tower zur Wachrichtung, sobald der letzte Gegner tot, entfernt
  oder durchgekommen ist.
- **Tote Effekt- und Bloom-Methoden entfernt** (`693571b`); Bloom im
  Display-Panel bleibt unberührt. `analyze_log.py` versteht jetzt `--help`
  (`e2ac3ae`). `DESIGN_SYSTEM.md` entspricht wieder `td-theme.ts` (`48e8e02`).

### Entschieden, noch nicht gebaut

- **Erste Spielerfähigkeit:** Nuklearschlag, Kills zählen für den Regler als
  Leck, eine Ladung, neue nach je drei Wellen, 60 % der Max-HP (Bosse 20 %),
  25 m, 1,5 s Vorwarnung mit Einschlag auf der nächsten Route-Zelle,
  Forschung (1.000 Gold, 40 s, nach `advanced-weaponry`, voraussichtlich nach
  dem ersten Boss), sofort eine Bot-Strategie, danach der Held.
  Festgehalten in `docs/game-design/PLAYER_AGENCY_CONCEPT.md`, Abschnitt 7.
  Gebaut wird in einer eigenen Runde.

### Playtest-Liste, Fortsetzung

41. Korridor an einer Wohnstraße mit Parkstreifen: die Seite mit Parkstreifen
    oder Vorgärten breiter als die an einer Fassade; in Gassen eine Zellreihe.
    **ok mit Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
    Grundsätzlich ja, schmale Gassen entstehen, wo die Häuser es vorgeben.
    Parkende Autos (etwas höher als die Straße) und Vorgärten zählen aber noch
    zu sehr als begehbare Zellen, obwohl der Höhenunterschied sie vermutlich
    trennen würde (Screenshots: Zellen auf einem geparkten Transporter in einer
    Gasse). Steht in TODO 1.7 (Routenkorridor).
42. Die schmale Abzweigung: ein paar Sekunden ohne Tower warten, im Log
    `[Corridor] clearance` erscheint `changed=true`, der Korridor wird
    breiter. Sonst `__corridor.pick()` und Klick darauf, Ausgabe schicken.
    **ok, über 9 belegt** (Playtest 2026-09-14): Die konkrete Abzweigung vom
    12. September war nicht mehr nachstellbar. Der Mechanismus dahinter, das
    Nachmessen nach dem Tile-Schub, greift laut Punkt 9 an drei Orten (erste
    Messung auf groben Tiles ohne Strahlen, zweite mit `changed=true` und 1
    bis 2 übrigen Stationen). Fällt wieder eine zu schmale Stelle auf:
    `__corridor.pick()` dort, als neuer Befund.
43. Die fehlende Mittelreihe: Route Grid Overlay an. Fehlt die Zelle dort,
    gibt es sie nicht; ist sie rosa, fehlt ihr die Höhenprobe; ist sie weiß,
    zeichnet nur die Tower-Anzeige sie nicht.
    **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`): keine
    fehlende Mittelreihe, nur weiße und orange Zellen gesehen.
44. Straßenkante mit Traufe: Randzellen am Boden (orange Kontur im Overlay).
    **Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, Rothenburg
    ob der Tauber): Es gibt viele orange Zellen, sie liegen aber in der
    Draufsicht oft im Haus oder unter dem Dach statt auf der Straße. Der
    Dach-Check setzt sie auf den Boden, statt sie wegzulassen; laut User
    sollten solche Zellen meist gar nicht nutzbar sein. Offen, wie weit sie
    Laufweg, Zielwahl und LOS beeinflussen. Steht in TODO 1.7 (Routenkorridor).
45. `__corridor.set({ maxHalfWidth: 5 })` ohne Tower, dann `__corridor.reset()`.
    **ok** (Playtest 2026-09-12)
46. Header: Labels, goldene Kante, Höhe unverändert.
    **ok** (Playtest 2026-09-12)
47. Next-Wave-Button: "START WAVE N"; in der Welle "WAVE N" und "x left" mit
    Balken; nach "Kill all" sofort 0; im Build-Mode grau.
    **ok** (Playtest 2026-09-12)
48. Dev-Menü: Kacheln lesbar, DevWorld nur mit `?devworld`, aktiver Toggle
    gold; bei niedrigem Fenster scrollt das Panel.
    **ok** (Playtest 2026-09-12)
49. Nur ein Menü offen; nach dem Laden das zuletzt offene.
    **ok** (Playtest 2026-09-12)
50. Debug-Fenster: Dev-Menü öffnen lädt die Fenster; ein offenes Fenster geht
    nach dem Laden wieder auf.
    **ok** (Playtest 2026-09-12)
51. VFX-Panel: "Low" in einer Welle mit Cannon und Rakete, keine Explosionen,
    Trails oder Mündungsblitze, liegende Bodenspuren verschwinden, Schaden
    unverändert; nach einem Einzelschalter steht "Custom"; nach dem Laden
    bleiben die Werte, ein alter FPS-Cap wird übernommen.
    **ok** (Playtest 2026-09-12)
52. Die Zeilen `[Corridor] rebuild: ...` notieren (welcher Teil dominiert,
    wie viele ms insgesamt). Sie erscheinen, wenn die clearance-Zeile
    `changed=true` zeigt; sonst ohne Tower `__corridor.reset()` aufrufen, das
    baut neu.
    **ok** (Playtest 2026-09-12, Innenstadt, 1 Route: Neuaufbau 39,5 bis
    41,7 ms, routes 14, lines 11, grid 10, heights 4 bis 6 ms, kein Teil
    dominiert. Die Messung davor, `clearance` mit 1260 Strahlen, dauerte
    520 bis 533 ms synchron)
53. Ort mit Tunnel oder Durchgang (`__routes.describe()`, Spalte `tags`):
    Overlay-Zellen dort gelb und auf der Straße im Tunnel, nicht auf dem Hang,
    sofern an beiden Mündungen Tiles liegen (sonst rosa);
    `__corridor.pick()` zeigt `surface tunnel`.
54. Raketen bei Frame Limit 30 und bei 4x: das Düsenglühen bleibt etwa 6 m
    lang wie bei 60 FPS; die anderen Streaks ebenfalls unverändert lang.
    **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
55. Explosion aus der Nähe: kein dunkler Punkt vor dem Rauch, der Rauch kommt
    weiter.
    **ok** (Playtest 2026-09-12)
56. Zwischen zwei Wellen Debug-Gegner töten oder entfernen: danach drehen die
    Tower zur Wachrichtung.
    **ok** (Playtest 2026-09-12)
