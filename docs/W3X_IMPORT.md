# Warcraft-3-Import (.w3x)

**Status:** Aktuell auf `exp/custom-maps` (Experiment, ab 2026-10-11). Teil von
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

Der Importer macht aus einer Warcraft-3-Karte (`.w3x`, `.w3m`) ein Kartendokument
(`CustomMapDocument`, `src/app/world/custom-map/map-document.ts`): Gelände mit Klippen und Wasser,
Bodenschichten, Wegenetz mit Spawns und HQ, Objekte und Stimmung. Er liegt in `src/app/world/w3x/`,
kommt ohne Angular und ohne DOM aus und läuft im Web Worker, in Node und in den Specs.

## Lizenz und Grenzen der Nutzung

Der Importer liest nur die **Struktur** einer Karte: Höhen, Kachelarten, Regionen, Wegpunkte,
Platzierungen und Namen. Er lädt keine Modelle, Texturen, Töne oder Skripte von Blizzard und das Spiel
liefert keine aus. Bodenarten und Doodads werden auf eigene CC0-Assets des Katalogs abgebildet
(`public/maps/assets/`). Die Karte selbst bringt der Spieler mit; Testkarten liegen nur lokal unter
`tmp/wc3/` (nicht im Repo).

## Aufruf

```ts
import { importW3x } from 'src/app/world/w3x/import-w3x';
import { importW3xInWorker } from 'src/app/world/w3x/w3x-import-client';

const { doc, report } = await importW3xInWorker(file, { fileName: file.name });
```

- `importW3x(bytes, options)` rechnet auf dem aufrufenden Thread, `importW3xSync` ebenso ohne Promise
- `importW3xInWorker(file, options)` startet `w3x.worker.ts` und bekommt Höhen, Splat-Karten und
  Wassermaske als Transferables zurück; ohne `Worker` (Node, Specs) importiert es direkt
- Fehler (keine Karte, geschützt, kein Gelände) kommen als `Error` mit lesbarer Meldung

### Optionen (`W3xImportOptions`)

| Option | Standard | Wirkung |
|--------|----------|---------|
| `fileName` | - | für `meta.source.file` und als Name, wenn die Karte keinen hat |
| `id` | aus dem Namen (`slugMapId`) | Karten-ID |
| `metresPerTile` | 4 | Meter je Warcraft-Kachel (128 Einheiten); gilt auch für Höhen |
| `cropToPlayable` | `true` | nur die spielbare Fläche (w3i-Ränder), sonst das ganze Gelände |
| `samplesPerTile` | 4 | Höhenwerte je Kachelkante (1 bis 8) |
| `cliffAngle` | 50 | ab diesem Hang (Grad) zeigt der Renderer das Klippenmaterial |
| `catalog` | geplante Katalog-IDs | `{ materials, objects }` mit `id` und `category`; fehlende IDs fallen auf die Kategorie zurück |
| `maxObjects` | 6000 | mehr Objekte werden gleichmäßig ausgedünnt (Hash, reproduzierbar) |
| `routeStrategy` | - | eine Wege-Strategie erzwingen (Vergleich, Tests) |

**Warum 4 m je Kachel:** Tower-Defense-Karten haben Spuren von zwei bis vier Kacheln Breite und Wege
von 10 000 bis 21 000 Einheiten. Mit 4 m werden daraus Straßen von 8 bis 16 m und Wege von 300 bis
650 m; das passt zur Breite echter Straßen im Spiel und zur Reichweite der Spawn-Portale auf echten
Karten (200 bis 1500 m). Eine Klippenstufe (128 Einheiten) wird 4 m hoch.

### Bericht (`report`)

- `strategy`: welche Wege-Strategie die Wege geliefert hat (`script-pattern`, `script-eval`,
  `terrain`) oder `null`
- `attempts`: jede versuchte Strategie mit Ergebnis
- `warnings`: was fehlt oder weggelassen wurde (Archiv-Auffälligkeiten, fehlende Dateien, Wasser auf
  anderen Höhen, mehr als 8 Spawns, ausgedünnte Objekte)
- `stats`: Fläche, Höhenwerte, Splat-Auflösung, Schichten mit Kachel-Zuordnung, Wasser, Spawns, Knoten,
  Kanten, Weglängen je Spawn in Metern, Spurbreiten, Objektzählung nach Grund, Kategorie und Asset

## Aufbau

