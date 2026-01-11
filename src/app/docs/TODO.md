# Offene TODOs

[ ] Warning in Console:
    [ ] CesiumIonAuthPlugin: Plugin has been moved to "3d-tiles-renderer/core/plugins". (anonymous)	@	three-tiles-engine.ts:229
[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbrechung der Route)
[ ] bei anderen Gegner stimmen die Vorschaumodelle nicht (z.b. Panzer) - was machen wir aber bei späteren gemischten Waves.
[ ] Compass eine nuance weniger aufdringlich und subtiler machen
[ ] Die Routenanimation hört auf sich zu bewegen und blendet dann aus, besser wäre wenn dass erst nach dem Ausblende aufhört zu animieren.
    Sollte auch noch optisch etwas feiner und hochwertiger aussehen

Performance:
 [ ] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.

LOS:
 [ ] Tower Prüfen ab dem Punkt in ihrer Mitte innen..streng genommen müssten sie ab außen an der Hülle prüfen. Relevant wenn der Tower auf einem gebäude steht z.b.

Projektile:
 [ ] Sollen nur ihr Ziel erreichen können wenn wirklich eine Sichtverbindung zum Gegner besteht (Line-of-Sight)

Location-System Bekannte Einschränkungen:
 [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
     - Workaround: Manuelle Koordinaten-Eingabe nutzen
     - Mögliche Verbesserung: Alternative Geocoding-API (Photon, Google)

Ideen:
- coole locations irgendwie sharebar machen

