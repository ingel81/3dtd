# Licht durch Munition

**Status:** Gebaut 2026-10-18 (E242), wartet auf Test
**Bezug:** [RENDER_QUALITY.md](RENDER_QUALITY.md) (Stufen), [PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md) (Effekt-Schalter),
[CUSTOM_MAPS.md](CUSTOM_MAPS.md) (Materialien der eigenen Karten)

Schüsse, die leuchten, beleuchten ihre Umgebung, solange sie sichtbar sind: das Mündungsfeuer von Gatling, Kanone,
Iron Bastion und Raketenturm, leuchtende Geschosse im Flug (Leuchtspur, Granate, Orbs, Gift, Eis, Rakete), die
Einschläge und Explosionen, die Strahlen (Flamme, Sentinel-Laser, Kettenblitz, Orbitallaser) und die Fähigkeiten
(Atomblitz, EMP, Frostbombe). Die drei Munitionstypen des Helden laufen über dieselben Geschosse: Standard als
Leuchtspur, Explosiv als Granate mit kleiner Explosion, Rune als violetter Orb.

Licht nehmen: Boden, Straßen, Brücken, Objekte, Gebäude, Gras, Bodendecals und Wasser der eigenen Karten und
OSM-Welten, dazu in jeder Welt Tower, Sockel, die Bauvorschau, der Held und die Gegner. Die 3D-Tiles ignorieren jedes
dynamische Licht; auf echten Orten leuchten nur Tower und Einheiten auf.

## Aufbau

| Teil | Datei | Aufgabe |
|---|---|---|
| Looks | `configs/shot-lights.config.ts` | Farbe, Stärke, Reichweite je Quelle; Pulse mit Dauer, Abkühlfarbe (`fade`) und Zufall (`jitter`) |
| Sammler | `three-engine/shot-lights/shot-lights.ts` (`ShotLights`, `engine.shotLights`) | sammelt je Bild, fasst zusammen, wählt aus, schreibt den Puffer und das Raster |
| Shader | `three-engine/shot-lights/shot-light-shader.ts` | Uniforms, `shotLightAt()`, `addShotLight()` für eingebaute Materialien |
| Quellen mit eigenem Zustand | `three-projectile.renderer.ts`, `three-flame-beam.renderer.ts`, `laser-beam.renderer.ts`, `orbital-beam.renderer.ts` | `ShotLightSource`: je Bild ihre Lichter (Geschosse aus den Instanzmatrizen, Strahlen) |
| Pulse | `game-engine/vfx.service.ts` | Mündungsfeuer, Einschläge, Kettenblitz, Atomblitz, EMP, Frostbombe |

**Je Bild** (`ShotLights.update`, am Ende von `ThreeTilesEngine.update`): Pulse, die noch glühen, und die Lichter der
Quellen werden Kandidaten (höchstens 1024). Kandidaten in derselben 4-m-Zelle verschmelzen zu einem Licht (Licht
summiert, Ort nach Licht gewichtet, Reichweite der weiteste): ein Strom von Leuchtspuren ist ein wanderndes Licht,
nicht zwanzig. Lichter außerhalb des Sichtkegels fallen weg, die übrigen nach Licht mal Reichweite durch Abstand zur
Kamera; die stärksten belegen die Plätze der Stufe. Ganzzahlige Zellschlüssel in einer offenen Hash-Tabelle, feste
Float32Arrays, keine Allokation je Bild; Hauptthread 0,03 bis 0,07 ms je Bild (gemessen, siehe unten).

