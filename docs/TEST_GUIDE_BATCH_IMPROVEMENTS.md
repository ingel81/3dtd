# Test-Guide: Branch `jarvis/batch-improvements`

> 34 Commits, 87 Dateien, +7830/-1833 Zeilen

---

## ⚡ Schnell-Check (5 Minuten)

1. Spiel starten → kein Crash ✓
2. Tower platzieren → Enemies kommen → Tower schießt → **Trail-Streaks sichtbar** ✓
3. Tower schießt → **Muzzle Flash** (gelb/weiß Blitz + Licht) ✓
4. Cannon/Rocket-Explosion → **animierte Partikel** ✓
5. Explosion → **Kamera wackelt** (Screen Shake) ✓
6. Ice Tower → Enemy verlangsamt → **blaue Frost-Aura + Tint** sichtbar ✓
7. Debug-Panel → Display → **Color Grading** auf "Dark Fantasy" → Look ändert sich ✓
8. Debug-Panel → Performance → **Subsystem Timings** sichtbar ✓
9. Tower upgraden (Range) → **LOS-Kreis wird größer** ✓
10. Speed 1x → 2x → 4x → **funktioniert** ✓
11. Rechtsklick im Baumodus → **Placement abgebrochen** ✓

---

## Detaillierte Tests

### 1. Trail-Streaks (Visuell)
**Wo:** Im Spiel, sobald Türme schießen
**Wie:** Platziere verschiedene Tower-Typen und beobachte die Projektile:
- 🏹 Archer → dünner weißgelber Lichtstreifen
- 💣 Cannon → grauer Rauchschweif
- 🚀 Rocket → dicker orangeroter Feuerschweif
- 🧊 Ice → cyan-blauer Kristalltrail
- 🔮 Magic → lila-blauer Wisp
- 🔫 Gatling → kurze gelbe Leuchtspuren

**Checken:** Trails verschwinden wenn Projektil einschlägt, kein visueller Müll.

---

### 2. Sprite-Sheet Partikel (Visuell)
**Wo:** Explosionen (Cannon/Rocket-Einschläge)
**Wie:** Lass Cannons/Rockets auf Enemies schießen
**Checken:** Explosionen sollten jetzt animierte Frames zeigen statt einfarbiger Punkte (Flash → Fireball → Rauch). Vergleich mit vorher: deutlich "filmischer".

---

### 3. Color-Grading LUT (Visuell)
**Wo:** Debug-Panel → Display Options → "Post-Processing" Sektion
**Wie:** Dropdown: `Off`, `Dark Fantasy`, `Noir`, `Warm Sunset`
**Checken:**
- Jeder Preset ändert die Farbstimmung spürbar
- `Off` = exakt wie vorher
- Bleibt nach F5 erhalten (localStorage)

---

### 4. Performance Debug-Panel (UI)
**Wo:** Debug-Panel → Performance
**Wie:** Spiel starten, Debug-Panel öffnen
**Checken:**
- **Frame Budget** Sektion: FPS, Frame Time (ms), Budget Used (%)
- **Subsystem Timings**: Enemy, Tower, Projectile, Combat, Events — jeweils mit ms-Wert
- **Bottleneck** wird orange markiert (der langsamste Subsystem)
- Werte bei 12ms+ gelb, 16ms+ rot

---

### 5. Range-Upgrade → LOS (Gameplay)
**Wo:** Im Spiel, Tower platzieren → upgraden
**Wie:**
1. Platziere einen Tower (z.B. Archer)
2. Merke dir den LOS-Radius (sichtbare Zellen)
3. Upgrade Range
**Checken:** LOS-Visualisierung wird größer nach dem Upgrade. Tower kann jetzt weiter entfernte Enemies angreifen.

---

### 6. Spielgeschwindigkeit (Gameplay)
**Wo:** Speed-Buttons im Game-UI
**Wie:** Wechsle zwischen 1x, 2x, 4x während einer Welle
**Checken:** Geschwindigkeit ändert sich tatsächlich (Enemies laufen schneller, Projektile fliegen schneller). War vorher kaputt (UI und GameState nicht synchron).

---

