# Held (Söldner)

**Stand:** 2026-09-14, Zahlen abgeglichen am 2026-09-15. Stufe 1 des Helden aus
[PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md), Abschnitt 7
(Entwurf in Abschnitt 3.2 im
[Archiv](archive/PLAYER_AGENCY_CONCEPT_2026-09-11.md)): nur auf den
Gegnerrouten, unverwundbar. Im Spiel heißt er "Mercenary".

Der Held ist eine Einheit, die der Spieler einmal anheuert und dann entlang
der Gegnerrouten schickt. Er kämpft von selbst auf kurze Distanz, hält den
Posten, an den er geschickt wurde, und steigt über Kills auf. Anders als der
Nuklearschlag ([ABILITIES.md](ABILITIES.md)) wirkt er dauernd und zählt
deshalb im Fairness-Gate mit.

---

## In Zahlen

Alle Werte stehen in `configs/hero.config.ts` (`HERO`, `HERO_AMMO`, `HERO_LEVELS`).

| Punkt | Wert |
|---|---|
| Freischaltung | Forschung `mercenary-contract` ("Mercenary Contract"): 600 Credits, 30 s, Voraussetzung `siege-engineering`; sie gibt den Global-Perk `mercenary` |
| Anheuern | einmal, 1000 Credits (`command:hire-hero`). Er erscheint auf dem Routenpunkt, der dem HQ am nächsten liegt |
| Bewegung | nur auf den Gegnerrouten, 8 m/s. Ein Befehl (`command:hero-move`) landet auf dem nächsten Routenpunkt im Umkreis von 30 m, sonst wird er abgelehnt |
| Posten | der Punkt, an den er geschickt wurde. Dort steht er, solange er ein Ziel in Reichweite hat. Sonst verfolgt er den Gegner mit dem größten Pfadfortschritt im Umkreis von 38 m (Leine plus Reichweite) um den Posten, höchstens 20 m entlang der Route vom Posten weg, alle 250 ms Spielzeit neu gewählt. Ist keiner da, geht er zurück |
| Unterwegs | auf dem Weg zu einem neuen Posten schießt er, bleibt aber nicht stehen und verfolgt niemanden |
| Kampf | 18 m, gemessen in 2D wie bei den Towern, also Boden und Luft; keine Sichtlinie. Ziel ist der Gegner mit dem größten Pfadfortschritt in Reichweite; er hält es, solange es lebt und in Reichweite bleibt |
| Körper entlang der Route (Ooze) | zählt mit seinem nächsten Punkt statt mit der Spitze: Reichweite, Zielwahl, Halten, Verfolgen und Schuss. Der Schuss fliegt wie bei den Towern zu diesem Punkt (`aimPoint` in Zielhöhe `ROUTE_BODY_AIM_HEIGHT_M`), ohne Sichtlinie. `HeroWorld.bodyContact` misst über `RouteBody.nearest` (`utils/hero-body-contact.ts`); ohne Karte (headless ohne Engine) gilt die Spitze |
| Munition | drei Sorten, siehe unten; Wechsel mit `command:hero-ammo` |
| Stufen | 5, erreicht bei 0, 30, 100, 250 und 500 Kills; Schaden je Schuss ×1,0 / 1,15 / 1,3 / 1,45 / 1,6. Reichweite, Tempo und Feuerrate bleiben |
| Leben | unverwundbar, Gegner greifen ihn nicht an |
| Gold | jeder seiner Kills zahlt seinen Anteil am Kill-Budget der Welle wie jeder Kill |
| Wave-Director | virtueller Tower mit Präsenzfaktor 0,5, siehe [Fairness-Gate](#fairness-gate) |
| Bots | heuern ihn nie an, siehe [Bots](#bots) |

### Munition

Die Munition ist seine Schadensart. Alle drei machen vor der Matrix dieselben
48 Schaden pro Sekunde; entscheidend ist, gegen welche Rüstung.

| Sorte | Schadensart | Schaden × Rate | am besten gegen (von seinen drei) | Tracer | Schuss-Sound |
|---|---|---|---|---|---|
| Standard rounds | physical | 16 × 3/s | Unarmored, Light | goldener Tracer (`hero-round`, visuell `bullet`) | `towers/gatling/shoot.mp3`, 0,22 |
| Explosive rounds | siege | 32 × 1,5/s | Heavy, Fortified | orange-roter Tracer (`hero-shell`, visuell `shell`), kleine Explosion beim Treffer, kein Splash | `towers/cannon/shoot.mp3`, 0,3 |
| Rune rounds | magic | 24 × 2/s | Ethereal | kleiner violetter Plasma-Orb (`hero-rune`, visuell `magic`) mit violett-cyanen Funken | `towers/magic/cast.mp3`, 0,3 |

Ein Lauf beginnt mit Standard rounds. Der Stufenbonus gilt für jede Munition.

---

## Herleitung von Preis und Forschung

Einkommen laut Curriculum (`goldKill + goldComplete`, ohne Skill-Boni und ohne
die 100 Start-Credits), kumuliert: W5 2.300, W6 3.000, W7 3.800, W8 4.700,
W9 5.800, W10 7.200, W12 11.500.

- **Weg zum Helden von null:** `gatling-tech` 400 + `siege-engineering` 500 +
  `mercenary-contract` 600 + Anheuern 1.000 = 2.500 Credits. Das Einkommen
  deckt das rechnerisch nach W6; weil der Spieler in der Zeit Tower braucht,
  ist der Kauf realistisch um W8 bis W10, also um die ersten Luftwellen
  (W7/W8) und vor oder mit dem ersten Boss (W10). Der Nuklearschlag kostet
  auf seinem Weg 3.750 Credits (bis `advanced-weaponry`) und kommt damit
  später; so bringt der Held früher Aktivität, die Fähigkeit bleibt die
  spätere Rettung.
- **Forschung 600:** zwischen den ersten Tower-Freischaltungen (400 bis 450)
  und den teuren der zweiten Stufe (650 bis 700), ein Schritt nach der Cannon,
  mit der er die Siege-Munition teilt. Dauer 30 s wie die Stufe dazwischen.
- **Anheuern 1.000:** so viel wie ein Dual Gatling auf dem T1-Deckel
  (90 + zwei Tracks bis L5 je 410 = rund 910). Er bringt vor der Matrix 48 DPS
  (auf Stufe 5 rund 77), also weniger als ein ausgebauter Tower auf dem
  Papier, bei 18 m Reichweite. Der Aufpreis bezahlt, dass er die Schadensart
  wechselt und dorthin geht, wo die Welle durchbricht; das Gate rechnet ihn
  deshalb nur zur Hälfte.
- **Economy-Roster:** `tools/economy-chart` zählt das Anheuern einmal zum
  Design-Roster, die Forschung kommt über `RESEARCH_TREE`. Mit dem Helden wuchs
  das Roster von 469.702 auf 471.302 Credits, der Puffer des Curriculums blieb
  gerundet bei 68 %; W1 bis W30 sind nicht verändert. Mit den Forschungen für
  Frostbombe, EMP und Orbitallaser steht es heute bei 474.302 Credits und
  67 % Puffer (`docs/economy-chart.html`).

**Stufenkurve:** 30, 100, 250, 500 Kills. Wie viele Gegner er pro Welle
tötet, hängt am Posten und ist nicht gemessen. Gedacht ist Stufe 2 nach
einigen Wellen im Mittelspiel und Stufe 5 um die großen Schwärme (W19 bringt
rund 930 Körper). Die +15 % je Stufe sind bewusst bescheiden: Tower wachsen
über 25 Upgrade-Stufen auf ein Vielfaches ihrer Basis-DPS, der Held fällt im
Spätspiel an Rohschaden zurück und bleibt über Munitionswahl und Position
nützlich. Das ist eine Playtest-Frage.

---

## Ablauf

```
UI: Klick auf die Route (HeroControlService), Taste V, Helden-Panel, Held-Knopf der Leiste
    command:hire-hero · command:hero-move { target } · command:hero-ammo { ammo }
                                   │
                    GameCommandsHandler → HeroManager.hire / moveTo / setAmmo
                                   │  Forschung, Credits, Route in Reichweite,
                                   │  Weg per Dijkstra im Befehl
                  ┌────────────────┴────────────────┐
        hero:rejected { reason }           hero:state-changed { hero }
GameStateManager.runSubStep
  … enemyManager.update, Tower-Kampf … → heroManager.update(stepMs)   eigener Schritt am Ende
                                   │  laufen, Ziel wählen, Leine, feuern
             ProjectileManager.spawnShot (Quelle 'hero', kein Tower-Typ)
                                   │  nächste Sub-Steps: Flug
       projectile:hit → CombatEffectService → DamageApplicationService (Quelle 'hero')
                                   │
                 enemy:died, dann hero:kill → HeroManager zählt, ggf. hero:level-up
```

| Event | Abnehmer |
|---|---|
| `hero:state-changed` | GameStateSyncService → `GameStore.hero` |
| `hero:kill` | HeroManager (Kills, Stufe) |
| `hero:level-up` | VFXService ("LEVEL N" über seinem Kopf) |
| `hero:rejected` | RefusalHintService: Grund in der Kontext-Hinweis-Box, nicht für Befehle des Bots ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#context-hint-box)) |

Gründe für `hero:rejected`: `locked`, `hired`, `credits`, `no-hero`,
`no-route`, `unknown-ammo`.

---

## Routengraph

`utils/route-graph.ts` macht aus den Routen-Polylinien (eine je Spawn) ein
Netz:

- Wegpunkte, die näher als 1,5 m beieinander liegen, werden ein Knoten. Wo
  zwei Routen dieselbe Straße teilen, teilen sie deren Wegpunkte.
- Liegt ein Wegpunkt auf einem Segment einer anderen Route, aber nicht an
  dessen Enden, wird das Segment dort geteilt: eine Route, die zwischen zwei
  Wegpunkten einer anderen einmündet, trifft sie in einem Knoten.
- Positionen in Metern auf einer flachen Projektion um den ersten Wegpunkt.
- `nearestPoint` snappt Klicks, `shortestPath` ist Dijkstra zwischen zwei
  Punkten auf Kanten, `closestWithinReach` findet den Punkt innerhalb einer
  Strecke entlang des Graphen, der einer Position am nächsten liegt (die
  Leine).

Routen, die sich weder Wegpunkte teilen noch berühren, bleiben getrennte
Teile; ein Befehl auf einen solchen Teil wird mit `no-route` abgelehnt.
Ändern sich die Routen (neue Arrays im `PathAndRouteService`), baut der
Manager den Graphen neu und setzt Held und Posten auf den nächsten Punkt.

---

## Determinismus

- Die Befehle wirken beim Emit wie die übrigen Commands. Der Weg eines
  Bewegungsbefehls wird im Befehl berechnet, aus den Routen allein.
- Der Graph ist eine reine Funktion der Routen: Routen werden nach ihrem
  Schlüssel gelesen, nicht in Einfügereihenfolge, Schleifen laufen nach
  Index, die Prioritätswarteschlange bricht Gleichstand nach Knotenindex.
- Laufen, Zielwahl, Leine und Feuern laufen im Sub-Step in Spielzeit
  (`heroManager.update(stepMs)`), ohne Zufall. Die Feuerpause zählt die
  `CombatComponent` in Spielzeit, das Neuplanen der Leine alle 250 ms
  Spielzeit.
- Die Befehle tragen die Werte, nicht "nächste": `command:hero-ammo` die
  Munition, `command:hero-move` den geklickten Punkt. Ein Replay derselben
  Befehle an denselben Sub-Steps ergibt denselben Helden.
- Nachweis: `integration/hero.spec.ts` heuert an, schickt und lässt ihn
  kämpfen durch den echten Sub-Step-Loop mit echten Gegnern, Projektilen und
  Schadensweg; Position, Kills, Gegner-HP, Credits und Schusszahl sind bei
  Timescale 1 und 10 gleich. `route-graph.spec.ts` prüft, dass derselbe
  Graph und derselbe Weg herauskommen, egal in welcher Reihenfolge die
  Routen ankommen, und dass gleich lange Wege immer gleich aufgelöst werden.

---

## Fairness-Gate

Der Held wirkt dauernd, also zählt er im Defense-Modell (Konzept Abschnitt 2,
Folgerung 1). `analyzeDefense(towers, airUnlocked, hero)` bekommt sein Profil
(`HeroManager.getDefenseProfile()`, `heroDefenseProfile()` in
`hero.config.ts`) und rechnet ihn als virtuellen Tower mit Präsenzfaktor 0,5:

- **`effectiveDPSPerArmor` und `gateDpsPerArmor`**, Boden und Luft: je
  Rüstung seine beste Munition (DPS × Matrix) × 0,5. Beste, weil der Spieler
  jederzeit wechseln kann; mit der beim Planen geladenen Munition könnte man
  vor dem Start eine schlechte laden, die Welle kleiner machen und danach
  wechseln. Die Gate-Sicht bekommt denselben Matchup-Boden wie ein Tower;
  seine beste Munition liegt überall darüber.
- **`killThroughput`**: Schüsse pro Sekunde seiner schnellsten Munition
  (3/s) × 0,5, Boden und Luft.
- Nicht in `totalDPS` (DPS-Rampe, COMING UP), nicht in den Fähigkeiten
  (Anti-Air, Anti-Ethereal, Splash), nicht im AoE-Anteil und nicht im
  DPS-Profil entlang des Pfads, das nur der ONNX-Pfad liest.
- Seine Kills sind Kills wie die eines Towers. Anders als Fähigkeits-Kills
  bucht der Leck-Regler sie nicht als Leck (Konzept 6.1: "Beim Held nicht").
  Die Folge laut Konzept Abschnitt 2: senkt er die Leck-Quote, werden die
  Wellen nach vier bis acht Wellen größer.

---

## Darstellung

**Modell** (`three-engine/renderers/hero-model.ts`): `HERO_MODEL.url` zeigt
auf `assets/models/hero/mercenary.glb` (Quaternius SWAT, oliv umgefärbt, mit
Gewehr, CC0, Credits in `attributions.config.ts`; 1,82 Einheiten hoch, Blick
+Z). Der Renderer lädt es über den AssetManager, skaliert es auf 4,5 m wie
die menschengroßen Gegner (1,78-m-Modell mit Skala 2,5, siehe
ENEMY_MODEL_BUDGET.md), setzt die Füße auf den Boden und blendet die Clips
je Zustand über:

| Zustand (`HeroPresentation.pose`) | Clip |
|---|---|
| `idle`: steht ohne Ziel | `idle` |
| `run`: läuft ohne Ziel | `run` |
| `shoot`: steht und feuert | `aim` (Schleife, für Dauerfeuer) |
| `run-shoot`: feuert auf dem Weg zu einem neuen Posten | `run_shoot` |

Den Clip `shoot` des GLB (ein Schuss mit starkem Rückstoß) nutzt er nicht.
Der Renderer lädt das GLB einmal, beim ersten Frame des Helden. Bis es da
ist, und wenn es nicht lädt (Warnung in der Konsole), zeigt er nur die Ringe;
eine Ersatzfigur gibt es nicht.

**Renderer** (`three-engine/renderers/hero.renderer.ts`, `engine.hero`): das
Modell auf dem Boden des Route-Grids wie die Füße der Gegner, Blickrichtung
aus seiner `TransformComponent`. Solange er gewählt ist, ein goldener Ring
unter ihm, ein kleinerer auf seinem Posten und der Bewegungsring unter dem
Cursor (gold auf einem Routenpunkt, rot ohne), flache Meshes mit
abgeschaltetem Tiefentest wie die Fähigkeits-Marker. Animation in Spielzeit
(Pause hält sie an), das Pulsieren des Rings in Echtzeit.

**Schüsse**: echte Projektile über `ProjectileManager.spawnShot`, also
dieselben Tracer, Partikelspuren, Streaks, Einschläge, Schadenszahlen und
Projektil-Sounds wie bei den Towern. Kein Mündungsfeuer, das hängt an
Tower-Modellen.

**Mündung**: ein Schuss startet an der Mündung des Gewehrs. Das GLB hat dafür
den Knoten `Muzzle` unter dem Knochen `WristR`. Die Simulation liest ihn nicht
zur Laufzeit, denn Renderzustand in der Simulation wäre je Timescale und ohne
Renderer (Bots, Tests) anders. Sie nimmt `HERO.muzzle` (2,4 m vor ihm, 0,36 m
rechts, 3,45 m hoch), gedreht um seine Blickrichtung (`heroMuzzleOffset`).
Die Werte sind am GLB in der Zielpose bei 4,5 m gemessen; `hero.renderer.spec.ts`
lädt die Datei und prüft sie auf 5 cm. In der Laufpose mit Feuer liegt die
Mündung bis zu 0,2 m anders, dort startet der Tracer entsprechend neben dem Lauf.

**Stufenaufstieg**: "LEVEL N" in `--td-gold-light` steigt über seinem Kopf auf.

---

## Bedienung

- **Anheuern:** oberster Knopf der Fähigkeitenleiste am linken Rand,
  sichtbar ab der fertigen Forschung. Vor dem Anheuern zeigt er eine Münze
  ohne Taste, sein Tooltip den Preis und die fehlenden Credits; ein Druck
  schickt `command:hire-hero` (`HeroControlService.hire`), der HeroManager
  prüft Forschung und Credits. Fehlen Credits, steht 2,5 s in der
  Kontext-Hinweis-Box "Hire Mercenary" über "Need 600 credits"
  (`RefusalHintService`). Danach zeigt der Knopf den Helden mit G, im
  Tooltip Stufe und Munition (`heroBarView()` in `ability-bar/hero-bar.ts`,
  Aussehen in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#fähigkeitenleiste-canvas)).
- **Wählen:** Klick auf ihn, Taste G oder sein Knopf in der Leiste
  (`HeroControlService.summon`, Knopf und Taste tun dasselbe). Das beendet
  Build-Modus, Kartenplatzierung und Zielmodus und wählt den Tower ab.
- **Schicken:** gewählt schickt ein Linksklick auf den Boden ihn zum
  nächsten Routenpunkt; ein Klick auf einen Tower wählt weiter den Tower.
  Er bleibt gewählt. Ohne Route in 30 m warnt die Kontext-Hinweis-Box "No
  route within 30 m". Lehnt der HeroManager den Befehl trotzdem mit
  `no-route` ab (ein Routenteil ohne Verbindung zu seinem), steht dort 2,5 s
  "Mercenary" über "No way there along the routes".
- **Kamera:** G oder sein Knopf, während er gewählt ist, fliegt zu ihm.
- **Munition:** V schaltet reihum, auch ohne ihn zu wählen; im Helden-Panel
  die drei Segmente.
- **Loslassen:** Esc (nach offenem Menü und schwebendem Verkauf, vor dem
  Tower), kurzer Rechtsklick, Klick auf ihn. Build-Modus,
  Kartenplatzierung, Zielmodus, Photo Mode, ein gewählter Tower und ein
  Neustart lassen ihn ebenfalls los.
- **Panel:** solange er gewählt ist, statt des Tower-Details: Stufe, Kills,
  Weg zur nächsten Stufe, DPS und Reichweite, Munitionswahl, der Hinweis zum
  Schicken.
- **Cheat:** "Hero" im Dev-Menü (Gruppe Cheats) schließt die Forschung samt
  Voraussetzungen ab und heuert ihn umsonst an (`debug:ready-hero`,
  deferred, im nächsten Sub-Step).

---

## Bots

Bots heuern ihn nie an. `ResearchPickStrategy` überspringt die Forschung
(`BOT_SKIPPED_RESEARCH`), sonst hätte die Rüstungslücken-Wahl von
strategist und meta den neuen Global-Perk wie jeden anderen bewertet und
600 Credits dafür ausgegeben. Eine Bot-Aktion zum Anheuern gibt es nicht.
Bot-Snapshots zeigen dem Gate also keinen Helden, die Baselines bleiben
vergleichbar.

---

## Dateien

| Datei | Rolle |
|---|---|
| `configs/hero.config.ts` | Werte, Munition, Stufen, Status, Gate-Profil |
| `utils/route-graph.ts` | Routengraph, Dijkstra, Leine |
| `utils/hero-body-contact.ts` | nächster Punkt eines Körpers entlang der Route, für Reichweite und Ziel |
| `entities/hero.entity.ts` | Transform, Movement (Ecken spitz, `roundsCorners` aus, siehe [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md#ecken)), Combat |
| `managers/hero.manager.ts` | Anheuern, Befehle, Sub-Step, Kills, Präsentation |
| `managers/game-commands.handler.ts` | `command:hire-hero`, `command:hero-move`, `command:hero-ammo`, `debug:ready-hero` |
| `managers/projectile.manager.ts` | `spawnShot`, mit `aimPoint` für Körper entlang der Route |
| `services/combat/damage-application.service.ts` | Quelle `hero` → `hero:kill` |
| `ai/core/defense-analyzer.ts` | virtueller Tower im Gate |
| `ai/training/strategies/research/research-pick.strategy.ts` | `BOT_SKIPPED_RESEARCH` |
| `services/hero-control.service.ts` | Auswahl, Klick, Vorschau, Munition |
| `services/input-handler.service.ts` | `setHeroCallbacks` |
| `services/hotkey-map.ts`, `services/hotkey.service.ts` | G, V, Esc |
| `components/game-sidebar/hero-panel/` | Helden-Panel |
| `components/ability-bar/hero-bar.ts` | Held-Knopf der Fähigkeitenleiste: Angebot, Held, was ein Druck tut |
| `three-engine/renderers/hero-model.ts` | Modell-Config, GLB-Lader |
| `three-engine/renderers/hero.renderer.ts` | Modell auf der Karte, Ringe |

Tests: `route-graph.spec.ts`, `hero.manager.spec.ts`, `hero-body-contact.spec.ts`,
`integration/hero.spec.ts`, `hero.config.spec.ts`,
`damage-application.service.spec.ts`, `projectile.manager.spec.ts`,
`defense-analyzer.spec.ts`, `ai-data-collector.service.spec.ts`,
`ai-data-collector.ability-kills.spec.ts`, `research-pick.strategy.spec.ts`,
`hero-control.service.spec.ts`, `hotkey-map.spec.ts`,
`hotkey.service.spec.ts`, `hero-panel.spec.ts`, `hero-bar.spec.ts`,
`hero.renderer.spec.ts`, `vfx.service.spec.ts`,
`game-state.manager.spec.ts`, `game-state.manager.order.spec.ts`.

---

## Bewusst nicht gemacht

- Kein Splash für Explosive rounds, die Explosion ist nur Optik.
- Kein Mündungsfeuer, keine eigenen Sounds; die drei Schüsse benutzen
  vorhandene Tower-Samples.
- Keine Sichtlinie: er schießt auf 18 m auch durch Häuser, wie im Konzept
  vorgesehen.
- Nicht in `totalDPS`: DPS-Rampe und COMING UP sehen ihn nicht.
- Stufe 2 aus dem Konzept (ganzes Straßennetz) nicht gebaut; er bleibt auf
  den Gegnerrouten.
- Die Bewegung misst Segmente auf der Kugel, der Graph auf der flachen
  Projektion; auf 250 m liegen die Längen etwa 0,1 % auseinander. Ankunft
  und Leine vertragen das.
- Neue Routen nimmt er erst im nächsten Sub-Step (`ensureGraph` in
  `update`). Wird der Routengraph in der Pause neu gebaut, stellt ihn der
  Renderer erst nach dem Fortsetzen auf die neuen Routen (Review-Befund,
  im Spiel nicht nachgestellt).
