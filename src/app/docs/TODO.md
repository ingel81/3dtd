# Offene TODOs

[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbrechung der Route)
[ ] bei anderen Gegner stimmen die Vorschaumodelle nicht (z.b. Panzer) - was machen wir aber bei späteren gemischten Waves.
[ ] Compass eine nuance weniger aufdringlich und subtiler machen

Performance:
 [ ] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.

 [ ] **Animationen laufen langsamer bei niedrigen FPS** (frame-abhängig statt zeit-abhängig)
     - Ursache: Hardcoded `this.update(16)` in three-tiles-engine.ts Zeile 962
     - Render Loop nimmt immer 60 FPS (16ms) an, egal wie viel Zeit wirklich vergangen ist
     - Bei 35 FPS vergehen tatsächlich ~28ms, aber Animation denkt es sind 16ms
     - Ergebnis: Animationen laufen mit ~57% Geschwindigkeit bei 35 FPS
     - Betroffen: Zombie-Animationen, Enemy Movement, Projectiles, Marker-Rotation
     - **Empfohlener Fix:** Echte deltaTime berechnen:
       ```typescript
       private lastFrameTime = 0;
       startRenderLoop(): void {
         const animate = (currentTime: number) => {
           const deltaTime = this.lastFrameTime ? currentTime - this.lastFrameTime : 16;
           this.lastFrameTime = currentTime;
           this.update(deltaTime);
           // ...
         };
       }
       ```
     - Datei: three-engine/three-tiles-engine.ts, startRenderLoop()

Projektile:
 [ ] Sollen nur ihr Ziel erreichen können wenn wirklich eine Sichtverbindung zum Gegner besteht (Line-of-Sight)

UI:
 [ ] Location Dialog nicht in unserem Style des TD. bitte Styleguide anwenden und selben background und schatten wie sidebar verwenden für dialog background. KEIN PURPLE

Location-System Bekannte Einschränkungen:
 [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
     - Workaround: Manuelle Koordinaten-Eingabe nutzen
     - Mögliche Verbesserung: Alternative Geocoding-API (Photon, Google)