| Datei | Inhalt |
|-------|--------|
| `binary-reader.ts` | Little-Endian-Leser, `W3xFormatError` |
| `mpq.ts`, `bzip2.ts`, `explode.ts` | MPQ-Archiv, bzip2, PKWARE DCL |
| `formats/` | `w3i`, `wts`, `w3e`, `doo` (Doodads und Einheiten), `w3r`, `wpm` |
| `map-files.ts` | öffnet die Karte, parst alles, sammelt Warnungen; `playableBounds` |
| `jass/` | JASS-Parser und abstrakter Interpreter |
| `routes/` | Weggraph, Skript-Strategien, Spurmaske, Gelände-Strategie, Strategiekette |
| `convert/` | Gelände, Bodenmaterialien, Doodad-Assets, Stimmung |
| `import-w3x.ts` | Konverter und Bericht |
| `w3x.worker.ts`, `w3x-import-client.ts` | Worker und Client |

## Formate

### MPQ

- Die Karte beginnt mit einem 512-Byte-Kopf `HM3W`; der MPQ-Kopf (`MPQ\x1A`, auch hinter einem
  `MPQ\x1B`-Benutzerkopf) wird in 512-Byte-Schritten gesucht
- Kopf v0 bis v3: klassische Hash- und Blocktabelle (verschlüsselt mit den Schlüsseln aus
  `(hash table)`/`(block table)`), ab v1 die oberen 16 Bit der Blockoffsets
- Dateien: verschlüsselt (Schlüssel aus dem Dateinamen ohne Pfad, mit `FIX_KEY` um Offset und Größe
  verschoben), Sektortabelle (mit Schlüssel - 1), Sektoren (Schlüssel + i), Single-Unit, unkomprimiert;
  ein Sektor so lang wie seine Ausgabe ist roh
- Kompression je Sektor über das Maskenbyte: zlib 0x02 (fflate), PKWARE implode 0x08 (nur
  Binärmodus), bzip2 0x10; in der Reihenfolge bzip2, implode, zlib entpackt. Huffman/ADPCM (nur
  Audio), Sparse und LZMA ergeben eine klare Fehlermeldung
- Geschützte Karten: Tabellengrößen jenseits des Dateiendes werden gekürzt (Hinweis im Bericht), ohne
  Listfile findet der Leser die Kartendateien über ihre bekannten Namen (`KNOWN_MAP_FILES`)

### Kartendateien

| Datei | Versionen | Gelesen |
|-------|-----------|---------|
| `war3map.w3i` | 18, 25, 28, 31 | Name, Autor, Beschreibung (TRIGSTR über `war3map.wts`), Ränder der spielbaren Fläche, Tileset, Nebel, Wasserfarbe, Skriptsprache, Spielversion (Reforged-Erkennung) |
| `war3map.w3e` | 11 | Ecken: Höhe, Wasser, Kartenrand, Textur, Flags (Rampe, Wasser, Rand), Klippenebene |
| `war3map.doo` | 7, 8 (Subversion 9/11) | Doodads und Zerstörbares: ID, Position, Winkel, Skala, Flags; Spezial-Doodads gezählt |
| `war3mapUnits.doo` | 7, 8 | vorplatzierte Einheiten (nur gezählt) |
| `war3map.w3r` | 5 | Regionen mit Skriptname `gg_rct_<Name>` |
| `war3map.wpm` | 0 | Wegekarte, 4 Zellen je Kachel |
| `war3map.j`, `scripts\war3map.j` | - | JASS (Strategien a und b) |
| `war3map.lua` | - | Lua, nur Strategie a |

Reforged-Dateien (1.32+) tragen nach der Skala eine Skin-ID. Der Hinweis kommt aus der w3i
(Spielversion ab 1.32); passt das Layout nicht genau bis zum Dateiende, liest der Parser das andere.

Höhen: `ground = (h - 0x2000) / 4 + (layer - 2) * 128`, Wasser: `(w - 0x2000) / 4 - 89.6`
(Weltkoordinaten, Ecke (i, j) bei `offset + 128 * (i, j)`, Zeile 0 im Süden).

## Wege

Drei Strategien in fester Reihenfolge; die erste mit einem Weg von einem Spawn zum Ende gewinnt.

