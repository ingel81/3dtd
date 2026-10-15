# Karteneditor

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Kartendokument: [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

Unter `/editor` baut man eigene Karten: Gelände, Bodentexturen, Wasser, Objekte, Straßen, Spawns und HQ. Eine Karte
liegt im Browser (IndexedDB; in der Desktop-App zusätzlich als Datei in `Dokumente/3DTD/Maps`, [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) E26b), lässt sich als `.3dtdmap` herunterladen und wieder einlesen und mit „Test map“ im Spiel
öffnen (`?world=map:<id>`). Der Einstieg im Hauptmenü ist „Map editor“ (Lage Start, unter der Linie; mit laufendem Lauf
fragt das Menü vorher). Die Oberfläche ist englisch wie das übrige Spiel.

## Kartenliste

Die Startseite von `/editor` zeigt links die eigenen und die mitgelieferten Karten (Bild, Größe, Spawns, Objekte,
zuletzt geändert), rechts die gewählte mit Beschreibung und den Knöpfen Open, Duplicate, Download, Delete (in den
Papierkorb, siehe [Speichern](#speichern-und-dateien)). Mitgelieferte Karten (`public/maps/index.json`) und Karten eines Koop-Hosts sind schreibgeschützt: „Copy
and edit“ legt eine eigene Kopie an und öffnet sie. Dasselbe gilt für jeden anderen Weg dorthin, etwa „Edit“ in der
Kartenwahl des Spiels (`/editor?map=<id>`): `EditorSession.open` öffnet nie das Original, sondern speichert sofort eine
eigene Kopie („Name (copy)“), sagt das in der Statuszeile und setzt deren Kennung in die Adresse, damit Neuladen die
Kopie öffnet und keine zweite anlegt. Die Kopie merkt sich ihr Original mit dessen Inhalts-Hash (`meta.copyOf`, nicht
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
  bis die Ansicht ihre Programme übersetzt hat, steht dort „Preparing the view“
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
- Die Adresse trägt die offene Karte (`/editor?map=<id>`); Neuladen öffnet sie wieder. Die Seite folgt der Adresse:
  Zurück im Browser schließt die Karte wie der eigene Zurück-Knopf (erst speichern; scheitert das, bleibt sie offen),
  Vor öffnet sie wieder

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
| 1 bis 9, 0, G, D | Werkzeug: Landscape, Terrain, Paint, Water, Objects, Roads, Spawns and HQ, Sky and weather, Map, Copy and stamps, Rules, Measure |
| M | Symmetrie reihum: aus, Mirror X, Mirror Y, Both, Turn 2, Turn 4 (auch oben in der Kopfleiste) |
| Alt+1 bis 9 (Strg+Ziffer, wo der Browser sie lässt) | Kamera-Ansicht merken; Shift+Ziffer fliegt hin; die Knöpfe 1 bis 9 unter der Minikarte ebenso (Alt-Klick merkt) |
| ? | Übersicht aller Tasten; unter „Your keys“ lassen sich die Einzeltasten (Werkzeuge, F, T, C, B, P, V, M) umlegen, gespeichert in `3dtd-editor-keys` |
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
Objects), Play (Roads, Spawns, Rules) und Map (Sky, Map, Stamps, Measure). Rechts stehen zwei Reiter: die Optionen des
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

**Einstieg.** Beim ersten Öffnen einer Karte führt eine Tour in 23 Schritten durch den Editor (`ui/shell/tour.ts`):
Ansicht, die Werkzeugleiste, dann jedes Werkzeug in der Reihenfolge der Leiste (Look, dann Landscape bis Measure; der Schritt
wählt das Werkzeug, sein Panel steht rechts), die Reiter Outline und History, Minikarte und gemerkte Ansichten,
Symmetrie, Speichern und File, Strg+K und Hilfe, zuletzt Check, Probewelle (mit ihrer Geschwindigkeit) und Test map.
Jeder Schritt sagt kurz, was der Teil tut und wie man ihn benutzt, und legt einen Ring um seinen Knopf (`target`, ein
CSS-Selektor; fehlt das Element, kein Ring). Ein Schritt geht von selbst weiter, wenn man tut, was er sagt (ein
Landschaftsstrich, eine Straße, ein Spawn, der Check, die Probewelle, der Test), sonst mit „Next“; „Back“ geht zurück,
„Skip the tour“ beendet sie. Danach kommt sie nicht mehr von selbst (localStorage `3dtd-editor-tour`: `done` oder
`skipped:<Schritt>`). Die Hilfe (?) startet sie neu („Start the tour“) und setzt eine übersprungene am Schritt fort,
an dem man sie beendet hat („Resume the tour (N/23)“); Strg+K kennt beides. Die Schritte der Werkzeuge stehen in
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
- Biome: Meadow, Forest, Pine forest, Rocks, Mountains, Swamp, Desert, Beach, Snow, Arctic, Village, City, Hell,
  Wasteland, Moon, Mars. Halten malt; die Stärke bestimmt Dichte und Ausprägung, der Rand franst aus. Unterholz, Büsche und Zäune
  wachsen am Rand des Strichs, Bäume und Häuser innen; eine Objektart mischt alle ihre Kandidaten aus dem Katalog.
  Objekte meiden Straßen, Wasser, Spawns und HQ; der Boden unter Straßen bleibt. Sumpf, Hölle und Arktis legen Becken
  an, gefüllt mit einem eigenen Gewässer der Art Swamp, Lava oder Ice knapp unter dem Boden am Startpunkt (ein
  vorhandenes derselben Art bis 2 m tiefer wird mitbenutzt, ein höheres nie: sein Wasser stünde über dem Land). Becken
  entstehen nur, wo das Land auf ihrem Spiegel bis 2,5 m darüber liegt (tiefer hinge das Wasser in der Luft, höher wäre es
  ein Schacht), ihr Rand bleibt über dem Spiegel, und wo das Land daneben trotzdem tiefer liegt, läuft es ab
  (`drainSpills`): ein Strich über einen Hang füllt nur die Becken in der Höhe seines Startpunkts. Beach arbeitet auf das
  Wasser zu, das dem Startpunkt des Strichs am nächsten liegt (bis 150 m, See, Meer oder Fluss,
  `LandscapeStroke.coastLevel`): unter dem Wasser eine flache Bank (halbe Tiefe), darüber ein Strand, der mit dem Abstand
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
  Wall am Startpunkt des Strichs), Dunes (runde Kämme quer zum Wind, flache Luv-, steile Leeseite), Erode (Regen gräbt
  Rinnen und Schuttfächer). Halten lässt die Form bis zu ihrer vollen Größe wachsen, nicht darüber hinaus
- Cliff rocks: gehalten über steilem Boden (steiler als der Klippenwinkel, höchstens 45 Grad) stehen Klippenmodelle des
  Katalogs entlang der Kante (`ops/landscape/cliff-rocks.ts`): auf einem Raster von Stellen alle 4 m, je Strich einmal
  entschieden; die Breite läuft längs der Höhenlinie, die Front zur tiefen Seite, die Größe folgt dem Gefälle über
  die Modelltiefe (0,5- bis 1,8-fach), leicht eingesenkt, mit etwa halber Breite Abstand zueinander, nicht auf
  Straßen. Die Modelle wählt der Look der Karte (Sandstein in der Wüste, Basalt in Hölle und Endzeit, Mars-Klippen auf
  dem Mars, sonst Felswände) oder das Panel
- Glow cracks: der Boden bricht in ein Netz feiner Lavarisse mit Kruste auf verbranntem Fels; die Risse sinken etwas ein
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
  ab, was aus der Karte fällt, „Increase detail“ verfeinert sie bilinear wie die Höhen selbst (`shiftGround`,
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
  aus der Karte oder, für eine bloße Linie, mit den Einstellungen des Straßenpinsels (Landscape, Road). Ebenso folgt das Flussbett
  seinem Lauf: einen Flusspunkt verschieben oder entfernen (Water, 4, Rivers), die Breite ändern oder „Fewer river
  points“ füllt das alte Bett und gräbt das neue (`moveRiverBed`): Schilf, Steine und Wasserfälle beider Bänder gehen,
  das neue Band bekommt Bodenanstrich, Schilf, Steine und Wasserfälle wie beim ersten Ziehen (`paintRiverBed`,
  `decorateRiver`, dieselben Funktionen wie der Pinsel)

**Terrain (2).** Raise und Lower (Shift kehrt um), Smooth, Flatten (auf die Höhe am Strichanfang), Level (auf eine
eingestellte Höhe; Strg+Klick nimmt sie vom Boden), Roughen (Rauschen), Erode (steile Hänge rutschen zu Geröll),
Terrace (Stufen in einstellbarer Höhe), Cliff (Plateau eine Stufe über dem Strichanfang, Shift eine darunter, harte
Kante wie Warcraft-Klippen), Ramp (zwei Klicks: Rampe zwischen den beiden Höhen, Breite einstellbar; nach dem zweiten
Klick meldet die Statuszeile „Ramp built“ statt weiter „Ramp start set“ zu zeigen).

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
- Gebäude (Katalog-Kategorie `building`, nicht schwimmend) ebnen beim ersten Setzen ihren Boden (`levelUnderBuilding`
  in `ops/object-ops.ts`): der Fußabdruck-Radius, 1,5 m und eine Gitterzelle mehr gehen auf die Grundhöhe (Mittel des
  Bodens unter der Mitte und acht Punkten des Fußabdrucks, Abtrag und Auftrag), darüber hinaus läuft der Boden über den
  Fußabdruck-Radius weich in das Gelände aus (mindestens 4 m und die doppelte Höhe von Abtrag oder Auftrag, so bleiben
  die Böschungen flacher als 1 zu 2). So steht das Haus ganz und kein Hang schneidet hinein.
  Ein Schritt im Verlauf mit dem Setzen; gilt für Place, Line, das Platzieren des Agenten (MCP) und `MapKit.place` der
  Levelskripte und `run_script`. Verschieben, Drehen, Kopieren und Streuen ebnen nichts: ein Haus halb im Hang ist
  danach eine freie Wahl.
- Felsen mit Unterseite (Katalog `base`, siehe [CUSTOM_MAPS.md](CUSTOM_MAPS.md), Assets) setzt der Editor auf ihre
  Platte (`settled` in `ops/object-ops.ts`): Wo die Platte über dem Hang hängt (`undersideGap`: Ebene der Platte,
  gekippt mit `pitch`/`roll`, gegen den Boden auf zwei Ellipsen unter ihr), sinkt der Fels, bis sie überall aufliegt,
  höchstens 35 % seiner Höhe (`MAX_SINK`); müsste er tiefer, kippt er zuerst in Vierteln zum Hang hin, bis der Rest
  passt. Das gilt beim Setzen (Place, Line), beim Streuen mit „Sink on slope“, für Felsen der Landscape-Pinsel und
  des Flussufers (am Ende des Strichs, auf dem Boden, den der Strich hinterlässt), bei Ende (Drop to the ground: Höhe
  0, dann absetzen) und bei „Align to slope“ im Panel (Fels neu aufs Gelände gelegt). Andere Objekte sinken beim
  Streuen weiter nach der Neigung unter ihrer Mitte; schwimmende (Katalog `float`: Boote, Bojen, Stege, Seerosen) weder
  sinken noch kippen mit dem Boden (Place, Line, Streuen, Biom-Pinsel): ihr z zählt ab der Wasserlinie
- Place: ein Klick setzt das gewählte Objekt (Raster-Fang 1 bis 8 m, zufällige Drehung; „Align to slope“ kippt es mit
  dem Boden unter seinem Fußabdruck, bei Felsen unter ihrer Platte, `pitch` und `roll` aus `slopeTilt`, jedes
  Symmetrie-Bild mit seinem eigenen Boden)
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

**Roads (6).** Draw: jeder Klick setzt einen Knoten und verbindet ihn mit dem letzten; ein Klick nahe einem Knoten
schließt dort an, nahe einer Straße entsteht eine Kreuzung (Alt setzt frei). Enter, Rechtsklick oder Doppelklick
beendet die Linie. Edit: Knoten ziehen (auf einem anderen abgelegt verschmelzen sie), Straße wählen; Shift+Klick
nimmt weitere Knoten und Straßen dazu, Ziehen auf freiem Grund wählt per Rahmen (Knoten darin und Straßen mit beiden
Enden darin), Strg+A alles; einen von mehreren gewählten Knoten zu ziehen verschiebt alle, Entf löscht alle,
Breite und Art gelten für alle gewählten Straßen; Breite und Art
(Road, Path, Bridge), S glättet als Kurve, X begradigt, J löst einen Knoten zwischen zwei Straßen auf, Entf löscht.
„Flatten road“ ebnet den Boden quer und glättet ihn längs, „Paint road“ malt eine Schicht darunter (gewählte Straße oder
alle). Die Routen von jedem Spawn zum HQ laufen als Punkte über die Karte (abschaltbar). Routen, Straßenlinien, die
gewählte Straße und eine gezogene Linie liegen in Schritten von 2 m auf dem Boden (`drapedLine`), nicht gerade
zwischen weit entfernten Punkten durch einen Hügel; Routen, Straßen und Punkte über einer Brücke auf ihrem Deck
(`walkHeightAt`, dasselbe Deck wie im Spiel, `bridge-decks.ts`).

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
Wind gilt der des Bioms, „Use the look's wind“ stellt das wieder her); Regler wirken sofort und werden beim Loslassen
ein Schritt im Verlauf.

**Map (9).** Name, Autor, Beschreibung; Größe ändern (die Mitte bleibt, kleiner schneidet die Ränder ab, größer setzt
sie in Randhöhe fort); „Increase detail“ bei Karten mit gröberem Boden als neue Karten (ältere mit 4 m, Importe):
Höhenpunkte auf höchstens 2 m (alte Zellgröße durch eine ganze Zahl, die Ausdehnung bleibt genau, jeder alte Punkt
behält seine Höhe, die neuen kommen bilinear), Bodenfarbe und Wassermasken bilinear auf die neue Auflösung
(`ops/detail.ts`), ein Undo-Schritt; Gelände-Generator über die offene Karte und „Erode the whole map“ (Regen gräbt Rinnen an allen
Hängen, Stärke „Rain“). Beide laufen im Terrain-Worker (`editor/workers/terrain.worker.ts`): der Generator schickt
Bänder von 48 Zeilen, die Ansicht zeigt sie sofort; die Erosion läuft in Scheiben zu 4000 Tropfen, die Ansicht zeigt
den Stand etwa einmal pro Sekunde und zeichnet ihn bandweise neu. Ein Fortschrittsbalken mit „Cancel“ stellt den
alten Boden wieder her; fertig ist es ein Undo-Schritt. Während ein Job läuft, nehmen die Werkzeuge keine Eingaben an,
die Ansicht lässt sich drehen.

**Was wartet.** Solange ein Strich oder ein Ziehen in der Ansicht gehalten wird oder ein Gelände-Job läuft
(`EditorSession.busyReason`), warten Rückgängig, Wiederholen, Speichern (Strg+S; ein Autosave kommt später wieder),
Einfügen (Strg+V), „Restore“, „Test map“, der Bot-Check und das Verlassen der Karte; die Statuszeile sagt, worauf
(„Undo waits: finish the stroke or drag first“). Sonst holte etwa ein Rückgängig unter einem laufenden Job beim Cancel
die Höhen von vor dem Job über bereits zurückgenommene Schritte zurück.

Heightmap (im Map-Panel): „Export 16-bit PNG“ und „Export RAW“ schreiben die Höhen als 16-Bit-Graustufen (oberste
Zeile = Nordrand, schwarz die tiefste, weiß die höchste Höhe; RAW 16 Bit Little Endian, quadratisch wie bei Gaea und
World Machine); der Dateiname trägt den Bereich (`<id>-heights-<tief>m-<hoch>m.png`). „Import…“ liest eine solche Datei
(PNG in Graustufen oder Farbe, 8 oder 16 Bit, alle Zeilenfilter, nicht interlaced; RAW quadratisch), skaliert sie
bilinear auf das Raster der Karte und setzt Schwarz auf „Lowest m“, Weiß auf „Highest m“ (aus dem Dateinamen, wenn er
sie trägt); ein Undo-Schritt (`ops/heightmap.ts`).

**Copy and stamps (0).** Select: ein Rechteck auf der Karte ziehen, Strg+C kopiert es; danach folgt das Stück dem
Zeiger als Umriss, R und Shift+R drehen um 90 Grad, Komma und Punkt um 15, ein Klick setzt es (Strg+V aus jedem
Werkzeug setzt die letzte Kopie). Schalter wählen, was mitkommt: Höhen, Bodenfarbe, Wasser, Objekte, Straßen. Höhen
gelten relativ zum Rand des Stücks: ein Hügel landet auf dem Boden, auf den man ihn setzt; der Rand blendet weich
über (einstellbar). Bodenfarbe geht nach Material, nicht nach Schicht: fehlt es auf der Karte, kommt es als Schicht
dazu, solange Platz ist. „Save the copy“ legt das Stück mit Name und Bild in die Stempel-Bibliothek (IndexedDB
`3dtd-editor-stamps`); Stempel gelten auf jeder Karte, ein Klick wählt einen zum Setzen.

**Rules (G).** Die eigenen Regeln der Karte: Startgeld und HQ-Leben (leer heißt Spiel-Standard: 100 und 500), die
Spuren (wenigste und meiste offene, was der Koop mit Spuren macht, die niemand hält: Close / To the host / Share out;
in der Spawn-Liste schaltet „opt“ einen Spawn auf wahlweise, [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#spurenwahl-e130)),
ob Bauwerke durch Treffer fallen (World, [CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#zerstörbarkeit-e131)),
die erlaubten Tower und die Wellen: die Wellen des Spiels (Budget-Source) oder eine eigene Liste in der Form der Table-
Source ([WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md)): je Welle Name, HP-Faktor, Abstand, Gegnertyp mit Anzahl, dazu die
Wiederholregel nach der letzten Welle; „Start from the game's list“ übernimmt die Liste des Spiels als Anfang.
„Difficulty“ (50 bis 200 %, Standard 100) legt einen Faktor auf das Budget jeder Welle des Spiels, der Druck-Regler
regelt weiter obendrauf ([WAVE_RUN_PLAN.md](WAVE_RUN_PLAN.md), Abschnitt 19); eine eigene Liste behält ihre HP. Prüfen
meldet Fehler der Liste und Regeln ohne schießenden Tower. Sie stehen im Kartendokument (`gameplay`, siehe
[Datei](#speichern-und-dateien)); das Spiel wendet sie an, auch im Koop, wo der Host die ganze Karte sendet
([CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#spielwerte-gameplay)).

**Measure (D).** Klicks setzen Punkte; das Panel zeigt Länge auf der Karte und am Boden entlang, Anstieg und Abstieg,
dazu je Spawn die Spurlänge und die Laufzeit für den langsamsten, einen typischen und den schnellsten Bodengegner.
Darunter Höhenlinien (alle 1 bis 10 m, jede fünfte heller) und ein Raster (10 bis 100 m) zum Einschalten.

„Build areas“ legt eine Fläche auf den Boden, wo ein Spieler einen Tower bauen darf: kräftig grün, wo er steht und
eine Route in Reichweite hat (60 m, die mittlere Grundreichweite der schießenden Tower, `TYPICAL_TOWER_RANGE`), blass
grün außer Reichweite, rot, wo keiner steht: Wasser, zu steil, ein Objekt, die Route selbst, HQ oder Spawn
(`validation/build-areas.ts`). Darunter die Fläche in Reichweite der Routen in m² und wie viele Tower darauf passen
(eine Fläche von 8 x 8 m je Tower, der Mindestabstand des Spiels). Es sind die Regeln des Spiels, nicht nachgebaut:
je Zelle (4 m, auf Karten über 2048 m die längere Seite durch 512) prüft `checkTowerPlacement` Spielfeld, HQ (30 m)
und Spawns (60 m), die Route (10 m, `MIN_DISTANCE_TO_ROUTE`), `CustomMapSurface.buildBlocker` mit
`TOWER_BUILD_RADIUS` (Wasser, Objekte, die das Bauen verbieten) und `resolveTowerFootprint` den Grund unter der
Grundfläche eines Archer-Towers (Wand oder Abbruch unter Mitte oder innerem Ring); die Mitte der Zelle zählt. Die
Rechnung läuft in einem Worker (`workers/build-areas.worker.ts`, 1024 m etwa 0,25 s, 2048 m etwa 0,85 s in Node
gemessen), 0,6 s nach der letzten Änderung (`BUILD_AREA_DELAY_MS`), solange die Fläche oder der Check offen ist; eine
Änderung währenddessen rechnet danach noch einmal. Wasser verdeckt die Fläche darunter (sie liegt auf dem Grund),
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
gezeichnete Straßen und die Linien-Pinsel (Fluss, Straße, Klippe) entstehen an jedem Bild; gespiegelte Linien laufen
rückwärts, damit eine Klippe ihre Seite behält. Ein Strich mit seinen Kopien ist ein Schritt im Verlauf.

„Mirror now“ (oben neben der Symmetrie, auch Strg+K) macht die ganze Karte auf einmal symmetrisch
(`ops/mirror-map.ts`): der Teil der Karte, auf den die Mitte der Ansicht zeigt, wird in die anderen kopiert. Höhen,
Bodenfarbe und Wassermasken Zelle für Zelle; Objekte, Spawns, Straßen und Flüsse der anderen Teile weichen den Bildern
der Quelle (Objektgruppen eines Bilds werden eigene Gruppen). Eine Straße, die die Achse kreuzt, endet am Bild ihres
Quell-Endes, so treffen sich die Hälften; ein Fluss über die Achse bleibt, wie er ist. Das HQ bleibt stehen. Ein
Schritt im Verlauf.

### Gelände-Generator

Presets aus Seed und Stärke auf dem Rauschen von DevWorld: Hills (Hügel in zwei Größen), Valleys (Hügel mit scharfen
Tälern), Islands (Land aus dem Meer, zum Rand hin abfallend, Wasser auf 0 m), Canyon (Hochebene mit gewundener Schlucht
und gestuften Wänden), Terraces (Hügel in flachen Stufen). Im Map-Panel über die offene Karte: Boden ersetzen oder
dazurechnen, wahlweise neu bemalen nach Neigung und Höhe; ein Schritt im Verlauf.

## Prüfen

„Check“ (V) listet Fehler vor Warnungen; ein Klick wählt das Betroffene, wechselt ins passende Werkzeug und zeigt es.
Solange die Liste offen ist, prüft der Editor nach jeder Änderung neu. Unter der Liste steht der Platz für Tower an
den Routen (Fläche in Reichweite, Tower darauf, bei mehreren Spuren die engste), aus derselben Rechnung wie Build areas.

| Code | Art | Bedeutung |
|------|-----|-----------|
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
| `object-on-path` | Warnung | Blockierendes Objekt auf einer Straße |
| `object-floating` | Warnung | Objekte, die mehr als 25 cm in der Luft hängen (`objectsInAir`), gemessen ab der Höhe, auf die der Renderer sie stellt (`seatHeight`): Felsen mit ihrer Platte gegen den Boden (ein Fels, der waagerecht am Hang steht), flache Felsstücke ohne gemessene Platte (Küstenfelsen, Becken; nicht die Kraterringe) mit ihrem Fußabdruck als Platte, abzüglich ihrer halben Dicke (die Küstenfelsen auf Archipelago standen als Platten aus der Flanke), schwimmende Assets mit der Wasserlinie gegen den Spiegel (eine Wassertiefe in z hebt sie hoch), alles andere mit dem Fuß gegen den Boden (Häuser, Mauern, Props an ihrer tiefsten Ecke, Bäume 0,15 m tief). Gehalten ist, was auf einem anderen Objekt steht (Fuß im Fußabdruck, zwischen dessen Fuß und Oberkante), auf dem Deck einer Straßenbrücke (bis 0,25 m über den Rand, höchstens 0,3 m eingesunken) oder auf Eis. Effekte und Assets mit `aloft` (Objekt-Brücken, Seilbahn-Spannen, Gondel) bleiben außen vor. Ebenso gemeldet: ein schwimmendes Asset tiefer unter seinem Wasser als die halbe Höhe (0,25 bis 1,5 m). Zählt sie und wählt den schlimmsten. Ende setzt ihn ab (z 0, Fels auf seine Platte), „Align to slope“ kippt ihn. Ein Gitter von 16 m sucht die Stützen nur für die wenigen in der Luft. Die Levelskripte brechen bei dieser Warnung ab (`finish`), ausgelieferte Karten haben keine (`shipped-maps-check`) |
| `water-floating` | Warnung | Wasser, das in der Luft endet (`waterInAir`): eine nasse Probe eines Gewässers (Maske gesetzt, Boden unter dem Spiegel) neben einer außerhalb der Maske, wo der Boden auf halbem Weg und anderes Wasser dort mehr als 0,5 m unter dem Spiegel liegen (ein See am Hang, ein Ufer, das ein Fluss oder eine Straße durchschnitt, ein Becken auf zu tiefem Land); ein Flussband (alle 2 m zwischen seinen Punkten), dessen beide Ufer einen Meter neben ihm so tief liegen, außer einen Fall hinab und jenseits des Kartenrands. Nennt jedes Gewässer und zeigt die schlimmste Stelle. Abhilfe: Ufer heben, Spiegel senken (Strg-Klick mit Fill füllt bis zum Rand) oder die Maske dort abnehmen. Die Levelskripte brechen ab (`finish`), ausgelieferte Karten haben keine (`shipped-maps-check`) |
| `danger-color` | Warnung | Deko in Gefahrenfarben (rote Pilze, rote Blüten; `DANGER_LOOK` in `render/asset-catalog.ts`, dieselbe Liste wie für die mitgelieferten Karten) bis 30 m an einer Straße: Rot steht im Spiel für Gegner, Treffer und Feuer |
| `scene-cost` | Warnung | Szenenkosten über 100 % (unten): mehr, als eine Karte flüssig zeichnet |

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
  ebenfalls erneuert
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
  Feld 100; später dazugekommene optionale Felder heben die Version nicht, so auch `environment.skyImage`, die Id
  eines Himmelsbilds, ohne Feld prozedural); Version-1-Dateien lesen sich
  unverändert über die Migration 1 nach 2
- Kartendokument Version 3: bis zu zwölf Bodenschichten. Die Gewichte der Schichten 9 bis 12 liegen in einer dritten
  Splat-Karte (`terrain/splat2.u8`), die es nur gibt, solange die Karte mehr als acht Schichten hat
  (`splatMapCount`, `fitSplatMaps`: die neunte Schicht legt sie leer an, das Entfernen bis auf acht wirft sie weg; im
  Verlauf kommt und geht sie mit der Schichtliste). Karten bis acht Schichten speichern, laden und zeichnen wie zuvor,
  ihr `contentHash` bleibt; Version-2-Dateien lesen sich unverändert über die Migration 2 nach 3
- Datei-Menü (drei Punkte): Download map file (`.3dtdmap`), Export top view as picture (PNG, 2048 px an der längeren
  Seite), Frame the whole map, Top view
- „Test map“ speichert und öffnet das Spiel mit `?world=map:<id>` im Test-Tab: ein Fenster mit festem Namen
  (`MAP_TEST_WINDOW`, `3dtd-map-test`), das jeder weitere Test und der Bot-Check wiederverwenden, statt Tabs zu stapeln;
  in der Desktop-App ein eigenes, gleich gehärtetes App-Fenster ([ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md), E26c).
  Das Fenster wird noch im Klick genommen (`window.open('', …)`: leer neu oder das vorhandene, ohne Neuladen) und erst
  nach dem Speichern auf das Spiel geschickt; so greift keine Popup-Sperre, wenn das Speichern samt Vorschaubild länger
  dauert als die Nutzer-Aktivierung des Browsers. Scheitert das Speichern, geht ein leer geöffnetes Fenster wieder zu.
  „From wave“ neben dem Knopf (1 bis 200, gilt, solange der Editor offen ist) startet den Test bei Welle N
  (`&fromWave=N`, `customMapStartWave`): die Wellen davor zählen als gespielt, der Spieler hat das Gold und die
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
  „Restore“ holt eine zurück (ein Undo-Schritt). Ein Absturz kostet so höchstens die Minuten seit dem letzten Autosave.
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
- Budget im Map-Panel (`editor/validation/map-budget.ts`): die Szenenkosten der Objekte („Prüfen“, Szenenkosten) und
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
src/app/editor/
  model/            EditorDocument (Befehle, Verlauf, Auswahl), Raster-Helfer, Kachel-Patches
  ops/              Operationen ohne Angular: Pinsel, Gelände, Farbe, Wasser, Objekte, Wegenetz, Straßen-Boden, Größe
  ops/landscape/    Landschafts-Pinsel: Biome, Formen, Erosion, Fluss, Straße, LandscapeStroke (ein Undo-Schritt)
  ops/symmetry.ts   Bilder der Symmetrie, Sektor des Zeigers, Kopieren der Zellen und Objekte
  ops/stamp.ts      Stücke kopieren und setzen; model/stamp-store.ts die Stempel-Bibliothek
  ops/generate.ts   Gelände-Generator; ops/contours.ts Höhenlinien
  ops/map-kit.ts    MapKit: die Operationen ohne Oberfläche für Skripte (Level-Skripte, KI-Agent)
  agent/            KI-Agent über MCP (Desktop-App): Werkzeuge, Skript-Sandbox, Abspielen als ein Undo-Schritt (AGENT_MCP.md)
  tools/            Werkzeuge: Zeigereingaben zu Befehlen
  validation/       Prüfen
  view/             EditorViewport (Renderer, Kamera, Eingabe), Overlay, Kamera, EditorMapView, ThumbnailRenderer
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

**Leistung.** Ein Pinselschritt bleibt unter 2 ms auf Karten mit 256, 512 und 1024 Samples je Seite
(`editor-brushes.perf.spec.ts`, Budgets in `npm run test:perf`): Biom-Pinsel merken sich je Strich das Rauschen jedes
Texels (Grundmischung, Ufer, Risse, Rand) in Kacheln von 64 x 64 (`FieldCache`), statt es bei jedem Tupfer neu zu
rechnen (Wald 2,3 auf 1,1 ms). Objekte gehen sofort in ihre Zelle: die Zell-Meshes halten Platz frei (die Hälfte
mehr, mindestens 16), neue Objekte landen in freien Slots, ein entferntes ersetzt der letzte der Zelle; neu gebaut
wird eine Zelle erst, wenn der Platz ausgeht. Pinsel auf einer Wassermaske bauen nur die Wasserkacheln (64 Zellen)
und das Ufer in ihrem Rechteck neu, das Hauptwasser wie die weiteren Gewässer; ganz neu (höchstens alle 120 ms)
nur bei Spiegel, Art oder Symmetrie. Die Geländeverdeckung (Horizontsuche) eines gehaltenen Pinsels wartet, bis die
Höhen ruhen (120 ms, höchstens 500 ms), und arbeitet dann einige Millisekunden je Bild ab. Den Himmel baut die
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
deshalb vorab und im Hintergrund (`compileAsync`, parallel, wo der Treiber es kann): beim Laden die Karte, danach im
Leerlauf die Programme des Bilds von oben (`renderTopDown` für Minikarte und Vorschau: Render-Target und kein Nebel
ergeben eigene Programme) und die Varianten des Geländeshaders mit mehr Schichten (`MapTerrainLayer.layerTwins`; die
Schleife über die Schichten ist auf 4, 8 oder 12 gerundet, ein neues Biom springt sonst im ersten Strich auf die
nächste Stufe). Bei der Wahl eines Bioms oder Objekts übersetzt `warmUpAssets` dessen Modelle für beide Bilder und
die Schattentiefe: Zwillinge der Tiefenmaterialien, wie der Schattenpass sie ableitet (`getDepthMaterial`), ohne
Nebel und Umgebung, da beide zum Schlüssel eines Programms gehören, auch wo der Shader sie nicht nutzt. Die
Zwillinge bleiben, denn three wirft ein Programm weg, das kein Material mehr nutzt.

**Palettenbilder.** Ein kleiner eigener Renderer zeichnet ein Bild je Leerlauf (`requestIdleCallback`), übersetzt
dessen Programme vorab und gibt das Bild als `ImageBitmap` an einen Worker, der es als PNG kodiert
(`thumbnail-encode.worker.ts`); das Zurücklesen von der GPU wartet dort statt im Bild. Die Materialien der Boden-
und Biom-Bilder bleiben erhalten: jedes Wegwerfen nahm das Programm mit, und das nächste Bild übersetzte es neu
(über eine halbe Sekunde).

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
Ausgeblendete Kategorien bekommt der Renderer als eigene Liste über einen Proxy des Dokuments, da er sie in sein
Dokument schreibt.

**Landschafts-Pinsel.** Ein `LandscapeStroke` nimmt Höhen, Splat, Wassermaske (Kachel-Patches), neue Schichten,
neues Wasser, neue Objekte und geänderte Straßen eines Strichs auf und legt sie als einen `CompoundCommand` in den
Verlauf. Höhen ziehen zu einem Ziel aus dem Boden vor dem Strich (`RegionRecorder.original`), daher türmt sich
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
wieder ein Sample) und meldet die Rechtecke der Bilder an die Ansicht; `BrushStroke` und `LandscapeStroke` sichern
die Ziel-Kacheln vorher. Ein Stück (`Stamp`) hält Höhen relativ zum Rand, Farbe je Material, Wasser, Objekte und die
Straßen, deren beide Enden darin liegen; `pasteStamp` setzt es gedreht über einen `LandscapeStroke`.

**Angular.** `EditorSession` (je Seite) hält Karte, Werkzeuge, Einstellungen und Signale für die Panels; Viewport und
Taktgeber laufen außerhalb der Zone, Änderungen am Dokument erreichen die Panels höchstens alle 150 ms.

**Datei.** `.3dtdmap` ist ein Zip (fflate) mit `map.json` und den Arrays als Little-Endian-Binärdateien
(`terrain/heights.f32`, `terrain/splat0.u8`, `terrain/splat1.u8`, ab neun Bodenschichten `terrain/splat2.u8`,
`terrain/water-mask.u8`), optional `preview.png`.
`contentHash` ist SHA-256 über das kanonische JSON der Welt (Schlüssel sortiert, ohne Name, Beschreibung und Zeiten)
und die Arrays; Umbenennen und erneutes Speichern ändern ihn nicht. Beim Lesen laufen erst die Migrationen
(`MAP_MIGRATIONS`, je Version ein Schritt), dann die Prüfung; Fehler kommen als `MapFileError` mit Klartext.

**Tests.** Vitest: `map-file.spec.ts`, `map-store.spec.ts`, `editor-document.spec.ts`, `ops.spec.ts`,
`path-graph.spec.ts`, `map-validation.spec.ts`, `validation/build-areas.spec.ts` (jede Zellart nach den Regeln des
Spiels, Platz je Spur), `tools.spec.ts`, `ops/landscape/landscape.spec.ts` (Gleichheit bei
gleichem Seed, Rand, Dichte, Freihalten von Straßen und Markern, ein Undo-Schritt, Formen, Erosion, Fluss mit Brücke,
Straße), `ops/symmetry.spec.ts`, `ops/stamp.spec.ts`, `ops/generate.spec.ts`, `ops/contours.spec.ts`. `editor-fuzz.spec.ts`
spielt je Seed (1, 7, 42, 99, 2026) 90 zufällige Schritte über die Werkzeuge und Befehle (Gelände- und Farbpinsel,
Wasser, Setzen auch am Hang ausgerichtet, Streuen und Ausdünnen, Radieren, Reihen entlang Linien und Straßen, Gizmo
verschieben, drehen und skalieren, Löschen, Duplizieren, Gruppieren, Ende, Tönen, Straßen zeichnen, ziehen, glätten
und verbreitern, Rahmenwahl, Spawns und HQ, Landschaft mit Biomen, Formen, Fluss, Straße, Klippe und Klippenfelsen,
Flusspunkte samt neuem Schilf und neuen Steinen, alte Straßen ohne gemerkte Ausstattung, „Rebuild road dressing“,
Stempel mit Drehung, Symmetrie, „Mirror now“, Heightmap-Import, Größe ändern, „Increase detail“,
Restore, Umgebung, Sprünge im Verlauf) und verlangt: alle Undos ergeben `contentBytes` des Anfangs bytegleich, alle
Redos die des Endes, und jeder Zustand unterwegs (Undo, Redo, Sprung) ist die Karte, wie sie nach diesem Schritt war;
eine neue Straße, deren Ausstattung abgebaut und neu gebaut wird, lässt den Boden auf 2 mm gleich (gemerkter Boden;
ohne Straßen, die sie geteilt hat, siehe die bekannte Grenze oben); neben fünf festen Seeds laufen fünf weitere, die
einmal an Annahmen des Tests selbst scheiterten (ein Lauf, der mit einem Sprung zurück endet, wird erst zu Ende
wiederholt);
ein Fehler nennt Seed und Schritte. Undo während Strich, Drag oder Job sperrt
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
