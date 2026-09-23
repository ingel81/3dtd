# Tower bemannen (Egoperspektive)

**Stand:** 2026-09-23, MVP. Der Spieler steigt in einen Tower, zielt mit der Maus aus der Egoperspektive und
feuert selbst. Solange er drin sitzt, feuert der Tower nicht von allein. Alle Regeln des Towers gelten weiter.

---

## Bedienung

| Was | Wie |
|---|---|
| Einsteigen | Tower wählen, dann `C` oder der Knopf mit dem Gamepad im Tower-Panel (Zeile der Zielwahl) |
| Zielen | Maus (Pointer Lock). Ohne Lock (vom Browser abgelehnt) fängt der nächste Klick auf die Karte die Maus |
| Feuern | linke Taste halten |
| Zoom | rechte Taste halten, 25° statt der 60° der Kamera, die Maus dreht dann langsamer. Beide Tasten zusammen gehen in jeder Reihenfolge: Abzug und Zoom kommen aus `event.buttons`, weil eine zweite Taste bei gedrückter erster nur als `pointermove` kommt |
| Aussteigen | `Esc` (gibt die Maus frei, das Spiel nimmt das als Aussteigen), `C` |
| Weiter nutzbar | Leertaste (Welle), `P`, `+`/`-`, `M`. Bauen, Verkaufen, Upgrades, Fähigkeiten, Held, Kamera-Tasten, Photo Mode und Dialoge warten |

Der Spieler steigt auch aus, wenn der Tower verkauft wird, das Spiel endet oder neu startet und wenn etwas anderes
die Kamera oder die Maus nimmt: Photo Mode, Replay, Boss-Intro, Intro-Flug, HQ oder Spawn setzen (Header),
Laden, Fehler. Die Kamera kehrt dann sofort (am Event `tower:manned`) dorthin zurück, wo er eingestiegen ist,
bei einem neuen Ort vor dessen Rahmung.

Bemannbar sind im MVP die Projektil-Tower (Archer, Dual Gatling, Cannon, Magic, Rocket, Ice, Poison, Chaos). Fire
(Strahl), Tentacle (Nahkampf), Lightning (Kette) und die passiven Gebäude nicht; bei ihnen fehlt der Knopf, und
`command:man-tower` ändert nichts.

---

## Regeln

Der besetzte Tower läuft pro Sub-Step über `TowerCombatService.updateMannedTower()` statt über
`updateTowerShooting()`:

- **Drehen:** Der Turm dreht mit seiner eigenen Geschwindigkeit (~π rad/s) zur Zielrichtung des Spielers, auch
  zwischen den Wellen. Tower mit `pitchNodes` (Dual Gatling) neigen die Rohre dazu, begrenzt auf `pitchRange`.
- **Feuern:** in und zwischen den Wellen, bei gehaltenem Abzug, wenn der Cooldown des Towers abgelaufen ist und der Turm höchstens 5° neben der Zielrichtung steht (`alignToleranceRad`; der
  Autofeuer-Wert ist 15°). Feuerrate, Schaden, Projektil, Schadensart und Upgrades sind die des Towers: der
  Cooldown ist dieselbe `CombatComponent` wie beim Autofeuer, `combat.fireRate` setzt nur das Upgrade
  (`Tower.applyUpgrade`), der Test prüft die Schusszahl gegen die Rate der Upgrade-Stufe exakt.
- **Treffer:** Ein Strahl vom Augenpunkt entlang der Zielrichtung. Getroffen ist der erste Gegner, an dessen
  Zielpunkt (Modellmitte, beim Ooze der nächste Punkt des Körpers) der Strahl innerhalb des Trefferradius
  vorbeigeht und den der Tower angreifen darf: `Tower.mayEngage()`, dieselbe Prüfung wie beim Autofeuer (lebt,
  Luft oder Boden samt AA-Retrofit, Reichweite horizontal, Sichtlinie vom Tower aus). Auf ihn fliegt ein normales
  Projektil, Treffer, Splash, Statuseffekte, Kill-Credit und Veteranenrang laufen wie sonst.
