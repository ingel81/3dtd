# OSM-Details: Tags, die wir noch nicht nutzen (Plan, E311)

Stand 2026-10-23, entschieden mit dem User, nicht gebaut. Erhebung an 17 Orten (7 in Deutschland, 10 international)
von der eigenen Overpass-Instanz, ungefiltert; Zahlen und Rohdaten in `tmp/plan/OSM_TAG_LUECKEN_2026-10-23.md`.
Befund: Flächen und Wege fragt `osm-query.ts` vollständig ab; die Lücken liegen bei Punkten und bei Attributen an
Dingen, die wir schon bauen. Maßstab wie immer: allgemeine Regeln, mehrere Orte, instanziert, im Budget.

## Entschieden

**Straße**
- **Parken am Straßenrand** (`parking:left/right/both`, Art längs/schräg/quer/halb auf dem Gehweg): sehr dezent, nur
  wo OSM es sagt, mit Lücken, nie vor Einfahrten, Kreuzungen, Überwegen. Die Autos sperren Bau und Sicht
  (`blocksBuild`, `blocksLos`); den Korridor berühren sie nicht (custom maps messen keine Straßenbreite,
  `measureStreetClearance`).
- **Ampeln** (`highway=traffic_signals`, schon abgefragt, nirgends gelesen): Mast je Zufahrt am rechten Rand,
  Fußgängerampel an Überwegen mit `crossing:signals`; Lichter schalten im Shader zyklisch um (Deko).
- **Überwege** (`crossing:markings`, `crossing:island`): Zebra- oder Linienmarkierung auf der Fahrbahn, Mittelinsel als
  kleine Fläche mit Bordstein.
- **Verkehrsschilder** (`highway=give_way|stop`, neu in der Abfrage): Schild am Rand, Haltelinie auf der Fahrbahn.
- **Radwege** (`cycleway:*`): Radstreifen als Markierung oder roter Belag am Fahrbahnrand.
- **Gehwegbelag** (`sidewalk:*:surface`): Pflaster, Asphalt, Platten je Seite.
- **Treppen** (`step_count`, `handrail`): echte Stufenzahl, Handläufe.

**Gebäude**
- **Dachgeschosse** (`roof:levels`): Dachhöhe daraus, wo kein `roof:height` steht (`building-mass.ts`); Gauben auf
  bewohnten Dächern, eine bis drei nach Länge.
- **Hausboote** (`building=houseboat`): schwimmendes Modell (Rumpf und Aufbau, `float`) am Ufer statt Haus an Land.
- **Tempel, Schreine, Pagoden** (`religion=shinto|buddhist`, `building=pagoda|temple|shrine`): Dach mit geschwungenen
  Traufen, Pagode aus gestapelten Dächern; **Torii** (`man_made=ceremonial_gate`) als Modell über dem Weg.

**Vegetation und Licht**
- **Baumgrößen** (`height`, `diameter_crown`, `circumference`): skalieren das Modell im Bereich, den es hergibt; ohne
  Angabe Zufall wie heute (`vegetation.ts` `tree`).
- **Laternen** (`lamp_mount`, `lamp_type`, `light:*`): Mast, Wandarm an der nächsten Fassade, Seil über der
  Fahrbahnmitte; zwei bis drei Leuchtenformen. Nachts leuchten sie wie heute (gebackenes Licht `effects/lamp-light.ts`
  und der Pool); die Wandlaterne braucht einen Lichtfleck auf der Fassade (gebackenes Licht trifft Wände schwächer).
- **Sträucher und Findlinge** als Punkt (`natural=shrub|stone`) aus vorhandenen Modellen.

**Kleinkram** (Katalogmodelle, prozedural in Blender, CC0)
- Kunstwerke nach `artwork_type`: Statue auf Sockel, Skulptur, Stele, Büste, Brunnenfigur; sperren Bau, Sicht nur
  große.
- Fahnenmasten (Fahne im Wind-Shader), Wegweiser und Infotafeln (`tourism=information`).
- Schranken (`barrier=lift_gate`), Drehkreuze, Absperrseile.
- Schaltkästen (`man_made=street_cabinet`), Kameras (`man_made=surveillance`).
- Pflanzkübel, Brunnen und Wasserhähne (`man_made=water_well|water_tap`), Hafenkräne, Poller (`seamark:type=mooring`).
- Automaten (`amenity=vending_machine` nach `vending`) und Geldautomaten (`amenity=atm`), an Wand oder Straße.
- Rettungsringe (`emergency=life_ring`), Notrufsäulen, Defibrillator-Kästen.
- Farben (`colour`) an Bänken, Containern, Briefkästen, Masten per Instanzfarbe.

**Bahn und Untergrund**
- Bahnsignale (`railway=signal`) und Weichenantriebe (`railway=switch`); Oberleitungsmasten setzen wir schon selbst
  (`rails.ts`).
- U-Bahn-Eingänge (`railway=subway_entrance`): Treppenabgang mit Geländer und Schild je Land, dunkle Öffnung wie
  die Tiefgarageneinfahrt.
- Tiefgarageneinfahrten als Punkt (`amenity=parking_entrance`): Rampe mit Öffnung, wo kein Weg mit Öffnung liegt.

Bewusst draußen: Stolpersteine, Grenzen, Haltepositionen (`public_transport=stop_position`).

## Reihenfolge

Je Schritt ein Commit-Paket mit Vorher/Nachher an den Abnahme-Orten (Erlenbach, Bamberg, Amsterdam, Kyoto, New York,
Rom) und den Kosten (Dreiecke und Draws je Ansicht, Speicher, Ladezeit der Welt, Dateigröße). Import und Regeln baut
ein Worker hier, Modelle der Zweitrechner (Blender 5.1, `tools/map-assets/`, LODs, `objects.json`), parallel.

1. **Ohne neue Modelle, nur Regeln:** Baumgrößen, Dachgeschosse (Höhe), Farben von Kleinkram, Gehwegbelag.
   Billig, sofort sichtbar, prüft den Abgleich der Tags.
2. **Fahrbahn:** Überwege mit Markierung und Insel, Haltelinien, Radstreifen. Liegt in Straßenoberfläche und
   Markierung, kein Objekt.
3. **Straßenmöbel mit Modellen:** Ampeln (mit Umschalten), Verkehrsschilder, Laternentypen (mit Wandlicht),
   Parken am Rand (vorhandene Autos), Schranken und Drehkreuze.
4. **Kleinkram-Familien:** Kunst, Fahnen, Wegweiser, Schaltkästen, Kameras, Kübel, Brunnen, Kräne, Poller, Automaten,
   Notfall, Sträucher und Findlinge. Eine neue Abfrage-Version für die neuen Punkte.
5. **Untergrund und Bahn:** U-Bahn- und Tiefgarageneingänge, Bahnsignale und Weichen.
6. **Bauformen:** Gauben, Hausboote, Torii, Tempel und Pagoden.

Budget: alles Neue instanziert und über die Pixelgrenze je Grafikstufe (E304), Kleinkram fällt fern zuerst weg.
Neue Punkte in `osm-query.ts` heben `OSM_QUERY_VERSION` (gespeicherte Rahmen laden neu); die Antwort einer Innenstadt
wächst dadurch, vorher an Köln und Amsterdam messen (heute bis 15 MB JSON).
