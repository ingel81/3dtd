# Wassernetz: Zusammenfluss, Krater im Fluss, Überlauf (Plan)

Stand 2026-10-21, abgestimmt (Entscheidungen unten). Betrifft TODO E283 (Fluss über Krater) und E288 (gemalte Flüsse
vereinigen sich nicht). Schritte 1 (Netz, E288), 2 (Krater im Fluss, E283) und 3 (Flächen folgen dem Krater) gebaut.

## Befund

- **Flüsse sind Einzelstücke.** `MapRiver` ist eine Linie aus Punkten mit Breite und Spiegelhöhe; die Höhe fällt
  vom ersten zum letzten Punkt (`river-levels.ts`, `bankLevels`). Jeder Fluss kennt nur sich. Zwei Striche, die sich
  berühren oder kreuzen, werden zwei Bänder mit je eigener Höhe: dunkle Naht, Ufer und Schilf des einen stehen im
  Wasser des anderen. Dasselbe passiert schon mit **einem** Strich, der nah an sich selbst zurückläuft: die beiden
  Bandstücke überlappen, das spätere liegt tiefer (die Höhe fällt längs des Laufs), dazwischen die Naht (E288, Bild
  vom User, in einem Zug gemalt).
- **Flächengewässer** (`MapWater`: Spiegel + Maske, `water` und `waterBodies`) sind flach und kennen keinen Zu- oder
  Abfluss.
- **Krater** sind Stempel ins Höhenraster aus der `CraterLedger` der Simulation (ganze Zahlen, deterministisch). Das
  Gelände sinkt, das Wasser nicht: das Flussband bleibt auf seiner gespeicherten Höhe und schwebt über dem Loch;
  ebenso wölben sich Asphaltflächen als Bogen darüber (E283).
- **Die Simulation liest kein Wasser** (`waterLevelAt` nur im Hauptthread: schwimmende Objekte, Editor-Prüfung).
  Alles hier ist Darstellung und kann im Hauptthread aus Karte + Kraterliste abgeleitet werden; Koop, Replay und
  Prüfsummen bleiben unberührt.

## Ziel

Wasser verhält sich wie ein Netz mit Fließrichtung: Flüsse münden ineinander, ein Krater im Fluss läuft als See
voll und gibt beim Überlauf den Fluss stromab weiter. Aus derselben Quelle für Editor, OSM-Welten und Spiel; eine
Mechanik, keine Sonderfälle je Stelle.

Maßstab (User 2026-10-21): keine perfekte Flüssigkeitssimulation, aber eine sinnvolle Annäherung, wie man sie von
einem 3D-Sandbox-Spiel erwartet. Also: Wasser fließt bergab, sammelt sich in Mulden bis zur tiefsten Kante, läuft
dort über, vereinigt sich, wo es sich trifft. Keine Partikel- oder Gitter-Strömungssimulation je Bild; Zustände
werden bei Änderungen (Malen, Krater) aus dem Gelände abgeleitet, dazwischen nur Übergänge (Füllen, Trockenfallen).

## Modell (Vorschlag)

Alles gilt für Wasser und Lava gleich (`MapRiver.kind`, `MapWaterKind`): Lavaflüsse überlappen, münden, füllen
Krater und laufen über wie Wasser, nur langsamer und mit Lavafall statt Wasserfall. Ein Netz verbindet nur
Gleichartiges; trifft Lava auf Wasser, erstarrt sie (F5).

### 1. Netz statt Einzelstücke (E288, gebaut)