- **Fehlschuss:** Ohne gültigen Gegner auf dem Strahl ist der Schuss ein Fehlschuss, in jede Richtung, auch
  zwischen den Wellen: dasselbe Projektil mit Mündungsfeuer und Sound, aber ohne Ziel (`targetEnemy` null). Es
  fliegt zum Punkt auf dem Zielstrahl in Reichweite des Towers, läuft also durchs Fadenkreuz, und ist dort weg:
  kein `projectile:hit`, kein Schaden, kein Splash, kein Einschlag (`ProjectileManager.fireBlank()`). Der
  Cooldown ist verbraucht. Ein Gegner außerhalb der Reichweite oder hinter einem Haus ist ein Fehlschuss, auch wenn
  das Fadenkreuz auf ihm liegt; ein Fehlschuss, der durch einen Gegner fliegt, trifft ihn nicht. Getroffen wird
  nur, was der Zielstrahl beim Abdrücken gewählt hat.
- **Trefferradius:** halbe sichtbare Höhe des Gegners, 0,6 bis 4 m, plus 0,4 m Toleranz; beim Ooze 2,5 m.
- **Hold Fire** bleibt beim Einsteigen, wie es war, und hindert den Spieler nicht am Feuern.

Zahlen: `configs/tower-control.config.ts` (`TOWER_CONTROL`). Geometrie (Richtung, Augenpunkt, Strahltest):
`utils/manual-aim.ts`.

---

## Ablauf

```
TowerControlService (UI: C, Panel-Knopf, Maus)
   command:man-tower { towerId }   command:tower-trigger { held }   command:leave-tower
   GameStateManager.setMannedAim(heading, pitch)   pro Mausbewegung, kein Command
                        │
     GameCommandsHandler → GameStateManager.manTower / setMannedTrigger / leaveTower
                        │                      → TowerLifecycle.man / setTrigger / leave
                        │                        tower:manned { towerId | null } → GameStore.mannedTowerId
GameStateManager.runSubStep
   … Autofeuer (überspringt den besetzten Tower) … → towerCombat.updateMannedTower(...)
                        │  drehen, Strahltest, Regeln, feuern
            ProjectileManager.spawn (Treffer) | fireBlank (Fehlschuss, freies Projektil)
                        │
            tower:manual-shot { towerId, target } (deferred)   → HUD: Rückstoß
            projectile:hit (sourceTowerId)                     → HUD: Treffermarker, Tick
            enemy:died (killedBy tower)                        → HUD: Kill-Marker, zwei Ticks
```

**Warum das Zielen kein Command ist:** Das Replay schreibt jedes `command:*` ins Befehlslog und setzt je Befehl
eine Marke in die Leiste. Ein Command pro Frame würde beides fluten. Einsteigen, Aussteigen und der Abzug sind
Commands; die Zielrichtung liegt als Eingabe am Tower (`Tower.manualAim`). Für eine spätere Re-Simulation oder
Lockstep (MULTIPLAYER_CONCEPT) müsste sie als gedrosselter Command oder pro Schuss mitlaufen.

**Kamera:** `TowerControlService.update()` setzt die Kamera jeden Frame nach den Sub-Steps auf den Augenpunkt
und richtet sie aus. Er liegt 2 m über der Mündungshöhe, mindestens aber 1,5 m über der Oberkante des Modells
(`eyeOverModelM`, gemessen einmal an dessen Bounding Box, `ThreeTowerRenderer.modelTopY`): beim Archer sitzt die
Mündung unter dem Dach, 2 m darüber war noch im Turm. Beim Blick waagerecht oder nach oben 1,6 m hinter dem
Tower; beim Blick nach unten wandert er mit der Neigung (smoothstep) bis 1,8 m vor die Mündung bei -60°, damit
das Geschütz aus dem Bild fällt (`eyeBackAt`). Die
Controls sind solange aus (`controls.enabled = false`, wie beim Boss-Intro). Tasten-Pan (WASD) bewegt die Kamera
zwar, wird aber im selben Frame überschrieben.

