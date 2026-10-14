# Eigene Karten: nächste Runde (Plan)

**Status:** gebaut 2026-10-14 (Branch `night/custom-maps-round2`), wartet auf Test (PLAYTEST B1 bis B4); Abweichungen unter „Ergebnis“
**Bezug:** [CUSTOM_MAPS.md](CUSTOM_MAPS.md) (Renderer), [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md) (Spiel),
[LEVEL_EDITOR.md](LEVEL_EDITOR.md) (Editor), [BENCHMARKS.md](BENCHMARKS.md); Freigabe der Karten ist TODO E134

Ziel: Editor und eigene Karten rund machen, bevor sie freigegeben werden. Der Editor soll richtig gut werden, die Welt
lebendig und mit Charakter aussehen, und eigene Karten sollen so flüssig laufen wie die Tiles-Welten.

## Vorgaben (User, 2026-10-13)

- **Performance ist das A und O.** Eigene Karten müssen im Prinzip so gut laufen wie Tiles-Karten. Jede Optik-Änderung
  nennt ihre Kosten; Teures nur in einer hohen Qualitätsstufe.
- **Tiles-Welten bleiben unverändert.** Tone-Mapping und neue Bildeffekte gelten nur für eigene Karten.
- **Einstellungen sauber trennen:** bei jeder neuen Grafik-Einstellung klar, ob sie allgemein gilt, nur für eigene
  Karten oder nur für Tiles-Welten.
- **Neue Karten immer in hoher Detailstufe**, gleich wie die mitgelieferten Level (keine Auswahl Normal/High).
- **Koop-Kartenversand:** die 4-MB-Grenze der Kartendatei muss deutlich höher.

## Ausgangslage (gemessen 2026-10-13)

RTX 5080, optimierter Build, 1300 × 852, Spielansicht. Tiles Stuttgart 0,88 ms je Bild bei 192 Draw Calls; Demo-Tal
1,39 ms bei 290; Hafenstadt 4,41 ms bei 1111. Bei doppelter Pixeldichte bleibt Tiles gleich (0,83 ms), das Demo-Tal
verdoppelt sich (2,64 ms). Laden: eigene Karten 3,7 bis 4,2 s, Tiles 18 bis 23 s. Ursachen: Kosten je Pixel
(Gelände-Shader, Schatten, Wasser), Draw Calls je Modellteil und 192-m-Zelle, unkomprimierte Texturen, keine
Qualitätsstufen. Die 38 s Ladezeit der Hafenstadt ließen sich nicht nachstellen (5,0 s kalt, 3,0 s warm).

## Phasen

Kennungen: ED Editor, PF Performance, OP Optik, QX übergreifend. Alles hier ist **A** (vor der Freigabe), außer wo
anders vermerkt.

### Phase 0: sofort, kostet nichts

| Kennung | Was |
|---|---|
| QX1 | Wind: Formel korrigieren (`object-layer.ts:691`, heute etwa 18-fach zu stark), Stamm starr, Äste und Blätter stärker, Böen als Front; Wind je Karte (`environment.wind`: Stärke, Richtung, Böen), Abschnitt „Wind“ im Editor; Gras, Wolken, Rauch, Regen und Schnee folgen derselben Richtung |
| OP-L1 | Lava-Bodenschicht: Glut auf Orange-Gelb begrenzen, nur in Rissen |
| OP-L5 | Ember Crater bekommt das Höllen-Biom |
| OP-L6 | Lava-Felsmodell neu backen (Emission je Dreieck) |
| OP-W4 | Sumpfalgen an Ufer binden, weniger deckend, nachts dunkler |
| OP-H1 | Horizont-Naht: Himmel unten in die Nebelfarbe blenden |
| OP-H3 | Schatten aufhellen (kühle Füllung), Sonne in Spielkarten ab etwa 20° |
| OP-H4 | Lesbarkeit: keine Deko in Gefahrenfarben (Regel und Editor-Prüfung), Asche grau und klein, Randlicht für Gegner |
| ED-K2, ED-K3 | Check: mehr als 32 Spawns, HQ oder Spawn im Wasser oder am Steilhang, Kanten außerhalb der Karte |
| ED-S13 | Strg+A wählt nur sichtbare Objekte |
| ED-K10 | Test-Tab mit festem Namen, Zurück-Taste im Editor |
| ED-K14 | Doku-Altlasten (Status-Zeilen, „acht Level“, Datenbankname, Align to slope, W3X-Wellenimport, Speicher-Abschnitt) |

