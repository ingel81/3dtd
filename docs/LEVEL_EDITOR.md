# Karteneditor

**Status:** Aktuell, seit 0.7.0 auf `main`, im Spiel gesperrt bis zur Freigabe (TODO E134); die nächste Runde plant [CUSTOM_MAPS_NEXT_PLAN.md](CUSTOM_MAPS_NEXT_PLAN.md) (E154). Kartendokument: [WORLD_PROVIDER_PLAN.md](WORLD_PROVIDER_PLAN.md).

Unter `/editor` baut man eigene Karten: Gelände, Bodentexturen, Wasser, Objekte, Straßen, Spawns und HQ. Eine Karte
liegt im Browser (IndexedDB; in der Desktop-App zusätzlich als Datei in `Dokumente/3DTD/Maps`, [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md) E26b), lässt sich als `.3dtdmap` herunterladen und wieder einlesen und mit „Test map“ im Spiel
öffnen (`?world=map:<id>`). Der Einstieg im Hauptmenü ist „Map editor“ (Lage Start, unter der Linie; mit laufendem Lauf
fragt das Menü vorher). Die Oberfläche ist englisch wie das übrige Spiel.

## Kartenliste

Die Startseite von `/editor` zeigt links die eigenen und die mitgelieferten Karten (Bild, Größe, Spawns, Objekte,
zuletzt geändert), rechts die gewählte mit Beschreibung und den Knöpfen Open, Duplicate, Download, Delete (zweimal
bestätigen). Mitgelieferte Karten (`public/maps/index.json`) sind schreibgeschützt: „Copy and edit“ legt eine eigene
Kopie an und öffnet sie.

