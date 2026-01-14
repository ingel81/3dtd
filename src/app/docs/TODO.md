# Offene TODOs

WaveDebugger:
    [ ] Anzahl Slider auf 500 limitieren
    [ ] Wenn Gegner gewählt wird seinen Speed im Slider setzen den er eigentlich in der Config hat
    [ ] Dito für einen neuen hinzuzufügenden Slider mit seiner Health

Allgemein:
[ ] Partikeleffekte für Schüsse (Raketen also Air ist bereits gut, bei normalen Schüssen aber kleinere Partikel und keine Explosion beim Auftreffen), Archer Tower nicht
[ ] Rocket Tower muss noch etwas heller werden...gibt es da unterschiede zum Dual Gatling Tower was rendering angeht? kann auch sein dass er einfach dunklere texturiert ist.
[ ] ICE Tower mit Slow Effekt implementieren, Splash Damage Type (gegner im kleinen Radius betroffen) 
    [ ] Air auch treffbar durch ihn
    [ ] model und sound liegen bereits da
    [ ] Soll kurzeitig rein optisch beim splashen von ice auf die route helllblaue Eisflächen auf dem Boden hinterlassen (ob die einen Effekt haben müssen wenn gegner reinlaufen steht noch aus ob das gut umsetzbar ist nicht zuvie Perf. kostet)
[ ] Dual Gatling Tower schießt in einem Bogen...das sollte nicht sein, Bogen nur für Archer.
[ ] Cannon, Magic und Snipertower mal komplett inaktiv nehmen.

[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbrechung der Route)
[ ] bei anderen Gegner stimmen die Vorschaumodelle nicht (z.b. Panzer) - was machen wir aber bei späteren gemischten Waves.

Performance:
 [~] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [~] Tile-Loading optimiert (downloadQueue.maxJobs=4, parseQueue.maxJobs=1, größerer lruCache) → deutlich flüssiger
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.

LOS:
 [x] **Statisches Pfad-LOS-Grid** ✓ Implementiert
     - 2m Grid entlang Route (±7m Korridor)
     - Bei Tower-Platzierung vorberechnet
     - O(1) Lookup zur Laufzeit
     - Shader-basierte Visualisierung mit Pulsing-Animation

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

Z-Kategorie (Nice-to-have Optimierungen):
- [ ] LOS-Visualisierung: Gebäude-Verdeckung
      Aktuell: depthTest=false (Zellen immer sichtbar, auch durch Gebäude)
      Ideal: Zellen von Gebäuden verdeckt aber nicht vom Terrain
      Mögliche Ansätze: Stencil Buffer, Decal-Rendering, Custom Depth Pass

