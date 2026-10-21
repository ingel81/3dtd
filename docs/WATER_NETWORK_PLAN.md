# Wassernetz: Zusammenfluss, Krater im Fluss, Überlauf (Plan)

Stand 2026-10-21, abgestimmt (Entscheidungen unten). Betrifft TODO E283 (Fluss über Krater) und E288 (gemalte Flüsse
vereinigen sich nicht). Noch nichts gebaut.

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

### 1. Netz statt Einzelstücke (E288)

- Ein Fluss bekommt optional `into?: { river: id, at: number }` (mündet bei Bogenlänge `at` in einen anderen Fluss)
  bzw. in ein Flächengewässer (`into: { body: index }`). Abgeleitet beim Malen und beim OSM-Import (dort liegen
  Zusammenflüsse als gemeinsame Knoten der Waterways vor), gespeichert in der Karte.
- **Höhen:** der Zufluss endet auf dem Spiegel des Hauptflusses an der Mündung; sein Gefälle wird von dort
  stromauf neu verteilt (bankLevels mit fester Endhöhe). Der Hauptfluss ändert sich nicht.
- **Darstellung:** an der Mündung eine gemeinsame Wasserfläche statt zweier Bänder (Band des Zuflusses endet mit
  weichem Übergang unter dem Hauptband, eine Höhe, ein Material); Ufer, Schilf und Steine des Zuflusses werden in
  der Fläche des Hauptflusses nicht gesetzt. Strömung (flow-map) an der Mündung aus beiden Richtungen gemischt.
- **Überlappt ein Fluss sich selbst** (Schleife, Haarnadel): die überlappenden Stücke werden eine gemeinsame
  Fläche auf einer Höhe, wie eine breite Stelle oder Bucht (F0).
- **Kreuzen sich zwei Flüsse:** Gesamtgewässer als Kreuz, der höhere speist, die tieferen Arme laufen ab (F1).

### 2. Krater im Fluss (E283)

Abgeleitet je Krater, der ein Flussband schneidet (Hauptthread, aus Kraterliste + Höhenraster):

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

### 3. Flächen folgen dem Krater (Rest von E283)

Asphalt, Parkplätze und andere flache Flächen (Pfad-Maske, Bodenflächen) lesen ihre Höhe aus dem Raster mit
Kratern, statt ihre alte Form zu behalten. Eigener kleiner Schritt, unabhängig vom Wasser.

## Kosten und Leistung

- Nur bei neuem oder vertieftem Krater, der Wasser berührt: ein Flussband neu zuschneiden (Punkte, kein Neubau der
  ganzen Karte), ein kleiner See (Maske im Krater-Rechteck), ggf. ein Wasserfall. Ziel unter 2 ms im Bild wie die
  übrigen Kraterarbeiten (DESTRUCTION_PLAN, Messungen), Flow-Bake des Sees im vorhandenen Worker.
- Füllen ist nur eine Uniform (Spiegelhöhe) je See und eine Schnittstelle am Band stromab, kein Neubau je Bild.

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