- **Abgeleitet, nicht gespeichert** (`map-ops/river-network.ts`): das Netz folgt aus der Geometrie, kein Feld
  `into` in der Karte. Wo sich die Bänder zweier gleichartiger Flüsse überlappen, zwei Stücke eines Flusses (mit
  langem Lauf dazwischen: eine Falte, keine Biegung) oder ein Fluss in einem Flächengewässer seiner Art liegt, ist
  ein Knoten. Je Fluss sind seine Stücke im Knoten Mündung (sein Ende), Abzweig (sein Anfang) oder Durchlauf.
  Grund: ein gespeichertes `into` wäre eine zweite Wahrheit neben der Geometrie und müsste bei jedem verschobenen
  Punkt nachgeführt werden; abgeleitet finden Pinsel, OSM-Import und Darstellung dieselben Knoten. Gesucht wird
  über ein Raster der Stützstellen (alle 2 m), nicht über alle Paare.
- **Höhen** (`joinRiverLevels`, Ergebnis in den Punkthöhen von `MapRiver.points`, also auch für `waterLevelAt`):
  ein Zufluss endet auf dem Spiegel des Hauptflusses bzw. Sees; liegt er höher, wird der Unterschied über seinen
  Lauf verteilt, liegt er tiefer, läuft er flach auf den Spiegel (an einem Fluss; in einem See endet er unter
  dessen Spiegel, angehoben stünde er über einem Ufer, das die Maske des Sees nicht erreicht). Der Hauptfluss ändert sich nicht. Kreuzung und
  Selbstüberlappung: eine Höhe, die tiefste, mit der ein Stück den Knoten verlässt. Ein Stück, das ihn auf
  dieser Höhe oder tiefer verlässt, läuft ab und ist ab seinem Eintritt höchstens so hoch; eines, das dahinter
  höher steht (der höhere zweier kreuzender Flüsse), speist: es steht nur im Knoten auf dessen Höhe und fällt
  von beiden Seiten hinein, seine Arme behalten ihr Wasser und ihr Bett (beim Pinsel ab FALL_MIN mit
  Lippenpunkt und dem vorhandenen Wasserfall).
- **Angewandt** beim Malen (Pinsel, auch nach Verschieben von Punkten über `relevelRiver`) und beim OSM-Import,
  jeweils vor dem Ausheben, sodass das Bett zur Höhe passt; nicht beim Laden (der Editor ist noch nicht
  freigegeben, User 2026-10-21). Mitgelieferte Karten mit Flüssen werden neu gebacken.
- **Darstellung:** je Ecke eines Bandes, wie weit anderes Wasser dort zeichnet (`riverCover`): der empfangende
  Fluss, das Flächengewässer, das frühere Stück. Das andere Band blendet sich dort aus, gegenläufig zum Seitenrand
  des zeichnenden, eine Höhe, ein Material, keine Naht. Die Strömung des darunter liegenden Bandes wird in die
  des zeichnenden gemischt. Ufer, Schilf und Steine des Pinsels werden in anderem Wasser nicht gesetzt; die des
  anderen Flusses im neuen Wasser gehen.
- **Überlappt ein Fluss sich selbst** (Haarnadel, zwei Schenkel nebeneinander): eine Fläche auf einer Höhe (F0).
  Eine lange Schleife, die ihren Hals nur streift, behält ihre Höhen (abgeflacht fiele ihr Bett trocken) und wird
  nur in der Darstellung verbunden: das höhere, frühere Stück zeichnet.
- **Kreuzen sich zwei Flüsse:** Gesamtgewässer als Kreuz, der höhere speist, die tieferen Arme laufen ab (F1).
- Nur Gleichartiges verbindet sich (Wasser mit Wasser, Lava mit Lava; Eis mit nichts).

### 2. Krater im Fluss (E283, gebaut)

Gebaut so (2026-10-21): `map-ops/crater-water.ts` rechnet je Krater auf dem Boden, wie er jetzt ist (rein, ohne
three), `render/water/crater-water.ts` zeichnet es, `CustomMapWorld` verbindet beides. Abweichungen und Ergänzungen
zum Vorschlag darunter:

- **Nur wenn der Krater über das Wasser hinausreicht.** Ein Krater ganz unter Wasser (eine Rakete im Flussbett, 35 cm)
  vertieft nur das Bett, es gibt nichts zu zeigen.