**Im Shader** lesen die Materialien einen Puffer von 32 Lichtern (zwei vec4 je Licht: Ort und 1/r², Farbe mal Stärke
und 1/Kern²) und ein Raster von 8 × 8 Zellen über dem Boden, den die gewählten Lichter bedecken: je Zelle ein Bit je
Licht, dessen Kreis sie trifft. Ein Fragment liest seine Zelle und rechnet nur deren Lichter (das niedrigste Bit je
Runde, sein Index aus log2). Abfall: invers quadratisch hinter einem Kern von halber Reichweite, weich auf null am
Rand; eine dem Licht zugewandte Fläche nimmt alles, eine abgewandte etwas (gewickelt), so beleuchtet ein Blitz über
der Straße Straße und Hauswand. Weich begrenzt wie die Laternen: viele Explosionen hellen stark auf, nie bis weiß.

**Kein Programmwechsel:** Puffer und Raster haben feste Größen. Eine andere Stufe ändert nur, wie viele Plätze
belegt werden; ohne Licht im Bild ist der Zähler 0 und der Shader überspringt alles. Die Uniforms sind ein Objekt für
alle Materialien (wie Nebel und Laternen), three lädt sie einmal je Material und Bild hoch.

**Ersetzt das PointLight des Mündungsfeuers** (`TowerMuzzleFlash`, ein PointLight in der Szene, 50 ms je Schuss,
der letzte Schuss gewann): auf eigenen Karten hätte es den Boden doppelt beleuchtet, und jedes beleuchtete Material
rechnete es in jeder Welt mit. Tower, Sockel und Held nehmen das Licht über `addShotLight`, die Gegner im VAT-Shader.

## Stufen

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| Plätze (`general.shotLights`) | aus | 8 | 16 | 32 |

Low ist aus, auch das Mündungslicht auf den Towern. Die Effekt-Schalter gelten mit: ohne Muzzle Flash kein
Mündungslicht, ohne Impact Effects kein Einschlaglicht.

## Varianten

| Variante | Urteil |
|---|---|
| PointLight je Schuss | verworfen: jede Änderung der Lichterzahl baut jedes beleuchtete Material neu, jedes Licht kostet jedes beleuchtete Pixel der Szene |
| Lichtpuffer, jedes Fragment rechnet alle Lichter | erster Prototyp; im echten Kampf mit 32 Plätzen rund 1,5 ms mehr unter Last (siehe Messung), wächst mit jedem Platz für jedes Pixel |
| Lichtpuffer mit Raster (gebaut) | jedes Fragment rechnet die Lichter seiner Zelle; im echten Kampf im Rauschen, im schlimmsten Fall 3 bis 12 % des Zeichnens |
| Additiver Lichtfleck auf dem Boden (Decal-Pass) | nicht gebaut: billig, aber nur Boden, keine Wände, keine Tower und Gegner, Ränder auf Hängen und Dächern falsch |
| Lichttextur über der Karte wie die Laternen | nicht gebaut: eine Abfrage je Fragment, aber 2D (keine Wandrichtung, Höhe nur gemittelt) und ein Render-Pass je Bild |

## Messung

Skript `e2e/perf/shot-lights.ts` (Kopf des Skripts: Aufruf). Es baut auf einer eigenen Karte (Harbor Town, Nacht)
Tower entlang der Route, lässt Gegner ohne Tod laufen und schaltet das Licht im selben Tab um:

- **Takt-Vergleich** (frames in turn): Phasen mit und ohne Licht im Wechsel, GPU-Zeit je Bild per Timer-Query.
- **Paar-Vergleich** (pairs in one frame): die Szene in jedem Bild zweimal gezeichnet, mit und ohne Licht, die
  Reihenfolge wechselt, jede Zeichnung in einer eigenen Timer-Query (je Query viermal gezeichnet). Beide sehen die
  Last des Rechners innerhalb einer Millisekunde; Median der Paar-Differenzen und Quartile.
- `--synthetic 32`: 32 zusätzliche feste Lichter, 12 m auseinander, 24 m Reichweite um die Tower (der schlimmste
  Fall: alle Plätze belegt, jeder Platz trifft Boden im Bild). `--grid`: dieselben Lichter mit Raster gegen jedes
  Licht je Fragment.