- **New map:** Name, Autor, Größe (Small 512 m, Medium 1024 m, Large 2048 m, Wide 2048 x 1024 m), Vorlage oder Boden
  (Flat, Hills, Valleys, Islands, Canyon, Terraces mit Seed und Stärke, siehe [Generator](#gelände-generator)) mit
  Grundmaterial. Eine Vorlage (Meadows, Woods, Mountains, Swamp, Desert, Arctic, City, Hell, Wasteland, Moon, Mars)
  legt Gelände aus dem Generator an, malt die ganze Karte mit ihrem Biom (Boden, Relief, Becken, Objekte) und setzt
  Himmel, Licht, Nebel, Tönung und Wetter; das Biom läuft in Bändern über die Karte (`biomeBand`), eine Karte von
  1024 m braucht dafür unter einer halben Sekunde. Jede neue Karte hat eine Straße von West zum HQ und einen Spawn an ihrem Ende, damit sie sofort
  spielbar ist; der Generator ebnet die Straße und legt sie, wo sie unter Wasser liefe, auf einen Damm
- **Import file:** `.3dtdmap` oder `.w3x` per Dateiwahl oder per Ablegen auf der Seite. Ein Warcraft-3-Import fragt
  erst nach Metern je Kachel (4), höchstens Objekten (6000), „Playable area only“, „Enhance ground“ (Boden nach
  Spielrolle neu malen, aus: Kacheln wie im Original) und „Take the map's waves“ (die Wellen der Karte als eigene
  Wellenliste, [W3X_IMPORT.md](W3X_IMPORT.md#wellen-option-waves)), läuft dann im Web Worker
  ([W3X_IMPORT.md](W3X_IMPORT.md)) und zeigt den Bericht: Größe, Bodenschichten, Wasser, woher die
  Straßen kamen, Spawns und Spurlängen, übernommene Doodads, Warnungen; „Open the map“ öffnet sie. Die Karte landet bei den eigenen
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
- Glow cracks: der Boden bricht in ein Netz feiner Lavarisse mit Kruste auf verbranntem Fels; die Risse sinken etwas ein
- Linien (ziehen, auch vom Kartenrand her): Cliff edge hebt den Boden links der Zeichenrichtung als Klippe, die
  Pinselgröße ist die Breite oben; River (Water oder Lava) legt einen Fluss an, der immer bergab fließt (bergauf
  gezeichnet wird er umgedreht): mäandernd, mit wechselnder Breite und schmalen Enden, Bett mit Sand- und
  Schlammufern (bei Lava verbrannter Fels), Schilf, Steinen, einem Wasserfall über jeder steilen Stufe und einer
  Brücke an jeder Straße, die er kreuzt; Road legt eine Straße ins Wegenetz (Anfang und Ende rasten an Knoten oder
  Straßen), passt den Boden als Damm oder Einschnitt an, pflastert sie und stellt Laternen oder Zäune an den Rand

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
- Place: ein Klick setzt das gewählte Objekt (Raster-Fang 1 bis 8 m, zufällige Drehung)
- Scatter: halten streut die gewählten Assets (mehrere wählbar) mit Dichte, Größenbereich, Mindestabstand, zufälliger
  Drehung und Einsinken am Hang; Shift dünnt aus
- Erase: entfernt, was der Pinsel trifft
- Select: Klick wählt (die ganze Gruppe, Strg+Klick ein Mitglied), Shift+Klick ergänzt, Ziehen auf freiem Grund
  wählt per Rahmen, Alt+Ziehen per Lasso, Strg+A alles Sichtbare; Rahmen und Lasso nehmen, was auf dem Bildschirm darin steht. Ausgeblendete
  Kategorien (Auge in der Gliederung) bleiben bei allen dreien draußen, Entf trifft also nichts Unsichtbares.
  Über der Auswahl steht ein Gizmo: bei Move (W) Pfeile für Ost (rot), Nord (grün) und Höhe (blau) und ein Quadrat
  für freies Verschieben, bei Turn (E) ein Ring, bei Scale (R) ein Würfel; Ziehen auf dem Grund im Ring verschiebt
  frei. L schaltet die Pfeile zwischen Kartenachsen und den Achsen des ersten gewählten Objekts. Der Raster-Fang gilt
  für Pfeile und freies Verschieben, Strg rastet Drehung (15 Grad), Höhe (halbe Meter) und Größe (Zehntel). Entf
  löscht, Strg+D dupliziert, Ende setzt die Auswahl auf den Boden zurück (Höhe 0), Strg+G gruppiert, Strg+Shift+G
  löst die Gruppe. Im Panel stehen Lage, Drehung, Größe und die Schalter „Blocks sight“ und „Blocks building“
  (Default folgt dem Katalog)

**Roads (6).** Draw: jeder Klick setzt einen Knoten und verbindet ihn mit dem letzten; ein Klick nahe einem Knoten
schließt dort an, nahe einer Straße entsteht eine Kreuzung (Alt setzt frei). Enter, Rechtsklick oder Doppelklick
beendet die Linie. Edit: Knoten ziehen (auf einem anderen abgelegt verschmelzen sie), Straße wählen; Breite und Art
(Road, Path, Bridge), S glättet als Kurve, X begradigt, J löst einen Knoten zwischen zwei Straßen auf, Entf löscht.
„Flatten road“ ebnet den Boden quer und glättet ihn längs, „Paint road“ malt eine Schicht darunter (gewählte Straße oder
alle). Die Routen von jedem Spawn zum HQ laufen als Punkte über die Karte (abschaltbar).

**Spawns and HQ (7).** Q: Klick setzt einen Spawn (Name nach Himmelsrichtung, im Panel änderbar; höchstens 32, dann sagt die Statuszeile
warum), H: Klick versetzt das
HQ. Ziehen verschiebt beide; sie rasten auf die nächste Straße (Alt frei). Das Panel zeigt je Spawn die Länge seiner
Spur oder „no route“.

**Sky and weather (8).** Himmel (Day, Dusk, Night, Overcast), Tageszeit (ein Sommertag: Aufgang 6 Uhr im Osten, 13 Uhr im
Süden 60 Grad hoch, Untergang 20 Uhr im Westen; tiefe Sonne ist Dämmerung, eine Stunde nach Untergang Nacht),
Sonnenrichtung und -höhe, Nebel, Tönung, Wetter (Clear, Rain, Snow, Fog mit Stärke); Regler wirken sofort und werden
beim Loslassen ein Schritt im Verlauf.

**Map (9).** Name, Autor, Beschreibung; Größe ändern (die Mitte bleibt, kleiner schneidet die Ränder ab, größer setzt
sie in Randhöhe fort); Gelände-Generator über die offene Karte und „Erode the whole map“ (Regen gräbt Rinnen an allen
Hängen, Stärke „Rain“). Beide laufen im Terrain-Worker (`editor/workers/terrain.worker.ts`): der Generator schickt
Bänder von 48 Zeilen, die Ansicht zeigt sie sofort; die Erosion läuft in Scheiben zu 4000 Tropfen, die Ansicht zeigt
den Stand etwa einmal pro Sekunde und zeichnet ihn bandweise neu. Ein Fortschrittsbalken mit „Cancel“ stellt den
alten Boden wieder her; fertig ist es ein Undo-Schritt. Während ein Job läuft, nehmen die Werkzeuge keine Eingaben an,
die Ansicht lässt sich drehen.

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
| `danger-color` | Warnung | Deko in Gefahrenfarben (rote Pilze, rote Blüten, rotes Laub; `DANGER_COLOR_ASSETS` im Asset-Katalog des Editors) bis 30 m an einer Straße: Rot steht im Spiel für Gegner, Treffer und Feuer |

## Speichern und Dateien

- Autosave schreibt zwei Sekunden nach der letzten Änderung in IndexedDB; die Kopfzeile zeigt „Unsaved changes“,
  „Saving“ oder „Saved“. Strg+S speichert sofort mit neuem Vorschaubild; beim Verlassen der Karte wird das Bild
  ebenfalls erneuert
- Kartendokument Version 2: optionales Feld `gameplay` (`startCredits`, `hqHealth`, `towers`, `waves` als
  `{ kind: 'budget' }` oder `{ kind: 'table', table }` in der Form der Table-Source); Version-1-Dateien lesen sich
  unverändert über die Migration 1 nach 2
- Datei-Menü (drei Punkte): Download map file (`.3dtdmap`), Export top view as picture (PNG, 2048 px an der längeren
  Seite), Frame the whole map, Top view
- „Test map“ speichert und öffnet das Spiel mit `?world=map:<id>` im Test-Tab: ein Fenster mit festem Namen
  (`MAP_TEST_WINDOW`, `3dtd-map-test`), das jeder weitere Test und der Bot-Check wiederverwenden, statt Tabs zu stapeln;
  in der Desktop-App ein eigenes, gleich gehärtetes App-Fenster ([ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md), E26c)
- Versionen: jedes Speichern und höchstens alle drei Minuten ein Autosave landen als gepackte Datei in IndexedDB
  (`3dtd-editor-history`; die frühere `3dtd-editor-versions` wird beim Öffnen gelöscht), die letzten 20 je Karte; das Map-Panel (9) listet sie, „Restore“ holt eine zurück (ein
  Undo-Schritt). Ein Absturz kostet so höchstens die Minuten seit dem letzten Autosave
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
rechnen (Wald 2,3 auf 1,1 ms). Die Ansicht baut Objekt-Batches höchstens alle 150 ms neu, Wasser alle 120 ms, den
Himmel alle 100 ms; die Minikarte wartet, bis kein Pinsel mehr gehalten wird. Gemessen im Browser (1024 m, zweiter
Strich mit einem Biom): p50 6,9 ms, p90 7,7 ms je Bild; der erste Strich übersetzt die Shader neuer Modelle.
Ganze Karten (Vorlagen) malt `biomeBand` in Bändern mit Pausen dazwischen: 1024 m in 0,3 bis 0,4 s.
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
Straße), `ops/symmetry.spec.ts`, `ops/stamp.spec.ts`, `ops/generate.spec.ts`, `ops/contours.spec.ts`. Browser:
`e2e/tests/editor.e2e.ts` (neue Karte, Gelände, Objekt mit Rückgängig, Straße, Spawn, gespiegeltes Objekt, kopiertes
und gesetztes Stück, Prüfen, Speichern, Neuladen, Löschen; ohne Kartensitzung).

## Grenzen

- Das Kartendokument kann Objekte kippen (`pitch`, `roll`; die Level-Skripte nutzen es für Gondeln und gestrandete
  Boote), die Werkzeuge setzen aber nur die Drehung um die Hochachse: Setzen und Streuen richten nichts am Hang aus
  (geplant als ED-S7), der Streupinsel lässt Objekte am Hang stattdessen einsinken
- Neue Objekte während eines Strichs erscheinen bis zu 150 ms verzögert, Wasser bis zu 120 ms: der Renderer baut sie
  bisher nur ganz neu (inkrementelles Hinzufügen ist bei der Kartenansicht angefragt)
- Gruppen, ausgeblendete Kategorien und Versionen kennt nur der Editor; das Spiel ignoriert `group`