- **Kratersee als Scheibe**, nicht als Flächengewässer: ein Netz über den Krater bis über seinen Wall, das Gelände
  schneidet das Ufer (Tiefe im Shader wie beim Fluss). Kein Masken-Bake, kein Worker nötig; die Höhe wird beim
  Füllen in die Ecken geschrieben.
- **Endspiegel:** Überlaufpunkt per Priority-Flood aus der Kratermitte (tiefster Weg hinaus), höchstens der Zufluss;
  liegt der Überlauf im eigenen Bett stromab, steigt der See bis zum Fluss dort (das Bett ist nach dem Überlauf
  wieder voll). Füllzeit aus dem Volumen: 10 s (50 m³) bis 20 s (50 000 m³, ein Nuke), logarithmisch, Lava dreimal.
- **Fluss:** das Stück durch den Krater verschwindet (Shader, Strecke längs des Laufs); stromab sinkt das Wasser in
  seinen Graben und zieht sich zurück, der trockene Abschnitt wächst mit 3 m/s, nach dem Überlauf läuft es mit 2 m/s
  wieder voll (Lava ein Drittel). Der Wasserfall an der Lippe wird kürzer, während der See steigt.
- **Überlauf woanders (F3):** steilster Abstieg vom Überlaufpunkt, Mulden füllen sich bis zu ihrer tiefsten Kante,
  bis Wasser, Kartenrand oder 1,5 km; ein schmaler Bach (halbe Breite des Zuflusses, 2 bis 8 m), seine Front läuft nach
  dem Füllen hinab. Das alte Bett bleibt trocken.
- **Kette:** ein Krater unter einem anderen bekommt Wasser erst, wenn der obere überläuft und es bei ihm ankommt;
  unter einem, der woanders überläuft, keines.
- **Zeit (Variante b, Lead 2026-10-21):** die Spielzeit des Hauptthreads (Pause hält an, 2x/4x schneller), keine Wanduhr
  und keine Änderung an Ledger, Snapshot oder Prüfsumme. Ein Krater, der im Lauf gegraben wird (`craters.dig`), füllt
  sich; nach `craters.setAll` (Laden, Replay-Sprung, Koop-Beitritt) stehen alle voll. Exakt wäre nur eine Grabzeit im
  Ledger (Variante a), falls je gewünscht.
- **Einschlag ins Wasser (F4):** Rakete eine Wassersäule mit Gischtring, ab 10 m Kraterradius (Nuke) dazu Dampf; in
  Lava glühende Funken.
- **Lava trifft Wasser (F5):** läuft ein Lavasee über und erreicht sein Abfluss Wasser, erstarrt die Lava dort zu
  dunklem Gestein, Dampf steigt auf, sobald die Front ankommt.
- **Krater in Flächengewässern:** geprüft, der Spiegel bleibt, der Krater zeigt sich als tiefere Stelle.
- **Editor (E294, gebaut 2026-10-21):** der Landschafts-Modus „crater“ trägt den Krater am Ende des Strichs in die
  Karte ein (`MapTerrain.craters`: Mitte, Radius bis zum Rand, mit den Bildern der Symmetrie; derselbe Ort noch einmal
  gegraben bleibt ein Eintrag, der größere Radius). Die Grube steht schon im Boden. Editor und Spiel rechnen den See
  mit derselben Logik (`world/custom-map/crater-lakes.ts` über `craterCuts`, gezeichnet von `CraterWaterLayer`). Im
  Editor füllt er sich nach dem Loslassen auf einer eigenen Uhr, dreimal so schnell wie im Spiel (3 bis 7 s, Lava 10 bis
  20 s): der Kartenbauer sieht die Reihenfolge (Fall über den Rand, See steigt, Überlauf, neuer Bach) ohne die Spielzeit
  abzuwarten; ein sofort voller See verriete sie nicht. Neu gerechnet wird, wenn Boden oder Wasser 0,3 s stillstehen.
  Krater, die die Karte beim Öffnen schon hat, stehen voll. Im Spiel steht ein Editor-Krater von Anfang an voll da,
  neben den Kratern der Einschläge (auch ohne Zerstörung). Undo, Spiegeln, Speichern und Laden nehmen die Liste mit; ein
  zugeschütteter Krater (Grund nicht unter dem Wasser, das hereinkommt) schneidet nichts mehr. Die Kraterliste ist
  Darstellung: die Simulation und die Prüfung lesen sie nicht. Map-Kit und Agent tragen ihre Krater ebenso ein
  (`MapKit.form`, nach dem Strich wie der Pinsel; der Fingerabdruck des Agenten zählt die Liste mit). Die
  mitgelieferten Karten mit Kratern (Ember Crater, Mars Canyon, Moon Base, Ruined City) führen die Liste seither; keiner
  ihrer Krater schneidet einen Fluss.