**Der Rechner war bei allen Messungen durch viele Agenten ausgelastet** (GPU 74 % belegt, eine Zeichnung, die frei
um 1 ms braucht, brauchte 5 bis 19 ms). Absolute Zahlen gelten nicht; die Anteile und die Vorzeichen der Paare
schon. **Bei freiem Rechner nochmal laufen lassen** (Lead), siehe „Nachmessen“.

Gemessen 2026-10-18/19, RTX 5080, Chromium headless über ANGLE D3D11, DPR 1, 1600 × 900, Harbor Town nachts,
Stufe High, 40 Tower (Gatling, Bastion, Rakete, Kanone, Magic, Chaos, Feuer, Blitz) und der Held, 300 Gegner. Je
Zeile 400 Paare, je Paar vier Zeichnungen; „Zeichnen“ ist die Zeit ohne Licht unter Last (frei um 1 ms).

| Szene | Plätze | Licht kostet (Median, Quartile) | Anteil am Zeichnen |
|---|---|---|---|
| echter Kampf, 32 Lichter im Bild | 8 | +0,42 ms (−0,39 … 1,41) | ~5 % |
| | 16 | +0,53 ms (−0,58 … 1,65) | ~6 % |
| | 32 | +0,22 ms (−0,86 … 1,38) | ~2 % |
| dazu 32 feste Lichter (schlimmster Fall) | 8 | +0,25 ms (−0,89 … 1,09) | ~3 % |
| | 16 | +0,67 ms (−0,35 … 1,53) | ~9 % |
| | 32 | +0,85 ms (−0,11 … 1,60) | ~12 % |

Die Kampfzeilen schwanken ohne Ordnung um +0,2 bis +0,5 ms: das Licht liegt dort im Rauschen der geteilten GPU. Der
schlimmste Fall steigt mit den Plätzen. Auf freiem Rechner wären es nach dem Verhältnis zur ganzen Zeichnung
höchstens ein Zehntel einer Millisekunde; auf einer schwachen GPU zählt der Anteil (Medium: 8 Plätze, ~3 bis 5 %).

**Was das Raster spart** (dieselben Lichter, Raster gegen jedes Licht je Fragment): echter Kampf mit 32 Plätzen
−1,31 ms (−2,46 … −0,32, alle Quartile darunter), 16 Plätze −0,56, 8 Plätze −0,42 ms; schlimmster Fall mit 32
Plätzen −1,78 ms (−2,85 … −0,83). Ohne Raster kostete der echte Kampf mit 32 Plätzen so rund 1,5 ms statt 0,2.

**Hauptthread:** `ShotLights.update` 0,04 bis 0,08 ms je Bild (Entwicklungs-Build, 50 bis 80 Kandidaten, 45 bis
73 nach dem Zusammenfassen). Uniform-Upload: ein `uniform4fv` mit 64 vec4 je Material und Bild.

**Empfehlung je Stufe:** Low aus (schwache GPUs, und die Stufe verzichtet ohnehin auf Bloom und Gras), Medium 8,
High 16, Ultra 32, so gebaut.

## Nachmessen

```bash
npx ng build --configuration development --output-path <dir>
node e2e/perf/serve.mjs <dir>/browser <port> --isolate
cd e2e
node perf/shot-lights.ts --url http://localhost:<port> --night --rounds 4 --seconds 3 --pairs 400 --along 0.3 \
  --towers 32 --hero explosive --view 90 --places 8,16,32 --grid
node perf/shot-lights.ts --url http://localhost:<port> --night --rounds 2 --seconds 3 --pairs 400 --along 0.3 \
  --towers 32 --view 90 --synthetic 32 --places 8,16,32 --grid
```

Bilder dazu: `--shots <dir> --shot-count 4 --view 60 --along 0.45 --towers 10 --mix dual-gatling:3,bastion,magic
--hero rune` (ohne `--night` die Karte, wie sie ist), ein Clip aus Einzelbildern mit `--clip <dir> --seconds 5`.