### Phase 1: Editor sicher machen

| Kennung | Was |
|---|---|
| ED-M1 | „Test map“ und Bot-Check in der Desktop-App: App-eigene Fenster zulassen (gehärtet) oder im selben Fenster; Desktop-E2E-Test |
| ED-M2 | „Edit“ auf mitgelieferten oder Koop-Karten legt sofort eine eigene Kopie an |
| ED-M3 | `navigator.storage.persist()` beim ersten Speichern, Stand im Map-Panel, sonst Erinnerung zum Download |
| ED-M4 | Neue Karten immer 2 m je Höhenzelle und Splat bis 1024 wie die Level; bestehende Karten per „Increase detail“ hochziehen |
| ED-S5 | Undo, Redo, Speichern, Einfügen und Restore gesperrt, solange Strich, Drag oder Gelände-Job laufen |
| ED-S10 | Versionen ausdünnen statt abschneiden, anheften, Papierkorb für Karten |
| ED-S11 | Web Lock je Karte; zweiter Tab öffnet schreibgeschützt mit „Take over editing“ |
| ED-K11 | WebGL-Kontextverlust: Hinweis „View lost, your map is safe“, Ansicht neu aufbauen |
| ED-K12 | Erneuter Import ersetzt statt kopiert (stabile Kennung im Meta) |
| ED-K1 | Koop-Kartenversand bis 32 MB (Teile mit Bestätigung, Fortschritt); Budget-Anzeige für Objekte und Dateigröße |
| ED-S12 | Fuzz-Test: zufällige Operationen, alle Undos bytegleich zum Anfang, alle Redos zum Ende |

### Phase 2: messen, dann schneller

| Kennung | Was |
|---|---|
| PF-M4 | Benchmark für eigene Karten neben Tiles: feste Kamerapfade, GPU-Zeit per Timer-Query, je Qualitätsstufe; zuerst, damit jede weitere Änderung gemessen wird |
| PF-M2 | Draw Calls: Zellen nur bei vielen Instanzen, Modellteile zusammenführen (Atlas, 1 bis 2 Teile je Modell); später BatchedMesh |
| PF-M3 | Texturen als KTX2, offline gepackt, Laden im Worker, Pixel nach dem Upload verwerfen |
| QX3 | Qualitätsstufen Low / Medium / High / Ultra / Auto mit dynamischer Auflösung (Stufentabelle unten), getrennt nach allgemein, eigene Karten, Tiles |
| QX5 | Gelände in der Ferne: eine Lage ab etwa 150 m in großem Maßstab, ab etwa 400 m gebackene Albedo und Normale |
| PF-S2 | Weniger Shader-Varianten (kalt 1,3 bis 1,8 s Übersetzen) |
| PF-S3 | Himmel im Wasser aus einer Textur statt je Pixel |
| PF-S4 | Editor: Objekte inkrementell statt zellweise neu |
| PF-S5 | Editor: Wasser je Rechteck aktualisieren |
| PF-S6 | Reversed-Z statt logarithmischem Tiefenpuffer, nur eigene Karten (erst prüfen, Gewinn unbelegt) |
| PF-K1 | Gras: Daten je Halm statt je Vertex, Dichte als Stufe |
| PF-K3 | LOD-Modelle parallel laden, Transforms offline backen |
| PF-K4 | Ladezeit je Datei und Quelle als Messmarke |
| PF-K5 | Raycast im Editor ohne Neuanlage |

**Qualitätsstufen (Vorschlag, Werte aus der Messung geschätzt):**