### 7. Spatial Grid (Performance)
**Wo:** Nicht direkt sichtbar — Performance-Verbesserung
**Wie:** Spiel mit vielen Enemies laufen lassen (späte Wellen, viele Tower)
**Checken:** Im Performance-Panel: Combat-Timings sollten niedrig bleiben auch bei 50+ Enemies. Kein spürbares Ruckeln bei Tower Sleep/Wake.

---

### 8. Web Worker Pathfinding (Performance)
**Wo:** Nicht direkt sichtbar — Main Thread entlastet
**Wie:** Tower platzieren während Enemies laufen
**Checken:** Kein Frame-Drop/Ruckler beim Platzieren, besonders auf komplexen Maps. DevTools → Console: keine Worker-Errors.

---

### 9. Audio (Regression)
**Wo:** Überall im Spiel
**Wie:** Normales Spielen — Tower-Schüsse, Explosionen, Enemy-Sounds
**Checken:** Audio funktioniert noch wie vorher (Audio-Split war nur Refactoring, keine Verhaltensänderung).

---

### 10. Muzzle Flash (Visuell)
**Wo:** Im Spiel, Projectile-Tower schießen
**Wie:** Archer, Cannon, Gatling, Rocket platzieren und schießen lassen
**Checken:** Kurzer gelb/weißer Blitz (3-5 Partikel + PointLight) am Barrel beim Schuss. NICHT bei Ice/Magic/Fire (Beam-Tower).

---

### 11. Screen Shake (Visuell + Haptik)
**Wo:** Im Spiel bei Explosionen
**Wie:** Cannon/Rocket auf Enemies schießen lassen, HQ Damage kassieren
**Checken:**
- Kamera wackelt leicht bei Cannon-Hit, stärker bei Rocket, stark bei HQ-Damage
- XZ-Ebene nur (kein vertikales Wackeln)
- Togglebar: Debug-Panel → Display → Effects → "Screen Shake"

---

### 12. Freeze-Visual-Effect (Visuell)
**Wo:** Im Spiel, Ice Tower auf Enemies schießen
**Wie:** Ice Tower platzieren, warten bis Enemy verlangsamt wird
**Checken:**
- Enemy bekommt blauen Emissive-Tint
- 3 cyan/weiße Partikel orbieren um den Enemy
- Effekt verschwindet wenn Slow ausläuft

---

### 13. Animation LOD (Performance)
**Wo:** Nicht direkt sichtbar — FPS-Verbesserung
**Wie:** Viele Enemies spawnen, Kamera rauszoomen
**Checken:** Weit entfernte Enemies animieren seltener/gar nicht. FPS sollte deutlich besser sein bei 50+ Enemies. Im Performance-Panel: Enemy-Timings niedrig.

---

### 14. Rechtsklick-Cancel (Gameplay)
**Wo:** Tower-Placement
**Wie:** Tower zum Bauen auswählen → Rechtsklick auf die Map
**Checken:** Baumodus wird abgebrochen, kein Context-Menu erscheint.

---

## Automatisierte Checks

```bash
# TypeScript
npx tsc --noEmit              # ✅ 0 Errors

# Tests
npx vitest run                # ✅ 433/433 passed (35 Suites)

# Lint
npx ng lint                   # ✅ 0 neue Errors (11 pre-existing)
```

---

## Commit-Übersicht (neueste zuerst)

| Bereich | Was |
|---------|-----|
| **Visual** | Trail-Streaks, Sprite-Sheet Partikel, Color-Grading LUT, Muzzle Flash, Freeze-Effect, Screen Shake, Bloom |
| **Performance** | Animation LOD, Spatial Grid, Partikel Free-List, Tiles Throttling, Sleeping Towers, Combat Fallback, A* MinHeap, HQ Explosion Reduktion, Bounding Sphere Culling, Selection Ring Sharing, Precision Qualifiers, Magic Orb Shader |
| **Gameplay** | Spielgeschwindigkeit-Fix, Range-Upgrade LOS, Rechtsklick-Cancel, Tower-Targeting-Strategien |
| **Refactoring** | Audio Split (4 Module), CombatEffect Split (4 Services), StatusEffect Extraktion, Distance-Zentralisierung, Error-Klassen |
| **Tests** | 46 Integration-Tests (5 Suites), Test-Fix-Commits für parallele Agent-Integration |
| **Infra** | Web Worker Pathfinding, Performance Instrumentation, TODO.md Updates |