Der Vorschlag, wie er abgestimmt war:

- **Schnitt:** der Fluss zerfällt am Krater in ein Stück stromauf und eins stromab.
- **Einlauf:** das Stück stromauf läuft bis zum Kraterrand und fällt hinein. Ist der Fall steil genug, kommt der
  vorhandene Wasserfall-Effekt (`render/effects/waterfall.ts`), sonst Stromschnellen.
- **Kratersee:** ein Flächengewässer im Krater (Maske = Kraterzellen unter dem Spiegel). Endspiegel = tiefste Stelle
  des Kraterrands (Überlaufpunkt), höchstens die Spiegelhöhe des Zuflusses am Einlauf.
- **Überlauf:** erreicht der See den Überlaufpunkt und liegt dieser stromab, fließt das Stück stromab von dort weiter.
  Liegt der Überlaufpunkt woanders (Krater am Hang), sucht sich das Wasser dort einen kurzen Weg zurück ins alte
  Bett oder bildet einen neuen Abfluss (F3: neuer Abfluss bergab).
- **Füllen über Zeit** (F2: etwa 10-20 s): See steigt von der Kratersohle zum Endspiegel; solange er nicht voll ist,
  fällt das Bett stromab trocken (Wasser sinkt und zieht sich zurück, nasser Grund bleibt). Der Zeitpunkt ergibt sich
  aus der Simulationszeit des Grabens, also zeigen Replay-Sprung und Spielstand laden denselben Zustand.
- **Mehrere Krater** hintereinander: Kette, jeder See speist den nächsten Abschnitt.
- **Krater in Flächengewässern** (See, Hafen): der Spiegel bleibt, das Wasser steht einfach tiefer; nur der
  Kraterwall kann als Insel herausragen. Kein Umbau nötig, nur prüfen, dass Maske und Uferschaum mitziehen.
- **Lava** verhält sich gleich (Lavasee im Krater, Lavafall), nur langsamer.

### 3. Flächen folgen dem Krater (Rest von E283, gebaut)

Asphalt, Parkplätze und andere flache Flächen (Pfad-Maske, Bodenflächen) lesen ihre Höhe aus dem Raster mit
Kratern, statt ihre alte Form zu behalten. Eigener kleiner Schritt, unabhängig vom Wasser.

