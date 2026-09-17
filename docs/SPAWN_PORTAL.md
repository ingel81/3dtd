# Spawn-Portal

**Stand:** 2026-09-17 (ein Bogen mittig um die Ebene statt des Doppeltors; was hinter der Ebene liegt,
verwirft ein Clip in den Shadern der Gegner, der Routenlinie und des Route Grid Overlay)

Ein Steinbogen vor dem Routenstart jedes Spawns: Gegner treten durch seine Ebene heraus, der
Spieler kann ihn beim Setzen des Spawns drehen. Code in `three-engine/renderers/marker/`
(`SpawnPortalManager`, `spawn-portal-pose.ts`, `-frame.ts`, `-sigils.ts`, `-gate-material.ts`,
`-glow-material.ts`), der Clip in `three-engine/renderers/portal-clip.ts`, Maße in
`configs/marker-geometry.config.ts`, Look in `SPAWN_PORTAL_LOOK`
(`configs/visual-effects.config.ts`). Zwei instanzierte Draw Calls für alle Portale:

- **Tor** (opak): der Steinbogen und die Leere, eine Fläche in der Ebene des Portals, von vorn
  und von hinten zu sehen.
- **Glow** (additiv): das Licht auf der Straße vor und hinter der Ebene, dazu der
  Beschwörungskreis vor dem Portal.

Wo ein Spawn stehen darf und wie Ort, URL und Favoriten ihn speichern:
[LOCATION_SYSTEM.md](LOCATION_SYSTEM.md#urllocationservice). Der Auftritt eines Bosses aus dem
Portal: [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-intro).

## Ebene und Ausrichtung

Die Mitte des Portals steht auf dem Routenstart, wo `EnemyManager.spawn` jeden Gegner auf
`path[0]` setzt (dieselbe Route, die das Portal bekommt, `path-route.service.spec.ts`). Die
Ebene des Portals, die Fläche der Leere, steht `PORTAL_DEPTH / 2` davor (5,25 m bei Skala 1,
`portalFrontDistance`), der Bogen um sie herum. Ein Gegner startet damit hinter der Ebene,
unsichtbar samt Healthbar (Verdeckung, unten), und tritt durch sie heraus. Der Abstand schrumpft
bei schmalen Korridoren nicht mit (`portalDepthScale`). Bis 2026-09-17 war das Portal ein
Doppeltor um ein 10,5 m tiefes Volumen, dessen Flächen der Leere vorn und hinten Tiefe schrieben,
mit Seitenwänden und Dach; von der Seite war es zu tief. Die vordere Fläche von damals ist die
Ebene von heute, Pose, Drehbereich und Austritt der Lufteinheiten rechnen mit demselben Abstand.

Das Portal schaut dorthin, wo die Route durch seine Ebene tritt: auf den Punkt, an dem sie zum
ersten Mal so weit vom Start weg ist wie die Ebene (`spawnPortalPose`, `routeExitPoint`). Die
Route läuft so mittig durch die Öffnung hinaus, auch wenn sie in einer Kurve beginnt
(Kreisverkehr, Stummel vor einer Ecke); ein Knick näher als die halbe Tiefe am Start lässt sie
hinter der Ebene trotzdem seitlich laufen.

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
lässt, `lateralLimit`) bleiben bis zur Ebene innerhalb der Breite der Öffnung, mindestens
`PORTAL_TURN_CLEARANCE` (0,5 m) von den Pfeilern entfernt, und in der Tiefe des Clip-Raums.
Hinter der Ebene ist das strenger als nötig, der Clip-Raum ist breiter als die Öffnung; auf
einer geraden Straße entfernt sich eine gedrehte Spur aber stetig von der Mitte, die engste
Stelle liegt dort ohnehin in der Ebene. Eine Drehung darüber hinaus steht an der Grenze, bei
jedem Neubau der Route neu gegen sie geprüft, auch ein Kurs aus URL, Favorit oder Showcase,
dessen Route sich seither geändert hat; gespeichert bleibt der Kurs, wie er gegeben wurde.

Auf einer geraden Straße sind das 10,5° zu jeder Seite bei 6 bis 8 m Korridor, 7° bei 12 m, 6°
bei 14 m; ab 16 m (breiter als die größte Öffnung samt Abstand) keine. Auf einem Kreisverkehr
(15 m Radius, 9 m Korridor) ungleich, 7,4° zur einen und 9,6° zur anderen Seite.

## Verdeckung der Gegner

