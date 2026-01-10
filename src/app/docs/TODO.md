# Offene TODOs

[ ] Mobs laufen z.t. unterirdisch an bestimmten Stellen (Vermutung: unterbechnung der Route)
[ ] Kein Feuer AM HQ bei Damage
[ ] bei anderen gegner stimmen die vorschaumodelle nicht (z.b. Panzer)


Bug:
 [x] gegner laufen am HQ angekommen die letzte etappe in der luft bis sie exakt am HQ Marker sind. liegt der in der Luft? Die sollten am boden bleiben und eher in das Gebäude  reinlaufen

Performance:
 [ ] spielt man das in einer größeren Stadt mit vielen 3d Gebäuden und straßen, kommt es beim zoomen oder panen und auch beim laden kurz zu aussetzern.
     da läuft jeweils irgendwas langlaufendes. da sollten wir feedback geben was gerade gemacht wird und das ggfs. auch noch optimeren. parallalsieren.
     [ ] Viele gegner sind erfreulicherweiße überhaupt kein problem...nur ein problem mit paning und zooming wenn tiles dazu kommen, etc.
     [ ] ist aber nicht so dramatisch wie es sich anhört.

 [ ] **Straßen-Overlay verursacht massiven FPS-Drop** (144 FPS → 35 FPS)
     - Ursache: 200-600 separate THREE.Line Objekte mit je eigenem geklonten Material
     - Jede Straße = 1 Draw Call → 200-600 Draw Calls statt 1
     - `frustumCulled: false` verhindert Culling-Optimierung
     - Während Height-Sync wird alles alle 500ms komplett neu erstellt
     - **Empfohlener Fix:** Merged Geometry - alle Straßen in EINE BufferGeometry
       → Erwartete Verbesserung: 10-15x Performance (1 Draw Call statt 600)
     - Alternativ: THREE.LineSegments oder InstancedMesh
     - Datei: tower-defense.component.ts, renderStreets() (Zeilen 2057-2154)

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

Allgemein:

Gegner:
 [x] Spawn verhalten: wird der spawn irgendwie verzögert? es dauert bei 1000 gegner bis die wellte los geht "Gegner sammeln sich..."
    [x] die laufen dann alle im Pulk los und sollten etwas verzögert werden. konfigurierbar am besten

Projektile:
 [ ] Sollen nur ihr Ziel erreichen können wenn wirklich eine Sichtverbindung zum Gegner besteht (Line-of-Sight)

Türme:

UI:
 [ ] Location Dialog nicht in unserem Style des TD. bitte Styleguide anwenden und selben background und schatten wie sidebar verwenden für dialog background. KEIN PURPLE

Kamera:

Gameplay:

Location-System Bekannte Einschränkungen:
 [ ] Nominatim-Geocoding gibt oft Straßen-Koordinaten statt Gebäude-Koordinaten
     - Workaround: Manuelle Koordinaten-Eingabe nutzen
     - Mögliche Verbesserung: Alternative Geocoding-API (Photon, Google)
