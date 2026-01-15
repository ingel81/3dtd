# Offene TODOs
Bewerten:
    [ ] FPS LIMIT auf 60 sinnvoll?
    [ ] Explosionen bei Rocket Treffern und Cannon Treffern
    [ ] Keine LOS Berechnung wenn Tower nicht gebaut werden kann
    [ ] LOS Berechnung performanter machen (Vielleicht gedrosselt machen und stück für Stück einblenden was er berechnet hat)
    [ ] Gatling Dual Fire mit exakten Positionen der Barrels abwechselnd links und rechts

Beobachten bis Testcase wieder da:
[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbrechung der Route)


Performance:
 [~] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [~] Tile-Loading optimiert (downloadQueue.maxJobs=4, parseQueue.maxJobs=1, größerer lruCache) → deutlich flüssiger
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.
 [ ] Instanced Decal Rendering - Blood/Ice Decals auf InstancedMesh umstellen
     - Aktuell: ~250 Draw Calls für separate Meshes
     - Mit Instancing: 2 Draw Calls (1 Blood-Pool, 1 Ice-Pool)
     - Pro Instance nur Transform-Matrix updaten statt ganzes Mesh
     - Könnte bei vielen Decals (500+) spürbar sein, aktuell nicht kritisch

Location-System Bekannte Einschränkungen:
 [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
     - Workaround: Manuelle Koordinaten-Eingabe nutzen
     - Mögliche Verbesserung: Alternative Geocoding-API (Photon, Google)

Ideen:
- [ ] Fette Explosion wenn HQ final kaputt
- [ ] coole locations irgendwie sharebar machen (URL-Parameter deaktiviert wegen Timing-Bugs beim Tile-Loading)
- [ ] Poison Tower
- [ ] Magic Tower
- [ ] Flame Tower

Stashed Features:
- [ ] World Dice - Random Street Generator (git stash: "feat: world dice random location generator")
      Wikidata SPARQL für zufällige Stadt + Overpass API für Straße
      Würfel-Button in Header + Location-Dialog

