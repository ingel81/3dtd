# Test Guide — jarvis/todo-neu-fixes

## 1. Herbert Boss-Styling entfernt
- Wave mit Herbert-Enemies starten
- ✅ Herbert hat **keine Boss-Healthbar** mehr (normaler Healthbar wie andere Enemies)

## 2. Sell-Button getrennt von Upgrades
- Tower platzieren, alle Upgrades kaufen
- ✅ Sell-Button ist **visuell getrennt** vom Upgrade-Block (nicht mehr an gleicher Position)
- ✅ Kein versehentliches Verkaufen beim schnellen Upgrade-Klicken

## 3. Target-Optionen gefiltert
- Tower auswählen der NUR Ground kann (z.B. Cannon)
- ✅ "Air Priority" Option wird **nicht** angezeigt
- Tower auswählen der NUR Air kann
- ✅ Nur sinnvolle Optionen sichtbar
- Tower der beides kann (z.B. Archer)
- ✅ Alle Optionen verfügbar

## 4. Wave Debug Delay-Precision
- Wave Debug Panel öffnen, Delay-Slider bewegen
- ✅ Maximal 1-2 Nachkommastellen (kein 0.30000000000004 mehr)

## 5. Enemy-Type Dropdown gestyled
- Enemy Debug Panel öffnen
- ✅ Dropdown sieht aus wie der im Enemy Debugger (custom styling, kein Browser-Default)

## 6. Pinguin Frost-Effekt
- Ice Tower platzieren, Pinguin-Wave starten
- ✅ Pinguine zeigen sichtbaren **Frost-Effekt** wenn getroffen (blauer Tint + leicht transparent)
- Vergleich: andere Enemies sollten Frost-Effekt ebenfalls zeigen

## 7. DevWorld: Bauen auf Gebäuden
- DevWorld starten (mit Gebäuden, z.B. "dense")
- Tower auf ein Gebäude platzieren
- ✅ Platzierung funktioniert, **kein "Nicht auf Gebäuden bauen" Fehler**
- Normaler Modus (echte Karte): Verhalten unverändert