| Stellschraube | Gilt für | Low | Medium | High (heute) | Ultra |
|---|---|---|---|---|---|
| Renderauflösung, dynamisch | allgemein | 0,6 (0,5–0,8) | 0,8 (0,6–1,0) | min(dpr, 1,5) | min(dpr, 2) |
| Kantenglättung | allgemein | FXAA | FXAA | MSAA 4× | MSAA 4× |
| Partikel, Punktlichter, Bloom | allgemein | 0,4×, 2, aus | 0,7×, 4, an | 1×, 6, an | 1×, 6, an |
| Detailschwelle `errorTarget` | Tiles | ~32 | ~24 | 20 | ~12 |
| Schattenkarte | eigene Karten | 1024 | 2048 | 4096 | 4096 weicher |
| LOD-Bias, Sichtweite | eigene Karten | 0,5× | 0,75× | 1× | 1,25× |
| Impostor ab | eigene Karten | 200 m | 280 m | 380 m | 500 m |
| Gras | eigene Karten | aus | 35 000 bis 90 m | 70 000 bis 140 m | 100 000 bis 180 m |
| Bodenschichten je Pixel | eigene Karten | 4, Ferne gebacken ab 150 m | Ferne gebacken ab 400 m | wie heute | wie heute |

Auto: Vorauswahl über den GPU-Namen, dann ein kurzer Messlauf beim ersten Start; eigene Karten starten eine Stufe
vorsichtiger als Tiles, weil Auflösung sie viel mehr kostet.

### Phase 3: lebendig und mit Charakter

| Kennung | Was | Kosten (geschätzt) |
|---|---|---|
| OP-B1 | Geländeform backen (Krümmung, Abfluss, Nähe zu Wasser und Lava) in die vorhandene Verdeckungstextur: Mulden feucht, Kuppen trocken, Geröll am Hangfuß | 0 Texturzugriffe extra |
| OP-W1 | Wasser mit Licht und Schatten | 0,05–0,1 ms |
| OP-W2 | Gebackene Strömungskarte für Wasser und Lava | ~0,1 ms |
| OP-W3 | Laufende Schaumbänder, nasser Sand | 0 |
| OP-W5 | Wasserfall ohne Kartenkanten, zwei Lagen, Gischt | gering |
| OP-W6 | Flussufer ungleichmäßig, Glanz funkelt | 0 |
| OP-W7 | Tiefenfärbung (0); Brechung und Gerstner-Wellen nur Hoch | 0 / 0,3–0,5 ms |
| OP-L2, OP-L3, OP-L4 | Lavakruste reißt auf, Relief und Sonne; erkaltete Ränder; Funken, Rauch, Schein ohne Lichter | je < 0,1 ms |
| OP-L7 | Bloom und Hitzeflimmern nur Hoch | 0,5–1 ms |
| OP-B2–OP-B7 | Übergänge und Glanz je Material, Klippen ohne Verzerrung, natürliche Variationstextur, Schmutz-Decals, Charakter-Materialien und 6 bis 8 Bodenschichten, Farbstimmung je Biom | 0 bis < 0,1 ms; Schichten kosten Ladezeit |
| QX2 | Tone-Mapping Khronos PBR Neutral nur auf eigenen Karten, Karten-Licht neu abstimmen; Tiles unverändert | 0 |
| OP-H2 | Tower in die gecachte Schattenkarte, Blob-Schatten für Gegner und Held (eigene Karten) | < 0,1 ms |
| OP-H5 | Weicher LOD-Wechsel der Objekte | 5–15 % Draws im Band |
| OP-H6 | Hafenstadt: Kaikante, Erdhügel im Becken | 0 |
| OP-H7 | Zweite Schattenkaskade, Eisrisse, Oktaeder-Impostoren, Grassorten, Burgmauer-Baukasten | einzeln |

### Phase 4: Editor-Werkzeuge

| Kennung | Was |
|---|---|
| ED-S3 | Straßen und Flüsse nicht destruktiv: Ausstattung je Kante, beim Verschieben neu angelegt |
| ED-S6 | Objekte entlang einer Linie (frei oder an Straße und Fluss) |
| ED-S7 | „Align to slope“ für Setzen und Streuen |
| OP-S2 | Klippen-Werkzeug mit Klippenmodellen entlang steiler Kanten |
| ED-S14 | Mondlicht und Objekt-Tönung im UI |
| ED-S15 | Mehrfachauswahl für Knoten, Straßen und Spawns |
| ED-K4 | „Mirror the map now“ |
| ED-K6 | Heightmap-Import und -Export (16-Bit-PNG, RAW) |
| ED-K9 | Verlaufsliste zum Springen |