**Eingabe:** Die Zeiger-Listener hängen am `window` in der Capture-Phase, vor InputHandlerService und den
Controls, und stoppen Events auf dem Canvas. Der Header bleibt klickbar, solange die Maus frei ist.

**HUD:** `components/tower-control-hud/`: Fadenkreuz (gold, solange ein angreifbarer Gegner auf dem Strahl
liegt, `TowerCombatService.mannedAimTarget`), Rückstoß je Schuss, Treffer- und Kill-Marker, Nachlade-Ring,
Zeile mit Tower-Name und Tasten. Sidebar und Overlays der Karte sind weg, Header und Info-Overlay (FPS) bleiben.
Beim Einsteigen gehen Auswahl und Hover des Towers (Ring, Reichweite; `InputHandlerService.clearHover`, auch ein
noch anstehender Hover-Pick), danach nimmt keine Mausbewegung mehr einen Tower auf. Das Abzeichen über dem
eigenen Tower (Rang, Hold-Fire-Pause) ist aus, weil es mitten im Bild stünde
(`TowerBadgeRenderer.hideFor`); Rang und Hold Fire laufen weiter und zeigen sich beim Aussteigen wieder. Die Ticks sind
synthetisch (`UI_SOUNDS.towerHit`, `towerKill` in `audio.config.ts`).

**Ton:** Die Schüsse des eigenen Towers spielen am Hörer (`audio:play` mit `atListener`,
`SpatialAudioManager.playAtListener`), ohne Richtung, mit allen Grenzen eines One-Shots. Am Modell unter und vor dem
Auge lag die Quelle beim Blick nach oben hinter dem Kopf, und das HRTF-Panning von three.js färbte den Klang um.
Der Hörer hängt an der Kamera, im Tower also nah an den Kills. Rückmelde-Sounds (Kill-Gold) klingen
darum solange wie aus mindestens 150 m (`feedbackSoundMinDistanceM`, siehe [SPATIAL_AUDIO.md](SPATIAL_AUDIO.md)),
Kampfgeräusche bleiben nah und laut.

---

## Tests

`integration/tower-control.scenario.spec.ts` durch den echten Sub-Step-Loop: kein Autofeuer im besetzten Tower,
nach dem Aussteigen wieder; mit Abzug Feuerrate des Towers, exakt nach Upgrade-Stufe, auch zwischen den Wellen; Projektil auf den Gegner im Fadenkreuz, Kill zählt
für den Tower; Fehlschuss daneben und bei einem Gegner außer Reichweite; Verkaufen steigt aus; Fire nicht
bemannbar. `utils/manual-aim.spec.ts` prüft die Geometrie gegen `geoHeading`.

---

## Grenzen des MVP

- Nur Projektil-Tower. Strahl, Nahkampf und Kette brauchen eigene Zielregeln.
- Ein Fehlschuss endet in der Luft in Reichweite des Towers, auch wenn der Strahl vorher Boden oder Haus trifft;
  er fliegt dann durch sie hindurch und ohne Einschlag.
- Der Augenpunkt folgt denselben Regeln für alle Tower (`eyeUpM`, `eyeBackM`, `eyeForwardDownM`, `eyeOverModelM`),
  keine Werte je Modell. Wo ein Modell hohe Spitzen hat, sitzt er dadurch hoch.
- Verliert das Fenster die Maus (Alt-Tab), steigt der Spieler aus.
- Beim Ooze prüft der Strahl nur den einen Punkt, auf den der Tower zielen würde (der nächste sichtbare Punkt
  des Körpers, `BodyAim`), mit 2,5 m Radius. Wer auf einen anderen Teil des Körpers zielt, schießt daneben.
- Treffer- und Kill-Marker hören auf den Tower, nicht auf den einzelnen Schuss: ein Projektil, das vor dem
  Einsteigen flog, oder ein Gift-Kill aus einem früheren Treffer zeigt sie auch.
- Bots und Wave-Director sehen die Bemannung nicht; der Tower zählt im Deckel wie immer.
- Nicht im Replay als eigener Zustand: das Replay zeigt, was die Renderer zeigten (Turmdrehung, Projektile).
