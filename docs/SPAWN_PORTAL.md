# Spawn-Portal

**Stand:** 2026-09-15 (aus ARCHITECTURE.md herausgelöst und gegen den Code geprüft)

Ein Steintor auf dem Routenstart jedes Spawns: Gegner treten aus ihm heraus, der Spieler kann
es beim Setzen des Spawns drehen. Code in `three-engine/renderers/marker/` (`SpawnPortalManager`,
`spawn-portal-pose.ts`, `-frame.ts`, `-sigils.ts`, `-gate-material.ts`, `-glow-material.ts`),
Maße in `configs/marker-geometry.config.ts`, Look in `SPAWN_PORTAL_LOOK`
(`configs/visual-effects.config.ts`). Zwei instanzierte Draw Calls für alle Portale:

- **Tor** (opak): Steinblöcke und die Leere, eine Fläche vor und eine hinter dem Volumen des
  Portals; Pfeiler und Sturz schließen es an den Seiten und oben.
- **Glow** (additiv): das Licht auf der Straße vor der vorderen und hinter der hinteren Fläche,
  dazu der Beschwörungskreis vor dem Portal.

Wo ein Spawn stehen darf und wie Ort, URL und Favoriten ihn speichern:
[LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#urllocationservice). Der Auftritt eines Bosses aus dem
Portal: [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-intro).

## Volumen und Ausrichtung

Die beiden Flächen der Leere liegen `PORTAL_DEPTH` (10,5 m bei Skala 1) auseinander und
schreiben beide Tiefe. Die Mitte des Portals steht auf dem Routenstart, wo `EnemyManager.spawn`
jeden Gegner auf `path[0]` setzt (dieselbe Route, die das Portal bekommt,
`path-route.service.spec.ts`). Ein Gegner steht damit im Volumen, von allen Seiten verdeckt samt
Healthbar, bis er vorn heraustritt. Die Tiefe schrumpft bei schmalen Korridoren nicht mit
(`portalDepthScale`).

Das Portal schaut dorthin, wo die Route sein Volumen verlässt: auf den Punkt, an dem sie zum
ersten Mal so weit vom Start weg ist wie die vordere Fläche (`spawnPortalPose`,
`routeExitPoint`). Die Route läuft so mittig durch die Öffnung hinaus, auch wenn sie in einer
Kurve beginnt (Kreisverkehr, Stummel vor einer Ecke); ein Knick näher als die halbe Tiefe am
Start lässt sie im Volumen trotzdem seitlich laufen.

## Vorschau beim Setzen des Spawns

Die Vorschau zeigt das Portal so, wie es stehen wird (`MapPlacementService`): wo ein Spawn stehen
darf, auf dem Start der Route, die er bekommt, zu ihr ausgerichtet (`spawnPortalPose`), in der
Skala des Standardkorridors, da die Breite dort erst mit der Route gemessen wird. Die Route
beginnt am Fußpunkt des Cursors auf dem nächsten Straßensegment, liegt der Fußpunkt keinen Meter
vor einem Knoten, auf dem Knoten (`findPath` in `OsmStreetService` bzw. `DevStreetProvider`,
Start über `SegmentRoutes` aus `utils/route-start.ts`). Die Vorschau folgt dem Cursor so die
Straße entlang. Bis 2026-09-14 begann die Route am ersten Knoten des Segments, bis zu eine
Segmentlänge vom Klick entfernt.

- **Gleiten:** Die Vorschau gleitet je Frame zu der Pose der letzten Mausbewegung
  (`updatePreview`, Zeitkonstante `PREVIEW_FOLLOW_S` 40 ms): ein Schritt, der Wechsel auf eine
  andere Straße, eine Wende der Route oder eine neue Bodenhöhe ist nach rund 0,1 s zu 90 %
  eingeholt, statt zwischen zwei Mausbewegungen zu springen. Ein Klick setzt die Pose, nicht das
  gerade Gezeigte; die Drehung mit R kommt ohne Verzögerung obendrauf.
- **Kosten:** Die Routen eines Segments werden gemerkt (A* höchstens zweimal je Segment), eine
  Bewegung wählt nur den Start neu. Mausbewegungen innerhalb der 16-ms-Drossel gehen nicht
  verloren, die letzte kommt am Ende des Fensters durch (`InputHandlerService.handlePointerMove`,
  `POINTER_MOVE_THROTTLE_MS`).
- **Ungültiger Platz:** Wo kein Spawn stehen darf, steht die Vorschau rot am Cursor und schaut
  zum HQ.
- Die Platzierungsvorschau zeichnet eine Kopie der Geometrie des Rahmens.

## Drehen mit R

R gehalten dreht die Vorschau mit 15°/s (`TURN_SPEED` in `map-placement.service.ts`) im
Drehbereich (unten); an der Grenze bleibt sie stehen, der nächste Druck dreht zurück. Die Drehung
zählt ab der Richtung der Route unter dem Cursor und ändert nur das Portal, nicht den Weg der
Gegner.

Wer gedreht hat, dessen Richtung gilt (`MarkerVisualizationService.setPortalHeading`), auch über
jeden Neubau der Route, bis der Spawn wieder hinzugefügt wird: neu gesetzt, HQ umgesetzt, Ort
gewechselt. Ohne Drehen folgt das Portal der Route.

**Gespeichert** wird die Drehung als Kompasskurs am Spawn (Grad im Uhrzeigersinn ab Nord,
`SavedSpawn.portalBearing`, umgerechnet mit `portalHeadingToBearing`) in der URL
(`s=lat,lon,kurs`) und in Favoriten, die danach gespeichert werden. Reload, geteilter Link,
Favorit und ein Showcase-Ort mit festem Spawn samt Kurs (`ShowcaseLocation.spawn`) drehen das
Portal wieder so (`LocationFacadeService.addSpawnPoint`, nach dem Bau der Route). URLs und
Favoriten ohne Kurs (auch alle von vor 2026-09-14) folgen der Route. Ein HQ-Umzug verwirft den
Kurs, die Route entsteht neu; Zuletzt gespielt und die Weltkarte speichern nur Koordinaten, ein
Ort von dort folgt ebenfalls der Route.

## Drehbereich

Die Drehung reicht nur so weit, wie die Gegner noch durch die Öffnung hinausgehen
(`portalTurnRange`, `clampPortalHeading`, Playtest 529): die Route und die äußersten Spuren
(`portalLaneOffset`, so weit neben der Route, wie der Korridor am Start einen Gegner laufen
lässt, `lateralLimit`) bleiben bis zur vorderen Fläche zwischen den Pfeilern, mindestens
`PORTAL_TURN_CLEARANCE` (0,5 m) von ihnen entfernt, und vor der hinteren Fläche. Eine Drehung
darüber hinaus steht an der Grenze, bei jedem Neubau der Route neu gegen sie geprüft, auch ein
Kurs aus URL, Favorit oder Showcase, dessen Route sich seither geändert hat; gespeichert bleibt
der Kurs, wie er gegeben wurde.

Auf einer geraden Straße sind das 10,5° zu jeder Seite bei 6 bis 8 m Korridor, 7° bei 12 m, 6°
bei 14 m; ab 16 m (breiter als die größte Öffnung samt Abstand) keine. Auf einem Kreisverkehr
(15 m Radius, 9 m Korridor) ungleich, 7,4° zur einen und 9,6° zur anderen Seite.

## Verdeckung der Gegner

`spawn-portal-frame.spec.ts` prüft am echten Asset mit Strahlen rundum von den gemessenen Körpern
aller Bodengegner (Bounding Box mal Skala, Mech und Tank bis 9,3 m lang): bei Skala 1 und 1,75
alle verdeckt, bei Skala 0,75 (Gasse) sind Mammoth, Mech, Stone Golem und Wallsmasher breiter
oder höher als das Tor. Der Drache ist breiter als jede Öffnung und bis Skala 1 höher.

**Lufteinheiten** einer Welle kommen ebenso heraus (`utils/air-portal-exit.ts`,
`AIR_PORTAL_EXIT`): Körpermitte auf der Mitte der Öffnung (`PORTAL_OPENING_HEIGHT` × Skala / 2
über dem Boden, Körper aus der VAT-Messung; höher als die Öffnung: auf dem Boden), waagrecht bis
8 m hinter die vordere Fläche (`holdPastFront`), dann über 30 m Route (`climbDistance`) mit
Smoothstep auf ihre Flughöhe. Die Höhe folgt der geflogenen Strecke, bei jeder Timescale gleich;
sie steht je Gegner in `Enemy.heightOffset`, das alle Leser nehmen. Debug-Spawns und
Split-Kinder starten auf Flughöhe. Die Air-LOS der Tower tastet weiter nur die Flughöhe ab
(`getAirTargetY`), auf den ersten 43 bis 47 m liegt die echte Höhe darunter.

## Look

Die Leere ist ein langsamer Wirbel auf fast schwarzem Grund, dunkelrot glimmend, violett in den
Tälern, stumpfes Orange nur an den heißesten Stellen, das Auge in der Mitte schwarz. Glutpunkte
steigen im Shader auf, ohne Partikel. Die Spawnfarbe tönt nur den Rand, die Sigillen und das
Straßenlicht. Farben in `SPAWN_PORTAL_LOOK.palette`, Maße in `configs/marker-geometry.config.ts`
(Intro-Flug und Totale lesen sie von dort).

## Rahmen (Asset)

`spawn-portal-frame.ts` lädt ein Asset, `public/assets/models/structures/spawn_portal.glb`,
gebaut und gebacken von `tools/blender/spawn_portal.py` (Blender, headless oder über das MCP).
7 151 Dreiecke, 2,6 MB: Basisfarbe und Normal-Map 2048 px JPEG, Verdeckung/Rauheit/Metall
1024 px JPEG, Emissive-Daten 1024 px PNG (R Glühmaske der Sigillen: weich über jede Zelle, wie
viel der Sigille noch glühen kann, weniger wo sie abgewittert oder verrußt ist; G Strichfolge 0
bis 1 je Sigille; B glühende Risse und die Rinne am First).

Ein Doppeltor um das Volumen: vorn und hinten je ein Tor aus Pfeilern, Sturz, Gesims und Krone,
2,6 m tief, seine Außenseite 0,3 m vor der Fläche der Leere; dazwischen niedrigere Seitenwände
und ein Satteldach mit einer glühenden Rinne am First unter eisernen Gittern, Spitzen entlang des
Firsts und an den Traufecken. Seitenwände und Traufe (12,6 m) sind so bemessen, dass der
breiteste und höchste Bodengegner (Stone Golem, 12,6 m breit, 12,4 m hoch) darin verschwindet.
Krone und große Hörner mit Eisenringen stehen auf dem vorderen Tor, das hintere trägt eine
kleinere Krone und Eckspitzen. Stein dunkel graubraun, kein Schwarz, Ton je Block, hellere
abgeriebene Kanten, Abplatzer, Ruß und Brandspuren um die Öffnung, Verwitterung auf den
Deckplatten; Kronenspitzen aus mehreren Ringen mit Rillen, Brüchen und Ruß zur Spitze.

`MarkerVisualizationService` lädt das Asset einmal über den `AssetManagerService` und gibt es
jedem `SpawnPortalManager` (`setFrame`); bis es da ist oder wenn es nicht lädt, stehen nur die
zwei Flächen der Leere, die das Volumen vorn und hinten schon schließen.

`spawn-portal-frame.spec.ts` liest das GLB und prüft Maße, freie Öffnung, Flächen nach außen,
saubere Tangenten, die vier Texturen, jede Sigille auf genau einem Stein und das Volumen. Das
Layout (Öffnung, Tiefe, Sigillen samt Pose je Zelle) liest das Skript aus
`tools/blender/spawn_portal_layout.json`, das `tools/blender/spawn-portal-layout.spec.ts` bei
`npm test` aus den Configs schreibt; ändert sich die Datei dabei, braucht das Asset einen neuen
Bake.

## Licht

Licht gefakt, die Tiles nehmen keins, die Lichter der Szene erreichen auch den Rahmen nicht: Tag
und Abend ändern im Spiel nur die Umgebung. Der Tor-Shader rechnet in linearem Licht und kodiert
seine Ausgabe selbst (`colorspace_fragment`): die Basisfarbe ist eine sRGB-Textur, die die GPU
beim Lesen dekodiert. Ohne die Kodierung kam der Stein beim Rendern direkt auf den Canvas (Bloom
und Color Grading aus, der Standard) mehrfach zu dunkel an, mit Bloom dagegen heller; so war es
bis zum Playtest 2026-09-13 abends.

Hauptlicht fest in der Welt, umhüllt (eine abgewandte Fläche behält ihr Relief), Himmel, das
dunkelrote Licht des Kerns vom nächsten Punkt der Volumenachse, alles auf der Normal-Map, dazu die
gebackene Verdeckung und Glanzlichter auf Obsidian und Eisen. Die Leere ist in Anzeigewerten
gebaut und wird vor der Kodierung zurückgewandelt, sie sieht mit und ohne Nachbearbeitung gleich
aus. Helligkeit über `SPAWN_PORTAL_LOOK.frameExposure` (Verstärkung der Basisfarbe, 1,15) und
`frameGlints`.

**Kosten:** je Rahmenpixel vier Texturzugriffe; in einer Sigillenzelle dazu das Distanzfeld der
einen Sigille (6 bis 12 Teile) und drei Noise-Abfragen. Die Texturen belegen mit Mipmaps etwa
53 MB GPU-Speicher; weiter zwei Draw Calls für alle Portale.

## Sigillen

`spawn-portal-sigils.ts`: ein fester, von Hand gesetzter Satz von zehn fiktiven okkulten Siegeln
aus Bögen, Punkten, kleinen offenen Ringen und Sicheln, in das Asset graviert. Keins steht in
einem Rand oder füllt eine runde Plakette: jedes ist eine lose, schiefe Gruppe um ein großes
Zeichen (Sichel, Orbit mit Knoten, Schwung, Spiralfragment), aus der Zellmitte gerückt. Sie
laufen als Fries um die Öffnung (links hinauf, über den Sturz, rechts hinab, vorn und hinten);
Zelle k zeigt Sigille `(3 k) mod 10`, jede Zelle dreht (±30°), skaliert (0,72 bis 1) und
verschiebt ihre Sigille anders (`sigilPoseForCell`). Im Stein sind sie stellenweise abgewittert,
von Rissen durchlaufen und teils unter Ruß. Ausgeschlossen sind:

- gerade Striche: keine Kreuze, Haken, Blitze oder Zickzack, keine Runen
- Buchstaben, Ziffern und alles wie echte Schrift: kein Bogen über 160° (C, U, O), kein
  einzelner Kreis, kein Kreis mit Mittelpunkt (ʘ), keine konzentrischen Kreise (◎), keine
  Punkte im Raster zwei mal drei (Braille)
- Augen (Mandel aus zwei Bögen), Tomoe und Kommas, Dreifachmond, Vesica, Sichel mit Punkt oder
  Stern in der Höhlung, nichts wie Yin-Yang
- Ränder: Bögen ab 0,25 Zellen Radius um die Zellmitte zusammen höchstens ein Halbkreis, sonst
  lesen sie sich als Drehregler, Knopf oder Lautsprechergitter
- Halbmond und Stern: keine Sichel mit genau einem freistehenden Punkt daneben; die Erosion im
  Asset lässt keinen Teil ganz verschwinden, so schrumpft keine Sigille darauf zusammen
- Logos und UI-Symbole (Steam, Teilen, Bluetooth, WLAN, Power, Radioaktiv), keine Ringe und
  Punkte beiderseits eines langen flachen Schwungs (Prozentzeichen; "drifting bodies" ist
  deshalb durch "averted moon" ersetzt)
- Triskele und Verwandtes (u. a. von rechtsextremen Gruppen genutzt): keine drei- oder
  vierzählige Drehsymmetrie um irgendein Zentrum, kein Knoten mit drei oder mehr Armen
  ("chained nodes" ist deshalb durch "tethered seeds" ersetzt: zwei Bögen mit je einem Knoten an
  beiden Enden, eine abgewandte Sichel, ein kleiner Ring)

Der Spec (`spawn-portal-sigils.spec.ts`) prüft den Aufbau (nur Bögen, Punkte, Ringe und Sicheln,
in der Zelle auch nach der Pose, schief gegen Spiegelung und Dritteldrehung, Rand, Sichel und
Punkt, Arme je Knoten, Drehsymmetrie um den Schwerpunkt und um den Mittelpunkt jedes Teils); was
sich nicht rechnen lässt (Gesichter, Buchstaben, Logos), ist beim Entwurf von Hand am
Kontaktbogen geprüft. Neue Sigillen müssen dieselben Regeln einhalten.

## Glühen und Leben der Sigillen

Gate-Shader in `spawn-portal-gate-material.ts`, Werte in `SPAWN_PORTAL_LOOK.glyphs`. Die Sigillen
glühen aus ihren Rillen, heißer Kern entlang jedes Strichs, dunkleres Blutrot am Rand, ein
schwacher Schein auf dem Stein daneben. Der Shader zeichnet sie aus dem Distanzfeld der Sigille
(`portalGlyphInk`, Pose je Zelle wie im Asset), nicht aus der Textur: nah bleiben sie scharf,
fern, wo ein Strich schmaler als ein Pixel ist, bleibt die Linie etwa anderthalb Pixel breit und
die Sigille lesbar. Die Glühmaske (R) dimmt abgewitterte und verrußte Stellen.

- **Stärke:** zwischen den Wellen eine niedrige, gut lesbare Glut (`dormant` 0,38), in der Welle
  deutlich stärker (`active` 1,2, der Kern läuft ins Orange), beim Schub eines Wellenstarts bis
  `flare` 0,8 darüber (`portalGlyphDrive`, auf der CPU aus der Energie).
- **Atem:** Jede Sigille atmet langsam und ungleichmäßig in eigenem Takt: zwei Wellen mit Rate
  und Phase je Zelle (`sigilBreathForCell`, Atem zwischen 5 und 11 s, die zweite Welle
  langsamer), dazu die Phase des Portals; sie dimmt um bis zur Hälfte, Nachbarn atmen nie im
  Gleichtakt. Entlang der Striche glühen Stücke heißer oder schwächer und wandern langsam.
- **Erwachen:** Ab und zu erwacht eine: ein ungleichmäßiges Glimmen kriecht an ihren Strichen
  entlang (Rauschen über der gebackenen Strichfolge), Stücke der Linien fangen Feuer und
  verlöschen wieder, nie eine umlaufende Front; es steigt an (1,2 s), hält (2,4 s) und sinkt
  zurück (3,2 s), an den Funken bis etwa 2,5-mal heller, mit Hitzeflimmern und Glut darüber.
  Jede Sigille bekommt Fenster von etwa 16 s und erwacht höchstens einmal darin, zwischen den
  Wellen mit 20 %, in einer Welle mit 55 %; der Schub beim Wellenstart lässt alle glimmen.
- **Uhr:** Atem und Erwachen laufen auf einer eigenen Uhr (`uGlyphTime`): Echtzeit zwischen den
  Frames, die in der Pause steht (`GameStateManager.paused`); die Zeitskala beschleunigt sie
  nicht. Wirbel, Energie und Straßenlicht laufen in Echtzeit weiter, auch in der Pause.

Alles folgt aus Zelle, Phase des Portals und Zeit, ohne Zustand auf der CPU.

## Beschwörungskreis

Glow-Shader in `spawn-portal-glow-material.ts`, Werte in `SPAWN_PORTAL_LOOK.circle`: auf der
Straße 4,6 m vor der vorderen Fläche, Radius 3,9 m: äußerer Doppelring, innerer Ring, dazwischen
alle zehn Sigillen aufrecht nach außen, in der Mitte der "haloed moon", gegenläufig. Dunkel,
dreht sehr langsam (0,02 rad/s), flammt mit dem Schub eines Wellenstarts auf. Unter Skala 1
bleibt die Tiefe bei 1 (`portalDepthScale`); der Shader misst die Tiefe darum in
Breiteneinheiten, so bleibt der Kreis rund. Aus den Distanzfeldern der Sigillen gezeichnet, ohne
Geometrie und ohne Draw Call; die Linien blenden aus, wo ein Pixel zu viel Straße deckt.

Kreis und Straßenlicht sind additives Licht in Anzeigewerten und werden zusammen für ihr Ziel
geschrieben (`displayLight`, `display-output.ts`, siehe
[ARCHITECTURE.md → Eigene Shader: Farben in Anzeigewerten](ARCHITECTURE.md#eigene-shader-farben-in-anzeigewerten-für-das-ziel-geschrieben)):
auf dem Canvas wie gebaut, mit Bloom über einer Straße von `ADDITIVE_GROUND` (0,3) gleich, über
hellerer Straße etwas schwächer, über dunklerer stärker. Allein dekodiert war der Kreis mit Bloom
über sonniger Straße kaum zu sehen (Playtest 248).