## Danach (B)

ED-S1 Bauflächen-Ansicht, ED-S2 Editor-Route wie im Spiel, ED-S4 Testlauf ab Welle N, ED-S9 Schwierigkeitsfaktor
für die Standardwellen je Karte, PF-K2 Schattenkarte bei Schwenks verteilen.

## Später (C) und verworfen (D)

- **C:** ED-K5 Prefabs, ED-K7 Intro-Kameraflug, ED-K8 Ereignisse je Welle, ED-K13 Balance-Hilfen, QX4 DevWorld
  durch Testkarten ersetzen.
- **D:** ED-S8 Wellen je Spawn und Spuren ab Welle N.

## Entschieden (User, 2026-10-13)

1. **Reihenfolge:** Phase 0 sofort, dann 1 Editor sicher, 2 Performance (Benchmark für eigene Karten zuerst), 3 Optik,
   4 Werkzeuge. Jede Optik-Änderung wird gegen die gemessenen Zahlen gebaut.
2. **Koop-Kartenversand bis 32 MB:** Teile nacheinander mit Bestätigung und Fortschrittsanzeige, innerhalb der
   Relay-Grenzen (1 MB je Nachricht, 8 MB ungelesen, 4 MB/s je Client); 32 MB in etwa 8 s.
3. **Tone-Mapping Khronos PBR Neutral**, nur auf eigenen Karten. Karten-Licht und Biome werden neu abgestimmt; Tower,
   Gegner und Effekte bleiben unverändert und werden nur geprüft.

## Umsetzung

- Eigener Branch von `next`, lokal committen, kein Push ohne Zuruf.
- Je Phase: betroffene Specs je Commit, volle Prüfung (vitest, tsc, Lint, Build) und eine Kurzmessung mit PF-M4 am
  Ende der Phase; Optik mit Vorher/Nachher-Bildern.
- Erledigtes wandert in die Fach-Doku ([CUSTOM_MAPS.md](CUSTOM_MAPS.md), [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md),
  [LEVEL_EDITOR.md](LEVEL_EDITOR.md)), offene Nachtests nach [PLAYTEST.md](PLAYTEST.md).

## Ergebnis (2026-10-14)

Alle A-Punkte der Phasen 0 bis 4 sind gebaut, danach zwei Review-Runden (jeder Bereich selbst, dann über Kreuz) mit
rund 30 Fixes. Das Verhalten steht in der Fach-Doku, die Messwerte in [BENCHMARKS.md](BENCHMARKS.md) und
[RENDER_QUALITY.md](RENDER_QUALITY.md).

- **Gemessen (RTX 5080, Spielansicht High, GPU-Median):** Hafenstadt 1111 auf 120 Draw Calls, 3,68 ms Bildzeit auf
  0,95 ms GPU; Demo-Tal 290 auf etwa 160 Calls, 0,96 ms; Tiles Stuttgart 0,82 ms. Ultra kostet etwa 1,2-mal High.
- **Koop:** Karten bis 32 MB als Binärrahmen (Protokoll 5), 32 MB in 9,8 s am echten Relay. Die 8 s aus dem Plan
  sind unter 4 MB/s je Client mit festem Sekundenfenster nicht erreichbar.
- **Verworfen nach Messung:** Gras je Halm in einem eigenen Pass (PF-K1, kein Gewinn über dem Rauschen, auch nicht
  mit SwiftShader; die Grassorten bleiben), Reversed-Z (PF-S6, die Himmelskuppel verdeckte Gelände), Erdflecken um
  Häuser als Decals (OP-B5, das Gras wächst darüber).
- **Nicht gemacht:** Modelltexturen als KTX2 (WebP in den GLBs, die Roh-GLBs fehlen); Transforms offline backen
  (PF-K3, nur 23 bis 42 ms); Atlas und BatchedMesh (PF-M2 erreicht das Ziel durch Packen und Zusammenlegen).
- **Bekannte Grenzen:** an der Einmündung einer geteilten Straße weicht der Boden nach Neubau um wenige Zentimeter ab
  ([LEVEL_EDITOR.md](LEVEL_EDITOR.md)); der ferne Bodenschatten kommt nur vom Gelände.