**(a) Muster im Skript** (`script-pattern`, JASS und Lua): der Code, den der World Editor für
GUI-Auslöser schreibt. `TriggerRegisterEnterRectSimple(trg, gg_rct_A)` plus `TriggerAddAction(trg, F)`,
wobei F die betretende Einheit (`GetTriggerUnit`/`GetEnteringUnit`) mit "move", "attack", "smart" oder
"patrol" zu `GetRectCenter(gg_rct_B)` (oder dessen X/Y) schickt, ergibt die Kante A nach B.

**(b) Auswertung des Skripts** (`script-eval`, nur JASS): `jass-parser.ts` liest Globals und
Funktionen, `jass-evaluator.ts` führt die Initialisierung aus: `main`, Funktionen über `ExecuteFunc`,
Auslöser über `TriggerExecute`/`ConditionalTriggerExecute`, einmalige Zeitauslöser und `TimerStart`
nach Zeit geordnet. So bekommen Rects und Orte in Variablen und Arrays ihre Werte, auch aus Schleifen.
Danach laufen die Aktionen jedes Auslösers einmal mit abstrakten Ereignisdaten; jeder Punktbefehl wird
mit Herkunft gesammelt: betretende Einheit (Kante von den Rects des Auslösers) oder zuletzt erzeugte
Einheit/Gruppe (Kante vom Erzeugungsort). Unbekannte Bedingungen führen alle Zweige aus, unbekannte
Schleifenenden brechen ab, Schreibzugriffe der Aktionen bleiben in einer Überlagerung. Ein Schrittbudget
(3 Mio. Anweisungen, 20 000 Durchläufe je Schleife) begrenzt feindliche Skripte.

**(c) Gelände** (`terrain`): die Spurmaske (`lane-mask.ts`) nimmt begehbare, nicht bebaubare
Wegezellen (halbe Kacheln), sonst begehbaren Boden unter der häufigsten Klippenebene, sonst Straßen-
Kacheln. Zhang-Suen verdünnt sie zum Skelett. Das Ende (Region mit Ende-Namen, oder die Region, deren
Auslöser Leben kostet) und die Spawns (Regionen mit Spawn-Namen ohne Richtungswort, sonst die fernen
Skelett-Enden) werden darauf gesetzt; ein Dijkstra-Baum zum Ende liefert die Wege, die sich an
Einmündungen Pixel und damit Knoten teilen. Douglas-Peucker behält die Ecken.

**Weggraph** (`route-graph.ts`): Ende ist der Knoten, den die meisten Starts erreichen (Leck-Auslöser,
Ende-Namen und Sackgassen entscheiden Gleichstände), Spawns sind die Starts, die ihn erreichen; es
bleiben nur Kanten auf solchen Wegen. Gemeinsame Wegpunkte sind ein Knoten. Wörter für Enden: throne,
end, finish, castle, leak, goal, base, king, queen, exit, core, home; für Spawns: spawn, start, creep,
enemy, enter, portal, gate, wave.

## Konvertierung

**Gelände:** Höhenraster über die importierte Fläche mit `samplesPerTile` Werten je Kachel. Die
Bodenhöhe ist bilinear, die Klippenebene springt in der Kachelmitte auf die der nächsten Ecke: Klippen
werden fast senkrechte Stufen von einem Abstand Breite. Kacheln mit Rampen-Ecke mischen die Ebene
bilinear zur Rampe. Wasser: Ecken mit Wasser-Flag, deren Spiegel über dem Boden liegt; das Dokument hat
einen Wasserspiegel, behalten wird der häufigste, andere Höhen fallen mit Warnung weg. Wasserfarbe nach
Tileset, mit der w3i-Tönung multipliziert.

**Bodenschichten** (`convert/ground-materials.ts`, nach den letzten drei Buchstaben der Kachel-ID):

| Kachelart | Material |
|-----------|----------|
| drt, drh, dro, drr | dirt |
| drd, mud, dmd | mud |
| dtr, rdt, rok, rck, lav, ash | rocky-ground |
| drg, grd | grass-dry |
| gsb, hdg, lgr | grass-lush |
| grs, grt | grass |
| flr, blm, wmb, sqd, rtl, stp | paving |
| btl, cbp, cbl, brk, rd* | cobblestone |
| gvl, grv | gravel |
| snw, ice | snow |
| dsr, dsd, snd | sand |
| vin, lvd, crp, lea | forest-floor |
| sonst | lose Treffer (gr, sn, sd, r..), dann dirt |