Gebaut so (2026-10-21): Straßen und Flächen (`render/drape/draped-layer.ts`, auch Rinnen) nahmen ihre Höhe schon
im Shader aus der Höhentextur; der Bogen kam von weit auseinander liegenden Ecken (quer über eine Straße bis 4,5 m,
Kreuzungen und Enden als Fächer, flache Flächen in 64-m-Zellen). Nach einem Krater (`updateHeights` mit `sunk`)
wandern die Dreiecke über der Grube, deren Grund mehr als 1,2 cm von ihrer Ebene abweicht, aus ihrer Kachel (dort
entartet, ihre Puffer bleiben) in einen Flicken der Kachel und werden an den Linien des Geländes geschnitten
(`draped-refine.ts`, dasselbe Auflegen wie das der Straßen, CUSTOM_MAPS.md): ein Draw Call mehr je getroffener Kachel. Je Kachel ein Index der Dreiecke nach Lage (beim
Laden gebaut, nur auf Karten mit Kratern), damit ein Krater nur die Dreiecke in seiner Nähe ansieht. Die Box der
Kachel wächst nur um die Höhen im Rechteck. Brücken behalten bei Kratern ihre Fahrbahn. Die Pfad-Maske folgt
ohnehin (sie liegt im Gelände-Shader). Routenkorridor, rote Routenlinie und Tower-Sicht (E291) nicht berührt.

## Kosten und Leistung

- Nur bei neuem oder vertieftem Krater, der Wasser berührt: ein Flussband neu zuschneiden (Punkte, kein Neubau der
  ganzen Karte), ein kleiner See (Maske im Krater-Rechteck), ggf. ein Wasserfall. Ziel unter 2 ms im Bild wie die
  übrigen Kraterarbeiten (DESTRUCTION_PLAN, Messungen), Flow-Bake des Sees im vorhandenen Worker.
- Füllen ist nur eine Uniform (Spiegelhöhe) je See und eine Schnittstelle am Band stromab, kein Neubau je Bild.
- Gemessen (Dev-Build, 2026-10-21): je Krater, der einen Fluss schneidet, einmalig 1,5 ms Rechnung und 1,3 ms Aufbau,
  in zwei Bildern; danach je Bild 0,06 ms im Mittel, 0,34 ms höchstens. Die Programme der Fälle (Wasser und Lava), des
  Gesteins und des Dampfs werden auf Karten mit Flüssen und Kratern beim Laden gebaut (sonst 167 bis 233 ms im
  ersten Krater im Fluss).

## Entscheidungen (User 2026-10-21)

- **F0 Fluss überlappt sich selbst:** eine gemeinsame Wasserfläche auf einer Höhe (wie eine breite Stelle oder
  Bucht), keine Naht, kein Ufer im Wasser.
- **F1 Zwei Flüsse kreuzen sich:** Gesamtgewässer als Kreuz. An der Kreuzung eine gemeinsame Fläche, alle vier Arme
  bleiben; der höhere Fluss speist die Kreuzung, sie läuft in die tieferen Arme ab (Gabelung).
- **F2 Füllen:** sichtbar über Sekunden (etwa 10-20 s, größerer Krater länger); das Bett stromab fällt so lange
  trocken und füllt sich beim Überlauf wieder. Im Spiel (Raketen, Nuke) genauso wie im Editor (Einschlag-Pinsel).
- **F3 Überlauf an anderer Stelle:** neuer Abfluss bergab. Das Wasser läuft an der tiefsten Kante über und sucht
  sich nach Gelände einen Weg bergab (steilster Abstieg, Mulden füllen sich unterwegs wie Krater), bis es wieder
  auf Wasser trifft oder den Kartenrand erreicht. Der Weg wird ein abgeleiteter Fluss (schmal, Breite aus dem
  Zufluss); das alte Bett stromab bleibt trocken, wenn der Weg woanders hinführt.
- **F4 Einschlag ins Wasser:** Rakete mit Wasserfontäne und Gischt, Nuke zusätzlich mit Dampfsäule über dem
  getroffenen Wasser; danach läuft der Krater voll.
- **F5 Lava trifft Wasser:** Lava erstarrt an der Grenze zu dunklem Gestein, mit Dampf.

## Reihenfolge (Vorschlag)

1. Netz und Mündung im Editor und OSM (E288), weil Krater-Seen dieselbe Mündung in Flächen brauchen.
2. Krater schneidet Fluss, Kratersee, Überlauf, Füllen (E283).
3. Flächen folgen dem Krater.
