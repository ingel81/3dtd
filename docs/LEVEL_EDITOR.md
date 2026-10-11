# Karteneditor

**Status:** Aktuell auf `exp/custom-maps` (Experiment, ab 2026-10-11). Plan und Kartendokument:
[WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

Unter `/editor` baut man eigene Karten: Gelände, Bodentexturen, Wasser, Objekte, Straßen, Spawns und HQ. Eine Karte
liegt im Browser (IndexedDB), lässt sich als `.3dtdmap` herunterladen und wieder einlesen und mit „Test map“ im Spiel
öffnen (`?world=map:<id>`). Der Einstieg im Hauptmenü ist „Map editor“ (Lage Start, unter der Linie; mit laufendem Lauf
fragt das Menü vorher). Die Oberfläche ist englisch wie das übrige Spiel.

## Kartenliste

Die Startseite von `/editor` zeigt links die eigenen und die mitgelieferten Karten (Bild, Größe, Spawns, Objekte,
zuletzt geändert), rechts die gewählte mit Beschreibung und den Knöpfen Open, Duplicate, Download, Delete (zweimal
bestätigen). Mitgelieferte Karten (`public/maps/index.json`) sind schreibgeschützt: „Copy and edit“ legt eine eigene
Kopie an und öffnet sie.

- **New map:** Name, Autor, Größe (Small 512 m, Medium 1024 m, Large 2048 m, Wide 2048 x 1024 m), Boden flach oder
  hügelig, Grundmaterial. Jede neue Karte hat eine Straße von West zum HQ und einen Spawn an ihrem Ende, damit sie sofort
  spielbar ist
- **Import file:** `.3dtdmap` oder `.w3x` per Dateiwahl oder per Ablegen auf der Seite. Ein Warcraft-3-Import fragt
  erst nach Metern je Kachel (4), höchstens Objekten (6000) und „Playable area only“, läuft dann im Web Worker
  ([W3X_IMPORT.md](W3X_IMPORT.md)) und zeigt den Bericht: Größe, Bodenschichten, Wasser, woher die
  Straßen kamen, Spawns und Spurlängen, übernommene Doodads, Warnungen; „Open the map“ öffnet sie. Die Karte landet bei den eigenen
- Die Adresse trägt die offene Karte (`/editor?map=<id>`); Neuladen öffnet sie wieder

## Bedienung

| Eingabe | Wirkung |
|---------|---------|
| Linke Maustaste | Werkzeug (halten bei Pinseln) |
| Rechte Maustaste ziehen | Ansicht drehen |
| Mittlere Maustaste ziehen, Shift + rechte | Ansicht verschieben |
| Mausrad | Zoom zum Punkt unter dem Zeiger |
| Pfeiltasten | Ansicht verschieben |
| F | Auswahl ins Bild holen, ohne Auswahl die ganze Karte |
| T | Draufsicht an und aus |
| 1 bis 9 | Werkzeug: Landscape, Terrain, Paint, Water, Objects, Paths, Spawns and HQ, Environment, Map |
| [ und ] | Pinsel kleiner, größer; { und } Stärke |
| Strg+Z, Strg+Y (Strg+Shift+Z) | Rückgängig, Wiederholen |
| Strg+S | Speichern mit neuem Vorschaubild |
| V | Prüfen (außer im Objektwerkzeug) |
| Esc | Halbfertiges abbrechen, Auswahl aufheben |

Jeder Pinsel hat Größe (1 bis 200 m), Stärke und Weichheit (Anteil des Radius, der ausblendet). Der Ring auf dem Boden
zeigt Größe und den harten Kern.

## Werkzeuge

**Landscape (1).** Landschaft malen: Höhe, Bodenfarbe, Wasser und Objekte entstehen gemeinsam, jeder Strich ist
ein Schritt im Verlauf. Jeder Strich hat einen Seed (im Panel und in der Statuszeile, „Roll“ würfelt, der Schalter
würfelt nach jedem Strich neu); derselbe Seed und derselbe Strich ergeben dieselbe Landschaft.
- Biome: Meadow, Forest, Pine forest, Rocks, Swamp, Desert, Snow, Village. Halten malt; die Stärke bestimmt Dichte und
  Ausprägung, der Rand franst aus. Unterholz, Büsche und Zäune wachsen am Rand des Strichs, Bäume und Häuser innen.
  Objekte meiden Straßen, Wasser, Spawns und HQ; der Boden unter Straßen bleibt. Der Sumpf legt flache Wasserlachen an
  (ohne Wasser auf der Karte entsteht es knapp unter dem Startpunkt). Unter dem Zeiger zeigen Punkte, wo der nächste
  Strich Pflanzen setzen würde
- Mountain (gratige Gipfel, Höhe nach Größe und Stärke), Valley, Plateau (Tafel mit steilem Rand), Erode (Regen gräbt
  Rinnen und Schuttfächer). Halten lässt die Form bis zu ihrer vollen Größe wachsen, nicht darüber hinaus
- Linien (ziehen, auch vom Kartenrand her): Cliff edge hebt den Boden links der Zeichenrichtung als Klippe, die
  Pinselgröße ist die Breite oben; River gräbt ein Flussbett mit Wasser, Sand- und Schlammufern, Schilf und einer
  Brücke an jeder Straße, die er kreuzt; Road legt eine Straße ins Wegenetz (Anfang und Ende rasten an Knoten oder
  Straßen), passt den Boden als Damm oder Einschnitt an, pflastert sie und stellt Laternen oder Zäune an den Rand

**Terrain (2).** Raise und Lower (Shift kehrt um), Smooth, Flatten (auf die Höhe am Strichanfang), Level (auf eine
eingestellte Höhe; Strg+Klick nimmt sie vom Boden), Roughen (Rauschen), Erode (steile Hänge rutschen zu Geröll),
Terrace (Stufen in einstellbarer Höhe), Cliff (Plateau eine Stufe über dem Strichanfang, Shift eine darunter, harte
Kante wie Warcraft-Klippen), Ramp (zwei Klicks: Rampe zwischen den beiden Höhen, Breite einstellbar).

**Paint (3).** Bis zu acht Bodenschichten aus dem Katalog; die Liste wählt die Schicht zum Malen, tauscht ihr Material,
verschiebt und entfernt sie (ihr Gewicht geht an die anderen). Halten malt, Shift oder der Schalter radiert. „Auto paint
the map“ malt die ganze Karte neu: die erste Schicht überall, felsartige Schichten an steilen Hängen, sandartige am
Ufer, schneeartige auf den Gipfeln (nach dem Materialnamen). Darunter das Klippenmaterial und ab welcher Neigung es
greift.

**Water (4).** Fill basin: ein Klick in eine Mulde flutet sie. Ohne Wasser (oder mit Strg) wird der Spiegel knapp unter
den Rand der Mulde gesetzt, also die Höhe, an der sie überlaufen würde. Paint und Erase malen die Wassermaske von Hand.
Spiegel und Farbe im Panel; Wasser lässt sich dort auch ganz abschalten.

**Objects (5).** Palette aus dem Katalog mit Bildern, Kategorien und Suche.
- Place: ein Klick setzt das gewählte Objekt (Raster-Fang 1 bis 8 m, zufällige Drehung)
- Scatter: halten streut die gewählten Assets (mehrere wählbar) mit Dichte, Größenbereich, Mindestabstand, zufälliger
  Drehung und Einsinken am Hang; Shift dünnt aus
- Erase: entfernt, was der Pinsel trifft
- Select: Klick wählt, Shift+Klick ergänzt, Ziehen auf freiem Grund wählt per Rahmen, Strg+A alles. Ziehen auf der
  Auswahl verschiebt, dreht oder skaliert sie (W, E, R; Strg rastet die Drehung in 15 Grad). Entf löscht, Strg+D
  dupliziert. Im Panel stehen Lage, Drehung, Größe und die Schalter „Blocks sight“ und „Blocks building“ (Default folgt
  dem Katalog)

**Paths (6).** Draw: jeder Klick setzt einen Knoten und verbindet ihn mit dem letzten; ein Klick nahe einem Knoten
schließt dort an, nahe einer Straße entsteht eine Kreuzung (Alt setzt frei). Enter, Rechtsklick oder Doppelklick
beendet die Linie. Edit: Knoten ziehen (auf einem anderen abgelegt verschmelzen sie), Straße wählen; Breite und Art
(Road, Path, Bridge), S glättet als Kurve, X begradigt, J löst einen Knoten zwischen zwei Straßen auf, Entf löscht.
„Flatten road“ ebnet den Boden quer und glättet ihn längs, „Paint road“ malt eine Schicht darunter (gewählte Straße oder
alle). Die Routen von jedem Spawn zum HQ laufen als Punkte über die Karte (abschaltbar).

**Spawns and HQ (7).** Q: Klick setzt einen Spawn (Name nach Himmelsrichtung, im Panel änderbar), H: Klick versetzt das
HQ. Ziehen verschiebt beide; sie rasten auf die nächste Straße (Alt frei). Das Panel zeigt je Spawn die Länge seiner
Spur oder „no route“.

**Environment (8).** Himmel (Day, Dusk, Night, Overcast), Sonnenrichtung und -höhe, Nebel, Tönung; Regler wirken
sofort und werden beim Loslassen ein Schritt im Verlauf.

**Map (9).** Name, Autor, Beschreibung; Größe ändern (die Mitte bleibt, kleiner schneidet die Ränder ab, größer setzt
sie in Randhöhe fort).

## Prüfen

„Check“ (V) listet Fehler vor Warnungen; ein Klick wählt das Betroffene, wechselt ins passende Werkzeug und zeigt es.
Solange die Liste offen ist, prüft der Editor nach jeder Änderung neu.

| Code | Art | Bedeutung |
|------|-----|-----------|
| `no-paths`, `no-spawns` | Fehler | Karte ohne Straßen oder ohne Spawn |
| `spawn-off-path`, `hq-off-path` | Fehler | Spawn oder HQ weiter als 16 m von einer Straße |
| `spawn-unreachable` | Fehler | Keine Straße führt vom Spawn zum HQ |
| `spawn-outside`, `hq-outside` | Fehler | Außerhalb der Karte |
| `paths-split` | Warnung | Straßennetz in mehreren Teilen |
| `lane-short`, `lane-long` | Warnung | Spur unter 200 m oder über 4000 m |
| `spawn-near-hq` | Warnung | Spawn unter 60 m vom HQ |
| `path-under-water` | Warnung | Straße (keine Brücke) unter Wasser |
| `path-steep` | Warnung | Straße steiler als 30 Grad |
| `object-on-path` | Warnung | Blockierendes Objekt auf einer Straße |

## Speichern und Dateien

- Autosave schreibt zwei Sekunden nach der letzten Änderung in IndexedDB; die Kopfzeile zeigt „Unsaved changes“,
  „Saving“ oder „Saved“. Strg+S speichert sofort mit neuem Vorschaubild; beim Verlassen der Karte wird das Bild
  ebenfalls erneuert
- Datei-Menü (drei Punkte): Download map file (`.3dtdmap`), Export top view as picture (PNG, 2048 px an der längeren
  Seite), Frame the whole map, Top view
- „Test map“ speichert und öffnet das Spiel mit `?world=map:<id>` in einem neuen Tab

## Architektur

```
src/app/world/custom-map/
  map-document.ts   Kartendokument (gemeinsamer Vertrag)
  map-create.ts     neue Karte, Id aus Name, Rauschen
  map-file.ts       .3dtdmap packen und lesen, contentHash, Prüfung, Migrationen
  map-store.ts      eigene Karten in IndexedDB, mitgelieferte aus maps/index.json
src/app/editor/
  model/            EditorDocument (Befehle, Verlauf, Auswahl), Raster-Helfer, Kachel-Patches
  ops/              Operationen ohne Angular: Pinsel, Gelände, Farbe, Wasser, Objekte, Wegenetz, Straßen-Boden, Größe
  ops/landscape/    Landschafts-Pinsel: Biome, Formen, Erosion, Fluss, Straße, LandscapeStroke (ein Undo-Schritt)
  tools/            Werkzeuge: Zeigereingaben zu Befehlen
  validation/       Prüfen
  view/             EditorViewport (Renderer, Kamera, Eingabe), Overlay, Kamera, EditorMapView
  catalog/          Paletten aus dem Katalog des Renderers (maps/assets/catalog.json), Farben, Formen, Kategorien
  import/           Warcraft-3-Import: lädt importW3xInWorker beim ersten Gebrauch, fasst den Bericht zusammen
  ui/               Angular: Seite, Kartenliste, Shell, Panels
```

**Dokument und Verlauf.** `EditorDocument` hält das `CustomMapDocument` und einen Verlauf aus Befehlen (`apply`,
`revert`, `bytes`). Jeder Befehl meldet, was er änderte (`DocChange`: Höhen- und Splat-Rechtecke, Objekt-Ids, Teile).
Pinselstriche schreiben während des Ziehens direkt in die Arrays; `RegionRecorder` sichert jede 32 x 32-Kachel beim
ersten Berühren, am Ende wird der Strich ein `PatchCommand` mit Vorher und Nachher nur der berührten Kacheln. Kleine Teile
(Straßen, Spawns, HQ, Umgebung, Metadaten) laufen über `SnapshotCommand`, Objekte über `ObjectsCommand` (Einfügen,
Ändern, Entfernen mit Position in der Liste). Der Verlauf hält höchstens 300 Schritte und 192 MB. „Dirty“ vergleicht
Zustands-Ids, also ist eine Karte nach Rückgängig bis zum gespeicherten Stand wieder sauber.

**Ansicht.** `EditorViewport` hat eigenen Renderer, Szene und Kamera, unabhängig von der Engine des Spiels. Es castet
den Boden einmal je Bild, sammelt die Änderungsmeldungen eines Bilds und reicht sie gebündelt an die Kartenansicht
(nur berührte Chunks), und hält das Overlay nach (Pinselring, Marker, Knoten, Auswahl, Gizmo-Ring, Routen). Die
Karte zeichnet derselbe Renderer wie im Spiel (`CustomMapView`, [CUSTOM_MAPS.md](CUSTOM_MAPS.md)); `EditorMapView`
übersetzt Raster- und Texel-Rechtecke in Meter, sammelt geänderte Objekte (neue oder entfernte bauen die Batches einmal
neu) und wählt Objekte per Strahl auf ihr Modell. Eine neue Schichtliste oder ein neues Gelände baut die Ansicht neu.
Szene-Rahmen wie im Spiel: Szene x = minus Karte Ost,
Szene z = Karte Nord, y oben.

**Landschafts-Pinsel.** Ein `LandscapeStroke` nimmt Höhen, Splat, Wassermaske (Kachel-Patches), neue Schichten,
neues Wasser, neue Objekte und geänderte Straßen eines Strichs auf und legt sie als einen `CompoundCommand` in den
Verlauf. Höhen ziehen zu einem Ziel aus dem Boden vor dem Strich (`RegionRecorder.original`), daher türmt sich
nichts auf. Objekte stehen auf einem verwackelten Raster je Objektart und Seed (eine Stelle und ein Würfel je Zelle,
einmal entschieden); Kern-Objekte wachsen, sobald der Pinsel stark genug war, Rand-Objekte werden am Strichende nach
dem stärksten erreichten Gewicht entschieden. Rauschen aus `devworld/utils/seeded-random.ts`. Ein Fluss liegt auf dem
einen Wasserspiegel der Karte (das Kartendokument kennt kein Gefälle) und schneidet sich durch höheres Gelände.

**Angular.** `EditorSession` (je Seite) hält Karte, Werkzeuge, Einstellungen und Signale für die Panels; Viewport und
Taktgeber laufen außerhalb der Zone, Änderungen am Dokument erreichen die Panels höchstens alle 150 ms.

**Datei.** `.3dtdmap` ist ein Zip (fflate) mit `map.json` und den Arrays als Little-Endian-Binärdateien
(`terrain/heights.f32`, `terrain/splat0.u8`, `terrain/splat1.u8`, `terrain/water-mask.u8`), optional `preview.png`.
`contentHash` ist SHA-256 über das kanonische JSON der Welt (Schlüssel sortiert, ohne Name, Beschreibung und Zeiten)
und die Arrays; Umbenennen und erneutes Speichern ändern ihn nicht. Beim Lesen laufen erst die Migrationen
(`MAP_MIGRATIONS`, je Version ein Schritt), dann die Prüfung; Fehler kommen als `MapFileError` mit Klartext.

**Tests.** Vitest: `map-file.spec.ts`, `map-store.spec.ts`, `editor-document.spec.ts`, `ops.spec.ts`,
`path-graph.spec.ts`, `map-validation.spec.ts`, `tools.spec.ts`, `ops/landscape/landscape.spec.ts` (Gleichheit bei
gleichem Seed, Rand, Dichte, Freihalten von Straßen und Markern, ein Undo-Schritt, Formen, Erosion, Fluss mit Brücke,
Straße). Browser: `e2e/tests/editor.e2e.ts` (neue Karte, Gelände, Objekt mit
Rückgängig, Straße, Spawn, Prüfen, Speichern, Neuladen, Löschen; ohne Kartensitzung).

## Grenzen

- Objekte haben nur eine Drehung um die Hochachse; „Align to slope“ fehlt im Kartendokument, der Streupinsel lässt
  Objekte am Hang stattdessen einsinken
- Die Bilder der Objekte in der Palette sind Umrisse nach Kategorie, keine Renderings der Modelle; die Namen kommen
  aus dem Katalog (deutsch)
