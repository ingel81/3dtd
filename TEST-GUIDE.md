# Test Guide — jarvis/todo-neu-fixes

## 1. Herbert Boss-Styling entfernt
- Wave mit Herbert-Enemies starten
- ✅ Herbert hat **keine Boss-Healthbar** mehr (normaler Healthbar wie andere Enemies)

=> ok

## 2. Sell-Button getrennt von Upgrades
- Tower platzieren, alle Upgrades kaufen
- ✅ Sell-Button ist **visuell getrennt** vom Upgrade-Block (nicht mehr an gleicher Position)
- ✅ Kein versehentliches Verkaufen beim schnellen Upgrade-Klicken

=> ist immer noch so, dass wenn alle upgrade gekauft wurden und der sell button dadurch nach oben rutscht man ihn versehentlich klicken wird wenn man auf die upgrades hämmert weil es schnell gehen muss.

## 3. Target-Optionen gefiltert
- Tower auswählen der NUR Ground kann (z.B. Cannon)
- ✅ "Air Priority" Option wird **nicht** angezeigt
- Tower auswählen der NUR Air kann
- ✅ Nur sinnvolle Optionen sichtbar
- Tower der beides kann (z.B. Archer)
- ✅ Alle Optionen verfügbar

=> ja, das problem ist nun noch dass air prio ja schön und gut ist für türme die beides können...aber welche targeting rule wender er dann bei air an? irgendwie noch halbgar die option
    man müsste quasi sagen könnne nimm bitte air und davon die stärksten ,schwächsten, weitestend ,nahesten, etc.

## 4. Wave Debug Delay-Precision
- Wave Debug Panel öffnen, Delay-Slider bewegen
- ✅ Maximal 1-2 Nachkommastellen (kein 0.30000000000004 mehr)

=> ok

## 5. Enemy-Type Dropdown gestyled
- Enemy Debug Panel öffnen
- ✅ Dropdown sieht aus wie der im Enemy Debugger (custom styling, kein Browser-Default)

=> hier hat sich nichts getan...das dropdown panel(!) sieht immer noch gleich aus (ich meine das auswahl control für den  gegerntyp um einen gegner zu platzieren. unterhalb "Placement")

## 6. Pinguin Frost-Effekt
- Ice Tower platzieren, Pinguin-Wave starten
- ✅ Pinguine zeigen sichtbaren **Frost-Effekt** wenn getroffen (blauer Tint + leicht transparent)
- Vergleich: andere Enemies sollten Frost-Effekt ebenfalls zeigen

=> ok

## 7. DevWorld: Bauen auf Gebäuden
- DevWorld starten (mit Gebäuden, z.B. "dense")
- Tower auf ein Gebäude platzieren
- ✅ Platzierung funktioniert, **kein "Nicht auf Gebäuden bauen" Fehler**
- Normaler Modus (echte Karte): Verhalten unverändert

=> NICHT OK => man kann jetzt wieder inerhalb gebäude auf der devworld bauen. gebäude werden nun auf dem terrain, aber im gebäude gebaut- trüme sollten aber in diesem fällen oben auf dem gebäude stehen. das war in einer früheren version bereits mal gelöst worden. da fehlt was.
