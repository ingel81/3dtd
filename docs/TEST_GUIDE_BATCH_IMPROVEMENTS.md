# Test-Guide: Branch `jarvis/batch-improvements`

> 25 Commits, 78 Dateien, +6674/-1564 Zeilen

---

## ⚡ Schnell-Check (5 Minuten)

1. Spiel starten → kein Crash ✓
2. Tower platzieren → Enemies kommen → Tower schießt → **Trail-Streaks sichtbar** ✓
3. Cannon/Rocket-Explosion → **animierte Partikel** ✓
4. Debug-Panel → Display → **Color Grading** auf "Dark Fantasy" → Look ändert sich ✓
5. Debug-Panel → Performance → **Subsystem Timings** sichtbar ✓
6. Tower upgraden (Range) → **LOS-Kreis wird größer** ✓
7. Speed 1x → 2x → 4x → **funktioniert** ✓

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

## Commit-Übersicht

| Commit | Beschreibung |
|--------|-------------|
| `57581c4` | fix: lint errors aus neuen Dateien |
| `d5c05a5` | fix: test failures aus paralleler Agent-Integration |
| `b140a8a` | feat: Integration-Tests (46 Tests, 5 Suites) |
| `0acae14` | fix: Sprite-Sheet Vector2 import |
| `f877aee` | fix: Sprite-Sheet Partikel cleanup |
| `b6fac01` | fix: Color Grading Preset restore nach Reload |
| `3e6b988` | feat: Web Worker für Pathfinding |
| `d6b1a17` | feat: Projektil Trail-Streak Ribbon Renderer |
| `febf3bb` | feat: Performance Instrumentation erweitert |
| `b521837` | refactor: Spatial Audio in 4 Module gesplittet |
| `b506722` | fix: LOS-Neuberechnung bei Range-Upgrade |
| `79e876b` | chore: TODO.md nach Jörg's Review aktualisiert |
| `3dc21fc` | fix: Game Speed UI ↔ GameStateManager Sync |
| `fd5d524` | perf: Partikel-Konsolidierung (4→2 Draw Calls) |
| `a8bd3ce` | refactor: StatusEffectService extrahiert |