Was von einem Gegner noch hinter der Ebene liegt, verwirft sein eigener Shader (`portal-clip.ts`,
`PORTAL_CLIP`): je Portal ein Quader hinter der Ebene, `PORTAL_DEPTH` tief (mal
`portalDepthScale`, er reicht also so weit hinter den Routenstart wie die Ebene davor), 4,5 m
(`side`) breiter als die Öffnung zu jeder Seite, von 3 m unter dem Boden am Routenstart (`below`)
bis 20 m darüber (`top`, mal `portalDepthScale`). Ein Gegner wird genau dort sichtbar, wo sein
Körper durch die Ebene tritt, Stück für Stück. Dort leuchtet ein schmaler Saum in den Farben des
Wirbels (`SPAWN_PORTAL_LOOK.seam`): 6 cm vor der Ebene, mindestens etwa anderthalb Pixel breit,
halb zwischen `ember` und `hot` der Palette, mal 1,6. Außerhalb der Quader ändert sich nichts.
Nur Optik: Zielwahl und Schaden kennen den Clip nicht, das Portal ist Sperrzone für Tower.

- **Mit Clip:** das VAT-Material aller Gegnertypen samt Kopf, Ringen und Schwanz des Wurms (je
  Fragment, mit Saum), das Band der Ooze (je Fragment, mit Saum, dort in linearem Licht) und die
  Healthbars (je Bar im Vertex-Shader über ihre Mitte, ohne Saum: eine Bar erscheint ganz, sobald
  der Ursprung ihres Gegners durch die Ebene ist, bei den meisten Modellen die Körpermitte).
- **Routen, ohne Saum:** die rote Routenlinie (`RouteLineLayer`), die Routen-Animation
  (`RouteAnimationService`, beide `LineMaterial`, gepatcht von `clipLineMaterial`) und die Platten
  des Route Grid Overlay am Boden und in der Luft (`RouteGridAggregateViz`, `PORTAL_CLIP_DISCARD`).
  Route und Zellen reichen weiter bis `path[0]`, die Gegner laufen darauf; gezeigt werden sie nur
  vor der Ebene. Das gelbe Straßen-Overlay (OSM) und die LOS-Anzeige eines Towers bleiben ohne
  Clip.
- **Ohne Clip:** was ein Gegner auslöst, das nicht sein Körper ist: Blut- und Schleimspritzer und
  andere Decals, Frost- und Giftauren, Eiskristalle, Schadenszahlen, die Trümmer einer getöteten
  Ooze (`OozeDebrisRenderer`), die Funken des Spawns. Im Portal wird nicht direkt geschossen,
  dort entstehen sie kaum. Schatten unter Gegnern zeichnet das Spiel nicht.
- **Uniforms:** ein Objekt für alle diese Materialien (`ThreeTilesEngine.portalClip`,
  `PortalClipUniforms`): die Anzahl, je Portal die Mitte der Ebene am Boden und die Richtung
  hinaus, halbe Breite, Tiefe, Unter- und Oberkante, in Szenenkoordinaten wie Pose und Gegner
  (`geoToLocalSimple`; Routenlinie und Animation hängen wie die Portale in der Overlay-Gruppe und
  prüfen ihre eigenen Koordinaten). `SpawnPortalManager` schreibt sie beim Hinzufügen, Setzen,
  Drehen und Entfernen eines Portals (`setPortalClips`), nicht je Frame; höchstens
  `MAX_SPAWN_PORTALS` (8), so viele zeichnet er.
- **Kosten:** je Fragment eines Gegners eine Schleife über die Portale, die nach dem letzten und
  im ersten Quader endet, ohne Portal sofort, dazu ein `fwidth` für die Breite des Saums; dieselbe
  Schleife ohne `fwidth` je Fragment der Routenlinien und der Platten des Overlays.
  Early-Z hatten die Gegner schon vorher nicht, ihre Shader setzen `gl_FragDepth`
  (logarithmische Tiefe).

`spawn-portal-frame.spec.ts` prüft, dass die gemessenen Körper aller Bodengegner (Bounding Box
mal Skala, um ihren Ursprung gelegt, der Mech mit 9,3 m der längste) samt Mitte der Healthbar
beim Start ganz im Quader liegen, auf jeder Spur, die ihr Typ läuft (`lateralSpread`), bei
Skala 0,75, 1 und 1,75; `portal-clip.spec.ts` die Lage des Quaders. Der Drache (15 m Spannweite,
der Schwanz rund 8 m hinter seinem Ursprung, gemessen in der Ruhepose) passt nicht ganz: unter
etwa Skala 1,5 ragt beim Start der Schwanz hinten aus dem Quader, auf den äußeren Spuren eine
Flügelspitze seitlich, bis er ein paar Meter geflogen ist. Beim alten Doppeltor ragte er ebenso
durch die hintere Fläche und über die Seitenwände hinaus.

