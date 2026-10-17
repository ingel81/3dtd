# Karteneditor

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Kartendokument: [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

Unter `/editor` baut man eigene Karten: Gelände, Bodentexturen, Wasser, Objekte, Straßen, Spawns und HQ. Eine Karte
liegt im Browser (IndexedDB; in der Desktop-App zusätzlich als Datei in `Dokumente/3DTD/Maps`, [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) E26b), lässt sich als `.3dtdmap` herunterladen und wieder einlesen und mit „Test map“ im Spiel
öffnen (`?world=map:<id>`). Der Einstieg im Hauptmenü ist „Map editor“ (Lage Start, unter der Linie; mit laufendem Lauf
fragt das Menü vorher). Die Oberfläche ist englisch wie das übrige Spiel.

Spiel und Editor stehen seit E195 Phase 4 im selben Fenster (`AppShellComponent`, `world/app-screen.service.ts`,
[WORLDS_NAVIGATION_PLAN.md](WORLDS_NAVIGATION_PLAN.md)): „Map editor“, „Edit“ in der Kartenwahl und „Edit this map“
öffnen ihn ohne Neuladen. Die Kartenliste trägt oben den Pfad `Worlds › Built Worlds › Map editor` mit den Chips und
einen Rückweg (Knopf mit Esc, E219): mit wartendem Lauf „Back to the run“, sonst dorthin, woher der Editor kam
(`WorldsStageService.editorExit`, `leaveEditor`): Globen oder Weltmenü, aus denen er geöffnet wurde; eine Welt, die für
den Editor offen blieb (Spiel ohne Lauf, Probespiel), schließt ins Menü ihrer Welt mit ihrer Karte oder ihrem Ort
gewählt, statt im Hintergrund neu zu starten. Esc geht vorher eine Ebene zurück (Rückfrage, Import, Formular New map,
Rahmen eines echten Orts). In einem Coop-Raum (Lobby oder Spiel) bleibt der Weg in den Editor gesperrt, sichtbar
mit „Leave the coop room to edit“ (Pfad, Pausemenü, Startliste, Game over; `MainMenuService.editWhy`, `whyNot('edit')`):
der Editor nähme das Spiel samt Raum mit. `/editor` (mit `?map=<id>`) bleibt Einstieg für
Entwicklung und AI-Agenten; die Route nennt nur, was zuerst steht, danach ändert kein Wechsel die Adresse. Die
`EditorSession` hängt am Fenster, nicht an der Editor-Ansicht: zeigt das Spiel, gehen Ansicht, Renderer und Canvas des
Editors, die offene Karte und ihr Verlauf bleiben (vorher gespeichert; scheitert das, bleibt der Editor).
Ein laufender Lauf endet dabei nicht (Entscheidung 2 des Plans): zwischen den Wellen schreibt das Menü sofort den
Autosave seiner Welt (`SaveGamePort.autosaveNow`), in einer Welle gilt der Autosave vom Anfang dieser Welle; ohne
einen von beiden endet er, und die Rückfrage sagt das. „Back to the run“ in der Kartenliste öffnet seine Welt wieder
und lädt den Autosave dort (`AppScreen.waitingRun`, `WorldSession.backToGame`).

## Kartenliste

Die Startseite von `/editor` zeigt links die eigenen und die mitgelieferten Karten (Bild, Größe, Spawns, Objekte,
zuletzt geändert), rechts die gewählte mit Beschreibung und den Knöpfen Open, Duplicate, Download, Delete (in den
Papierkorb, siehe [Speichern](#speichern-und-dateien)). Mitgelieferte Karten (`public/maps/index.json`) und Karten eines Koop-Hosts sind schreibgeschützt: „Copy
and edit“ legt eine eigene Kopie an und öffnet sie. Dasselbe gilt für jeden anderen Weg dorthin, etwa „Edit“ in der
Kartenwahl des Spiels: `MapLifecycle.open` öffnet nie das Original, sondern speichert sofort eine eigene Kopie
(„Name (copy)“) und sagt das in der Statuszeile. Die Kopie merkt sich ihr Original mit dessen Inhalts-Hash (`meta.copyOf`, nicht
Teil des `contentHash`); ein weiteres „Edit“ desselben Originals öffnet die neueste eigene Kopie wieder. Hat sich das
Original seither geändert (Spiel-Update, neue Version des Hosts, verglichen über `index.json` bzw. die Zusammenfassung,
ohne die Datei zu laden), bietet ein Banner „Fresh copy“ (neue Kopie, die alte bleibt) oder „Open your copy“.

- **New map:** Name, Autor, Größe (Small 512 m, Medium 1024 m, Large 2048 m, Wide 2048 x 1024 m), Vorlage oder Boden
  (Flat, Hills, Valleys, Islands, Canyon, Terraces mit Seed und Stärke, siehe [Generator](#gelände-generator)) mit
  Grundmaterial. Eine Vorlage (Meadows, Woods, Mountains, Swamp, Desert, Arctic, City, Hell, Wasteland, Moon, Mars)
  legt Gelände aus dem Generator an, malt die ganze Karte mit ihrem Biom (Boden, Relief, Becken, Objekte) und setzt
  Himmel, Licht, Nebel, Tönung und Wetter; das Biom läuft in Bändern über die Karte (`biomeBand`). Jede neue Karte hat
  die Detailstufe der mitgelieferten Level, ohne Wahl: Höhenpunkte alle 2 m (`DEFAULT_CELL_SIZE`) und die Bodenfarbe
  mit etwa einem Texel je Meter, höchstens 1024 px (`splatResolutionFor`). „Meadows“ auf 1024 m braucht vom Klick bis
  zum offenen Editor 1,8 bis 2,7 s (mit 4 m waren es 0,9 bis 1,6 s; Chromium, RTX 5080, 2026-10-14). Jede neue Karte hat eine Straße von West zum HQ und einen Spawn an ihrem Ende, damit sie sofort
  spielbar ist; der Generator ebnet die Straße und legt sie, wo sie unter Wasser liefe, auf einen Damm.
  Während des Anlegens steht der Stand in der Knopfzeile des Formulars („Painting the land 40 %“, dann „Opening the
  editor“), das Formular bleibt bis zum Wechsel gesperrt und springt nicht (früher schob eine eigene Zeile dafür die
  Liste über die Höhe, ein Rollbalken kam und ging und die Vorlagen sprangen von sechs auf fünf Spalten und zurück);
  bis die Ansicht ihre Programme übersetzt hat, steht dort „Preparing the view“; bis dahin zeichnet die Ansicht
  nichts (vorher stand gut eine Sekunde der grüne Ersatzboden, bevor die Bodenfarben da waren), ein neu gebauter
  Boden (Größe geändert, Kontext zurück) behält bis dahin das letzte Bild
- **New map, From a real place:** der zweite Start neben „A landscape“: Ortssuche, dann derselbe Rahmen wie im Menü
  (flache Karte mit dem 2,4-km-Quadrat, HQ, ziehbare Spawns, „Make the map“); die erzeugte Karte ist schon gespeichert
  und öffnet sich im Editor. Ablauf und Regeln in [OSM_WORLD_PLAN.md](OSM_WORLD_PLAN.md#phase-o2-gebaut-2026-10-15)
- **Import file:** `.3dtdmap` oder `.w3x` per Dateiwahl oder per Ablegen auf der Seite. Ein Warcraft-3-Import fragt
  erst nach Metern je Kachel (4), höchstens Objekten (6000), „Playable area only“, „Enhance ground“ (Boden nach
  Spielrolle neu malen, aus: Kacheln wie im Original) und „Take the map's waves“ (die Wellen der Karte als eigene
  Wellenliste, [W3X_IMPORT.md](W3X_IMPORT.md#wellen-option-waves)), läuft dann im Web Worker
  ([W3X_IMPORT.md](W3X_IMPORT.md)) und zeigt den Bericht: Größe, Bodenschichten, Wasser, woher die
  Straßen kamen, Spawns und Spurlängen, übernommene Doodads, Warnungen; „Open the map“ öffnet sie. Die Karte landet bei den eigenen
- **Erneuter Import:** jede eigene Karte bekommt beim ersten Speichern eine dauerhafte Kennung (`meta.uid`, UUID;
  nicht Teil des `contentHash`), die in jede `.3dtdmap` mitgeht; eine Kopie (Duplicate, Kopie einer mitgelieferten
  Karte) bekommt eine neue. Liest man eine Datei ein, deren Kennung eine eigene Karte trägt (bei Warcraft-Importen:
  dieselbe `.w3x`-Datei), fragt die Liste „Replace“ oder „Keep both“: Replace legt den Inhalt an die Stelle der Karte
  (Kennung, `id` und Anlagezeit bleiben, also auch ihre Versionen; der alte Inhalt wird eine Version), Keep both legt
  die Datei als neue Karte mit eigener Kennung daneben
- Die Adresse trägt die offene Karte nicht mehr; Neuladen öffnet die Karte, die dieser Tab offen hatte
  (sessionStorage `3dtd-editor-map`), `/editor?map=<id>` öffnet eine Karte beim Start

## Bedienung

| Eingabe | Wirkung |
|---------|---------|
| Linke Maustaste | Werkzeug (halten bei Pinseln) |
| Rechte Maustaste ziehen | Ansicht drehen |
| Rechte Maustaste halten + W A S D, Q E | Fliegen: vor, zurück, seitwärts; Q E senken und heben; Shift schneller |
| Mittlere Maustaste ziehen, Shift + rechte | Ansicht verschieben |
| Mausrad | Zoom zum Punkt unter dem Zeiger |
| Pfeiltasten | Ansicht verschieben |
| F | Auswahl ins Bild holen, ohne Auswahl die ganze Karte |
| T | Draufsicht an und aus |
| C | Spielansicht: die Startansicht des Spiels über dem HQ (70 Grad, 60 Grad Bildwinkel), noch einmal C zurück |
| B | Standbild: Wind in Pflanzen und Gras, Wasser- und Lavafluss, Wasserfälle, Wolken, Wetter, Partikel und Flammen stehen still, damit man ein ruhiges Bild ansehen kann; noch einmal B lässt sie laufen. Aus beim Öffnen des Editors, nur die Ansicht des Editors (`CustomMapView.setAnimationPaused`), das Spiel nie; auch als Knopf in der Legende und, solange es an ist, neben „Controls“ |
| P | Probewelle: die Gegner laufen die Routen ab (auch der Knopf „Trial wave“) |
| + und - (auch =) | Probewelle schneller, langsamer: 1x, 2x, 4x, 8x, solange sie läuft (nicht umlegbar) |
| Strg+K | Befehle: Werkzeuge, Pinsel, Biome, Ansichten, Symmetrie, Marker und die Objekte der Karte nach Namen |
| 1 bis 9, 0, G, D, N | Werkzeug: Landscape, Terrain, Paint, Water, Objects, Roads, Spawns and HQ, Sky and weather, Map, Copy and stamps, Rules, Measure, Life |
| M | Symmetrie reihum: aus, Mirror X, Mirror Y, Both, Turn 2, Turn 4 (auch oben in der Kopfleiste) |
| Alt+1 bis 9 (Strg+Ziffer, wo der Browser sie lässt) | Kamera-Ansicht merken; Shift+Ziffer fliegt hin; die Knöpfe 1 bis 9 unter der Minikarte ebenso (Alt-Klick merkt) |
| ? | Übersicht aller Tasten; unter „Your keys“ lassen sich die Einzeltasten (Werkzeuge, F, T, C, B, P, V, M) umlegen, gespeichert in `3dtd-editor-keys`. Die Übersicht liest die umlegbaren Tasten aus derselben Belegung, die die Tasten auswertet. Die festen Tasten der Werkzeuge (W E R L Q, Q H, S X J, R; `EditorTool.fixedKeys`) nimmt keine Aktion: die Statuszeile sagt, wem die Taste gehört; eine früher so gespeicherte Belegung fällt beim Laden weg. Ein Tausch mit einer anderen Aktion steht ebenfalls in der Statuszeile |
| [ und ], Strg+Mausrad | Pinsel kleiner, größer; { und } Stärke |
| Strg+Z, Strg+Y (Strg+Shift+Z) | Rückgängig, Wiederholen |
| Strg+S | Speichern mit neuem Vorschaubild |
| V | Prüfen (außer im Objektwerkzeug) |
| Esc | Halbfertiges abbrechen, Auswahl aufheben; ist beides nicht da, zurück zu Look |

Die Steuerung folgt Unity und Unreal, nicht dem Spiel: die linke Taste gehört immer dem gewählten Werkzeug, die Ansicht
bewegen die anderen Tasten (Entscheidung 2026-10-11). Eine Legende unten rechts in der Ansicht zeigt das ständig
(schließbar, `localStorage` `3dtd-editor-legend`), der erste Schritt der Tour erklärt es.

Die Paletten zeigen gerenderte Bilder: Objekte mit ihrem Modell schräg von oben, Bodenmaterialien als beleuchtete
Kugel, Biome als kleines Stück Boden mit ihren Pflanzen. Ein kleiner eigener Renderer zeichnet sie im Hintergrund und
hebt sie in IndexedDB (`3dtd-editor-thumbs`) auf; bis ein Bild fertig ist, steht ein gezeichnetes Symbol.

Die linke Leiste zeigt jedes Werkzeug mit Symbol und Namen: oben allein Look, darunter drei Gruppen: Shape (Landscape, Terrain, Paint, Water,
Objects, Life), Play (Roads, Spawns, Rules) und Map (Sky, Map, Stamps, Measure). Rechts stehen zwei Reiter: die Optionen des
Werkzeugs und die Gliederung; ein Werkzeug zu wählen zeigt seine Optionen. Die rechte Spalte lässt sich an ihrer
Innenkante breiter und schmaler ziehen (320 bis 680 px, anfangs 340; Pfeiltasten auf der fokussierten Kante, Doppelklick
setzt zurück, gemerkt in `localStorage` `3dtd-editor-side`), die Ansicht passt sich an. Lange Beschriftungen brechen
um, keine Spalte scrollt seitwärts. Werkzeuge mit Modi (Landscape, Terrain,
Water) zeigen sie gruppiert als Knöpfe und darunter, was der gewählte tut. Unter der Minikarte stehen nur gemerkte
Ansichten, „+ Keep view“ merkt die aktuelle. Eine neue Karte startet mit der Vorlage Meadows; „Empty“ ganz hinten
fragt nach Boden und Material. Paint legt eine neue Schicht über „+ Add a ground“ aus einer Palette mit Bildern an,
nach Landschaft gruppiert. Der Editor hält die Luft bis zur Kameraentfernung klar (`setClearAir`), damit die Übersicht
über die ganze Karte nicht im Dunst liegt.

Der Reiter History listet den Verlauf, neuester Schritt oben: „Opened“ (die Karte wie geöffnet), jeder getane
Schritt mit seinem Namen, die zurückgenommenen gedimmt; ein Klick springt dorthin, so viele Rückgängig oder
Wiederholen auf einmal (`EditorDocument.jumpTo`, ein Sprung wartet wie diese während Strich, Drag oder Job). Auch
über Strg+K („History: jump to a step“).

Die Gliederung (Reiter Outline) hat eine Suche und zeigt Marker, Straßen, Objekte nach Kategorie und Asset (ein Klick
wählt alle eines Assets; das Auge blendet eine Kategorie in der Ansicht aus, die Karte behält sie), Gruppen, Boden und
Gewässer.

Jeder Pinsel hat Größe (1 bis 200 m), Stärke und Weichheit (Anteil des Radius, der ausblendet). Der Ring auf dem Boden
zeigt Größe und den harten Kern.

**Einstieg.** Beim ersten Öffnen einer Karte führt eine Tour in 24 Schritten durch den Editor (`ui/shell/tour.ts`):
Ansicht, die Werkzeugleiste, dann jedes Werkzeug in der Reihenfolge der Leiste (Look, dann Landscape bis Measure; der Schritt
wählt das Werkzeug, sein Panel steht rechts), die Reiter Outline und History, Minikarte und gemerkte Ansichten,
Symmetrie, Speichern und File, Strg+K und Hilfe, zuletzt Check, Probewelle (mit ihrer Geschwindigkeit) und Test map.
Jeder Schritt sagt kurz, was der Teil tut und wie man ihn benutzt, und legt einen Ring um seinen Knopf (`target`, ein
CSS-Selektor; fehlt das Element, kein Ring). Ein Schritt geht von selbst weiter, wenn man tut, was er sagt (ein
Landschaftsstrich, eine Straße, ein Spawn, der Check, die Probewelle, der Test), sonst mit „Next“; „Back“ geht zurück,
„Skip the tour“ beendet sie. Danach kommt sie nicht mehr von selbst (localStorage `3dtd-editor-tour`: `done` oder
`skipped:<Schritt>`). Die Hilfe (?) startet sie neu („Start the tour“) und setzt eine übersprungene am Schritt fort,
an dem man sie beendet hat („Resume the tour (N/24)“); Strg+K kennt beides. Die Schritte der Werkzeuge stehen in
`TOOL_TOUR`, einem Eintrag je Werkzeug; ein neues Werkzeug bekommt dort seinen Schritt und erscheint an seinem Platz
in der Leiste (`tour.spec.ts` verlangt einen je Werkzeug der Leiste). Die Hilfe hat neben den Tasten die Seite „Good levels“: Weglänge, Engstellen, Bauflächen,
Sichtlinien, Spurzahl und Testen, jeweils mit einem Knopf, der das passende Werkzeug öffnet. Kann eine Karte nicht
gespeichert werden, sagt ein Banner im Editor, was passiert ist, dass die Änderungen noch da sind und was zu tun ist.

## Werkzeuge

**Look (Esc).** Das neutrale Werkzeug: jede Karte öffnet damit, und Esc kommt dorthin zurück, sobald kein Strich,
Ziehen, halber Weg, Rampenanfang, Messpunkt oder Stempel mehr offen und nichts gewählt ist (erst bricht Esc das ab
und hebt die Auswahl auf, wie in jedem Werkzeug; `EditorTool.cancel` sagt, ob es etwas gab). Ein Klick wählt, was
unter dem Zeiger steht (ein Objekt mit seiner Gruppe, Strg+Klick allein; Spawn, HQ, Straße, Knoten), und nennt es in
der Statuszeile; ein Ring zeigt das Objekt unter dem Zeiger. Nichts bewegt sich, nichts wird gemalt oder gesetzt,
Entf und die Gizmo-Tasten wirken nicht. Das Panel zeigt das Gewählte (was, wie viele, wo) und „Edit with …“, das
das passende Werkzeug öffnet (Objects im Modus Select, Roads im Modus Edit, Spawns and HQ). Ein Klick auf freien Boden beschreibt die Stelle (`describeGround`): vorherrschende Bodenschicht, Höhe, Neigung, Wasser darüber mit Tiefe, Lage; „Edit with Paint“. Ob dort Tower stehen dürfen, zeigt weiter das Overlay Build areas (das rechnet ein Worker). Look hat keine
umlegbare Taste (Esc ist keine Einzeltaste, die man vergeben könnte).

**Landscape (1).** Landschaft malen: Höhe, Bodenfarbe, Wasser und Objekte entstehen gemeinsam, jeder Strich ist
ein Schritt im Verlauf. Jeder Strich hat einen Seed (im Panel und in der Statuszeile, „Roll“ würfelt, der Schalter
würfelt nach jedem Strich neu); derselbe Seed und derselbe Strich ergeben dieselbe Landschaft.
- Biome: Meadow, Forest, Autumn wood, Pine forest, Rocks, Mountains, Swamp, Desert, Beach, Snow, Arctic, Village, City,
  Hell, Wasteland, Moon, Mars. Autumn wood malt Herbstbäume auf Laub mit Laubhaufen, braunen Pilzen und roten Büschen am
  Rand (die roten Fliegenpilze nicht, sie stehen in `DANGER_LOOK`). Halten malt; die Stärke bestimmt Dichte und Ausprägung, der Rand franst aus. Unterholz, Büsche und Zäune
  wachsen am Rand des Strichs, Bäume und Häuser innen; eine Objektart mischt alle ihre Kandidaten aus dem Katalog.
  Objekte meiden Straßen, Wasser, Spawns und HQ; der Boden unter Straßen bleibt. Sumpf, Hölle und Arktis legen Becken
  an, gefüllt mit einem eigenen Gewässer der Art Swamp, Lava oder Ice knapp unter dem Boden am Startpunkt (ein
  vorhandenes derselben Art bis 2 m tiefer wird mitbenutzt, ein höheres nie: sein Wasser stünde über dem Land). Becken
  entstehen nur, wo das Land auf ihrem Spiegel bis 2,5 m darüber liegt (tiefer hinge das Wasser in der Luft, höher wäre es
  ein Schacht), ihr Rand bleibt über dem Spiegel, und wo das Land daneben trotzdem tiefer liegt, läuft es ab
  (`drainSpills`): ein Strich über einen Hang füllt nur die Becken in der Höhe seines Startpunkts. Beach arbeitet auf das
  Wasser zu, das dem Startpunkt des Strichs am nächsten liegt (bis 150 m, See, Meer oder Fluss,
  `LandscapeContext.coastLevel`): unter dem Wasser eine flache Bank (halbe Tiefe), darüber ein Strand, der mit dem Abstand
  vom Wasser sanft steigt (Abstandsfeld zur Küste, `coastDistance`: 0,3 m an der Wasserlinie, 1,5 m nach 24 m), was
  höher stand, wird darauf abgetragen; dahinter steigt das Land höchstens 0,25 m je Meter (keine Abbruchkante), ab 48 m
  bleibt es, wie es war, und zum Rand des Pinsels läuft der Abtrag aus (Relief `shore`); niedrige Dünen hinten am Strand; nasser Küstensand auf der Bank unter dem Wasser
  und bis 0,35 m darüber (`waterline`, nur bei echtem Wasser), sonst Sand mit Flecken von Kiessand (drei
  Bodenschichten). Unter dem Wasser und bis 0,7 m darüber malt der Pinsel überall, wo er hinreicht, mit voller Stärke,
  auch an seinem ausgefransten Rand: sonst blieb dort die erste Schicht (Gras) direkt am Wasser. Eine lockere Reihe
  Bäume hinter den Dünen (Palmen auf Karten mit warmem Look: Wüste, Mars, Hölle, `mapClimate`; Strandkiefern auf allen
  anderen), Treibholz und Kiesel in ihrem Band über dem Wasser, dichtes Dünengras (Objekte mit `above` und `climate`;
  die Bäume zuerst, das Gras ließe ihnen sonst keinen Abstand). Ein Level-Skript setzt den Look vor dem Strich. City legt ein Straßenraster fest auf die Karte (alle 64 m, Asphalt und Gehwege), Häuser stehen an
  den Blockrändern zur Straße gewandt, Laternen auf den Gehwegen; Hell legt Glutrisse über den Boden; Wasteland und
  Moon haben Kraterfelder. Mars mischt hellen Staub mit Dünen, ockerfarbenen Kies und dunklen Basaltsand, Ocker an
  steilen Hängen, dazu rostige, graue und schwarze Steine. Sind die zwölf Bodenschichten voll, macht der Strich Platz (`makeRoom`): eine Schicht, die schon vor dem Strich da war und die kein Boden mehr hält (überall übermalt, höchstens 4 von 255), nimmt das neue Material; sonst malt die Schicht, die ihm am nächsten aussieht (gemeinsamer Katalog-Tag zuerst, dann die mittlere Farbe), an seiner Stelle. Die Statuszeile nennt, was wohin ging; ein Undo stellt die Liste mit zurück. Die Levelskripte lassen ein solches Material weiter weg (`leftOut`). Unter dem Zeiger zeigen Punkte, wo der nächste
  Strich Pflanzen setzen würde
- Mountain (gratige Gipfel, Höhe nach Größe und Stärke), Valley, Plateau (Tafel mit steilem Rand), Crater (Schüssel mit
  Wall am Startpunkt des Strichs; die Schüssel hängt am mittleren Boden ihres Walls, der Wall steht rundum mindestens
  so hoch: auf einem Gipfel oder Hang entsteht ein geschlossenes Becken, das Wasser oder Lava bis zum Rand hält), Dunes (runde Kämme quer zum Wind, flache Luv-, steile Leeseite), Erode (Regen gräbt
  Rinnen und Schuttfächer). Halten lässt die Form bis zu ihrer vollen Größe wachsen, nicht darüber hinaus
- Cliff rocks: gehalten über steilem Boden (steiler als der Klippenwinkel, höchstens 45 Grad) stehen Klippenmodelle des
  Katalogs entlang der Kante (`ops/landscape/cliff-rocks.ts`): auf einem Raster von Stellen alle 4 m, je Strich einmal
  entschieden; die Breite läuft längs der Höhenlinie, die Front zur tiefen Seite, die Größe folgt dem Gefälle über
  die Modelltiefe (0,5- bis 1,8-fach), die Wand steht vom Fuß des Gefälles (dem tiefsten Boden davor, leicht
  eingesenkt) bis etwa zu seiner Kante, mit etwa halber Breite Abstand zueinander, nicht auf Straßen und nicht im
  Wasser. Die Modelle wählt der Look der Karte (Sandstein in der Wüste, Basalt in Hölle und Endzeit, Mars-Klippen
  und die rote Felsfläche `cliff-face-red` in derselben Färbung auf dem Mars, sonst die grauen Felswände und
  Felsflächen; je Look nur Modelle derselben Färbung, die Küstenklippe und die rote Felsfläche für rote Wüsten und die
  Hölle nur über das Panel) oder das Panel. Die Klippenmodelle sind geschlossen (`close_shell` in
  `tools/map-assets/blender_kit.py`), von oben und hinten Fels statt Loch
- Glow cracks: der Boden bricht in ein Netz feiner Lavarisse mit Kruste auf verbranntem Fels; die Risse sinken etwas ein.
  Glühende Bodenschichten (Lava) deckt das Klippenmaterial nicht zu: Risse auf Flanken und Kraterwänden steiler als der
  Klippenwinkel glühen weiter
- Linien (ziehen, auch vom Kartenrand her): Cliff edge hebt den Boden links der Zeichenrichtung als Klippe, die
  Pinselgröße ist die Breite oben; River (Water oder Lava) legt einen Fluss an, der immer bergab fließt (bergauf
  gezeichnet wird er umgedreht): mäandernd, mit wechselnder Breite und schmalen Enden, Bett mit Sand- und
  Schlammufern (bei Lava verbrannter Fels), Schilf (nicht an Flanken steiler als 30 Grad), Steinen, einem Wasserfall über jeder steilen Stufe und einer
  Brücke an jeder Straße, die er kreuzt; Road legt eine Straße ins Wegenetz (Anfang und Ende rasten an Knoten oder
  Straßen), passt den Boden als Damm oder Einschnitt an, pflastert sie und stellt Laternen oder Zäune an den Rand. Was
  er gebaut hat, merkt sich die Kante (`dress`); zieht man danach einen Knoten, glättet, begradigt oder verbreitert die
  Straße (Roads, 6), legt der Editor das alles neu an: der alte Streifen wird zurückgebaut (die Höhen genau wie vor der
  Straße: `dress.ground` hält je Höhenpunkt des Bands die Höhe vorher und nach dem Einebnen, auf den Millimeter;
  danach Geformtes bleibt als Unterschied erhalten; „Resize“ verschiebt die gemerkten Höhen mit dem Raster und schneidet
  ab, was aus der Karte fällt, „Increase detail“ verfeinert sie auf den Dreiecken der alten Zellen wie die Höhen selbst (`shiftGround`,
  `refineGround`); ohne gemerkte Höhen gerade vom Land am einen Rand zum anderen, `restoreBand`; der Bodenanstrich blendet immer so), seine Laternen und Zäune gehen,
  entlang der neuen Linie entstehen Damm, Belag und Ausstattung neu; ein Schritt im Verlauf. Straßen ohne `dress` (aus Karten von
  vorher, aus Level-Skripten) liest der Editor beim ersten Bearbeiten von der Karte ab (`inferDress`): Laternen und Zäune
  an ihren Seiten und den Belag entlang der Mitte, wenn es ein Straßenbelag ist, den das Land daneben nicht hat; ihr
  Boden vor der Straße ist dann unbekannt, der Rückbau füllt gerade. Findet er nichts, bleibt die Straße eine bloße
  Linie. **Bekannte Grenze:** Mündet eine neue Straße in die Mitte einer gebauten, teilt sie diese; beide Hälften
  behalten den gemerkten Boden der ganzen alten Straße, und der Rückbau gibt ihn genau zurück. Neu angelegt wird eine
  Hälfte aber mit einem Höhenprofil nur über ihre eigene Länge (`flattenUnderPaths` glättet entlang der Linie), nicht über
  die ganze frühere Straße; an der Teilungsstelle kann der Boden danach um einige Zentimeter vom ersten Bau abweichen
  (im Fuzz-Test bis etwa 9 cm). Ein Profil über die Einmündung hinweg hieße, die Glättung über verbundene Kanten zu
  führen; das steht aus. „Rebuild road dressing“ im Roads-Panel legt die Ausstattung der gewählten Straßen neu an: aus ihrem `dress`,
  aus der Karte oder, für eine bloße Linie, mit den Einstellungen des Straßenpinsels (Landscape, Road). „Surface“ im
  Roads-Panel (gewählte Straße, keine Brücke) stellt den Belag dieser Straßen sofort um (`setRoadSurface`, ein Schritt):
  Asphalt, Pflaster, Platten, Kies, Feldweg und andere Straßenbeläge des Katalogs (`ROAD_SURFACES`) stehen in `edge.surface`
  und im `dress`, werden unter die Straße gemalt, die Wegmaske lässt die Kante aus, und „Rebuild road dressing“ malt ihn
  wieder; ein befestigter Belag liegt außerdem als Straßenfläche mit geraden Kanten darüber (CUSTOM_MAPS.md „Wege“),
  gemalt wird dann wie in OSM-Welten (`roadPaintBands`): der eigene Belag bis 1,5 m vor der Kante, darum ein Bankett
  (Kies an Landstraßen, Platten an Wohn- und Pflasterstraßen, Erde an Pfaden); ein unbefestigter Belag in voller Breite; „None“ gibt die gezeichnete Straße mit Pflaster und Spuren über dem Boden zurück, der Anstrich bleibt. Agent:
  `map.roadSurface(ids, material | 'none')`. Ebenso folgt das Flussbett
  seinem Lauf: einen Flusspunkt verschieben oder entfernen (Water, 4, Rivers), die Breite ändern oder „Fewer river
  points“ füllt das alte Bett und gräbt das neue (`moveRiverBed`): Schilf, Steine und Wasserfälle beider Bänder gehen,
  das neue Band bekommt Bodenanstrich, Schilf, Steine und Wasserfälle wie beim ersten Ziehen (`paintRiverBed`,
  `decorateRiver`, dieselben Funktionen wie der Pinsel)

**Terrain (2).** Raise und Lower (Shift kehrt um), Smooth, Flatten (auf die Höhe am Strichanfang), Level (auf eine
eingestellte Höhe; Strg+Klick nimmt sie vom Boden), Roughen (Rauschen), Erode (steile Hänge rutschen zu Geröll),
Terrace (Stufen in einstellbarer Höhe), Cliff (Plateau eine Stufe über dem Strichanfang, Shift eine darunter, harte
Kante wie Warcraft-Klippen), Ramp (zwei Klicks: Rampe zwischen den beiden Höhen, Breite einstellbar; nach dem zweiten
Klick meldet die Statuszeile „Ramp built“ statt weiter „Ramp start set“ zu zeigen). Neben ihrer flachen Krone
schüttet und schneidet die Rampe mit höchstens 0,75 m je Meter (`RAMP_SIDES`, rund 37°, auch um die Enden): über tiefem
Grund steht sie als Damm auf Böschungen, durch einen Hügel bekommt sie geneigte Einschnitte. Vorher fiel der Rand nur
über die Randweichheit des Pinsels ab, ein Damm 10 m über der Wiese stand als steile Keilwand da. Die Karten-Skripte
(`map-kit.ts`, `k.ramp`) bauen ihre Rampen weiter ohne Böschung, die mitgelieferten Karten bleiben gleich.

**Paint (3).** Bis zu zwölf Bodenschichten aus dem Katalog (beim Hinzufügen nach Biom gruppiert); die Liste wählt die Schicht zum Malen, tauscht ihr Material,
verschiebt und entfernt sie (ihr Gewicht geht an die anderen). Halten malt, Shift oder der Schalter radiert. „Auto paint
the map“ malt die ganze Karte neu (`defaultAutoRules`, nach dem Materialnamen): die erste Schicht überall, eine
sandartige am Ufer des Wassers der Karte (ohne Wasser keine: tiefe Wiesen bleiben grün), eine felsartige ab 30 Grad
Neigung (voll ab 35, flachere Bergflanken behalten ihr Gras; Fels vor Stein vor Klippe), eine schneeartige auf den
Gipfeln bis 40 Grad, über dem Fels, damit ein steiler Gipfel weiß bleibt. Darunter das Klippenmaterial und ab welcher
Neigung es greift.

**Water (4).** Das Hauptwasser und weitere Gewässer, jedes mit eigenem Spiegel, eigener Art (Water, Sea, Swamp, Ice,
Lava) und Farbe; das Panel listet sie, das gewählte bearbeitet das Werkzeug. Fill basin: ein Klick in eine Mulde flutet
sie, von ihrem Grund aus: der Klick läuft den Boden hinab bis zum tiefsten Punkt, höchstens 40 m weit (`hollowFloor`),
so füllt auch ein Klick auf die Wand, den Rand oder einen Buckel im Krater. Ohne Wasser (oder mit Strg) wird der Spiegel
knapp unter den Rand der Mulde gesetzt (0,3 m, in einer Mulde flacher als 0,6 m die halbe Tiefe, `basinBrim`, so hält
auch ein flacher Krater Wasser), also die Höhe, an der sie überlaufen würde (`basinSpillHeight`): die Flut steigt vom Klickpunkt nach Höhe geordnet und läuft über kleine Dellen
im Boden weiter (ein unebener Grubenboden), sie endet erst, wo das Wasser hinter einem Sattel zum Kartenrand abläuft
oder in eine eigene Mulde fällt (beide Seiten mindestens 2 m unter dem Sattel, `OWN_HOLLOW_DEPTH`). Behält ein
Gewässer seinen Spiegel und liegt der deutlich unter dem Rand der geklickten Mulde, sagt die Statuszeile das und
nennt die Randhöhe (Strg-Klick füllt bis dahin). Pour (Water oder Lava): ein Klick gießt dort, als liefe reichlich
nach (`ops/pour.ts`): die Mulde füllt sich bis zu ihrem Überlauf, das Überlaufende rinnt bergab in die nächste tiefere
Mulde und füllt sie auch, bis es den Kartenrand oder ein vorhandenes Gewässer erreicht. Dafür füllt eine Prioritätsflut
vom Rand und von den Gewässern aus einmal alle Mulden der Karte (Priority-Flood+Queue); der Guss läuft diese Fläche
hinab, jede Ebene darauf, in der der Boden tiefer liegt, ist eine Mulde. Jede gefüllte Mulde wird ein neues Gewässer
(0,3 m unter ihrem Überlauf, Maske über See und Ufer), alle zusammen ein Schritt im Verlauf. Gefüllt wird nur eine
Mulde, die einen See hält (`holdsLake`): mindestens 1 m tief und dazu im Mittel 1 m tief oder 0,06 m tief je Meter ihrer
Breite (Wurzel der Fläche). Die Dellen einer welligen Ebene (Relief von Wiese bis Hügel) erreichen bis 2 m Tiefe auf
Zehntausenden m², bleiben aber unter 0,6 m im Mittel und 0,05 je Meter; das Wasser läuft über sie weiter, statt die
Ebene unter einem Krater zum See zu machen. Ein Krater 20 m breit und 2 m tief hat 1 m und 0,1. Ein Guss füllt höchstens
12 Mulden, eine Karte trägt 64 Gewässer. Die Symmetrie-Bilder gießen mit.
Die Flut läuft in einem Worker (auf 1025² etwa 100 ms); ändert sich die Karte, während sie läuft, verwirft der Editor
das Ergebnis. Dig lake gräbt unter dem Pinsel ein Seebett bis zur eingestellten Tiefe und füllt es. Paint und
Erase malen die Maske von Hand. Sea from the edge flutet das Gewässer vom Kartenrand her über alles unter seinem
Spiegel. Füllt man eine Grube mit senkrechten Wänden (Terrain Lower), endet das Wasser auf einer glatten Linie knapp vor
der Wand statt in Sägezähnen entlang des Rasters (Uferschnitt, [CUSTOM_MAPS.md](CUSTOM_MAPS.md), Wasser).

**Objects (5).** Palette aus dem Katalog mit Bildern, Kategorien (auch Structures und Effects), Biom-Filter nach den
Tags des Katalogs und Suche (Name, Id oder Tag).
- Leben setzen: die Effekte der Palette (Kategorie Effects, ohne Modell) sind Objekte wie alle, mit Verlauf, Auswahl,
  Kopieren, Symmetrie und `map.place` in Skripten und über MCP. Vogelschwarm (`fx-birds`, Effekt `birds`: kreist mit
  10 Vögeln 45 m weit in 50 m Höhe über dem Punkt, mit der Skalierung größer, höher und mehr Vögel), Glühwürmchen
  (`fx-fireflies`), Rauch (`fx-smoke`), hohe Rauchsäule (`fx-smoke-column`, 40 m, zieht mit dem Wind), Glut
  (`fx-embers`), Bodennebel, Laub, Schneegestöber, Funkeln. Bei Effekt-Objekten macht die Skalierung die Fläche
  größer und dichter (Teilchen mal Skalierung zum Quadrat; die Rauchsäule höher, breiter, Puffs nur linear mehr), die
  Tönung (Tint im Auswahl-Panel) färbt die Teilchen. Ohne gesetzte Schwärme oder Glühwürmchen bringt die Karte eigene
  mit (CUSTOM_MAPS.md, „Leben aus dem Karteninhalt“): sobald einer gesetzt ist, gelten nur die gesetzten. Häuser mit
  Schornstein rauchen von selbst, ein von Hand gesetzter Rauch über dem Haus ersetzt den Schornsteinrauch.
  Bereiche, Wege und Umgebungston setzt das Werkzeug Life (N)
- Gebäude (Katalog-Kategorie `building`) und Objekte mit Drehteil (Katalog `spin`: die Radarschüssel drehte sonst am Hang in den Boden dahinter), beide nicht schwimmend, nicht auf Stelzen: Katalog `stilts`, die Pfahlhütte am Ufer verschob sonst ihr Ufer und ließ Wasser in der Luft stehen) ebnen beim ersten Setzen ihren Boden (`levelUnderBuilding`
  in `map-ops/object-ops.ts`): sein Grund (`object-ground.ts`: der Fußabdruck-Kreis, bei Gebäuden mit Katalog `box`
  geschnitten mit dem gedrehten Rechteck, wie Bauverbot und Sitz), 1,5 m und eine Gitterzelle mehr gehen auf die
  Grundhöhe (Mittel des Bodens unter der Mitte und acht Randpunkten des Grunds, `groundRing`, Abtrag und Auftrag),
  darüber hinaus läuft der Boden weich in das Gelände aus, über den Fußabdruck-Radius, mit Rechteck über seine halbe
  schmale Seite (mindestens 4 m und die doppelte Höhe von Abtrag oder Auftrag, so bleiben die Böschungen flacher als
  1 zu 2). So steht das Haus ganz und kein Hang schneidet hinein; eine lange Schule ebnet ein langes Feld mit Böschungen
  an den Seiten, nicht den Kreis ihrer halben Länge (quer zu ihr bis 17 bis 20 m von der Mitte statt 45 m). Trockenen
  Boden gräbt das Ebnen nicht tiefer als das Wasser unter den geebneten Punkten (eine Hütte am Ufer gräbt keine Grube
  unter den Meeresspiegel, Archipelago meldete sonst Wasser in der Luft).
  Ein Schritt im Verlauf mit dem Setzen; gilt für Place, Line, das Platzieren des Agenten (MCP) und `MapKit.place` der
  Levelskripte und `run_script`. Verschieben, Drehen, Kopieren und Streuen ebnen nichts: ein Haus halb im Hang ist
  danach eine freie Wahl.
- Felsen mit Unterseite (Katalog `base`, siehe [CUSTOM_MAPS.md](CUSTOM_MAPS.md), Assets) setzt der Editor auf ihre
  Platte (`settled` in `map-ops/object-ops.ts`): Wo die Platte über dem Hang hängt (`undersideGap`: Ebene der Platte,
  gekippt mit `pitch`/`roll`, gegen den Boden auf zwei Ellipsen unter ihr), sinkt der Fels, bis sie überall aufliegt,
  höchstens 35 % seiner Höhe (`MAX_SINK`); müsste er tiefer, kippt er zuerst in Vierteln zum Hang hin, bis der Rest
  passt. Das gilt beim Setzen (Place, Line), beim Streuen mit „Sink on slope“, für Felsen der Landscape-Pinsel und
  des Flussufers (am Ende des Strichs, auf dem Boden, den der Strich hinterlässt), bei Ende (Drop to the ground: Höhe
  0, dann absetzen) und bei „Align to slope“ im Panel (Fels neu aufs Gelände gelegt). Andere Objekte sinken beim
  Streuen weiter nach der Neigung unter ihrer Mitte; schwimmende (Katalog `float`: Boote, Bojen, Stege, Seerosen) weder
  sinken noch kippen mit dem Boden (Place, Line, Streuen, Biom-Pinsel): ihr z zählt ab der Wasserlinie
- Place: ein Klick setzt das gewählte Objekt (Raster-Fang 1 bis 8 m, zufällige Drehung; „Align to slope“ kippt es mit
  dem Boden unter seinem Fußabdruck, bei Felsen unter ihrer Platte, `pitch` und `roll` aus `slopeTilt`, jedes
  Symmetrie-Bild mit seinem eigenen Boden). Am Zeiger steht sein Grund als Umriss (Rechteck des Katalog-`box` oder
  Fußabdruck-Kreis) mit einem Dorn aus der Mitte der Vorderseite (lokal +z, wie die Modelle und OSM-Häuser schauen).
  Q und Komma drehen das nächste Objekt nach links, E und Punkt nach rechts, Shift+Mausrad ebenso, je um den Schritt
  „Turn step“ (5, 15, 45 oder 90 Grad, anfangs 15) auf dessen Raster, Shift+Q/E um 90 Grad; eine Drehtaste schaltet
  „Turn at random“ ab, das Feld „Turn“ nimmt die Gradzahl auch direkt. In Place drehen also Q und E, W und R wechseln
  wie überall zu Select. „Face the road“ (anfangs an) dreht ein Gebäude (Katalog-Kategorie `building`) mit der
  Vorderseite zum nächsten Punkt der nächsten Straße (`roadFacing` in `map-ops/object-ops.ts`: alle Kanten der Straßen
  außer Tunneln, gemessen vom Fußabdruck bis zum Straßenrand, höchstens 20 m, `ROAD_FACE_REACH`); ist keine so nah,
  gilt die eingestellte oder zufällige Drehung. Jedes Symmetrie-Bild schaut zu seiner eigenen nächsten Straße. Die
  Statuszeile sagt, wie das Objekt gesetzt wird („facing the road“, „turned at random“, „turned 45 deg“), die Legende
  zeigt im Modus Place die Drehtasten. `MapKit.place`, Levelskripte und das Platzieren des Agenten geben ihre Drehung
  selbst an und bleiben davon unberührt
- Scatter: halten streut die gewählten Assets (mehrere wählbar) mit Dichte, Größenbereich, Mindestabstand, zufälliger
  Drehung, Einsinken am Hang und „Align to slope“; Shift dünnt aus
- Line: das gewählte Objekt in einer Reihe, frei gezogen oder per Klick entlang einer Straße oder eines Flusses: Abstand,
  Versatz (links der Laufrichtung, negativ rechts; bei Straßen etwa die halbe Breite), „Both sides“ (eine zweite Reihe
  gegenüber, andersherum gedreht), Drehung längs, quer oder zufällig, „Align to slope“; die Symmetrie-Bilder entstehen
  mit; ein Schritt im Verlauf (`objectsAlong`, wie `row` der Level-Skripte). Zäune, Mauern, Fackeln, Baumreihen.
  Gehört das gewählte Objekt zu einem Mauer-Baukasten (`WALL_KITS`, bisher die Burgmauer: Stücke von 8, 4 und 2 m,
  Eckblock, Endblock, Turm), setzt Line die Mauer aus passenden Teilen (`wallAlong`): die gezogene Linie wird begradigt
  (Punkte bis 2 m neben der Geraden fallen weg, Knicke unter 12 Grad auch), an jedem Knick steht ein Eckblock oder
  wahlweise ein Turm, an offenen Enden ein Endblock; endet die Linie bei ihrem Anfang, wird es ein Ring. Je Schenkel
  ganze Stücke auf 2 m genau, deren Enden in den Blöcken verschwinden (die Mauern dürfen bis zur Blockmitte
  hineinreichen), also ohne Lücke und ohne Überlappung. Zinnen links oder rechts der Zeichenrichtung; das Torhaus
  setzt man von Hand in die Mauer
- Erase: entfernt, was der Pinsel trifft
- Prefabs (über der Palette): die gewählten Objekte als Prefab ablegen und gespeicherte Prefabs setzen, siehe
  [Copy and stamps](#werkzeuge) unten
- Select: Klick wählt (die ganze Gruppe, Strg+Klick ein Mitglied), Shift+Klick ergänzt, Ziehen auf freiem Grund
  wählt per Rahmen, Alt+Ziehen per Lasso, Strg+A alles Sichtbare; Rahmen und Lasso nehmen, was auf dem Bildschirm darin steht. Ausgeblendete
  Kategorien (Auge in der Gliederung) bleiben bei allen dreien draußen, Entf trifft also nichts Unsichtbares.
  Über der Auswahl steht ein Gizmo: bei Move (W) Pfeile für Ost (rot), Nord (grün) und Höhe (blau) und ein Quadrat
  für freies Verschieben, bei Turn (E) ein Ring, bei Scale (R) ein Würfel; Ziehen auf dem Grund im Ring verschiebt
  frei. L schaltet die Pfeile zwischen Kartenachsen und den Achsen des ersten gewählten Objekts. Der Raster-Fang gilt
  für Pfeile und freies Verschieben, Strg rastet Drehung (15 Grad), Höhe (halbe Meter) und Größe (Zehntel). Entf
  löscht, Strg+D dupliziert, Ende setzt die Auswahl auf den Boden zurück (Höhe 0), Strg+G gruppiert, Strg+Shift+G
  löst die Gruppe. Im Panel stehen Lage, Drehung, Größe, Neigung (Pitch, Roll in Grad; „Align to slope“ kippt die
  Auswahl mit dem Boden, „Upright“ stellt sie gerade), die Schalter „Blocks sight“ und „Blocks building“
  (Default folgt dem Katalog) und die Tönung: Farbe für die Auswahl, „Random tint“ (jedes Objekt ein eigener Ton um
  die Farbe oder um Weiß), „No tint“. Streuen hat eine Tönung und „Random tint“ (0 bis 100 %) für jedes neue Objekt

**Life (N).** Leben auf der Karte (TODO E190, CUSTOM_MAPS.md „Lebensbereiche“): Bereiche und Wege, die die Karte im
Dokument trägt (`life.areas`), und die Schalter dessen, was die Karte von selbst mitbringt (`tools/life-tool.ts`,
`ui/panels/life-panel.component.ts`). Die Taste N, weil L im Objektwerkzeug die Pfeile umschaltet.
- Outline: ein Klick je Ecke, Enter, Doppelklick oder Rechtsklick schließt den Umriss; gehalten und gezogen malt er
  ihn frei (ein Punkt alle 6 m, Loslassen schließt). Line: ebenso eine offene Linie. Was darin lebt, wählt das Panel:
  Birds (ein Schwarm kreist im Umriss, auf einer Linie hin und zurück), Fireflies (nachts), Ground fog, Leaves,
  Embers, Sparks, Snow, Dust devils, Heat haze (nur mit dem Lava-Glüh-Effekt), Boats (treiben auf dem Wasser des Umrisses, auf einer Linie hin und zurück),
  Movers (ein Requisit des Katalogs fährt oder geht über den Boden, mit Tempo), Sound (ein Klang, voll
  im Umriss oder auf der Linie, über 70 m leiser). Ein neuer Bereich ist ein Schritt im Verlauf und gleich gewählt. Zu wenig für einen Umriss (unter
  drei Ecken oder 16 m²) sagt die Statuszeile. Höchstens 64 Bereiche, 256 Punkte je Bereich
- Edit: ein Klick wählt den kleinsten Umriss um den Punkt, sonst eine Linie in 12 Pixeln; die Punkte des gewählten
  stehen als Griffe da, Ziehen verschiebt einen (ein Schritt), Shift+Klick auf den Rand setzt einen Punkt dazu, Entf
  nimmt den gewählten Punkt (ein Umriss behält drei, eine Linie zwei) oder ohne gewählten Punkt den Bereich
- Panel: Art des nächsten Bereichs; der gewählte mit Dichte (10 bis 300 %), Flughöhe (Vögel), Höhe und Farbe
  (Partikel), Vogelart (Singvögel, Möwen, Krähen und Raben, Greifvögel), Boot (die schwimmenden Requisiten des
  Katalogs) oder Klang, Lautstärke und Reichweite (10 bis 300 m, wie weit er um den Bereich ausklingt, Standard 70), „Shows from“ Medium oder nur
  High, Show, Remove; die Liste der Bereiche; „One spot“ setzt ein
  Effekt-Objekt (Rauchsäule, kreisender Schwarm, Glühwürmchen, Glut) mit dem Objektwerkzeug; „What the map brings by
  itself“: Schornsteinrauch, Glühwürmchen an Ufern und in Wäldern, Vögel über offenem Land, Funken über Lava, wehende
  Banner, Dichte (0 bis 200 % auf alles); „Sound“: „Over the whole map“ (keiner, der des Looks bei Tag und Nacht oder
  ein Klang) mit Lautstärke, „At each wave“ (Glocke, ferne Sirene, Schiffshorn einmal je Wellenstart) mit Lautstärke,
  „Comes from“ (ein Lebensbereich oder überall) und „Play“, „Hear it in the editor“ (spielt den Ton von der Mitte der Ansicht aus, Lautstärke 80 %;
  aus beim Öffnen, Browser starten Ton erst nach einem Klick). Regler wirken sofort und werden beim Loslassen ein Schritt
- Die Bereiche stehen nur, solange das Werkzeug in der Hand ist, als Linien in der Farbe ihrer Art über dem Boden.
  Mit Symmetrie entstehen an jedem Bild Kopien eines neuen Bereichs (gespiegelte Linien laufen rückwärts; ein Umriss,
  der sein eigenes Bild ist, bleibt einer); Ändern und Löschen gilt danach nur dem einen Bereich. Stempel nehmen
  Bereiche mit, deren Punkte alle im Rechteck liegen, „Mirror now“ behandelt sie wie Flüsse. Größe ändern lässt sie,
  wo sie sind (die Mitte bleibt)

**Roads (6).** Draw: jeder Klick setzt einen Knoten und verbindet ihn mit dem letzten; ein Klick nahe einem Knoten
schließt dort an, nahe einer Straße entsteht eine Kreuzung (Alt setzt frei). Enter, Rechtsklick oder Doppelklick
beendet die Linie. Edit: Knoten ziehen (auf einem anderen abgelegt verschmelzen sie), Straße wählen; Shift+Klick
nimmt weitere Knoten und Straßen dazu, Ziehen auf freiem Grund wählt per Rahmen (Knoten darin und Straßen mit beiden
Enden darin), Strg+A alles; einen von mehreren gewählten Knoten zu ziehen verschiebt alle, Entf löscht alle,
Breite und Art gelten für alle gewählten Straßen; Breite und Art
(Road, Path, Bridge), S glättet als Kurve, X begradigt, J löst einen Knoten zwischen zwei Straßen auf, Entf löscht.
„Flatten road“ ebnet den Boden quer und glättet ihn längs, „Paint road“ malt eine Schicht darunter (gewählte Straße oder
alle). Die Routen von jedem Spawn zum HQ laufen als Punkte über die Karte (abschaltbar). Gefunden werden sie im
Editor-Worker (`EditorRoutes`, Auftrag `routes`), sobald sich Straßen oder Marker geändert haben, höchstens so oft, wie
die Panels der Karte folgen (je Schritt im nächsten Bild, während eines Ziehens alle 150 ms); Overlay, Probewelle und
die Spurlängen in Measure und Markers lesen dasselbe Ergebnis. Vorher suchte der Hauptthread sie bei jedem Bild eines
Knoten-Ziehens neu (Netz von 7 500 Knoten und 11 000 Kanten in Node 25 ms). Routen, Straßenlinien, die
gewählte Straße und eine gezogene Linie liegen in Schritten von 2 m auf dem Boden (`drapedLine`), nicht gerade
zwischen weit entfernten Punkten durch einen Hügel; Routen, Straßen und Punkte über einer Brücke auf ihrem Deck
(`walkHeightAt`, dasselbe Deck wie im Spiel, `bridge-decks.ts`). Nur in Roads sind die Knoten Griffe, die mit dem
Abstand der Kamera wachsen; in jedem anderen Werkzeug (Look eingeschlossen) sind sie Punkte von 0,6 m, die nicht
mitwachsen (`setNodeHandles`), sonst decken die rund 2000 Knoten einer OSM-Karte sie von weitem zu. Ein gewählter
Knoten ist überall ein Griff.

**Spawns and HQ (7).** Q: Klick setzt einen Spawn (Name nach Himmelsrichtung, im Panel änderbar; höchstens 32, dann sagt die Statuszeile
warum), H: Klick versetzt das
HQ. Ziehen verschiebt beide; sie rasten auf die nächste Straße (Alt frei). Shift+Klick wählt mehrere Spawns, Strg+A
alle; einen davon zu ziehen verschiebt alle mit gleichem Abstand, Entf löscht alle. Das Panel zeigt je Spawn die Länge seiner
Spur oder „no route“.

**Sky and weather (8).** Sky picture (Procedural oder eines der Himmelsbilder, CUSTOM_MAPS.md „Bildhimmel“: die
Wahl setzt das Preset des Bilds und seine Sonnenhöhe; mit Bild entfallen Himmel-Preset und Tageszeit, Direction dreht
den Himmel mit der Sonne, Height bewegt nur das Licht), Himmel (Day, Dusk, Night, Overcast; Day stellt eine Sonne unter 15 Grad auf 10 Uhr, Dusk eine höhere auf 19 Uhr, damit
Himmel und Licht zusammenpassen, `skyPreset`; Night und Overcast lassen die Sonne stehen), Tageszeit (ein Sommertag: Aufgang 6 Uhr im Osten, 13 Uhr im
Süden 60 Grad hoch, Untergang 20 Uhr im Westen; tiefe Sonne ist Dämmerung, eine Stunde nach Untergang Nacht),
Sonnenrichtung und -höhe, bei Night das Mondlicht (`moonlight`, kühles Licht auf dem Land, Himmel bleibt dunkel), Nebel,
Tönung, Wetter (Clear, Rain, Snow, Fog mit Stärke), Wind (Stärke, Richtung „From“, aus der er kommt, Böen; ohne eigenen
Wind gilt der des Bioms, „Use the look's wind“ stellt das wieder her), Planet (nur prozeduraler Himmel: Größe als
scheinbarer Durchmesser in Grad, 0 keiner, dazu Richtung und Höhe; ohne eigene Einstellung zeigt der Look Moon die Erde
im Nordosten, 33 Grad hoch, 4 Grad groß, `DEFAULT_PLANET`; „Use the look's planet“ stellt das wieder her; Map-Kit und
Skript: `environment({ planet: { azimuth, elevation, size } })`); Regler wirken sofort und werden beim Loslassen
ein Schritt im Verlauf.

**Map (9).** Name, Autor, Beschreibung; Größe ändern (die Mitte bleibt, kleiner schneidet die Ränder ab, größer setzt
sie in Randhöhe fort); „Increase detail“ bei Karten mit gröberem Boden als neue Karten (ältere mit 4 m, Importe):
Höhenpunkte auf höchstens 2 m (alte Zellgröße durch eine ganze Zahl, die Ausdehnung bleibt genau, jeder alte Punkt
behält seine Höhe, die neuen liegen auf den zwei Dreiecken der alten Zelle, die das Spiel zeichnet), Bodenfarbe und Wassermasken bilinear auf die neue Auflösung
(`ops/detail.ts`), ein Undo-Schritt; Gelände-Generator über die offene Karte und „Erode the whole map“ (Regen gräbt Rinnen an allen
Hängen, Stärke „Rain“). Beide laufen im Editor-Worker auf seinem Spiegel der Karte (`EditorCore.terrain`,
`workers/terrain-job.ts`; die Seite schickt keine Kopie von Höhen, Boden und Straßen mehr, auf 1025² mit 1024er Splat
vorher 5 ms, bei 2048er Splat ein Vielfaches), Scheibe für Scheibe mit einer ruhigen Pause dazwischen, so dass ein
Cancel nach der laufenden Scheibe hält (kein Beenden des Workers): der Generator schickt
Bänder von 48 Zeilen, die Ansicht zeigt sie sofort; die Erosion läuft in Scheiben zu 4000 Tropfen, die Ansicht zeigt
den Stand etwa einmal pro Sekunde und zeichnet ihn bandweise neu. Ein Fortschrittsbalken mit „Cancel“ stellt den
alten Boden wieder her; fertig ist es ein Undo-Schritt. Während ein Job läuft, nehmen die Werkzeuge keine Eingaben an,
die Ansicht lässt sich drehen.

**Intro flight** (im Map-Panel, TODO E170): der Kameraflug, den das Spiel nach dem Laden spielt. „Default“ ist der Flug
des Spiels (vom HQ an jedem Spawn vorbei, CUSTOM_MAP_WORLD.md). „Orbit the HQ“ kreist um das HQ, Abstand, Höhe über dem
HQ-Boden und Startrichtung aus der aktuellen Ansicht („Orbit from this view“ nimmt sie neu), „Turn“ 30 bis 720 Grad.
„Camera path“ fliegt durch Ansichten, die „Add this view“ einzeln behält (Kameraort und Blickpunkt, höchstens 16, eine
allein steht still), als Catmull-Rom-Kurve mit gleicher Zeit zwischen je zwei; „View n“ zeigt eine Ansicht wieder,
„Remove“ nimmt sie heraus. „Length“ 3 bis 60 s. „Preview“ spielt den Flug in der Ansicht (ohne das Ein- und
Ausschwenken des Spiels), ein Klick oder das Rad hält ihn an. Jede Änderung ist ein Undo-Schritt. Gespeichert als
`intro` der Karte (CUSTOM_MAPS.md); eine Karte ohne behält den Standard-Flug und ihre Datei. Spiegeln und Größe
ändern lassen den Flug, wie er ist.

**Was wartet.** Solange ein Strich oder ein Ziehen in der Ansicht gehalten wird oder ein Gelände-Job läuft
(`EditorSession.busyReason`, geprüft an der Tür `session.edit`), warten Rückgängig, Wiederholen, Speichern (Strg+S; ein Autosave kommt später wieder),
Einfügen (Strg+V), „Restore“, „Test map“, der Bot-Check und das Verlassen der Karte; die Statuszeile sagt, worauf
(„Undo waits: finish the stroke or drag first“). Sonst holte etwa ein Rückgängig unter einem laufenden Job beim Cancel
die Höhen von vor dem Job über bereits zurückgenommene Schritte zurück.

Läuft ein Job (Generieren, Erodieren, das Abspielen eines Agenten, `JobRunner`) oder bearbeitet ein
anderer Tab die Karte, ist das Dokument gehalten (`EditorDocument.hold`): jeder neue Schritt, jede neue Transaktion
(`begin`, bevor sie etwas schreibt), Rückgängig und Wiederholen wird dort abgelehnt, ein Schritt, dessen Änderung schon
im Dokument steht (ein Strich, der vor dem Job begann, `record`), wird zurückgenommen, und die Statuszeile sagt warum
(„Flatten roads waits: a job runs“). Die Sperre sitzt damit an einer Stelle statt in jeder Panel-Methode; Panels
ändern über `session.edit(what, fn)`, das zusätzlich auf einen laufenden Strich oder Zug wartet; zusätzlich sind die Panels während des Jobs ausgegraut, der Job steht mit
Fortschritt und Cancel über ihnen. Der Job selbst legt seinen Schritt erst nach dem Halten ab.

Heightmap (im Map-Panel): „Export 16-bit PNG“ und „Export RAW“ schreiben die Höhen als 16-Bit-Graustufen (oberste
Zeile = Nordrand, schwarz die tiefste, weiß die höchste Höhe; RAW 16 Bit Little Endian, quadratisch wie bei Gaea und
World Machine); der Dateiname trägt den Bereich (`<id>-heights-<tief>m-<hoch>m.png`). „Import…“ liest eine solche Datei
(PNG in Graustufen oder Farbe, 8 oder 16 Bit, alle Zeilenfilter, nicht interlaced; RAW quadratisch), skaliert sie
bilinear auf das Raster der Karte und setzt Schwarz auf „Lowest m“, Weiß auf „Highest m“ (aus dem Dateinamen, wenn er
sie trägt); ein Undo-Schritt (`ops/heightmap.ts`).

**Copy and stamps (0).** Select: ein Rechteck auf der Karte ziehen, Strg+C kopiert es; danach folgt das Stück dem
Zeiger als Umriss, R und Shift+R drehen um 90 Grad, Komma und Punkt um 15, ein Klick setzt es (Strg+V aus jedem
Werkzeug setzt die letzte Kopie). Schalter wählen, was mitkommt: Höhen, Bodenfarbe, Wasser, Objekte, Straßen, Lebensbereiche (alle Punkte im
Rechteck; gedreht wie Objekte; Stempel von früher haben keine). Höhen
gelten relativ zum Rand des Stücks: ein Hügel landet auf dem Boden, auf den man ihn setzt; der Rand blendet weich
über (einstellbar). Bodenfarbe geht nach Material, nicht nach Schicht: fehlt es auf der Karte, kommt es als Schicht
dazu, solange Platz ist. „Save the copy“ legt das Stück mit Name und Bild ab, je nach „Every map“ in die
Stempel-Bibliothek dieses Browsers (IndexedDB `3dtd-editor-stamps`, gilt auf jeder Karte) oder mit „This map“ in die
Datei der Karte (`prefabs`, siehe [Datei](#speichern-und-dateien); höchstens 32, ein Schritt im Verlauf, reist mit der
Karte mit). Die Liste „Stamps and prefabs“ zeigt die der Karte zuerst, ein Klick wählt einen zum Setzen. Gruppen im
Stück werden beim Setzen eigene Gruppen der Karte (`g<n>`, die nächste freie); vorher landeten die Kopien in der
Gruppe des Originals, und ein Klick wählte Original und alle Kopien zusammen. Auch die Symmetrie-Bilder eines gesetzten
Objekts mit Gruppe bekommen je Bild eine eigene (`<Gruppe>m<Bild>`, wie „Mirror now“).

**Prefabs.** Ein Prefab ist ein Stempel aus einer Auswahl von Objekten statt aus einem Rechteck (`capturePrefab` in
`ops/stamp.ts`): im Objects-Werkzeug Objekte wählen, unter „Prefabs“ Namen geben und „Save as prefab“, wahlweise
„With the ground under them“ (Höhen, Bodenfarbe und Wasser im Rechteck um die Fußabdrücke der Objekte plus 2 m) und
„Every map“ oder „This map“ wie bei den Stempeln. Es hält nur die gewählten Objekte (keine Straßen), um die Mitte ihrer
Fußabdrücke, mit Drehung, Größe, Neigung, Tönung und Schaltern. Darunter stehen die Prefabs der Karte und der
Bibliothek mit Bild; ein Klick öffnet Copy and stamps im Modus Place mit dem Prefab: Umriss am Zeiger, R und Komma/Punkt
drehen, ein Klick setzt es. Gesetzt bilden seine Objekte eine Gruppe (ab zwei Objekten), ein Klick wählt sie zusammen.
Ohne Boden ändert das Setzen keinen Höhenpunkt und keine Farbe, egal was „Take along“ sagt (`parts` des Stücks: was es
hält; das Setzen nimmt davon, was die Schalter erlauben). Prefabs stehen auch in der Stempel-Liste (Zusatz „Prefab“),
Löschen geht in beiden Listen.

**Rules (G).** Die eigenen Regeln der Karte: Startgeld und HQ-Leben (leer heißt Spiel-Standard: 100 und 500), die
Spuren (wenigste und meiste offene, was der Koop mit Spuren macht, die niemand hält: Close / To the host / Share out;
in der Spawn-Liste schaltet „opt“ einen Spawn auf wahlweise, [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#spurenwahl-e130)),
ob Bauwerke durch Treffer fallen (World, [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#zerstörbarkeit-e131)),
die erlaubten Tower und die Wellen: die Wellen des Spiels (Budget-Source) oder eine eigene Liste in der Form der Table-
Source ([WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md)): je Welle Name, HP-Faktor, Abstand, Gegnertyp mit Anzahl, dazu die
Wiederholregel nach der letzten Welle; „Start from the game's list“ übernimmt die Liste des Spiels als Anfang.
Unter einer eigenen Liste steht eine Balance-Hilfe (`ui/panels/wave-curve.ts`, Kurve `wave-curve-chart`): die HP jeder
Welle je Spur (Grund-HP mal HP-Faktor, Teilungen mitgezählt, `lineageHp`; nach der Liste die Wiederholregel) gegen die
Liste des Spiels, logarithmisch, über die Liste plus zehn Wellen (mindestens 30). Unter dem Zeiger die Welle mit
Gegnern, HP, HP der Spiel-Liste, dem Schaden am HQ, wenn alles durchkäme (`lineageLeakDamage`, gegen das HQ-Leben der
Regeln), und der Spawn-Dauer; darunter die erste Welle der Liste, die allein auf einer Spur das ganze HQ nehmen könnte.
Für die Wellen des Spiels (Budget) gibt es keine Kurve: deren HP richten sich nach der Abwehr. Wie viel Platz für Tower
die Spuren haben, zeigt Build areas.
„Wave events“ legt fest, was vor einer Welle geschieht ([CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#ereignisse-je-welle-e170)):
Art wählen, „Add event“; die Liste steht nach Wellen, ein Klick öffnet einen Eintrag. Message (Text), Weather (Clear,
Rain, Snow, Fog mit Stärke), Time of day (Stunde), Portal opens (welcher Spawn ab dieser Welle Gegner bringt),
Objects (die gewählten Objekte erscheinen oder gehen; „Use the selection“ ersetzt sie, „Select them“ wählt sie). Ein
neues Objects-Ereignis nimmt die Auswahl des Objektwerkzeugs. Jede Änderung ein Schritt im Verlauf, Probleme stehen
darunter und im Check.
„Difficulty“ (50 bis 200 %, Standard 100) legt einen Faktor auf das Budget jeder Welle des Spiels, der Druck-Regler
regelt weiter obendrauf ([WAVE_RUN_PLAN.md](WAVE_RUN_PLAN.md), Abschnitt 19); eine eigene Liste behält ihre HP. Prüfen
meldet Fehler der Liste und Regeln ohne schießenden Tower. Sie stehen im Kartendokument (`gameplay`, siehe
[Datei](#speichern-und-dateien)); das Spiel wendet sie an, auch im Koop, wo der Host die ganze Karte sendet
([CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#spielwerte-gameplay)).

**Measure (D).** Klicks setzen Punkte; das Panel zeigt Länge auf der Karte und am Boden entlang, Anstieg und Abstieg,
dazu je Spawn die Spurlänge und die Laufzeit für den langsamsten, einen typischen und den schnellsten Bodengegner.
Darunter Höhenlinien (alle 1 bis 10 m, jede fünfte heller; gerechnet im Editor-Worker, Auftrag `contours`) und ein
Raster (10 bis 100 m) zum Einschalten.

„Build areas“ legt eine Fläche auf den Boden, wo ein Spieler einen Tower bauen darf: kräftig grün, wo er steht und
eine Route in Reichweite hat (60 m, die mittlere Grundreichweite der schießenden Tower, `TYPICAL_TOWER_RANGE`), blass
grün außer Reichweite, rot, wo keiner steht: Wasser, zu steil, ein Objekt, die Route selbst, HQ oder Spawn
(`map-ops/validation/build-areas.ts`). Darunter die Fläche in Reichweite der Routen in m² und wie viele Tower darauf passen
(eine Fläche von 8 x 8 m je Tower, der Mindestabstand des Spiels). Es sind die Regeln des Spiels, nicht nachgebaut:
je Zelle (4 m, auf Karten über 2048 m die längere Seite durch 512) prüft `checkTowerPlacement` Spielfeld, HQ (30 m)
und Spawns (60 m), die Route (10 m, `MIN_DISTANCE_TO_ROUTE`), `CustomMapSurface.buildBlocker` mit
`TOWER_BUILD_RADIUS` (Wasser, Objekte, die das Bauen verbieten) und `resolveTowerFootprint` den Grund unter der
Grundfläche eines Archer-Towers (Wand oder Abbruch unter Mitte oder innerem Ring); die Mitte der Zelle zählt. Die
Rechnung läuft im Editor-Worker samt der Routen (Auftrag `buildAreas`, 1024 m etwa 0,25 s, 2048 m etwa 0,85 s in Node
gemessen), 0,6 s nach der letzten Änderung (`BUILD_AREA_DELAY_MS`), solange die Fläche oder der Check offen ist; eine
Änderung währenddessen rechnet danach noch einmal. Der Hauptthread baute vorher Routen und Eingabe selbst (1025² mit
50 000 Objekten in Node rund 70 ms samt Kopie), jetzt nur den Abgleich des Spiegels. Wasser verdeckt die Fläche darunter (sie liegt auf dem Grund),
nur der Rand am Ufer zeigt rot.

### Symmetrie

Für faire Karten: Mirror X (Ost und West gespiegelt), Mirror Y (Nord und Süd), Both (vier Viertel), Turn 2 (halbe
Drehung um die Mitte), Turn 4 (Vierteldrehung, nur quadratische Karten; sonst halbe Drehung). Hilfslinien zeigen die
Achsen. Pinsel (Terrain, Paint, Water, Landscape) kopieren nach jedem Tupfer die Zellen, die der Strich geändert hat,
aus dem Teil der Karte, in dem der Zeiger steht, in die Bilder (gemessen an dem, was sie vor dem Strich hielten; der
übrige Boden im Rechteck des Tupfers bleibt, wie er ist, so entstehen auf ungleichem Boden keine Rechtecke). Pinsel, die
den Boden heben oder graben (Raise, Lower, Smooth, Roughen, Erode, Berg, Tal, Krater, Dünen, Risse, Erosion, Biome mit
welligem Relief), geben dem Bild dieselbe Änderung auf seinem eigenen Boden; Pinsel, die Höhen setzen (Flatten, Level,
Terrace, Cliff, Plateau, Biome, die ebnen oder Tümpel unter einen Spiegel senken), die Höhen der Quelle. Auf
symmetrischem Boden sind die Kopien exakt. Gesetzte und gestreute Objekte, Spawns,
gezeichnete Straßen, die Linien-Pinsel (Fluss, Straße, Klippe) und neue Lebensbereiche entstehen an jedem Bild; gespiegelte Linien laufen
rückwärts, damit eine Klippe ihre Seite behält. Ein Strich mit seinen Kopien ist ein Schritt im Verlauf.

„Mirror now“ (oben neben der Symmetrie, auch Strg+K) macht die ganze Karte auf einmal symmetrisch
(`ops/mirror-map.ts`): der Teil der Karte, auf den die Mitte der Ansicht zeigt, wird in die anderen kopiert. Höhen,
Bodenfarbe und Wassermasken Zelle für Zelle; Objekte, Spawns, Straßen und Flüsse der anderen Teile weichen den Bildern
der Quelle (Objektgruppen eines Bilds werden eigene Gruppen). Eine Straße, die die Achse kreuzt, endet am Bild ihres
Quell-Endes, so treffen sich die Hälften; ein Fluss über die Achse bleibt, wie er ist. Lebensbereiche wie Flüsse:
ganz im Quellteil kopiert, ganz außerhalb entfernt, über die Achse bleiben sie. Das HQ bleibt stehen. Ein
Schritt im Verlauf.

### Gelände-Generator

Presets aus Seed und Stärke auf dem Rauschen von DevWorld: Hills (Hügel in zwei Größen), Valleys (Hügel mit scharfen
Tälern), Islands (Land aus dem Meer, zum Rand hin abfallend, Wasser auf 0 m), Canyon (Hochebene mit gewundener Schlucht
und gestuften Wänden), Terraces (Hügel in flachen Stufen). Im Map-Panel über die offene Karte: Boden ersetzen oder
dazurechnen, wahlweise neu bemalen nach Neigung und Höhe; ein Schritt im Verlauf. Der Editor-Worker rechnet die Reihen
in Bändern und danach auch den Abschluss (Wasser des Presets, Straßen einebnen und über Wasser heben, weitere Schichten,
Bemalen); die Seite übernimmt nur die fertigen Höhen, Schichten und Splat-Karten (1024-m-Karte, Islands, 30 Straßen:
vorher 840 ms Abschluss im Bild, jetzt im Worker 390 ms, weil das Heben über Wasser nur noch die Samples in Reichweite
jeder Straße prüft).

## Prüfen

„Check“ (V) listet Fehler vor Warnungen; ein Klick wählt das Betroffene, wechselt ins passende Werkzeug und zeigt es.
Solange die Liste offen ist, prüft der Editor neu, sobald 300 ms nach einer Änderung nichts mehr kam und kein Strich
oder Ziehen mehr läuft. Die Prüfung läuft im Editor-Worker (Auftrag `check`, mit den zuletzt bestimmten Bauflächen);
eine OSM-Welt kostete den Hauptthread bis 120 ms je Prüfung, 1025² mit 50 000 Objekten in Node 115 ms, jetzt nur den
Abgleich des Spiegels. Ein Trockenlauf des Agenten prüft seine Kopie der Karte dort ebenso (die Kopie geht ganz mit). Unter der Liste steht der Platz für Tower an
den Routen (Fläche in Reichweite, Tower darauf, bei mehreren Spuren die engste), aus derselben Rechnung wie Build areas.

| Code | Art | Bedeutung |
|------|-----|-----------|
| `map-file` | Fehler | Die Kartendatei ließe sich nicht schreiben (`mapProblems` in `map-file.ts`, dieselbe Prüfung wie beim Packen): ein Fehler der Struktur (eine Kante zu einem Knoten, den es nicht gibt, ein HQ ohne Position; Formatregel 3). Speichern, Strg+S und Download scheitern daran gleich; die Meldung nennt das Feld, der Klick wählt das Ding oder öffnet das Werkzeug dazu. Ein gescheitertes Speichern öffnet die Prüfung selbst |
| `no-paths`, `no-spawns` | Fehler | Karte ohne Straßen oder ohne Spawn |
| `too-many-spawns` | Fehler | Mehr als 32 Spawns (`MAX_SPAWN_PORTALS`); das Spiel nutzt nur die ersten 32, das Werkzeug setzt keine weiteren |
| `spawn-off-path`, `hq-off-path` | Fehler | Spawn oder HQ weiter als 16 m von einer Straße |
| `spawn-unreachable` | Fehler | Keine Straße führt vom Spawn zum HQ |
| `spawn-outside`, `hq-outside` | Fehler | Außerhalb der Karte |
| `path-outside` | Fehler | Ein Knoten oder Kurvenpunkt einer Straße liegt außerhalb der Karte |
| `spawn-in-water`, `hq-in-water` | Warnung | Im Wasser: Maske eines Gewässers gesetzt und Boden unter dessen Spiegel, oder im Band eines Flusses; ein Spawn auf einer Brücke zählt nicht |
| `spawn-steep`, `hq-steep` | Warnung | Hang steiler als 30 Grad unter Spawn oder HQ |
| `paths-split` | Warnung | Straßennetz in mehreren Teilen |
| `lane-short`, `lane-long` | Warnung | Spur unter 200 m oder über 4000 m |
| `spawn-near-hq` | Warnung | Spawn unter 60 m vom HQ |
| `lane-little-room` | Warnung | Entlang der Route eines Spawns Platz für weniger als 20 Tower in Reichweite (Build areas, `minTowerSpots`); kommt, sobald der Worker gerechnet hat |
| `path-under-water` | Warnung | Straße (keine Brücke) unter Wasser |
| `path-steep` | Warnung | Straße steiler als 30 Grad |
| `object-on-path` | Warnung | Blockierendes Objekt reicht mit seinem Boden auf eine Straße: Fußabdruck, bei Gebäuden und Mauern das gedrehte Grundrechteck, bei Felsen die Unterseite, gegen die halbe Wegbreite, bei Fußwegen (`path`) die Hälfte davon: eine Wand darf am Gehweg stehen (`objectsOnPaths`, `PATH_WALL_SHARE`); der OSM-Import stellt Gebäude und Stützmauern mit derselben Prüfung; Tore und Bögen mit Katalog `roadThrough` ausgenommen. Mitgelieferte Level rücken solche Objekte mit `LevelKit.keepOffRoads` ab |
| `object-on-mover-route` | Warnung | Fels, Baum, Gebäude, Mauer oder Prop auf dem Weg einer Bodenlinie der bewegten Dinge (`movers`, ohne `height`): sein Fußabdruck reicht bis 1,8 m an die Schleife, die sie fahren (`objectsOnMoverWays`); ein Rover führe hindurch. Nennt die Assets. Die Levelskripte brechen bei dieser Warnung ab (`finish`) |
| `water-buried` | Warnung | Wasser, dessen Bett über seine Oberfläche stieg: mindestens 85 % der Zellen seiner Maske liegen über seinem Pegel (ab 40 Zellen), es ist nicht zu sehen; etwa ein Biom- oder Formpinsel über einem See (`buriedWater`). Eine breit über das Ufer gemalte Maske bleibt darunter (Demo-Tal 65 %) |
| `object-floating` | Warnung | Objekte, die mehr als 25 cm in der Luft hängen (`objectsInAir`), gemessen ab der Höhe, auf die der Renderer sie stellt (`seatHeight`): Felsen mit ihrer Platte gegen den Boden (ein Fels, der waagerecht am Hang steht), flache Felsstücke ohne gemessene Platte (Küstenfelsen, Becken; nicht die Kraterringe) mit ihrem Fußabdruck als Platte, abzüglich ihrer halben Dicke (die Küstenfelsen auf Archipelago standen als Platten aus der Flanke), schwimmende Assets mit der Wasserlinie gegen den Spiegel (eine Wassertiefe in z hebt sie hoch), alles andere mit dem Fuß gegen den Boden (Häuser, Mauern, Props an ihrer tiefsten Ecke, Bäume 0,15 m tief). Gehalten ist, was auf einem anderen Objekt steht (Fuß im Fußabdruck, zwischen dessen Fuß und Oberkante), auf dem Deck einer Straßenbrücke (bis 0,25 m über den Rand, höchstens 0,3 m eingesunken) oder auf Eis. Effekte und Assets mit `aloft` (Objekt-Brücken, Seilbahn-Spannen, Gondel) bleiben außen vor. Ebenso gemeldet: ein schwimmendes Asset tiefer unter seinem Wasser als die halbe Höhe (0,25 bis 1,5 m). Zählt sie und wählt den schlimmsten. Ende setzt ihn ab (z 0, Fels auf seine Platte), „Align to slope“ kippt ihn. Ein Gitter von 16 m sucht die Stützen nur für die wenigen in der Luft. Die Levelskripte brechen bei dieser Warnung ab (`finish`), ausgelieferte Karten haben keine (`shipped-maps-check`) |
| `water-floating` | Warnung | Wasser, das in der Luft endet (`waterInAir`): eine nasse Probe eines Gewässers (Maske gesetzt, Boden unter dem Spiegel) neben einer außerhalb der Maske, wo der Boden auf halbem Weg und anderes Wasser dort mehr als 0,5 m unter dem Spiegel liegen (ein See am Hang, ein Ufer, das ein Fluss oder eine Straße durchschnitt, ein Becken auf zu tiefem Land); ein Flussband (alle 2 m zwischen seinen Punkten), dessen beide Ufer einen Meter neben ihm so tief liegen, außer einen Fall hinab und jenseits des Kartenrands. Nennt jedes Gewässer und zeigt die schlimmste Stelle. Abhilfe: Ufer heben, Spiegel senken (Strg-Klick mit Fill füllt bis zum Rand) oder die Maske dort abnehmen. Die Levelskripte brechen ab (`finish`), ausgelieferte Karten haben keine (`shipped-maps-check`) |
| `danger-color` | Warnung | Deko in Gefahrenfarben (rote Pilze, rote Blüten; `DANGER_LOOK` in `render/asset-catalog.ts`, dieselbe Liste wie für die mitgelieferten Karten) bis 30 m an einer Straße: Rot steht im Spiel für Gegner, Treffer und Feuer |
| `scene-cost` | Warnung | Szenenkosten über 100 % (unten): mehr, als eine Karte flüssig zeichnet |
| `wave-events` | Fehler, Warnung | Wellen-Ereignisse (`map-ops/validation/wave-event-check.ts`): ein Portal nennt einen Spawn, den es nicht mehr gibt (Fehler); alle Spawns öffnen erst später, Welle 1 hätte keine Spur (Fehler); Objekte eines Ereignisses fehlen; Tageszeit auf einer Karte mit Himmelsbild |

### Szenenkosten

Was die Objekte einer Karte das Bild kosten, in Punkten (`render/objects/scene-cost.ts`); das Map-Panel zeigt sie als
Balken „Scene cost 62 %“ mit der Zahl der Objekte darunter, der Check warnt über 100 %, `tools/maps/shipped-maps-check.spec.ts`
hält die mitgelieferten Karten unter 80 %. Ein Punkt ist etwa ein Dreieck im Bild:

- Je Objekt die Dreiecke seines Modells, seiner LOD-Modelle (`lod` im Katalog) und, bei Bäumen und Felsen ab 1,5 m,
  des Impostors (4 Dreiecke ab `max(letzte LOD-Distanz × 1,5, Höhe × 25, 380 m)`), wie `object-layer.ts` sie zeichnet,
  bis zur Sichtweite (`drawDistance`); Stufe High (`lodBias` 1, Impostor ab 380 m)
- Jedes Band zählt mit dem Anteil der Karte, der darin liegt: Kreisring um die Kamera, höchstens die ganze Karte
  (`(min(A, π b²) − min(A, π a²)) / A`, A = Breite × Tiefe). Ein Haus, gezeichnet bis 3 km, zählt auf jeder Karte
  voll; ein Grasbüschel mit 10 Dreiecken bis 140 m auf einer Large-Karte 0,15
- dazu 2 Punkte je Objekt (Instanz, Einsortieren, Schatten) und 20 je Partikel pro Sekunde eines Effekts; ein Modell
  ohne gezählte Dreiecke oder ein unbekanntes Asset zählt 500 Dreiecke bis 500 m
- Die Dreiecke schreibt `tools/map-assets/count_triangles.py` (`triangles` je Objekt und je `lod`) in `catalog.json`,
  `update_catalog.py` ruft es mit auf

Beispiele (Punkte je Objekt auf einer Large-Karte): Grasbüschel und Blumen 2,2, Busch 25, Eiche 97, großer Fels 135,
Steinmauer 1 042, Lagerfeuer 1 194 (Partikel), Haus 3 760, großes Haus 6 560.

**100 % = 12 Mio. Punkte** (`SCENE_BUDGET`, die eine Stelle zum Nachstellen), geeicht am 2026-10-15 mit
`e2e/perf/render-bench.ts` (RTX 5080, Stufe High, Canvas 1300 × 852, [BENCHMARKS.md](BENCHMARKS.md), „Eigene Karten und
Szenenkosten“): über neun Karten wächst die GPU-Zeit (Median) der teuersten Ansicht mit rund 0,19 ms je Mio. Punkte
auf einem Sockel von 0,8 ms (Gelände, Gras, Wasser, Himmel, Schatten), die der Spielansicht mit 0,14 ms auf 0,5 ms.
100 % ist, wo die teuerste Ansicht 3 ms erreicht (die Gerade: 11,5 Mio.), dieselbe Marke, unter der die automatische
Qualität nach der Bildzeit eine Stufe hochschaltet ([RENDER_QUALITY.md](RENDER_QUALITY.md)): eine GPU mit einem Drittel
der Leistung bleibt mit dem Bild unter den 10 ms, ab denen sie herunterschaltet. Gemessen:

| Karte | Objekte | Szenenkosten | GPU Spielansicht | GPU teuerste Ansicht | Calls |
|-------|---------|--------------|------------------|----------------------|-------|
| Moon Base | 1 558 | 20 % | 0,41 ms | 0,80 ms (pan) | 78 |
| Autumn Keep | 6 958 | 23 % | 0,53 ms | 1,06 ms (close) | 85 |
| Demo Valley | 13 178 | 16 % | 0,75 ms | 1,03 ms (pan) | 160 |
| Harbor Town | 923 | 21 % | 0,85 ms | 1,28 ms (pan) | 121 |
| Ruined City | 8 169 | 62 % | 0,92 ms | 1,42 ms (close) | 89 |
| Neue Karte Meadows, Large | 91 535 | 4 % | 0,86 ms | 1,11 ms (pan) | 203 |
| Neue Karte Hell, Medium | 1 770 | 10 % | 1,12 ms | 1,27 ms (pan) | 203 |
| Neue Karte Woods, Large | 102 474 | 53 % | 1,86 ms | 3,40 ms (close) | 598 |
| Neue Karte City, Medium | 5 533 | 100 % | 2,40 ms | 3,05 ms (close) | 214 |

Ohne Messung: die übrigen mitgelieferten Karten 3 bis 30 %, neue Karten Meadows Medium 3 %, Woods Medium 50 %, City
Large 257 % (nach der Geraden gut 6 ms in der teuersten Ansicht).

Die Szenenkosten zählen nur die Objekte: die Large-Wiese kostet so viel GPU-Zeit wie die Hafenstadt, fast alles
Gelände und Gras, ihre 91 500 Büschel und Blumen kaum etwas (4 % sind richtig, die 0,86 ms stehen im Sockel). Über der
Geraden liegt der Large-Wald (598 Calls, Bäume in vielen Zellen): Draw Calls kennt das Modell nicht, ein Posten je
Asset lohnt sich erst, wenn mehr Karten so weit darüber liegen. Nachmessen nach größeren Änderungen am Zeichnen: die
Karten oben (neue Karten aus den Vorlagen, Saat 1) mit `render-bench.ts`, je Karte die teuerste Ansicht gegen die
Szenenkosten.

## Speichern und Dateien

- Autosave schreibt zwei Sekunden nach der letzten Änderung in IndexedDB; die Kopfzeile zeigt „Unsaved changes“,
  „Saving“ oder „Saved“. Strg+S speichert sofort mit neuem Vorschaubild; beim Verlassen der Karte wird das Bild
  ebenfalls erneuert. Prüfen, Packen und der Fingerabdruck für den Verlauf laufen im Editor-Worker auf seinem Spiegel
  der Karte (siehe „Editor-Worker“ unter Architektur): vorher kostete jedes Speichern auf einer 512-m-Karte ein Bild von
  60 bis 140 ms, mit einem Pack-Worker je Speichern noch die Kopie der ganzen Karte (1025² mit 50 000 Objekten in Node
  rund 40 ms), jetzt nur die geänderten Kacheln und Objekte (0,3 ms ohne Änderung, eine Strichkachel und ein
  Objekt 0,8 ms, `doc-mirror.perf.spec.ts`). Der Worker liefert auch Zusammenfassung und (bei Strg+S) Inhalts-Hash
  desselben Stands: ändert der Spieler während des Speicherns etwas, passen Datei, Hash und Listenzahlen trotzdem
  zusammen. Auch der Download packt dort
- Ein Tab je Karte (`editor/model/map-lock.ts`): wer eine Karte zuerst öffnet, hält ihre Web-Sperre
  (`navigator.locks`, Name `3dtd-map:<id>`). Ein zweiter Tab öffnet sie schreibgeschützt: Banner „Another tab edits
  this map“, Kopfzeile „Read only“, die Panels aus, Werkzeuge und Werkzeugtasten aus, Rückgängig, Speichern, Einfügen,
  Restore und Test warten; ansehen geht. „Take over editing“ bittet den anderen Tab über einen `BroadcastChannel`, zu
  speichern (Halbfertiges wie ein gehaltener Strich oder ein Gelände-Job fällt weg) und loszulassen; der wird
  schreibgeschützt und reiht sich ein, dieser liest die Karte neu und bearbeitet sie. Der andere antwortet sofort,
  dass er speichert; dann wartet dieser, bis die Sperre frei wird (höchstens 60 s), denn eine große Karte braucht zum
  Speichern länger als 3 s. Antwortet der andere nicht in 3 s (eingefroren, schlafender Tab), nimmt er die Sperre mit
  `steal`. Schließt der bearbeitende Tab, bekommt der
  wartende die Karte von selbst. Ohne Web Locks (alte Browser) darf jeder Tab bearbeiten, wie früher
- Kontextverlust: setzt der Grafiktreiber zurück (oder der GPU-Prozess startet neu), verliert die Ansicht ihren
  WebGL-Kontext. Die Karte liegt im Speicher, nicht auf der GPU: der Editor speichert sofort, ein Banner sagt „View
  lost … Your map is safe“ (mit „Reload the page“, das vorher speichert). Kommt der Kontext zurück
  (`webglcontextrestored`), baut die Ansicht sich neu (`rebuildView`: die Textur-Arrays behalten nach dem Hochladen
  keine Pixel, ein bloßes Wiederhochladen ginge nicht)
- Dauerhaft halten: ohne Zusage räumt ein Browser IndexedDB bei Platzmangel oder beim Löschen der Websitedaten, samt Versionen. Das erste Speichern je Seite
  fragt daher `navigator.storage.persist()` (`editor/model/storage-safety.ts`; Firefox fragt den Spieler, Chrome
  entscheidet selbst). Das Map-Panel (9) zeigt unter „Storage“ den Stand: Kartenordner der Desktop-App, „keeps your
  maps for good“ oder die Warnung samt „Download map file“. Darf der Browser räumen, erinnert nach 30 Minuten Arbeit
  ohne Download ein Banner daran („Download“, „Later“ schiebt es um weitere 30 Minuten)
- Kartendokument Version 2: optionales Feld `dress` je Straßenkante (Damm, Belag, Laternen und Zäune des Straßenpinsels
  mit den Ids ihrer Objekte und dem Boden des Bands vor dem Einebnen, `ground`, gepackt in `road-ground.ts`: etwa
  4 Byte je Höhenpunkt, eine 300 m lange Straße auf 2-m-Raster rund 12 kB Text vor dem Zip; die mitgelieferten Level
  wachsen dadurch um 21 bis 54 kB, 2 bis 7 %; nur der Editor liest es); optionales Feld `gameplay` (`startCredits`, `hqHealth`, `towers`, `waves` als
  `{ kind: 'budget' }` oder `{ kind: 'table', table }` in der Form der Table-Source, `difficulty` in Prozent, ohne
  Feld 100, `events` die Wellen-Ereignisse; später dazugekommene optionale Felder heben die Version nicht (Formatregel 2), so auch `environment.skyImage`, die Id
  eines Himmelsbilds, ohne Feld prozedural, und `life`, das Leben der Karte (Werkzeug Life, CUSTOM_MAPS.md
  „Lebensbereiche“); ohne Feld sieht und klingt die Karte wie vorher, ihr `contentHash` bleibt; ebenso `intro`, der eigene
  Kameraflug (`{ kind: 'orbit', seconds, radius, height, angle, sweep? }` oder `{ kind: 'path', seconds, views }`, je
  Ansicht `x`, `y`, `h` und `lookX`, `lookY`, `lookH` im Kartenraum, `world/custom-map/map-intro.ts`, geprüft von
  `introProblems`)); Version-1-Dateien lesen sich
  unverändert über die Migration 1 nach 2
- Prefabs und Stempel der Karte (`prefabs`, optional, höchstens 32, `MAX_MAP_PREFABS`): je Eintrag Id, Name, Zeit, Bild
  (PNG als Data-URL) und das Stück; dessen Arrays liegen im Zip unter `prefabs/<k>/heights.f32`, `paint.u8` und
  `water.u8`. Nur der Editor liest sie, das Spiel nicht; sie zählen nicht zum `contentHash` (wie `meta.uid`), eine
  Karte ohne Prefabs schreibt kein Feld. Hebt die Version nicht
- Kartendokument Version 3: bis zu zwölf Bodenschichten. Die Gewichte der Schichten 9 bis 12 liegen in einer dritten
  Splat-Karte (`terrain/splat2.u8`), die es nur gibt, solange die Karte mehr als acht Schichten hat
  (`splatMapCount`, `fitSplatMaps`: die neunte Schicht legt sie leer an, das Entfernen bis auf acht wirft sie weg; im
  Verlauf kommt und geht sie mit der Schichtliste). Karten bis acht Schichten speichern, laden und zeichnen wie zuvor,
  ihr `contentHash` bleibt; Version-2-Dateien lesen sich unverändert über die Migration 2 nach 3
- Datei-Menü (drei Punkte): Download map file (`.3dtdmap`), Export top view as picture (PNG, 2048 px an der längeren
  Seite), Frame the whole map, Top view
- „Test map“ speichert und spielt die Karte im selben Fenster (E195 Phase 5, Startauftrag mit `trial`): der Editor
  wartet mit Karte, Verlauf und Kamera; „Edit“ im Pfad oder „Back to editor“ im Pausemenü und nach Game over kehrt
  am selben Stand zurück. Das Probespiel wird nie gespeichert, auch nicht als Autosave, und ist kein Lauf, zu dem
  man zurückkehrt. Der Bot-Check läuft ebenso im Fenster, sein Ergebnis steht danach in der Prüfung
  (`AppScreen.trial`). Scheitert das Speichern, bleibt der Editor.
  „From wave“ neben dem Knopf (1 bis 200, gilt, solange der Editor offen ist) startet den Test bei Welle N
  (`WorldStart.startWave`, per Link `&fromWave=N`, `customMapStartWave`): die Wellen davor zählen als gespielt, der Spieler hat das Gold und die
  Forschung, die ein typischer Spieler bis dahin hat, und baut die Abwehr selbst. Die Rechnung (`runStartAt`,
  `sim/protocol/run-start.ts`, mit den Goldregeln der Wellen, die die Karte spielt):
  - Gold der Wellen 1 bis N−1: Kill-Gold, Abschlussgold und Meilensteine, ohne Skill-Boni, wie der Dev-Sprung
    (`skippedWavesGold`). Kill-Gold je Spur, Abschlussgold einmal
  - Forschung: in der Reihenfolge, in der Spieler forschen (`START_RESEARCH_ORDER`: je Forschung die mittlere Welle,
    in der fünf menschliche Läufe vom 2026-09-22 bis 2026-10-04 sie fertig hatten; was neuer ist als die Läufe, danach
    nach Preis), was bis Welle N offen ist (`minWave`) und dessen Voraussetzungen erledigt sind, solange alle zusammen
    höchstens ein Drittel dieses Golds kosten (`START_RESEARCH_SHARE`: so viel gaben die Läufe von W5 bis W30 im Median
    dafür aus, zu heutigen Preisen, zwischen einem Viertel und der Hälfte). Bei der ersten, die nicht mehr passt, hört
    sie auf, wie ein Spieler, der auf die nächste spart. Sie ist beim Start fertig, ihr Preis je Spur abgezogen
  - Credits je Spieler: Startcredits je Spur plus `(Kill − Forschung) · Spuren + Abschluss`

  | Welle | Gold davor (Kill + Abschluss) | Forschung | Credits (eine Spur, 100 Start) | Forschung der Läufe davor |
  |---|---:|---:|---:|---|
  | 5 | 1.600 | 400 (1: Gatling) | 1.300 | 0 bis 2, meist Gatling |
  | 10 | 5.610 | 1.870 (5: dazu AA, Eis, Kanone, Biologie) | 3.840 | 4 bis 7 |
  | 20 | 54.694 | 16.620 (14) | 38.174 | 13 bis 15 |
  | 30 | 329.392 | 77.120 (21, alles außer Tier 5) | 252.372 | 18 bis 21 |

  Vorher (die billigste zuerst, ein Viertel) kaufte sie bis W5 nur Biologie (120, schaltet keinen Tower frei): außer
  Archer war alles gesperrt.

  Der Start steht in den Laufregeln (`RunRules.start`) und damit im Weltschlüssel: die Simulation setzt ihn bei jedem
  Neustart wieder (`GameStateManager.applyRunStart`, angekündigt als `wave:jumped`), ein Replay startet genauso. Ein
  Lauf ab Welle N zählt keine Bestwelle; die Spurenwahl vor Welle 1 entfällt (die Wellen davor gelten als gespielt),
  es spielen die Spuren, die die Karte offen startet. Nur allein: ein Koop-Gast öffnet die Karte ohne den Parameter
- Versionen: jedes Speichern und höchstens alle drei Minuten ein Autosave landen als gepackte Datei in IndexedDB
  (`3dtd-editor-history`; die frühere `3dtd-editor-versions` wird beim Öffnen gelöscht); das Map-Panel (9) listet sie,
  „Restore“ holt eine zurück (ein Undo-Schritt): die ganze Karte samt Leben, Intro-Flug und Prefabs
  (`ALL_DOC_PARTS`, dieselbe Liste wie beim Abspielen eines Agenten und `restore_version`), nur Name und Beschreibung
  bleiben, wie sie sind. Ein Absturz kostet so höchstens die Minuten seit dem letzten Autosave.
  Ältere Versionen dünnen aus, statt hinten herauszufallen (`thinVersions`): alle der letzten Stunde, je Stunde des
  letzten Tages, je Tag des letzten Monats und je Woche davor nur die neueste, höchstens 40; wer oft speichert, hat
  so trotzdem einen Weg zur letzten Woche. „Pin“ hält eine Version fest, die Ausdünnung lässt sie stehen
- Papierkorb: „Delete“ in der Kartenliste legt eine eigene Karte sofort in den Papierkorb (unter einer eigenen Kennung
  `trash-<Zeit>-<id>`, Herkunft `trashed`; in der Desktop-App verlässt ihre Datei den Kartenordner). Ein Banner und der
  Abschnitt „Trash“ unten in der Liste holen sie zurück („Restore“, unter ihrer Kennung oder einer freien, wenn eine
  neue Karte sie inzwischen trägt; die Versionen ziehen dann mit um, `VersionHistory.move`); ihre Versionen bleiben so
  lange stehen. Spielen lässt sich eine Karte im Papierkorb nicht (`MapStore.load` kennt sie nicht). Nach 30 Tagen (`TRASH_DAYS`) oder mit
  „Delete for good“ (zweimal) geht sie samt Versionen endgültig. Karten eines Koop-Hosts gehen nach Rückfrage gleich
  endgültig, der Host schickt sie beim nächsten Beitritt wieder
- Budget im Map-Panel (`map-ops/validation/map-budget.ts`): die Szenenkosten der Objekte („Prüfen“, Szenenkosten) und
  die Dateigröße gegen die 32 MB, die ein Koop-Raum verschickt
  ([COOP_PLAN.md](COOP_PLAN.md), C1c). Die Größe ist die des letzten manuellen Speicherns (gleiche Packstufe wie der
  Koop-Versand; Autosaves packen leichter und größer); ab 80 % gelb, über 100 % rot mit Hinweis
- Probewelle (P, „Trial wave“): die Gegnermodelle des Spiels laufen jede Route vom Spawn zum HQ mit ihrer echten
  Geschwindigkeit und Animation, die Typen der ersten Welle der eigenen Wellenliste oder eine Mischung (Zombie, Ratte,
  Panzer, Spinne, Skelett); die Statuszeile nennt, wie lange der schnellste und der langsamste bis zum HQ brauchen.
  Solange sie läuft, steht oben rechts in der Ansicht eine Leiste mit 1x, 2x, 4x, 8x und Stop; + und - schalten
  ebenso (wie die Spielgeschwindigkeit im Spiel, eine Stufe mehr, weil lange Routen bei 1x Minuten brauchen). Die
  Geschwindigkeit gilt sofort und bleibt für die nächste Probewelle, solange der Editor offen ist. Sie streckt nur die
  Uhr der Läufer (Abstand, Weg und Animation, `TrialRunners.speed`); die Probewelle ist ein Bild im Editor, die
  Simulation des Spiels sieht sie nicht; sie laufen auf der Gehhöhe (`walkHeightAt`): über eine Brücke auf dem Deck, nicht durch Fluss oder Lava darunter

## Architektur

```
src/app/world/custom-map/
  map-document.ts   Kartendokument (gemeinsamer Vertrag)
  map-create.ts     neue Karte, Id aus Name, Rauschen
  map-file.ts       .3dtdmap packen und lesen, contentHash, Prüfung, Migrationen
  map-store.ts      eigene Karten in IndexedDB, mitgelieferte aus maps/index.json
  map-pack.ts       .3dtdmap packen für den Verlauf (packForSave, im Editor-Worker), im eigenen Worker (Karte des
                    Koop-Hosts), Fingerabdruck der Datei
  map-unpack.ts     .3dtdmap lesen im eigenen Worker je Aufruf (unpackOffThread): jeder Leseweg von Spiel und Editor
                    (MapStore.load, Import, Kartenordner, Karte des Koop-Hosts, Version), mit contentHash auf Wunsch;
                    die Arrays kommen ohne Kopie zurück
src/app/map-ops/    gemeinsame Kartenbibliothek ohne Angular, ohne three, ohne Editor-Zustand (Editor, OSM-Import,
                    Demo-Karte, Level-Skripte, Skript-Sandbox)
  grid.ts           Raster-Helfer (Höhe, Hang, Samples, Texel, Rechtecke)
  brush.ts          runder Pinsel und sein Abfall; terrain-ops, paint-ops, water-ops: Gelände, Farbe, Wasser
  object-ops.ts     Objekte: Streuen, Setzen auf den Hang, Planieren unter Gebäuden, Linien, Mauern
  path-graph.ts     Wegenetz, Routen; path-terrain.ts Boden unter Straßen
  generate.ts       Gelände-Generator; landscape-noise.ts, lines.ts, river-levels.ts (Spiegel und Punkte eines Flusses)
  asset-catalog.ts  Paletten aus dem Katalog des Renderers (maps/assets/catalog.json), Farben, Formen, Kategorien
  validation/       Prüfen: map-validation, build-areas, wave-event-check, map-budget
src/app/editor/
  model/            EditorDocument (Befehle, Verlauf, Auswahl), Kachel-Patches, Versionen, Stempel-Bibliothek,
                    Spiegel der Karte für den Editor-Worker (doc-mirror.ts)
  model/commands/   alle Befehlsklassen: Kachel-Patch, Snapshot (ALL_DOC_PARTS), Objekte, Verbund, Boden-Schichten,
                    Wasser, Flüsse
  ops/              Operationen auf dem EditorDocument: Größe, Details, Höhenkarte, Spiegeln, Höhenlinien, Gießen,
                    die Schritte je Teil (ground-, water-, road-, marker-commands; object-commands: Planieren unter
                    neuen Gebäuden), Messen, Beschreiben eines Punkts; Werkzeuge, Panels, Agent und Skripte rufen dieselben
  ops/landscape/    Landschafts-Pinsel: Biome, Formen, Erosion, Fluss, Straße; LandscapeContext über der Transaktion
  ops/symmetry.ts   Bilder der Symmetrie, Sektor des Zeigers, Kopieren der Zellen und Objekte
  ops/stamp.ts      Stücke kopieren und setzen, Prefabs aus einer Auswahl; model/stamp-store.ts die Stempel-Bibliothek
  ops/map-kit.ts    MapKit: die Operationen ohne Oberfläche für Skripte (Level-Skripte, KI-Agent)
  agent/            KI-Agent über MCP (Desktop-App): Werkzeuge, Skript-Sandbox, Abspielen als ein Undo-Schritt (AGENT_MCP.md)
  tools/            Werkzeuge: nur Zeigereingaben zu ops und Befehlen; TOOL_DEFS (tool-defs.ts) ist die eine Liste der
                    Werkzeuge (Name, Taste, Symbol, Gruppe, Pinsel, Erzeugen, ToolId daraus), ihr Panel steht in
                    ui/shell/tool-panels.ts; PART_TOOL ordnet einem Prüfbefund das Werkzeug zu
  view/             EditorViewport (Renderer, Szene, Kamera, Bildschleife) und seine Teile: InputRouter, ViewPicker,
                    ChangeApplier, ProgramWarmup, TopDownRenderer, ViewExtras; overlay/ (eine Klasse je Ebene),
                    EditorMapView, CameraController, ThumbnailRenderer
  import/           Warcraft-3-Import: lädt importW3xInWorker beim ersten Gebrauch, fasst den Bericht zusammen
  services/         die Dienste der Session (Angular-frei bis auf Signale), EditorCore: der Editor-Worker von hier aus
  workers/          Editor-Worker (editor-core.worker.ts, editor-core-host.ts, Protokoll), Terrain, Gießen
  ui/               Angular: Seite, Kartenliste, Shell, Panels; ui/shell/actions.ts ist das Aktionsregister, aus dem
                    Befehlspalette, änderbare Tasten, Hilfe und Dateimenü entstehen
```

**Schichten.** `model/` und `ops/` sind der Kern des Editors und kennen weder Eingabe noch Ansicht noch Seite: sie
importieren nichts aus `tools/`, `view/` und `ui/` (Lint-Regel in `eslint.config.js`). Ein Werkzeug übersetzt nur Zeiger
und Tasten in dieselben Schritte, die Panels, Agent und Skripte auch rufen.

**Dokument und Verlauf.** `EditorDocument` hält das `CustomMapDocument` und einen Verlauf aus Befehlen (`apply`,
`revert`, `bytes`). Jeder Befehl meldet, was er änderte (`DocChange`: Höhen- und Splat-Rechtecke, Objekt-Ids, Teile).
Ein Schritt, der beim Arbeiten schreibt, läuft in einer Transaktion (`model/edit-transaction.ts`, `editor.begin(label)`):
jeder Pinselstrich, jeder Landschaftsstrich, Generieren und Erodieren, das Abspielen eines Agenten, die Boden- und
Wasserschritte der Panels. Sie schreibt direkt ins Dokument und sagt vorher, was sie gleich ändert: Kacheln eines Arrays
(`touch`; `RegionRecorder` sichert jede 32 x 32-Kachel beim ersten Berühren), ganze Teile (`snapshot`: ein Teil des
Dokuments, die Schichtliste, der Boden mit Schichten und Splat, alles Wasser, die Flüsse), neue und entfernte Objekte, einen
schon getanen eigenen Schritt (ein neues Gewässer, `include`). `commit` legt alles als einen Schritt in den Verlauf (nur
die berührten Kacheln, Vorher und Nachher), `abort` schreibt alles zurück und meldet es der Ansicht; Cancel eines Jobs,
ein Fehler beim Abspielen und ein Gießen ohne Senke nehmen denselben Weg wie ein Undo. `editor.transact(label, parts,
edit)` ist die Transaktion um eine einzelne Änderung. Einzelne fertige Befehle (`SnapshotCommand.record` für kleine
Teile, `ObjectsCommand` für Objekte mit ihrer Stelle in der Liste) gehen weiter über `execute`. Der Verlauf hält
höchstens 300 Schritte und 192 MB. „Dirty“ vergleicht Zustands-Ids, also ist eine Karte nach Rückgängig bis zum
gespeicherten Stand wieder sauber.


**Ansicht.** `EditorViewport` hat eigenen Renderer, Szene und Kamera, unabhängig von der Engine des Spiels, und die
Bildschleife; die Arbeit machen seine Teile in `view/`:

| Teil | Aufgabe |
|---|---|
| `InputRouter` | Zeiger, Rad und Tasten zum Werkzeug oder zur Kamera; ein Bodenstrahl je Bild, nur wenn sich der Zeiger bewegte oder ein Werkzeug zieht; Werkzeugwechsel (leert die Werkzeug-Ebenen), Sperre bei Jobs |
| `ViewPicker` | Strahl zum Boden, was ein Klick nähme (HQ, Spawn, Knoten, Objekt per Modell, Straße), Gizmo-Griff, Karte zu Bildschirm |
| `ChangeApplier` | sammelt die `DocChange` eines Bilds und reicht sie gebündelt weiter (nur berührte Chunks); Himmel, Leben und Wasser höchstens alle 100 bzw. 120 ms, das Nachlegen des Overlays auf bewegtem Boden höchstens alle 200 ms (eine `Throttle`); das Ziel (`ChangeTarget`) und die Uhr sind übergeben, getestet ohne WebGL |
| `ProgramWarmup` | Shader vorab (siehe unten) |
| `TopDownRenderer` | die Karte von oben (Minikarte, PNG, Vorschaubilder) |
| `ViewExtras` | Probewelle (`TrialWave`), Ton der Karte (`MapSound`), Intro-Vorschau (`IntroPreview`), Spielansicht (`GameView`) |

`ViewHost` (`services/view-host.ts`) hält als einzige Stelle den Viewport und reicht der Seite nur `EditorViewPort`.
Das Overlay (`view/overlay/`) ist eine Klasse je Ebene: was Werkzeuge zeichnen (`ToolOverlay`: Entwurfslinie,
Hover- und Gizmo-Ring samt Griffen, Vorschaupunkte, Messlinie, Flussgriffe, Lebensbereiche), was das Dokument zeigt
(`MarkerLayer` und `SelectionLayer` hält der `ChangeApplier` nach, `RouteLayer` der `ViewHost` mit den Routen des Editor-Workers) und die Bodenhilfen (`BrushLayer`,
`ContourLayer`, `GridLayer`, `BuildAreaLayer`, `GuideLayer`). Ein Werkzeug sieht über `ToolContext.overlay` nur
`ToolOverlay`; der `InputRouter` leert es zwischen `deactivate` des alten und `activate` des neuen Werkzeugs, also
räumt kein Werkzeug seine Linien selbst weg. Die Karte zeichnet derselbe Renderer wie im Spiel (`CustomMapView`,
[CUSTOM_MAPS.md](CUSTOM_MAPS.md)); er liest das Dokument nur und hält selbst, welche Objekte er zeigt (ausgeblendete
Kategorien als Filter, `setVisible`). `EditorMapView` übersetzt Raster- und Texel-Rechtecke in Meter und reicht
geänderte Objekt-Ids weiter (`objectsChanged`: neue oder entfernte bauen nur ihre Zellen neu). Eine neue Schichtliste
oder ein neues Gelände baut die Ansicht neu. Szene-Rahmen wie im Spiel: Szene x = minus Karte Ost,
Szene z = Karte Nord, y oben. Der Drehpunkt der Kamera liegt auf dem Boden, über einem See oder dem Meer auf dessen
Spiegel (`surfaceAt`, wie `CustomMapSurface.surfaceAtMap` im Spiel): eine nahe Ansicht bleibt über dem Wasser, nicht
darunter auf dem Grund.

**Leistung.** Ein Pinselschritt bleibt unter 2 ms auf Karten mit 256, 512 und 1024 Samples je Seite
(`editor-brushes.perf.spec.ts`, Budgets in `npm run test:perf`): Biom-Pinsel merken sich je Strich das Rauschen jedes
Texels (Grundmischung, Ufer, Risse, Rand) in Kacheln von 64 x 64 (`FieldCache`), statt es bei jedem Tupfer neu zu
rechnen (Wald 2,3 auf 1,1 ms). Für die Höhen merken sie sich ebenso je Sample den Rand, den Halt der Straßen, das Relief und das
Rauschen der Tümpel (als Gleitkommazahlen); die Tümpel rechneten es je Tupfer bis zu zweimal (Hölle 2,2 auf 1,75 ms). Die Landformen (Gebirge, Tal, Plateau, Krater, Dünen) merken sich ebenso je Strich und Sample ihr Rauschen und
den Halt der Straßen (als Gleitkommazahlen, also dieselbe Form wie ohne Speicher); den Abstand zu den Straßen sucht ein
Strich in einem Raster der Straßenstücke (16 m) statt über alle Straßen. Ein Tupfer mit 200 m Radius auf einer
1024-m-Karte mit 220 Straßen kostet so 1,6 bis 2,8 statt 13 bis 16 ms. Ein Pinsel am Kartenrand schreibt die
Schürze in ihre Geometrie zurück (`writeApronGeometry`, Normalen wie `computeVertexNormals` direkt auf den Arrays),
deren lagebedingte Höhen (Hügelrauschen, Gebirgskulisse) einmal je Kartengröße gerechnet sind: 54 auf 6 ms je Bild
bei 1024 m; die Normalen-Textur des Höhenrasters liest das Raster direkt (400 x 400 Samples 6,8 auf 2,5 ms). Objekte gehen sofort in ihre Zelle: die Zell-Meshes halten Platz frei (die Hälfte
mehr, mindestens 16), neue Objekte landen in freien Slots, ein entferntes ersetzt der letzte der Zelle; neu gebaut
wird eine Zelle erst, wenn der Platz ausgeht. Pinsel auf einer Wassermaske bauen nur die Wasserkacheln (64 Zellen)
und das Ufer in ihrem Rechteck neu, das Hauptwasser wie die weiteren Gewässer; ganz neu (höchstens alle 120 ms)
nur bei Spiegel, Art oder Symmetrie. Die Geländeverdeckung (Horizontsuche) eines gehaltenen Pinsels wartet, bis die
Höhen ruhen (120 ms, höchstens 500 ms), und arbeitet dann einige Millisekunden je Bild ab. Das Overlay baut Marker, Knoten (Instanzen, eine Menge je Farbe) und Straßen
(alle Kanten in einem `LineSegments`) nur neu, wenn sich Wege, Spawns, HQ oder die Auswahl ändern, und sucht die
Routen nur dann neu; Höhen und Wasser darunter legen es nur auf die neuen Höhen (`redrape`, höchstens alle 200 ms im
Strich). Auf einem Wegenetz von 7 600 Knoten und 8 700 Kanten: Neubau 19 statt 1 500 ms, Nachlegen 3 ms. Die Panels der Werkzeuge bleiben gemountet, folgen den
Revisionen der Kartenteile, die sie zeigen (`panelRev('objects', 'paths')`, `EditorState`), aber nur, solange sie zu
sehen sind (`PanelShown`), und holen sie beim Zeigen nach; ein Geländestrich lässt Outliner, Objekt-Panel und Budget in
Ruhe. Änderungen je Tupfer und Kamerabilder gehen an Zuhörer (`onDocChange`, `onCamera`: Tour, Minikarte) statt
an Signale, die Angular sonst in jedem Bild alles prüfen ließen. Gehaltener Gebirgspinsel auf einer kleinen Stadtkarte,
16 s: 603 statt 1 388 Prüfläufe, Template-Zeit 65 statt 220 ms. Den Himmel baut die
Ansicht höchstens alle 100 ms neu; die Minikarte wartet, bis kein Pinsel mehr gehalten wird.

Gemessen 2026-10-14 (optimierter Build, RTX 5080, 1600 x 900, gehaltener Pinsel 3 s, ms je Bild p50/p90, je zwei
Läufe; neue Karte 1024 m Meadows bei 2 m, Demo-Tal 512 m mit 13 000 Objekten):

| Pinsel | neue Karte vorher | nachher | dieselbe Karte bei 4 m | Demo-Tal vorher | nachher |
|---|---|---|---|---|---|
| Terrain | 3,4–3,8 / 4,5–5,5 | 0,9–1,0 / 1,3–2,3 | 0,9 / 3,0 | 4,7–5,7 / 5,9–7,6 | 2,6 / 3,5–3,8 |
| Biom Wald (zweiter Strich) | 7,9–10,7 / 11–14 | 2,6–2,9 / 3,8–4,9 | 1,4–1,8 / 2,0–3,6 | 11,7–13,9 / 15,7–31,7 | 4,9–5,1 / 6,3–7,0 |
| Streuen | 0,7 / 1,7 | 0,7–0,8 / 1,7–2,1 | 0,6 / 0,7 | 1,6–1,8 / 2,9–3,8 | 1,4 / 1,5–1,6 |
| Radieren | 0,5–0,6 / 2,3 | 0,5–0,6 / 1,5–2,5 | 0,4 / 0,6–1,2 | 1,6–1,7 / 3,2–4,1 | 1,2 / 1,4–1,5 |
| Wasser malen | 0,6 / 2,5–2,6 | 0,6–1,8 / 2,5–4,5 | 0,4 / 1,4–1,5 | 1,6–1,8 / 3,9–4,2 | 1,1–1,2 / 1,3–1,4 |

Die feinere Detailstufe kostet nach den Änderungen beim Terrain-Pinsel nichts mehr, beim Biom-Pinsel etwa das
Doppelte von 4 m (gut 1 ms).

**Shader vorab.** Ein Programm, das erst im Bild übersetzt wird, hält das Bild an (bis 1,5 s). Der Editor übersetzt
deshalb vorab und im Hintergrund (`ProgramWarmup`, `compileAsync`, parallel, wo der Treiber es kann): beim Laden die Karte, danach im
Leerlauf die Programme des Bilds von oben (`TopDownRenderer` für Minikarte und Vorschau: Render-Target und kein Nebel
ergeben eigene Programme) und die Varianten des Geländeshaders mit mehr Schichten (`MapTerrainLayer.layerTwins`; die
Schleife über die Schichten ist auf 4, 8 oder 12 gerundet, ein neues Biom springt sonst im ersten Strich auf die
nächste Stufe). Bei der Wahl eines Bioms oder Objekts übersetzt `ProgramWarmup.assets` dessen Modelle für beide Bilder und
die Schattentiefe: Zwillinge der Tiefenmaterialien, wie der Schattenpass sie ableitet (`getDepthMaterial`), ohne
Nebel und Umgebung, da beide zum Schlüssel eines Programms gehören, auch wo der Shader sie nicht nutzt. Die
Zwillinge bleiben, denn three wirft ein Programm weg, das kein Material mehr nutzt.

**Palettenbilder.** Ein kleiner eigener Renderer zeichnet ein Bild je Leerlauf (`requestIdleCallback`), übersetzt
dessen Programme vorab und gibt das Bild als `ImageBitmap` an einen Worker, der es als PNG kodiert
(`thumbnail-encode.worker.ts`); das Zurücklesen von der GPU wartet dort statt im Bild. Die Materialien der Boden-
und Biom-Bilder bleiben erhalten: jedes Wegwerfen nahm das Programm mit, und das nächste Bild übersetzte es neu
(über eine halbe Sekunde). Geht die Ansicht des Editors (ins Spiel, Test, Bot-Check), gibt der Renderer seinen
WebGL-Kontext zurück (`release`, mit `forceContextLoss`): die fertigen Bilder bleiben im Speicher, ein laufendes Bild
legt keinen neuen Kontext an, und erst das nächste fehlende Bild nach der Rückkehr macht einen neuen.

Gemessen 2026-10-14 (optimierter Build, neue Karte, längstes Bild / Summe der Bilder über 50 ms in ms, zwei bis drei
Läufe; ohne V-Sync, daher auch im Leerlauf Bilder um 200 ms, wenn die GPU voll läuft):

| Situation | vorher | nachher |
|---|---|---|
| Objekte zum ersten Mal öffnen (5 s) | 350–798 / 1895–3161 | 209–244 / 1576–2099 |
| Malen zum ersten Mal öffnen (4 s) | 17–400 / 0–1611 | 207–212 / 1213–1352 |
| Erster Strich Nadelwald | 1406–1488 / 2123–3517 | 194–199 / 254–442 |
| Erstes Setzen eines großen Hauses | 425–433 / 842–844 | 207–428 / 742–815 |

Nachher wird in keiner dieser Situationen mehr ein Programm im Bild übersetzt (vorher drei bis sechs).
Ganze Karten (Vorlagen) malt `biomeBand` in Bändern mit Pausen dazwischen.

**Landschafts-Pinsel.** Ein `LandscapeContext` weiß, was ein Landschaftsstrich beim Arbeiten braucht, und schreibt
über seine Transaktion: Höhen, Splat, Wassermaske (Kachel-Patches), neue Schichten, neues Wasser, neue Objekte und
geänderte Straßen eines Strichs landen als ein Schritt im Verlauf. Was das Land freihalten muss (Straßen, Spawns, HQ,
Wasser), fragt `LandQuery` ab, die auch ohne Strich arbeitet (Freiprüfung im MapKit). Höhen ziehen zu einem Ziel aus
dem Boden vor dem Strich (`baseHeight`, die gesicherten Kacheln der Transaktion), daher türmt sich
nichts auf. Objekte stehen auf einem verwackelten Raster je Objektart und Seed (eine Stelle und ein Würfel je Zelle,
einmal entschieden); Kern-Objekte wachsen, sobald der Pinsel stark genug war, Rand-Objekte werden am Strichende nach
dem stärksten erreichten Gewicht entschieden. Rauschen aus `devworld/utils/seeded-random.ts`. Ein Fluss ist ein
`MapRiver` in `terrain.rivers` (Punkte alle 8 m mit Breite und Spiegelhöhe, dazu einer an Kante und Fuß eines
Falls, wo der Spiegel mehr als 0,3 m von der Geraden zwischen zwei Punkten abweicht, `riverPoints`: das Band läuft
zwischen Punkten gerade, ein Punkt mitten in der Wand und einer hinter dem Fuß ergaben eine schräge Platte über dem
Becken; Fließrichtung ab Punkt 0): der Spiegel
kommt aus den Ufern (`bankLevels`): je Punkt das tiefere der beiden Ufer, gemessen, wo die breiteste Böschung des
Pinsels das Land erreicht (halbe Breite plus 1,4 Uferbreiten), abzüglich eines Freibords (0,4 bis 1,5 m, mit der
Breite wachsend, `freeboard`), höchstens 0,5 m unter dem Boden in der Mitte; wie weit das tiefere Ufer ihn hinabzieht,
wird über etwa die Bandbreite gemittelt, damit er in Biegungen am Hang nicht springt. So steht ein Fluss am Hang als
gefülltes Bett unter dem tieferen Ufer statt als Film auf einem Damm. Die Böschung steigt über 60 % der Uferbreite vom
Wasser zum Land. Nach dem Verschieben von Punkten, einer neuen Breite und bei „Carve the bed“ setzt der Editor die
Spiegelhöhen neu aus den Ufern (`relevelRiver`), so sinken auch Flüsse älterer Karten in ein Bett; erneutes Schnitzen
ändert dann nichts mehr. Der Spiegel fällt nie und mindestens 0,4 cm je Meter; wo er mehr fällt, als er
läuft (eine Klippe), steht an der Kante ein Wasserfall-Objekt (Front flussab, Größe nach Fallhöhe, über 12 m eine
Kaskade); flachere steile Strecken bleiben Stromschnellen auf dem Band. Die Flussliste ist im Strich ein
`RiverListCommand`. „Remove river“ (oder Entf ohne gewählten Punkt) nimmt den Fluss samt Bett ab (`removeRiver`):
quer zum Lauf führen Höhe und Bodenanstrich gerade vom Land am einen Rand zum Land am anderen, Schilf, Steine und
Wasserfälle im Band gehen mit, eine Brücke darüber wird wieder Straße; ein Rückgängig-Schritt.

**Symmetrie und Stücke.** `mirrorChange` kopiert nach einem Tupfer die geänderten Zellen der Höhen, Splat-Karten und
Wassermaske aus dem Sektor des Zeigers in die Bilder (das Raster ist um die Mitte gelegt, ein gespiegeltes Sample ist
wieder ein Sample) und meldet die Rechtecke der Bilder an die Ansicht; `mirrorDab` sichert über die Transaktion
die Ziel-Kacheln vorher. Ein Stück (`Stamp`) hält Höhen relativ zum Rand, Farbe je Material, Wasser, Objekte und die
Straßen, deren beide Enden darin liegen; `pasteStamp` setzt es gedreht über einen `LandscapeContext`. Das Wasser ist
das der Hauptwasserfläche oder, ohne sie im Stück, das des Gewässers, das den größten Teil davon bedeckt (ein
Oasenteich, ein Lavakrater; `kind` im Stück), mit seinem Spiegel relativ zum Rand. Beim Einsetzen steht es relativ zum
Boden dort: in der Hauptwasserfläche, wenn sie auf dieser Höhe liegt (oder fehlt), sonst in einem Gewässer dieser Art
auf dieser Höhe, neu angelegt, wenn keines da ist (`LandscapeContext.waterAt`). Vorher grub ein Teich, auf eine Mesa
gesetzt, sein Bett bis zum Spiegel des Meers hinunter, und ein Gewässer außer dem Hauptwasser kam gar nicht mit.

**Angular.** `EditorSession` ist eine dünne Fassade über je einem Dienst (`editor/services/`): `MapLifecycle`
(welche Karte offen ist, `openMap`, öffnen, schließen, eigene Kopie, Tab-Sperre), `EditorState` (Revision je Kartenteil,
Verlauf), `ToolHost` (Werkzeug, Einstellungen, Hinweiszeile), `ViewHost` (die Ansicht, für die Seite nur als
`EditorViewPort`), `SaveService`, `JobRunner`, `CheckService`, `MapLibrary` (Karten, Papierkorb, Import, Stempel-
Bibliothek, auch ohne offene Karte), `EditorPictures`, `AgentAdapter` (der `AgentHost` des KI-Agenten) und
`EditorNotices` (Statuszeile, Banner). Jede Änderung aus einem Panel geht durch `session.edit(what, fn)`; die
Einstellungen sind je Teil ein Signal mit unveränderlichen Werten (`patch(settings.water, { mode })`), wer einen Teil liest,
folgt nur ihm. `EditorState` sammelt die Änderungen des Dokuments und erhöht die Revisionen der berührten Teile einmal je
Bild; die Tupfer eines laufenden Strichs höchstens alle 150 ms. Ein Timer läuft nur, solange sich etwas ändert. Ansicht und
Taktgeber laufen außerhalb der Zone. Die Seite zeigt den Editor, solange `openMap` eine Karte nennt; der Agent öffnet
und schließt Karten über denselben `MapLifecycle`.

**Editor-Worker.** Ein dauerhafter Modul-Worker (`editor/workers/editor-core.worker.ts`) startet mit der Karte und endet
beim Schließen, wenn er beantwortet hat, was er schuldet (`EditorCore`, von `MapLifecycle` geöffnet und geschlossen; ein
Speichern beim Verlassen bekommt noch seinen eigenen). Er hält einen Spiegel der Karte (`model/doc-mirror.ts`): jeder
Auftrag bringt mit, was sich seit dem letzten geändert hat (`MirrorTracker.sync`), der Worker spielt es ein
(`DocMirror.apply`) und rechnet auf genau dem Stand, für den der Auftrag gestellt wurde.
- Kleine Teile (Meta, Umgebung, Regeln, Leben, Intro, Spawns, HQ, die eigenen Felder des Geländes wie Schichten, Klippe,
  Wasserspiegel, Flüsse) gehen jedes Mal ganz mit: billiger als sie zu verfolgen. Die Schlüssel stehen dabei an ihrer
  Stelle, damit eine Datei aus dem Spiegel ihre Felder in derselben Reihenfolge schreibt.
- Höhen, Splat-Karten und Wassermasken gehen in Kacheln zu 64 Samples: die Kacheln, die die `DocChange`-Rechtecke seit
  dem letzten Auftrag nannten; ein neues Array (Größe, Detail, ein neues Gewässer) ganz, eine geänderte Schichtliste
  alle Splat-Karten, `water` ohne Rechteck alle Masken. Die Kopien werden übertragen, nicht geklont.
- Objekte als Patch gegen die zuletzt geschickte Liste: an der Identität erkannt (ein ersetztes Objekt ist ein neues),
  dazu die Ids, die die Änderungen nannten (eins in place geändert). Straßenknoten und -kanten ebenso, die in place
  geänderten an ihren Feldern (zwei Ebenen tief, etwa `dress`), denn eine Änderung der Straßen nennt keine Ids und ein
  gezogener Knoten bewegt sich in place: ein Knoten gezogen auf einem Netz von 7 500 Knoten und 11 000 Kanten kostet
  den Abgleich 1,9 ms statt 10,5 ms für die ganzen Straßen. Prefabs ganz, wenn sie sich geändert haben.
- Der Spiegel teilt keinen Speicher mit dem Dokument. Die Arrays des Dokuments selbst auf `SharedArrayBuffer` zu legen
  hieße: jeder `structuredClone` (Undo-Schnappschüsse, Skript-Sandbox, Aufträge mit Kopien) teilte den Puffer statt ihn zu
  kopieren; ein eigener geteilter Spiegel kostete dieselbe Kopie wie das Übertragen der Kacheln.
- Jeder Teil hat eine Version (`DocPart`), die mit jeder Änderung steigt; ein Ergebnis kommt mit den Versionen, auf denen
  es gerechnet wurde, `EditorCore.current` sagt, ob sie noch gelten.
- Aufträge: was den Stand genau so sehen muss, wie er erbeten wurde (Packen), läuft sofort beim Eintreffen und liest
  den Spiegel vor seinem ersten `await`; alles andere wartet auf einen ruhigen Moment, je Art gewinnt der neueste (ein
  älterer wird mit `null` beantwortet), die dringlichste Art zuerst: `pack`, `pathMask` (Wegmaske, CUSTOM_MAPS.md),
  `check` (Prüfen), `groundShape` und `lava` (Bodenverdeckung, CUSTOM_MAPS.md), `routes` (Routen der Spawns),
  `contours` (Höhenlinien), `buildAreas` (Bauflächen; der Worker behält sie für die nächste Prüfung), `farShadow`.
  Gelände-Jobs (Generieren, Erodieren) sind Ströme: Scheibe für Scheibe zurück (`part`), anhaltbar (`stop`).
  `groundShape` zählt jedes Rechteck: die Ansicht schickt eins nach dem anderen und sammelt, was dazwischen kommt. Was ein Auftrag mitbringt und nicht verloren gehen darf, wenn ein neuerer seinen Platz nimmt (die Covers
  der Wegmaske), nimmt der Worker beim Eintreffen (`take`).
- Ohne Worker (Tests) läuft derselbe Code im Prozess, die Nachrichten geklont wie bei einem Worker. Der Zufallslauf
  (`editor-fuzz.spec.ts`) gleicht nebenbei den Spiegel ab: eine Datei aus dem Spiegel muss Byte für Byte die aus dem
  Dokument sein.

**Datei.** `.3dtdmap` ist ein Zip (fflate) mit `map.json` und den Arrays als Little-Endian-Binärdateien
(`terrain/heights.f32`, `terrain/splat0.u8`, `terrain/splat1.u8`, ab neun Bodenschichten `terrain/splat2.u8`,
`terrain/water-mask.u8`), optional `preview.png`.
`contentHash` ist SHA-256 über das kanonische JSON der Welt (Schlüssel sortiert, ohne Name, Beschreibung und Zeiten)
und die Arrays; Umbenennen und erneutes Speichern ändern ihn nicht. Beim Lesen laufen erst die Migrationen
(`MAP_MIGRATIONS`, je Version ein Schritt), dann die weiche und die harte Prüfung (Formatregeln unten); Fehler kommen
als `MapFileError` mit Klartext.

**Formatregeln.** Was eine neue Fassung der Datei darf, ohne ältere Spiele zu brechen (Desktop-App eines Spielers,
der nicht aktualisiert hat):

1. **Version heben.** Ein neues Feld oder eine neue Bedeutung, die ein älteres Spiel nicht übergehen darf, ohne
   falsch zu spielen (andere Spielregeln, ein anderes Gelände, Wege, Spawns, Masken, Arrays), hebt `MAP_VERSION` und
   bringt eine Migration in `MAP_MIGRATIONS` mit, die ältere Dateien hebt. Ein älteres Spiel liest die Version vor
   allem anderen und sagt „This map was made with a newer version of the game (map version 4, this game reads up to
   3). Update the game to open it.“ statt „broken“; im Editor beim Import und Öffnen im Banner, im Spiel auf der
   Ladetafel.
2. **Ohne Version.** Ein optionales Feld, dessen Fehlen nur das Bild oder den Ton ändert (`skyImage`, `planet`,
   `wind`, `life`, `intro`), und ein neuer Wert einer Liste (Himmel, Biom, Wetter, Wasser- und Flussart, Wegart,
   Brückenstil, Wellen-Ereignis, Leben, Vogelart, Spurregel `vacant`, Wellenquelle) heben die Version nicht. Ein
   älteres Spiel setzt einen unbekannten Wert beim Lesen auf den Standard (oder lässt das Ding weg, wo es keinen gibt:
   ein Wellen-Ereignis unbekannter Art, ein Lebensbereich unbekannter Art) und meldet es. Die Listen stehen einmal in
   `map-document.ts` (`MAP_SKIES`, `MAP_BIOMES`, `MAP_WEATHERS`, `MAP_WATER_KINDS`, `MAP_RIVER_KINDS`,
   `MAP_PATH_KINDS`, `MAP_BRIDGE_STYLES`, `MAP_WAVE_EVENT_KINDS`, dazu `LIFE_KINDS` und `BIRD_SPECIES` in
   `map-life.ts`); ein Wert, der im Typ dazukommt, kompiliert nicht, bis er dort steht. Das weiche Lesen der Listen
   gibt es seit E223 (Oktober 2026); Spiele davor weisen einen unbekannten Wert noch als „broken“ ab.
3. **Zwei Prüfungen.** Hart ist nur die Struktur (`validateMapDocument`): Raster, Höhen, Splat- und Wassermasken,
   Gewässer, Listen, Wegknoten und Kanten mit ihren Ids, Spawn- und HQ-Positionen, Meta, Spielregeln und Wellenliste.
   Eine solche Karte wird weder geschrieben noch gelesen (`MapFileError`, „The map is broken: …“). Weich ist der Inhalt
   (`map-repair.ts`): ein kaputtes Objekt (fehlende oder doppelte Id, kein Asset, Lage, Gruppe oder Neigung keine Zahl),
   ein kaputter Fluss, Lebensbereich, ein kaputtes Wellen-Ereignis, Prefab oder ein kaputter Intro-Flug fällt weg; ein
   kaputter Schalter des Lebens fällt auf den Standard; Zahlen der Umgebung kommen in ihren Bereich, eine Tönung, die
   keine `#rrggbb`-Farbe ist, wird weiß, `blocksLos`/`blocksBuild`/`optional`, die nicht true oder false sind, fallen
   auf den Standard, doppelte oder fehlende Spawn-Ids bekommen neue (Spuren, Portale und Koop-Spuren gehen über die
   Id), zu lange Texte (Name und Autor 80, Beschreibung 2000 Zeichen) werden gekürzt, mehr als `MAX_MAP_OBJECTS`
   (100 000) Objekte, 64 Lebensbereiche, 64 Wellen-Ereignisse oder 32 Prefabs werden abgeschnitten; mehr als 100 000
   Wegknoten oder Kanten werden nur gemeldet. Die Karte öffnet mit dem Rest.
4. **Gemeldet.** Was das Lesen ändert, steht in `repaired`: der Editor zeigt es im Banner („… had parts this game does
   not take; it opened with them set right or left out: …“, das nächste Speichern behält die berichtigte Karte), das
   Spiel im Banner über dem Spiel, bis der Spieler es schließt (`UiNotice.lasting`). Die Prüfung im Editor nennt
   dieselben Punkte vorher als Warnung `map-values`, Speichern schreibt sie, wie sie sind. Der Inhalts-Hash ist der der
   berichtigten Karte. Eine Datei, die vor einer neuen weichen Prüfung öffnete, öffnet weiter; eine neue harte Prüfung
   ist eine Formatänderung nach Regel 1.
5. **Koop und Replays.** Das weiche Lesen hängt nur an der Datei (keine Uhr, kein Zufall) und ist nach einem Durchlauf
   fertig (`mapRepairs` auf der gelesenen Karte ist leer). Ein Koop-Raum erzwingt denselben Build, der Host packt die
   berichtigte Karte, der Gast liest dieselbe Karte mit demselben Hash.
6. **Papierkorb.** Löschen, Zurückholen und Ersetzen lesen nur `meta` aus `map.json` (`mapFileMeta`,
   `withMapFileMeta`), nicht die ganze Prüfung: eine Karte, die nach einem Update nicht mehr öffnet, lässt sich in den
   Papierkorb legen, zurückholen (unter anderer Id wird nur `meta.id` in der Datei umgeschrieben) und durch eine
   gelesene Datei ersetzen.

**Tests.** Vitest: `map-file.spec.ts`, `map-store.spec.ts`, `editor-document.spec.ts`, `ops.spec.ts`,
`path-graph.spec.ts`, `map-validation.spec.ts`, `map-ops/validation/build-areas.spec.ts` (jede Zellart nach den Regeln des
Spiels, Platz je Spur), `tools.spec.ts`, `ops/landscape/landscape.spec.ts` (Gleichheit bei
gleichem Seed, Rand, Dichte, Freihalten von Straßen und Markern, ein Undo-Schritt, Formen, Erosion, Fluss mit Brücke,
Straße), `ops/symmetry.spec.ts`, `ops/stamp.spec.ts`, `map-ops/generate.spec.ts`, `ops/contours.spec.ts`. `editor-fuzz.spec.ts`
spielt je Seed (1, 7, 42, 99, 2026) 90 zufällige Schritte über die Werkzeuge und Befehle (Gelände- und Farbpinsel,
Wasser, Setzen auch am Hang ausgerichtet, Streuen und Ausdünnen, Radieren, Reihen entlang Linien und Straßen, Gizmo
verschieben, drehen und skalieren, Löschen, Duplizieren, Gruppieren, Ende, Tönen, Straßen zeichnen, ziehen, glätten
und verbreitern, Rahmenwahl, Spawns und HQ, Landschaft mit Biomen, Formen, Fluss, Straße, Klippe und Klippenfelsen,
Flusspunkte samt neuem Schilf und neuen Steinen, alte Straßen ohne gemerkte Ausstattung, „Rebuild road dressing“,
Stempel mit Drehung, Symmetrie, „Mirror now“, Heightmap-Import, Größe ändern, „Increase detail“,
Restore, Umgebung, Sprünge im Verlauf) und verlangt: alle Undos ergeben `contentBytes` des Anfangs bytegleich, alle
Redos die des Endes, und jeder Zustand unterwegs (Undo, Redo, Sprung) ist die Karte, wie sie nach diesem Schritt war;
eine neue Straße, deren Ausstattung abgebaut und neu gebaut wird, lässt den Boden auf 5 mm gleich (gemerkter Boden auf den Millimeter, die Fläche des Spiels wählt die Diagonale einer Zelle nach ihren Ecken;
ohne Straßen, die sie geteilt hat, siehe die bekannte Grenze oben); neben fünf festen Seeds laufen fünf weitere, die
einmal an Annahmen des Tests selbst scheiterten (ein Lauf, der mit einem Sprung zurück endet, wird erst zu Ende
wiederholt); einige Schritte laufen abgebrochen (jede Transaktion `abort` statt `commit`: Pinsel, Landschaft,
Klippenfelsen, Stempel, Heightmap, Straßenausstattung, Flüsse, Füllen) und müssen die Karte bytegleich und den Verlauf
unverändert lassen; ein Fehler nennt Seed und Schritte. Undo während Strich, Drag oder Job sperrt
die Session (`editor-session.spec.ts`). Browser:
`e2e/tests/editor.e2e.ts` (neue Karte, Gelände, Objekt mit Rückgängig, Straße, Spawn, gespiegeltes Objekt, kopiertes
und gesetztes Stück, Prüfen, Speichern, Neuladen, Löschen; ohne Kartensitzung).

## KI-Agent (Desktop-App)

In der Desktop-App kann ein KI-Agent (MCP-Client) die offene Karte bauen und ändern, während man zusieht: Schalter
in den Einstellungen (Privacy, standardmäßig aus), Skripte gegen das Map-Kit in einer Sandbox, jeder Aufruf ein
Undo-Schritt `Agent: …`, abgespielt mit Animation; Cancel im Map-Panel stellt die Karte wieder her. Andere Karten
liest und kopiert er nur. Alles Weitere in [AGENT_MCP.md](AGENT_MCP.md).

## Grenzen

- Gruppen, ausgeblendete Kategorien und Versionen kennt nur der Editor; das Spiel ignoriert `group`
