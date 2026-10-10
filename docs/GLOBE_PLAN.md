# Weltkugel als Ladegrund (TODO E126)

Stand 2026-10-09, **gebaut** auf dem Branch `globe/e126-2026-10-09`, wartet auf den Nachtest
([PLAYTEST.md](PLAYTEST.md#g-weltkugel-als-ladegrund-2026-10-09)). Solange keine Tiles da sind, steht hinter dem Menü
eine realistische 3D-Erde; bei jedem Ortswechsel steigt die Kamera vom alten Ort auf, die Kugel dreht zum neuen, und
eingetaucht wird erst, wenn dessen Tiles da sind, nahtlos in sie hinein. High-End in der Optik, sparsam im Betrieb.

## Ziel

- **Der Ladegrund zeigt die Erde.** Tag mit Blue Marble, Nacht mit Stadtlichtern, Wolken mit eigenem Drift, Glanz
  auf den Ozeanen, Atmosphärensaum, echter Sternenhimmel, Sonnenstand zur Uhrzeit des Spielers.
- **Die Kugel weiß, wohin es geht.** Sie dreht zum Ort, der lädt; Ortsmarken zeigen die zuletzt gespielten Orte,
  Favoriten und Rekorde.
- **Eintauchen ohne Schnitt.** Erst wenn die Tiles des Ortes geladen sind, fliegt die Kamera hinab und landet in der
  Ansicht, die das Menü vorher zeigte.
- **Ortswechsel spiegelbildlich.** Aufsteigen vom alten Ort durch die Tiles in die Kugel, drehen, eintauchen.
- **Performant.** Komprimierte Texturen, ein zweiter WebGL-Kontext nur so lange, wie die Kugel steht; das Spiel
  zeichnet nicht, solange die Kugel es verdeckt.

## Ablauf

```
idle        Start ohne Ort: die Erde dreht langsam, Start über der Zeitzone des Spielers
turning     Ort gewählt (oder vom Ortswechsel angekündigt): Drehung zum Ort, die ganze Erde im Bild (10 000 km);
            liegt der Ort in der Nacht, geht die Sonne dabei im Zeitraffer über ihm auf (D2)
waiting     über dem Ort im Tag, die Ladeplatte läuft; ab den ersten Tiles wird der obere Abstieg vorgeladen
warming     geladen: der Rest des Abstiegs wird vorgeladen
diving      Kugelkamera taucht bis 500 km ab, senkrecht nach unten, Bildschirm-Oben in Blickrichtung des Spiels
handover    Spielkamera übernimmt dieselbe Pose, die Kugel folgt ihr und blendet in 0,7 s aus
gone        Kugel-Kontext frei; die Spielkamera landet in der Menüansicht, dann gibt Play frei
rising      Ortswechsel: Spielkamera steigt auf 500 km, die Kugel blendet ein (im Tag); erst danach setzt der
            Wechsel den neuen Ursprung; weiter mit turning zum neuen Ort
```

Gemessen (Stuttgart, Paris, Cesium Ion, 2026-10-09/10): Abtauchen gesamt 7 s (Kugel 2,1 s, Spielkamera 4,9 s; mit
vorgemerktem Play 4,5 s). Vorladen nach dem Laden 3 bis 5 s, davon der Großteil schon während des Ladens. Ortswechsel
Stuttgart → Paris 26 s bis Play, davon Aufstieg 3,2 s.

## Architektur

| Teil | Datei | Aufgabe |
|---|---|---|
| Kugel (Three.js, Angular-frei) | `globe/globe-view.ts` | eigener `WebGLRenderer` auf eigenem Canvas, Erde, Saum, Sterne, Sonne, `render()` auf Zuruf, `dispose()` mit `forceContextLoss` |
| Laufzeit | `globe/globe-runtime.ts`, `globe.worker.ts`, `globe-host.ts` | eigene Schleife der Kugel: Kamerafahrten, Leerlauf, Folgen der Abstiegsbahn, Sonnenlauf, Wolkenloch, Marken projizieren; im Worker auf einem OffscreenCanvas, sonst im Hauptthread; nimmt Befehle, meldet Ereignisse |
| Shader | `globe/globe-shaders.ts` | Erde in einem Pass (Tag, Regionskacheln, Relief, Wasserglanz, Wolken, Wolkenschatten, Stadtlichter, Dunst), Saum, Sterne, Sonne |
| Texturen | `globe/globe-textures.ts` | KTX2-Stufen, Regionskacheln um den Ort (`regionTilesAround`) |
| Geodäsie, Himmel | `globe/globe-geo.ts` | WGS84, Sonnenstand (NOAA), Sternzeit, Sonnenaufgang im Anflug (`landingSun`, `sweptSun`) |
| Kugelkamera | `globe/globe-flight.ts` | „Shot“: Punkt darunter, Höhe, Blickziel, Versatz nach rechts, Rollen zum Kurs |
| Regisseur | `services/world/globe-director.service.ts` | Phasen, Befehle an die Laufzeit, Ortsmarken, Anzeige, Überblendungen als CSS-Übergang, Übergabe, `__globe` |
| Abstieg der Spielkamera | `services/world/dive-flight.service.ts`, `dive-path.ts` | Bahn (logarithmische Höhe, Neigung ab 55 %), Vorladen, Flug über `ThreeTilesEngine.addFrameHook` |
| Engine | `three-engine/dive-view.ts` | Maßstab `m` für Sichtweite, Nebel und Fernabschlag; Vorlade-Kameras nacheinander; Texturupload in Zeitscheiben; Offscreen-Zeichnung |
| Kopplung | `services/world/globe-link.ts` | Token `GLOBE_LINK`: `holdsPlay`, `playWaits`, `beforeOriginChange`, `nextPlace`; ohne Kugel neutrale Werte |
| Hülle | `components/globe-backdrop/` | Canvas je Kugel (neu je Generation, im Worker gehört er dem), Marken und Anzeige direkt im DOM |
| Einstellung | Settings, Graphics, „Menu globe“ | High, Low, Off (`td_globe_quality_v1`) |

### Im Worker

Beim Laden steht der Hauptthread oft (Straßen, Routen, Korridor; gemessen bis 1,5 s am Stück, mit und ohne Kugel).
Deshalb läuft die Kugel in einem Worker auf einem OffscreenCanvas (`transferControlToOffscreen`) mit eigener
Bildschleife und rechnet ihre Fahrten selbst; der Regisseur schickt nur Befehle („zum Ort drehen“, „Sonne von A nach
B“, „der Abstiegsbahn ab Zeitpunkt T folgen“). Zeiten wandern als Epoch-Millisekunden, so fliegt die Kugel die Bahn
der Spielkamera vom selben Augenblick an. Ein- und Ausblenden sind CSS-Übergänge, die der Compositor ausführt. Wo der
Browser kein WebGL 2 im OffscreenCanvas hat, läuft dieselbe Laufzeit im Hauptthread (`localStorage`
`td_globe_main_thread` = 1 erzwingt das zum Vergleich). Gemessen 2026-10-10 (Ortswechsel Stuttgart → Paris): im
Hauptthread 36 Frames über 50 ms, in der Kugel 1519 bewegte Frames, längster Abstand 42 ms. Die Ortsmarken und die
Anzeige bleiben im DOM und können bei einem Hänger kurz stehen.

### Übergabe in Nadir-Sicht

Die Kugel lebt in ECEF-Metern auf dem WGS84-Ellipsoid der Tiles, die Spielwelt im Rahmen des `ReorientationPlugin`.
`ThreeTilesEngine.sceneToEcef` liefert die Umrechnung aus der Matrix der Tiles-Gruppe. Übergeben wird bei senkrechtem
Blick in 500 km Höhe (`HANDOVER_ALTITUDE`): dort sieht keine Kamera Himmel, die Posen sind gleich, die Kugelkamera trägt
die Spiel-FOV. Kugel und Spielkamera zoomen mit gleicher Geschwindigkeit durch die Übergabe (`diveDurations`: Kugel
quadratisch beschleunigend, Spielkamera quadratisch bremsend). Während der Überblendung zeichnet die Kugel im Frame-Hook
der Engine, also im selben Frame wie das Spiel.

Die Engine hebt während des Flugs mit dem Maßstab `m = Höhe / Endhöhe` Fernebene (8000 m · m) und Nebel (· m) an und
senkt den Fernabschlag (`errorFalloff / m`); bei der Landung ist `m = 1`, also kein Sprung.

### Vorladen

Messprobe 2026-10-09 (Stuttgart): Vorlade-Kameras von 600 km bis 1,5 km kosten **+262 Requests, +8 MiB** auf rund
700 Requests, 110 MiB des Ortes (gut 7 % der Bytes). Gleichzeitig registriert mischen sie die Detailstufen (die
Bibliothek verfeinert für die strengste Kamera), deshalb **nacheinander**, je Stufe bis nichts mehr lädt. Feste
Höhenleiter `WARM_ALTITUDES` (500/170/60/20/7/2,5 km): die oberen vier liegen bei jeder Endansicht senkrecht über dem
HQ, also gleich, und laufen schon ab den ersten Tiles. Je Stufe werden die Tile-Texturen in Zeitscheiben von 4 ms
hochgeladen und die Ansicht einmal in eine 4×4-Ecke des verdeckten Canvas gezeichnet (Geometrie auf die GPU; ein
Render-Target würde für jedes Material neue Shader kompilieren). Solange die Kugel deckt, laufen 8 statt 4 Downloads
und 2 statt 1 Parse parallel (`applyQueueBudget`); die Spielkamera zeichnet dann nicht (`setDrawSuppressed`, außer
jemand wartet auf einen Frame).

### Leistung

Gemessen 2026-10-09/10 (Chrome, RTX, 144 Hz): Kugel-Render 0,3 bis 0,6 ms CPU je Frame; Aufbau 30 ms; Abbau 6 ms;
Upload 8k 45 ms; erster Frame eines frischen Kontexts 110 ms im Hauptthread, 12 ms im Worker (vor dem Aufstieg
unsichtbar vorweggenommen). In Vorladen, Abtauchen,
Übergabe und Aufstieg **kein Frame über 50 ms**. Die großen Stalls beim Laden (bis 1,8 s) gibt es mit und ohne Kugel
(Laden selbst). GPU-Speicher der Stufe High etwa 80 MB, nach der Landung frei.

## Rendering

| Teil | Umsetzung | Kosten |
|---|---|---|
| Erde | Gitter 384×192 auf dem Ellipsoid; ein Shader: Tag, bis zu vier Regionskacheln, Relief aus Höhendaten, Wasserglanz, Wolken als Schicht mit Schatten, Stadtlichter, Mondlicht-Hauch, Dunst | 1 Draw |
| Saum | Schale 100 km über dem Ellipsoid, nur wo der Strahl die Erde verfehlt | 1 Draw |
| Streuung | Rayleigh und Mie, Einfachstreuung, 12 Schritte (Low 6), zur dichtesten Stelle verdichtet, Lichtweg 4 Schritte, Rauschen gegen Bänder; in km im „Kugelraum“ | in Erde und Saum |
| Sterne | Yale Bright Star Catalogue, 9096 Sterne, Farbe aus B-V, gedreht nach Sternzeit | 1 Draw |
| Sonne | Richtung aus UTC, Scheibe und Halo | 1 Draw |
| Marken | HTML, je Frame projiziert, hinter der Erde ausgeblendet | DOM |

Kein Tiefenpuffer: feste Zeichenreihenfolge, die Erde ist konvex. Belichtung 0,17 (der Boden ist physikalisch beleuchtet,
Albedo · E / π unter Sonne 22). Wolken lösen sich unter 1800 km auf und sind unter 450 km fort (grobe Textur aus der
Nähe, die Tiles haben keine); über dem Ziel öffnet sich ein Wolkenloch.

### Texturen

| Datei | Quelle | Größe |
|---|---|---|
| `earth-day-2k/8k.ktx2` | NASA Blue Marble NG, **Juli 2004** (Laub, kaum Schnee, wie die Tiles) | 0,2 / 2,4 MB |
| `earth-night-2k/8k.ktx2` | NASA Black Marble 2016 (RGB), NASA Wolken (Alpha) | 0,4 / 6 MB |
| `earth-relief-2k/4k.ktx2` | Höhe und Wasser aus GEBCO 2008 über NASA Visible Earth | 0,2 / 0,5 MB |
| `region/<Reihe>_<Spalte>.ktx2` | Blue Marble 500 m, auf 1 km je Pixel, 9°-Kacheln, nur mit Land (587 von 800) | 54 MB |
| `stars.bin` | Yale BSC5 | 146 KB |

ETC1S (Basis Universal) mit Mipmaps, auf dem Gerät in dessen GPU-Format umgewandelt; Transcoder per `postinstall` nach
`public/basis/`. Stufe sofort 2k, dann 8k; Regionskacheln (2×2 um den Ort) ab der Ortswahl. Low lädt nur 2k.
Werkzeug: `bash tools/globe/fetch_sources.sh`, dann `python tools/globe/build_textures.py` (KTX-Software 4.4, `ktx.exe`).

## Sonderfälle

- **Ohne Menü** (`?bot=`, `&benchmark`, `&menu=skip`), **DevWorld**, kein WebGL 2, Einstellung Off: keine Kugel.
- **E2E-Tests** schalten die Kugel aus (`e2e/support/game.ts`), außer ein Test setzt den Schlüssel selbst.
- **Ladefehler**: Kugel bleibt, kein Abtauchen. Scheitert ein Wechsel (Straßen), dreht die Kugel zum alten Ort zurück
  und taucht wieder ein.
- **Kontextverlust der Kugel**: Kugel für diese Seite aus, Spiel unberührt.
- **Einstellung an im laufenden Spiel**: greift ab dem nächsten Ortswechsel; Off wirkt sofort.

## Entscheidungen

Aus der Abstimmung vom 2026-10-09 (`tmp/plan/LADEGRUND_GLOBUS.md`): echte Erde mit allem, Eintauchen erst mit den
Tiles, bei jedem Ortswechsel, echter Sonnenstand, Texturen sehr scharf und gestaffelt.

Abstimmung vom 2026-10-09 (AUQ):
- **D1 Wann eintauchen**: am Ende des Ladens; der Abstieg landet in der fertigen Menüansicht, Play gibt danach frei.
- **D2 Nacht am Ort**: Sonnenaufgang im Zeitraffer (4,5 s bis 30° Sonnenhöhe). Nachtest 2026-10-10 (User: „viel
  dunkel abends während Laden“), neu entschieden: die Sonne geht schon auf, während die Kugel zum Ort dreht; das
  ganze Laden über steht er im Tag. Ohne Ortswahl echter Sonnenstand. Der Aufstieg zeigt die Kugel im Tag.
- **Feinschliff 2026-10-10** (User): beim Laden die ganze Erde im Bild (10 000 km statt 5000 km), flüssig während
  des Ladens (Worker).
- **D3 Bedienung**: nur Kulisse, keine Eingabe.
- **D4 Texturen**: alles mitliefern unter `public/assets/globe/` (65 MB), keine fremden Server.
- **Performance** (User): High-End und performant zugleich.

Beim Bau festgelegt (mit Begründung oben): Übergabe bei 500 km; Regionskacheln 1 km statt 500 m (Größe); Juli statt
Dezember (Schnee gegen Sommer-Tiles); Wolken und Dunst im Erd-Shader statt eigener Schalen; Leerlauf über der
Zeitzone des Spielers; feste Vorlade-Höhenleiter.