**Lufteinheiten** einer Welle kommen ebenso heraus (`utils/air-portal-exit.ts`,
`AIR_PORTAL_EXIT`): Körpermitte auf der Mitte der Öffnung (`PORTAL_OPENING_HEIGHT` × Skala / 2
über dem Boden, Körper aus der VAT-Messung; höher als die Öffnung: auf dem Boden), waagrecht bis
8 m über die Ebene hinaus (`holdPastFront`), dann über 30 m Route (`climbDistance`) mit
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
gebaut und gebacken von `tools/blender/spawn_portal.py` (Blender, headless mit
`--factory-startup`, sonst öffnet das MCP-Addon aus den Einstellungen einen zweiten Server, oder
über das MCP).
3 772 Dreiecke, 1,96 MB: Basisfarbe und Normal-Map 2048 px JPEG, Verdeckung/Rauheit/Metall
1024 px JPEG, Emissive-Daten 1024 px PNG (R Glühmaske der Sigillen: weich über jede Zelle, wie
viel der Sigille noch glühen kann, weniger wo sie abgewittert oder verrußt ist; G Strichfolge 0
bis 1 je Sigille; B glühende Risse).

Ein Bogen um die Ebene, dahinter nichts: Pfeiler auf zweistufigen Plinthen, Sturz, Gesims und
Krone, 2,6 m tief, mittig um die Ebene, Vorder- und Rückseite je 1,3 m davor und dahinter (bis
2026-09-17 stand die Vorderseite 0,3 m vor der Ebene). Die Ecken der Plinthen liegen damit bis
10,54 m vom Routenstart (`PORTAL_RADIUS` 10,6 statt 10). Rauschfelder und Nietabstand liest das
Skript 1 m weiter hinten (`LOOK_BACK`), wo sie vor dem Umzug lagen: Die Steine behielten ihre
Töne. Krone,
große Hörner mit Eisenringen und Spitzen stehen auf dem Gesims; Sigillen und Eisenklammern trägt
der Bogen vorn und hinten. Bis 2026-09-17 ein Doppeltor mit Seitenwänden und Satteldach um das
Volumen (Ebene und Ausrichtung, oben). Stein dunkel graubraun, kein Schwarz, Ton je Block,
hellere abgeriebene Kanten, Abplatzer, Ruß und Brandspuren um die Öffnung, Verwitterung auf den
Deckplatten; Kronenspitzen aus mehreren Ringen mit Rillen, Brüchen und Ruß zur Spitze.

`MarkerVisualizationService` lädt das Asset einmal über den `AssetManagerService` und gibt es
jedem `SpawnPortalManager` (`setFrame`); bis es da ist oder wenn es nicht lädt, steht nur die
Fläche der Leere, die Gegner verbirgt der Clip auch dann.

`spawn-portal-frame.spec.ts` liest das GLB und prüft Maße, freie Öffnung, dass der Bogen vor dem
Routenstart mittig um die Ebene steht, Flächen nach außen, saubere Tangenten, die vier Texturen und
jede Sigille auf genau einem Stein, vorn und hinten. Das Layout (Öffnung, Tiefe, Sigillen samt
Pose je Zelle) liest das Skript aus `tools/blender/spawn_portal_layout.json`, das
`tools/blender/spawn-portal-layout.spec.ts` bei `npm test` aus den Configs schreibt; ändert sich
die Datei dabei, braucht das Asset einen neuen Bake.

## Licht

Licht gefakt, die Tiles nehmen keins, die Lichter der Szene erreichen auch den Rahmen nicht: Tag
und Abend ändern im Spiel nur die Umgebung. Der Tor-Shader rechnet in linearem Licht und kodiert
seine Ausgabe selbst (`colorspace_fragment`): die Basisfarbe ist eine sRGB-Textur, die die GPU
beim Lesen dekodiert. Ohne die Kodierung kam der Stein beim Rendern direkt auf den Canvas (Bloom
und Color Grading aus, der Standard) mehrfach zu dunkel an, mit Bloom dagegen heller; so war es
bis zum Playtest 2026-09-13 abends.

Hauptlicht fest in der Welt, umhüllt (eine abgewandte Fläche behält ihr Relief), Himmel, das
dunkelrote Licht des Kerns vom nächsten Punkt der Achse der Öffnung zwischen 1 m vor und 1 m
hinter der Ebene (`coreReach`, so fangen Vorder- und Rückseite des Bogens es gleich), alles auf der
Normal-Map, dazu die gebackene Verdeckung und Glanzlichter auf Obsidian und Eisen. Die Leere ist
in Anzeigewerten gebaut und wird vor der Kodierung zurückgewandelt, sie sieht mit und ohne
Nachbearbeitung gleich aus. Helligkeit über `SPAWN_PORTAL_LOOK.frameExposure` (Verstärkung der
Basisfarbe, 1,15) und `frameGlints`.

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
Straße 4,6 m vor der Ebene, Radius 3,9 m: äußerer Doppelring, innerer Ring, dazwischen
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
