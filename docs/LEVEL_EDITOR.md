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
Kopie öffnet und keine zweite anlegt.

- **New map:** Name, Autor, Größe (Small 512 m, Medium 1024 m, Large 2048 m, Wide 2048 x 1024 m), Vorlage oder Boden
  (Flat, Hills, Valleys, Islands, Canyon, Terraces mit Seed und Stärke, siehe [Generator](#gelände-generator)) mit
  Grundmaterial. Eine Vorlage (Meadows, Woods, Mountains, Swamp, Desert, Arctic, City, Hell, Wasteland, Moon, Mars)
  legt Gelände aus dem Generator an, malt die ganze Karte mit ihrem Biom (Boden, Relief, Becken, Objekte) und setzt
  Himmel, Licht, Nebel, Tönung und Wetter; das Biom läuft in Bändern über die Karte (`biomeBand`). Jede neue Karte hat
  die Detailstufe der mitgelieferten Level, ohne Wahl: Höhenpunkte alle 2 m (`DEFAULT_CELL_SIZE`) und die Bodenfarbe
  mit etwa einem Texel je Meter, höchstens 1024 px (`splatResolutionFor`). „Meadows“ auf 1024 m braucht vom Klick bis
  zum offenen Editor 1,8 bis 2,7 s (mit 4 m waren es 0,9 bis 1,6 s; Chromium, RTX 5080, 2026-10-14). Jede neue Karte hat eine Straße von West zum HQ und einen Spawn an ihrem Ende, damit sie sofort
  spielbar ist; der Generator ebnet die Straße und legt sie, wo sie unter Wasser liefe, auf einen Damm
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
| P | Probewelle: die Gegner laufen die Routen ab (auch der Knopf „Trial wave“) |
| Strg+K | Befehle: Werkzeuge, Pinsel, Biome, Ansichten, Symmetrie, Marker und die Objekte der Karte nach Namen |
| 1 bis 9, 0, G, D | Werkzeug: Landscape, Terrain, Paint, Water, Objects, Roads, Spawns and HQ, Sky and weather, Map, Copy and stamps, Rules, Measure |
| M | Symmetrie reihum: aus, Mirror X, Mirror Y, Both, Turn 2, Turn 4 (auch oben in der Kopfleiste) |
| Alt+1 bis 9 (Strg+Ziffer, wo der Browser sie lässt) | Kamera-Ansicht merken; Shift+Ziffer fliegt hin; die Knöpfe 1 bis 9 unter der Minikarte ebenso (Alt-Klick merkt) |
| ? | Übersicht aller Tasten; unter „Your keys“ lassen sich die Einzeltasten (Werkzeuge, F, T, C, P, V, M) umlegen, gespeichert in `3dtd-editor-keys` |
| [ und ], Strg+Mausrad | Pinsel kleiner, größer; { und } Stärke |
| Strg+Z, Strg+Y (Strg+Shift+Z) | Rückgängig, Wiederholen |
| Strg+S | Speichern mit neuem Vorschaubild |
| V | Prüfen (außer im Objektwerkzeug) |
| Esc | Halbfertiges abbrechen, Auswahl aufheben |

Die Steuerung folgt Unity und Unreal, nicht dem Spiel: die linke Taste gehört immer dem gewählten Werkzeug, die Ansicht
bewegen die anderen Tasten (Entscheidung 2026-10-11). Eine Legende unten rechts in der Ansicht zeigt das ständig
(schließbar, `localStorage` `3dtd-editor-legend`), der erste Schritt der Tour erklärt es.

Die Paletten zeigen gerenderte Bilder: Objekte mit ihrem Modell schräg von oben, Bodenmaterialien als beleuchtete
Kugel, Biome als kleines Stück Boden mit ihren Pflanzen. Ein kleiner eigener Renderer zeichnet sie im Hintergrund und
hebt sie in IndexedDB (`3dtd-editor-thumbs`) auf; bis ein Bild fertig ist, steht ein gezeichnetes Symbol.

Die linke Leiste zeigt jedes Werkzeug mit Symbol und Namen, in drei Gruppen: Shape (Landscape, Terrain, Paint, Water,
Objects), Play (Roads, Spawns, Rules) und Map (Sky, Map, Stamps, Measure). Rechts stehen zwei Reiter: die Optionen des
Werkzeugs und die Gliederung; ein Werkzeug zu wählen zeigt seine Optionen. Werkzeuge mit Modi (Landscape, Terrain,
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

**Einstieg.** Beim ersten Öffnen einer Karte führt eine Tour in sieben Schritten durch den Editor: Ansicht, Landschaft
malen, Weg ziehen, Spawn und HQ, Check, Probewelle, Test map. Ein Schritt geht von selbst weiter, wenn man tut, was
er sagt (ein Strich, eine Straße, ein Spawn, der Check, die Probewelle, der Test), sonst mit „Next“; „Skip the
tour“ beendet sie. Danach kommt sie nicht mehr von selbst (localStorage `3dtd-editor-tour`), die Hilfe (?) und
Strg+K starten sie wieder. Die Hilfe hat neben den Tasten die Seite „Good levels“: Weglänge, Engstellen, Bauflächen,
Sichtlinien, Spurzahl und Testen, jeweils mit einem Knopf, der das passende Werkzeug öffnet. Kann eine Karte nicht
gespeichert werden, sagt ein Banner im Editor, was passiert ist, dass die Änderungen noch da sind und was zu tun ist.

## Werkzeuge

**Landscape (1).** Landschaft malen: Höhe, Bodenfarbe, Wasser und Objekte entstehen gemeinsam, jeder Strich ist
ein Schritt im Verlauf. Jeder Strich hat einen Seed (im Panel und in der Statuszeile, „Roll“ würfelt, der Schalter
würfelt nach jedem Strich neu); derselbe Seed und derselbe Strich ergeben dieselbe Landschaft.
- Biome: Meadow, Forest, Pine forest, Rocks, Mountains, Swamp, Desert, Snow, Arctic, Village, City, Hell, Wasteland,
  Moon, Mars. Halten malt; die Stärke bestimmt Dichte und Ausprägung, der Rand franst aus. Unterholz, Büsche und Zäune
  wachsen am Rand des Strichs, Bäume und Häuser innen; eine Objektart mischt alle ihre Kandidaten aus dem Katalog.
  Objekte meiden Straßen, Wasser, Spawns und HQ; der Boden unter Straßen bleibt. Sumpf, Hölle und Arktis legen Becken
  an, gefüllt mit einem eigenen Gewässer der Art Swamp, Lava oder Ice (ein vorhandenes in der Nähe des Startpunkts
  wird mitbenutzt). City legt ein Straßenraster fest auf die Karte (alle 64 m, Asphalt und Gehwege), Häuser stehen an
  den Blockrändern zur Straße gewandt, Laternen auf den Gehwegen; Hell legt Glutrisse über den Boden; Wasteland und
  Moon haben Kraterfelder. Sind die acht Bodenschichten voll, sagt die Statuszeile, welche Materialien fehlen. Unter dem Zeiger zeigen Punkte, wo der nächste
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
  Schlammufern (bei Lava verbrannter Fels), Schilf, Steinen, einem Wasserfall über jeder steilen Stufe und einer
  Brücke an jeder Straße, die er kreuzt; Road legt eine Straße ins Wegenetz (Anfang und Ende rasten an Knoten oder
  Straßen), passt den Boden als Damm oder Einschnitt an, pflastert sie und stellt Laternen oder Zäune an den Rand. Was
  er gebaut hat, merkt sich die Kante (`dress`); zieht man danach einen Knoten, glättet, begradigt oder verbreitert die
  Straße (Roads, 6), legt der Editor das alles neu an: der alte Streifen wird zurückgebaut (die Höhen genau wie vor der
  Straße: `dress.ground` hält je Höhenpunkt des Bands die Höhe vorher und nach dem Einebnen, auf den Millimeter;
  danach Geformtes bleibt als Unterschied erhalten; ohne gemerkte Höhen oder auf einem anderen Raster gerade vom Land
  am einen Rand zum anderen, `restoreBand`; der Bodenanstrich blendet immer so), seine Laternen und Zäune gehen,
  entlang der neuen Linie entstehen Damm, Belag und Ausstattung neu; ein Schritt im Verlauf. Straßen ohne `dress` (aus Karten von
  vorher, aus Level-Skripten) liest der Editor beim ersten Bearbeiten von der Karte ab (`inferDress`): Laternen und Zäune
  an ihren Seiten und den Belag entlang der Mitte, wenn es ein Straßenbelag ist, den das Land daneben nicht hat; ihr
  Boden vor der Straße ist dann unbekannt, der Rückbau füllt gerade. Findet er nichts, bleibt die Straße eine bloße
  Linie. „Rebuild road dressing“ im Roads-Panel legt die Ausstattung der gewählten Straßen neu an: aus ihrem `dress`,
  aus der Karte oder, für eine bloße Linie, mit den Einstellungen des Straßenpinsels (Landscape, Road). Ebenso folgt das Flussbett
  seinem Lauf: einen Flusspunkt verschieben oder entfernen (Water, 4, Rivers), die Breite ändern oder „Fewer river
  points“ füllt das alte Bett und gräbt das neue (`moveRiverBed`): Schilf, Steine und Wasserfälle beider Bänder gehen,
  das neue Band bekommt Bodenanstrich, Schilf, Steine und Wasserfälle wie beim ersten Ziehen (`paintRiverBed`,
  `decorateRiver`, dieselben Funktionen wie der Pinsel)

**Terrain (2).** Raise und Lower (Shift kehrt um), Smooth, Flatten (auf die Höhe am Strichanfang), Level (auf eine
eingestellte Höhe; Strg+Klick nimmt sie vom Boden), Roughen (Rauschen), Erode (steile Hänge rutschen zu Geröll),
Terrace (Stufen in einstellbarer Höhe), Cliff (Plateau eine Stufe über dem Strichanfang, Shift eine darunter, harte
Kante wie Warcraft-Klippen), Ramp (zwei Klicks: Rampe zwischen den beiden Höhen, Breite einstellbar).

**Paint (3).** Bis zu acht Bodenschichten aus dem Katalog (beim Hinzufügen nach Biom gruppiert); die Liste wählt die Schicht zum Malen, tauscht ihr Material,
verschiebt und entfernt sie (ihr Gewicht geht an die anderen). Halten malt, Shift oder der Schalter radiert. „Auto paint
the map“ malt die ganze Karte neu: die erste Schicht überall, felsartige Schichten an steilen Hängen, sandartige am
Ufer, schneeartige auf den Gipfeln (nach dem Materialnamen). Darunter das Klippenmaterial und ab welcher Neigung es
greift.

**Water (4).** Das Hauptwasser und weitere Gewässer, jedes mit eigenem Spiegel, eigener Art (Water, Sea, Swamp, Ice,
Lava) und Farbe; das Panel listet sie, das gewählte bearbeitet das Werkzeug. Fill basin: ein Klick in eine Mulde flutet
sie. Ohne Wasser (oder mit Strg) wird der Spiegel knapp unter den Rand der Mulde gesetzt, also die Höhe, an der sie
überlaufen würde. Dig lake gräbt unter dem Pinsel ein Seebett bis zur eingestellten Tiefe und füllt es. Paint und
Erase malen die Maske von Hand. Sea from the edge flutet das Gewässer vom Kartenrand her über alles unter seinem
Spiegel.

**Objects (5).** Palette aus dem Katalog mit Bildern, Kategorien (auch Structures und Effects), Biom-Filter nach den
Tags des Katalogs und Suche (Name, Id oder Tag).
- Place: ein Klick setzt das gewählte Objekt (Raster-Fang 1 bis 8 m, zufällige Drehung; „Align to slope“ kippt es mit
  dem Boden unter seinem Fußabdruck, `pitch` und `roll` aus `slopeTilt`, jedes Symmetrie-Bild mit seinem eigenen Boden)
- Scatter: halten streut die gewählten Assets (mehrere wählbar) mit Dichte, Größenbereich, Mindestabstand, zufälliger
  Drehung, Einsinken am Hang und „Align to slope“; Shift dünnt aus
- Line: das gewählte Objekt in einer Reihe, frei gezogen oder per Klick entlang einer Straße oder eines Flusses: Abstand,
  Versatz (links der Laufrichtung, negativ rechts; bei Straßen etwa die halbe Breite), „Both sides“ (eine zweite Reihe
  gegenüber, andersherum gedreht), Drehung längs, quer oder zufällig, „Align to slope“; die Symmetrie-Bilder entstehen
  mit; ein Schritt im Verlauf (`objectsAlong`, wie `row` der Level-Skripte). Zäune, Mauern, Fackeln, Baumreihen
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
alle). Die Routen von jedem Spawn zum HQ laufen als Punkte über die Karte (abschaltbar).

**Spawns and HQ (7).** Q: Klick setzt einen Spawn (Name nach Himmelsrichtung, im Panel änderbar; höchstens 32, dann sagt die Statuszeile
warum), H: Klick versetzt das
HQ. Ziehen verschiebt beide; sie rasten auf die nächste Straße (Alt frei). Shift+Klick wählt mehrere Spawns, Strg+A
alle; einen davon zu ziehen verschiebt alle mit gleichem Abstand, Entf löscht alle. Das Panel zeigt je Spawn die Länge seiner
Spur oder „no route“.

**Sky and weather (8).** Himmel (Day, Dusk, Night, Overcast), Tageszeit (ein Sommertag: Aufgang 6 Uhr im Osten, 13 Uhr im
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
Wiederholregel nach der letzten Welle; „Start from the game's list“ übernimmt die Liste des Spiels als Anfang. Prüfen
meldet Fehler der Liste und Regeln ohne schießenden Tower. Sie stehen im Kartendokument (`gameplay`, siehe
[Datei](#speichern-und-dateien)); das Spiel wendet sie an, auch im Koop, wo der Host die ganze Karte sendet
([CUSTOM_MAP_WORLD.md](CUSTOM_MAP_WORLD.md#spielwerte-gameplay)).

**Measure (D).** Klicks setzen Punkte; das Panel zeigt Länge auf der Karte und am Boden entlang, Anstieg und Abstieg,
dazu je Spawn die Spurlänge und die Laufzeit für den langsamsten, einen typischen und den schnellsten Bodengegner.
Darunter Höhenlinien (alle 1 bis 10 m, jede fünfte heller) und ein Raster (10 bis 100 m) zum Einschalten.

### Symmetrie

Für faire Karten: Mirror X (Ost und West gespiegelt), Mirror Y (Nord und Süd), Both (vier Viertel), Turn 2 (halbe
Drehung um die Mitte), Turn 4 (Vierteldrehung, nur quadratische Karten; sonst halbe Drehung). Hilfslinien zeigen die
Achsen. Pinsel (Terrain, Paint, Water, Landscape) kopieren nach jedem Tupfer die geänderten Zellen aus dem Teil der
Karte, in dem der Zeiger steht, in die Bilder: die Kopien sind exakt. Gesetzte und gestreute Objekte, Spawns,
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
Solange die Liste offen ist, prüft der Editor nach jeder Änderung neu.

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
| `path-under-water` | Warnung | Straße (keine Brücke) unter Wasser |
| `path-steep` | Warnung | Straße steiler als 30 Grad |
| `object-on-path` | Warnung | Blockierendes Objekt auf einer Straße |
| `danger-color` | Warnung | Deko in Gefahrenfarben (rote Pilze, rote Blüten; `DANGER_LOOK` in `render/asset-catalog.ts`, dieselbe Liste wie für die mitgelieferten Karten) bis 30 m an einer Straße: Rot steht im Spiel für Gegner, Treffer und Feuer |

## Speichern und Dateien

- Autosave schreibt zwei Sekunden nach der letzten Änderung in IndexedDB; die Kopfzeile zeigt „Unsaved changes“,
  „Saving“ oder „Saved“. Strg+S speichert sofort mit neuem Vorschaubild; beim Verlassen der Karte wird das Bild
  ebenfalls erneuert
- Ein Tab je Karte (`editor/model/map-lock.ts`): wer eine Karte zuerst öffnet, hält ihre Web-Sperre
  (`navigator.locks`, Name `3dtd-map:<id>`). Ein zweiter Tab öffnet sie schreibgeschützt: Banner „Another tab edits
  this map“, Kopfzeile „Read only“, die Panels aus, Werkzeuge und Werkzeugtasten aus, Rückgängig, Speichern, Einfügen,
  Restore und Test warten; ansehen geht. „Take over editing“ bittet den anderen Tab über einen `BroadcastChannel`, zu
  speichern (Halbfertiges wie ein gehaltener Strich oder ein Gelände-Job fällt weg) und loszulassen; der wird
  schreibgeschützt und reiht sich ein, dieser liest die Karte neu und bearbeitet sie. Antwortet der andere nicht in
  3 s (eingefroren, schlafender Tab), nimmt er die Sperre mit `steal`. Schließt der bearbeitende Tab, bekommt der
  wartende die Karte von selbst. Ohne Web Locks (alte Browser) darf jeder Tab bearbeiten, wie früher
- Kontextverlust: setzt der Grafiktreiber zurück (oder der GPU-Prozess startet neu), verliert die Ansicht ihren
  WebGL-Kontext. Die Karte liegt im Speicher, nicht auf der GPU: der Editor speichert sofort, ein Banner sagt „View
  lost … Your map is safe“ (mit „Reload the page“, das vorher speichert). Kommt der Kontext zurück
  (`webglcontextrestored`), baut die Ansicht sich neu (`rebuildView`: die Textur-Arrays behalten nach dem Hochladen
  keine Pixel, ein bloßes Wiederhochladen ginge nicht)
- Dauerhaft halten: ein Browser darf IndexedDB bei Platzmangel räumen, samt Versionen. Das erste Speichern je Seite
  fragt daher `navigator.storage.persist()` (`editor/model/storage-safety.ts`; Firefox fragt den Spieler, Chrome
  entscheidet selbst). Das Map-Panel (9) zeigt unter „Storage“ den Stand: Kartenordner der Desktop-App, „keeps your
  maps for good“ oder die Warnung samt „Download map file“. Darf der Browser räumen, erinnert nach 30 Minuten Arbeit
  ohne Download ein Banner daran („Download“, „Later“ schiebt es um weitere 30 Minuten)
- Kartendokument Version 2: optionales Feld `dress` je Straßenkante (Damm, Belag, Laternen und Zäune des Straßenpinsels
  mit den Ids ihrer Objekte und dem Boden des Bands vor dem Einebnen, `ground`, gepackt in `road-ground.ts`: etwa
  4 Byte je Höhenpunkt, eine 300 m lange Straße auf 2-m-Raster rund 12 kB Text vor dem Zip; die mitgelieferten Level
  wachsen dadurch um 21 bis 54 kB, 2 bis 7 %; nur der Editor liest es); optionales Feld `gameplay` (`startCredits`, `hqHealth`, `towers`, `waves` als
  `{ kind: 'budget' }` oder `{ kind: 'table', table }` in der Form der Table-Source); Version-1-Dateien lesen sich
  unverändert über die Migration 1 nach 2
- Datei-Menü (drei Punkte): Download map file (`.3dtdmap`), Export top view as picture (PNG, 2048 px an der längeren
  Seite), Frame the whole map, Top view
- „Test map“ speichert und öffnet das Spiel mit `?world=map:<id>` im Test-Tab: ein Fenster mit festem Namen
  (`MAP_TEST_WINDOW`, `3dtd-map-test`), das jeder weitere Test und der Bot-Check wiederverwenden, statt Tabs zu stapeln;
  in der Desktop-App ein eigenes, gleich gehärtetes App-Fenster ([ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md), E26c)
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
- Budget im Map-Panel (`editor/validation/map-budget.ts`): Objekte gegen 15 000 (was eine Karte flüssig hält,
  [SHOWCASE_LEVELS.md](SHOWCASE_LEVELS.md)) und die Dateigröße gegen die 32 MB, die ein Koop-Raum verschickt
  ([COOP_PLAN.md](COOP_PLAN.md), C1c). Die Größe ist die des letzten manuellen Speicherns (gleiche Packstufe wie der
  Koop-Versand; Autosaves packen leichter und größer); ab 80 % gelb, darüber rot mit Hinweis
- Probewelle (P, „Trial wave“): die Gegnermodelle des Spiels laufen jede Route vom Spawn zum HQ mit ihrer echten
  Geschwindigkeit und Animation, die Typen der ersten Welle der eigenen Wellenliste oder eine Mischung (Zombie, Ratte,
  Panzer, Spinne, Skelett); die Statuszeile nennt, wie lange der schnellste und der langsamste bis zum HQ brauchen

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
Doppelte von 4 m (gut 1 ms). Der erste Strich mit neuen Modellen übersetzt deren Shader (Spitzen bis 1,5 s), die
Bilder der Paletten rendern beim ersten Öffnen eines Werkzeugs im Hintergrund.
Ganze Karten (Vorlagen) malt `biomeBand` in Bändern mit Pausen dazwischen.
Ausgeblendete Kategorien bekommt der Renderer als eigene Liste über einen Proxy des Dokuments, da er sie in sein
Dokument schreibt.

**Landschafts-Pinsel.** Ein `LandscapeStroke` nimmt Höhen, Splat, Wassermaske (Kachel-Patches), neue Schichten,
neues Wasser, neue Objekte und geänderte Straßen eines Strichs auf und legt sie als einen `CompoundCommand` in den
Verlauf. Höhen ziehen zu einem Ziel aus dem Boden vor dem Strich (`RegionRecorder.original`), daher türmt sich
nichts auf. Objekte stehen auf einem verwackelten Raster je Objektart und Seed (eine Stelle und ein Würfel je Zelle,
einmal entschieden); Kern-Objekte wachsen, sobald der Pinsel stark genug war, Rand-Objekte werden am Strichende nach
dem stärksten erreichten Gewicht entschieden. Rauschen aus `devworld/utils/seeded-random.ts`. Ein Fluss ist ein
`MapRiver` in `terrain.rivers` (Punkte alle 8 m mit Breite und Spiegelhöhe, Fließrichtung ab Punkt 0): der Spiegel
liegt am oberen Ende knapp unter dem Boden und fällt danach nie und mindestens 0,4 cm je Meter; wo er mehr fällt, als er
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
(`terrain/heights.f32`, `terrain/splat0.u8`, `terrain/splat1.u8`, `terrain/water-mask.u8`), optional `preview.png`.
`contentHash` ist SHA-256 über das kanonische JSON der Welt (Schlüssel sortiert, ohne Name, Beschreibung und Zeiten)
und die Arrays; Umbenennen und erneutes Speichern ändern ihn nicht. Beim Lesen laufen erst die Migrationen
(`MAP_MIGRATIONS`, je Version ein Schritt), dann die Prüfung; Fehler kommen als `MapFileError` mit Klartext.

**Tests.** Vitest: `map-file.spec.ts`, `map-store.spec.ts`, `editor-document.spec.ts`, `ops.spec.ts`,
`path-graph.spec.ts`, `map-validation.spec.ts`, `tools.spec.ts`, `ops/landscape/landscape.spec.ts` (Gleichheit bei
gleichem Seed, Rand, Dichte, Freihalten von Straßen und Markern, ein Undo-Schritt, Formen, Erosion, Fluss mit Brücke,
Straße), `ops/symmetry.spec.ts`, `ops/stamp.spec.ts`, `ops/generate.spec.ts`, `ops/contours.spec.ts`. `editor-fuzz.spec.ts`
spielt je Seed (1, 7, 42, 99, 2026) 90 zufällige Schritte über die Werkzeuge und Befehle (Gelände- und Farbpinsel,
Wasser, Setzen auch am Hang ausgerichtet, Streuen und Ausdünnen, Radieren, Reihen entlang Linien und Straßen, Gizmo
verschieben, drehen und skalieren, Löschen, Duplizieren, Gruppieren, Ende, Tönen, Straßen zeichnen, ziehen, glätten
und verbreitern, Rahmenwahl, Spawns und HQ, Landschaft mit Biomen, Formen, Fluss, Straße, Klippe und Klippenfelsen,
Flusspunkte, Stempel mit Drehung, Symmetrie, „Mirror now“, Heightmap-Import, Größe ändern, „Increase detail“,
Restore, Umgebung, Sprünge im Verlauf) und verlangt: alle Undos ergeben `contentBytes` des Anfangs bytegleich, alle
Redos die des Endes, und jeder Zustand unterwegs (Undo, Redo, Sprung) ist die Karte, wie sie nach diesem Schritt war;
ein Fehler nennt Seed und Schritte. Undo während Strich, Drag oder Job sperrt
die Session (`editor-session.spec.ts`). Browser:
`e2e/tests/editor.e2e.ts` (neue Karte, Gelände, Objekt mit Rückgängig, Straße, Spawn, gespiegeltes Objekt, kopiertes
und gesetztes Stück, Prüfen, Speichern, Neuladen, Löschen; ohne Kartensitzung).

## Grenzen

- Gruppen, ausgeblendete Kategorien und Versionen kennt nur der Editor; das Spiel ignoriert `group`