Schichten nach Fläche sortiert, die häufigste ist Schicht 0; mehr als 8 werden zusammengelegt. Die
Splat-Karten (ein Texel je Höhenwert, Zweierpotenz bis 1024) mischen die Texturen der vier Kachelecken
mit Smoothstep-Gewichten. Steile Flächen zeigen `cliff`.

**Wege:** Knoten und Kanten des Weggraphs, Richtung vom Spawn zum Ende (`a` nach `b`), Art `road`.
Breite: Median der Querläufe durch die Spurmaske an sieben Stellen der Kante (1 bis 6 Kacheln, ohne
Maske 2,5). Spawns heißen wie ihre Region; das HQ steht in der Mitte der Ende-Region. Das Spiel zeigt
Portale für bis zu 32 Spawns (`MAX_SPAWN_PORTALS`); das Dokument enthält alle, der Bericht warnt.

**Objekte** (`convert/doodad-assets.ts`, zweiter Buchstabe der ID):

| Buchstabe | Kategorie | Assets |
|-----------|-----------|--------|
| T | tree | tree-oak, tree-birch, tree-pine, tree-fir (Nadelbäume auf Schnee-Tilesets, kahle auf Barrens) |
| R | rock | rock-small, rock-large |
| P, W | plant | bush |
| S | building | house, house-large, tower-ruin, well |
| O, Z, sonst | prop | barrel, crate |
| D, B | wall | wall-stone, fence-wood |

Die Wahl in der Liste kommt aus einem Hash des Doodad-Index (jeder Import gleich). Skala = Mittel der
drei Skalen (0,3 bis 3), Drehung = Warcraft-Winkel (Bogenmaß gegen den Uhrzeigersinn ab Osten, wie im
Kartenraum), Höhe 0 (auf dem Boden). Weggelassen: Doodads außerhalb der Fläche, unsichtbare (Flags 0)
und Hilfsobjekte (Wege-, Luft- und Sichtblocker `YT?b/YT?c`, `Ytlb`, Plattformen), Bäume, Felsen,
Gebäude und Mauern auf einer Straße. Baumwände bleiben als Kulisse.

**Stimmung** (`convert/environment.ts`): Himmel, Sonnenhöhe, Nebel und Tönung je Tileset (Dalaran:
Tag, leichter Nebel); hat die Karte eigenen Nebel (w3i-Stil linear oder exponentiell), ergibt sich die
Dichte aus seinem Ende: `1,5 / Ende in Metern`. `fogDensity` ist exponentiell je Meter.

`meta.source = { kind: 'w3x', file, mapName, tileset }` mit dem Tileset-Namen.

## Prüfen

- `npm run w3x-import` importiert die Testkarte (oder `W3X_FILE=...`) und schreibt nach
  `tmp/w3x-out/`: Draufsicht als PNG, Bericht als JSON, `.3dtdmap` für den Editor
- Specs: MPQ mit synthetischen Archiven (Schreiber in `src/test/w3x-fixtures.ts`), jeder Parser mit
  synthetischen Bytes, JASS-Auswertung an Schnipseln, Gelände-Strategie an einem Spurraster, voller
  Import einer synthetischen Karte (`src/test/w3x-synthetic-map.ts`) und der Testkarte, wenn sie da ist

Testkarte "Mafa TD Queen v14.6": Strategie (b) findet die 10 Spuren in 29 Kanten (10 600 bis 20 900
Einheiten, 332 bis 652 m), (c) allein dieselben 10 Spuren bis auf 3 % Länge; Spuren 16 m breit,
1499 von 1506 Doodads platziert, Import in 0,1 bis 0,25 s.

## Grenzen

- Ein Wasserspiegel je Karte; Becken auf anderen Höhen fallen weg
- Lua-Skripte nur über Muster (a); die Auswertung (b) kann nur JASS
- Wege aus Skripten, die Befehle erst zur Laufzeit berechnen (Zufall, Spielerzahl, Einheitenzähler),
  findet (b) nur, soweit die Werte aus der Initialisierung folgen; sonst greift (c)
- Kanten sind gerade Linien zwischen Regionsmitten bzw. Skelett-Ecken; Kurven kommen nicht mit
- Kein Import von Wellen, Einheitenwerten oder Fähigkeiten; Spezial-Doodads (Klippen- und Rampenmodelle)
  werden nur gezählt
- Kompressionen für Audio (Huffman, ADPCM), Sparse und LZMA (spätere MPQ-Versionen) fehlen; Karten,
  deren Gelände so gepackt ist, lassen sich nicht importieren
