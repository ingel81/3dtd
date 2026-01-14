# Offene TODOs

[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbrechung der Route)
[ ] bei anderen Gegner stimmen die Vorschaumodelle nicht (z.b. Panzer) - was machen wir aber bei späteren gemischten Waves.

Performance:
 [~] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [~] Tile-Loading optimiert (downloadQueue.maxJobs=4, parseQueue.maxJobs=1, größerer lruCache) → deutlich flüssiger
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.

LOS:
 [ ] **Optimierung: Statisches Pfad-LOS-Grid**
     Aktuell: LOS-Raycasts zur Laufzeit (auch mit Caching ~3/s pro Tower)
     Idee: Separates feines Hex-Grid (2m) nur entlang der Gegner-Route vorberechnen + aureichend Puffer um die route wirklich sicher abzudecken
     - Bei Tower-Platzierung einmalig ~100-150 Raycasts (nur Route ±3m im Range)
     - Zur Laufzeit: Nur "ist Gegner-Position in sichtbarer Zelle?" → O(1) Lookup
     - Visualisierung bleibt separat (grobes 8m Grid für ganzen Bereich)
     - Zwei Systeme: Grob+vollständig für User-Feedback, Fein+Route für Schieß-Logik
     - Vorteil: LOS-Checks zur Laufzeit komplett eliminiert (nur simple Math)
     - Nachteil: Statisch (nur Gebäude, keine dynamischen Blocker)
     - Wichtig: zuschaltbare Visualisierung für die interne "feine" LOS zu debugging zwecken.

Location-System Bekannte Einschränkungen:
 [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
     - Workaround: Manuelle Koordinaten-Eingabe nutzen
     - Mögliche Verbesserung: Alternative Geocoding-API (Photon, Google)

Ideen:
- [ ] coole locations irgendwie sharebar machen (URL-Parameter deaktiviert wegen Timing-Bugs beim Tile-Loading)

Stashed Features:
- [ ] World Dice - Random Street Generator (git stash: "feat: world dice random location generator")
      Wikidata SPARQL für zufällige Stadt + Overpass API für Straße
      Würfel-Button in Header + Location-Dialog

