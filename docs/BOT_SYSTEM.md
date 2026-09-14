# Bot System — Dokumentation

**Stand:** 2026-09-15
**Code:** `src/app/ai/training/`

## Überblick

Der Bot spielt die Verteidigerseite: er baut, upgradet, verkauft, forscht und
startet Wellen. Er hat zwei Aufgaben, und die zweite bestimmt sein Design:

1. Automatisiertes Spielen für Playtests und Headless-Läufe.
2. **Der Bot ist der Gegner, gegen den der Wave Director bewertet wird.** Alles,
   was der Bot systematisch anders macht als ein Mensch, verschiebt die Messung
   des Wave-Designs. Das ist kein theoretisches Risiko — genau daran ist eine
   ganze Trainingsgeneration gescheitert (siehe [Warum die Platzierung so
   aussieht](#warum-die-platzierung-so-aussieht)).

Architektur: **Strategy Pattern mit Composition**. Ein `StrategyBot` hält eine
nach Priorität sortierte Liste von `ITowerStrategy`-Objekten und führt pro
Entscheidung die erste aus, die kann und will.

---

## Ausführungsmodell

```
Sub-Step-Loop (game-loop-facade)
  └─ TrainingClientService.updateBot(getSnapshot, deltaTime)   → ohne Session: false
       └─ TrainingSession.updateBot(getSnapshot, deltaTime)
            ├─ bot.tickCooldown(deltaTime)      → false ⇒ Abbruch, KEIN Snapshot
            ├─ bot.update(getSnapshot(), 0)     → StrategyBot.decideAction(state)
            │    └─ Strategien in Prioritätsreihenfolge: canExecute() → execute()
            └─ TrainingSession.executeBotAction(action)
```

Drei Details, die man beim Lesen des Codes sonst falsch erwartet:

- **Cooldown läuft in Game-Time, nicht Wall-Clock.** `tickCooldown(deltaTime)`
  bekommt den Sub-Step-Delta des Fixed-Timestep-Loops. Bei Timescale 75 verhält
  sich der Bot dadurch pro *Spiel*sekunde identisch zu 1×. Vorher lief er über
  `Date.now()` und traf im Schnelldurchlauf ein 75-tel der Entscheidungen pro
  Spielsekunde — das war die Ursache von „Bot kommt bei 75× bis Welle 6, bei 10×
  bis Welle 20".
- **`tickCooldown` ist von `update` getrennt**, damit der Aufrufer den
  Snapshot-Bau überspringen kann, solange der Bot in Reaktionszeit steht. Der
  Snapshot ist das mit Abstand teuerste in der Schleife (volle Defense-Analyse,
  effektive DPS pro Rüstung, Route-Grid-Reach-Query), und die Sub-Step-Loop
  läuft bei Trainingsgeschwindigkeit ~200 Ticks pro gerendertem Frame. Wer
  `tickCooldown` vorher ruft, übergibt danach `deltaTime = 0`, sonst tickt der
  Cooldown doppelt.
- **`wait`-Actions blockieren nicht.** Gibt eine Strategie `wait` zurück (typisch:
  „ich spare auf einen Turmtyp"), merkt der Bot das als Fallback und probiert
  weiter niedrigere Prioritäten. Erst wenn keine konkrete Action zustande kommt,
  wird der gemerkte `wait` geliefert. Jede Action — auch `wait` — setzt den
  Reaktionszeit-Cooldown zurück, damit zufallsbasierte Entscheidungen nicht
  jeden Frame neu gewürfelt werden.

Strategie-eigene Cooldowns (Sell-Cooldown, Wave-Start-Delay) laufen über
`tickCooldowns(deltaTime)` und werden **jeden** Frame getickt, auch während der
Bot selbst in Reaktionszeit steht. Sonst würden sie bei hoher Timescale
verhungern.

---

## Verzeichnisstruktur

```
src/app/ai/training/
├── training-client.service.ts       # Einstieg: Signale für UI/Game-Loop, lädt die Session bei Bedarf
├── training-session.ts              # WebSocket-Client + Bot-Steuerung + Action-Ausführung (Lazy-Chunk)
│
├── bots/
│   ├── tower-bot.interface.ts       # ITowerBot, TowerAction, BotConfig, BOT_CONFIGS
│   ├── base-tower-bot.ts            # Cooldown, Stats
│   ├── strategy-bot.ts              # Prioritätsauswahl, Strategie-Notifications
│   └── strategy-bot.factory.ts      # Strategie-Sets je Skill-Level + Jitter
│
└── strategies/
    ├── tower-strategy.interface.ts  # ITowerStrategy, BaseStrategy (+ Tower-Bewertung)
    ├── ability/
    │   ├── ability-aim.ts                          # Zielhilfen (densestCenter), geteilt
    │   ├── nuclear-strike.strategy.ts              # 97
    │   ├── frost-bomb.strategy.ts                  # 96
    │   ├── emp.strategy.ts                         # 94
    │   └── orbital-laser.strategy.ts               # 93
    ├── placement/
    │   ├── research-center-placement.strategy.ts   # 95
    │   ├── anti-air-placement.strategy.ts          # 90
    │   ├── anti-ethereal-placement.strategy.ts     # 88
    │   ├── splash-defense-placement.strategy.ts    # 85
    │   ├── distributed-placement.strategy.ts       # 65
    │   └── coverage-fill.strategy.ts               # 60
    ├── research/
    │   └── research-pick.strategy.ts               # 80
    ├── upgrade/
    │   ├── path-coverage-upgrade.strategy.ts       # 75
    │   └── sell-underperformer.strategy.ts         # 72
    └── wave/
        └── auto-start-wave.strategy.ts             # 30
```

Es gibt **keine** `index.ts`-Barrels in diesem Baum; importiert wird direkt aus
den Dateien. `GameStateSnapshot` liegt in
`src/app/ai/core/models/game-state-snapshot.ts`.

---

## Core Interfaces

### ITowerBot

```typescript
export interface ITowerBot {
  readonly config: BotConfig;
  readonly name: string;

  update(state: GameStateSnapshot, deltaTime: number): TowerAction | null;

  /** Timer um deltaTime (Game-Time ms) vorstellen; true = Entscheidung fällig. */
  tickCooldown(deltaTime: number): boolean;

  reset(): void;
  onWaveCompleted?(survived: boolean, damagePercent: number): void;
}

export type BotSkillLevel = 'beginner' | 'casual' | 'strategist' | 'meta';
```

### ITowerStrategy

```typescript
export interface ITowerStrategy {
  readonly name: string;
  readonly priority: number;          // 0-100, höher = zuerst geprüft

  canExecute(state: GameStateSnapshot): boolean;
  execute(state: GameStateSnapshot): TowerAction | null;

  /** Optional: Game-Time-Cooldowns dekrementieren. Default no-op. */
  tickCooldowns?(deltaTime: number): void;
}
```

`BaseStrategy` liefert zusätzlich die geteilten Bewertungshelfer:

| Helfer | Zweck |
|---|---|
| `getAffordableTowers(credits, knownTypes, state?)` | filtert nach Kosten, wirft `attackType === 'passive'` (Research-Center) raus und respektiert `state.research.towerUnlocked` |
| `getTowerValue(type)` | DPS pro Credit über `computeTowerDPSFromLevels` — **nicht** `damage × fireRate`. Die Abkürzung liefert 0 für Beam-Tower (Fire hat `damage: 0` und trägt seinen Output in `damagePerSecond`) und ignoriert Chain-Falloff, Splash und DoT |
| `getTowerValueVsArmor(type, armor)` | effektive DPS pro Credit gegen eine Rüstungsklasse. Notwendig, weil die Damage-Matrix schief ist: Archer schlägt Magic auf dem Papier, landet aber bei 0.1× gegen Ethereal, wo Magic 2.0× macht |

### TowerAction

```typescript
export type TowerActionType =
  'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave' | 'research-start' | 'research-cancel' | 'use-ability';

export interface TowerAction {
  type: TowerActionType;
  position?: { x: number; z: number };   // place, use-ability: x = lon, z = lat
  towerType?: TowerTypeId;               // place
  towerId?: string;                      // upgrade, sell
  upgradeId?: string;                    // upgrade
  researchId?: string;                   // research-start, research-cancel
  abilityId?: AbilityId;                 // use-ability
  confidence?: number;
  reason?: string;
}
```

`research-cancel` wird von `executeBotAction` behandelt, aber von keiner
aktuellen Strategie erzeugt.

### BotConfig / BOT_CONFIGS

```typescript
export interface BotConfig {
  skillLevel: BotSkillLevel;
  reactionTimeMs: number;          // Game-Time zwischen Entscheidungen
  knownTowerTypes: TowerTypeId[];  // für alle Skill-Level dieselbe Liste
  adaptsToEnemies: boolean;
  maxTowers: number;               // 0 = unbegrenzt
}
```

| Skill | reactionTimeMs | maxTowers | adaptsToEnemies |
|---|---|---|---|
| beginner | 3000 | 10 | false |
| casual | 1500 | 15 | true |
| strategist | 800 | 20 | true |
| meta | 400 | 20 | true |

`knownTowerTypes` ist bei allen `ALL_COMBAT_TOWERS` (archer, dual-gatling,
cannon, magic, rocket, ice, fire, tentacle, poison, lightning, chaos). Was ein Bot
tatsächlich bauen *kann*, entscheidet der Research-Unlock, nicht die Config.
Skill-Level unterscheiden sich in Reaktionszeit, Turm-Cap und Strategie-Set.

**Warum `maxTowers` bei 20 liegt** (und nicht bei 80 oder 300):

- Der Design-Zielbestand sind ~13 Türme (einer je Typ, Archer ×3) auf Level 20
  — siehe `docs/wave-planner.html`. 20 liegt knapp darüber, nicht weit.
- Bei 80 baute der Bot eine Verteidigung, die kein menschlicher Build erreicht:
  ~7800 DPS über den ganzen Pfad, ab Welle 11 wurden 100 % jeder Welle getötet.
  Der Wave Director hatte damit nichts mehr zum Zielen — die Near-Miss-Quote lag
  über 15k Episoden flach bei 0.02, während er das einzig noch Erreichbare
  optimierte, das Run-Pacing. Ein Training gegen eine Verteidigung, die das
  Spiel nie produziert, lehrt Wellen, die das Spiel nie braucht.
- Bei 300 baute der Bot 298 Türme; die Kampfauflösung allein kostete 6 ms pro
  Sub-Step, was bei Timescale 75 (~225 Sub-Steps pro Frame) den Loop auf 2 FPS
  drückte.

Die Factory legt beim Erzeugen ±30 % Jitter auf `reactionTimeMs` und `maxTowers`
(`jitterConfig()`, Faktor in [0.7, 1.3], Untergrenzen 100 ms und 5 Türme,
`maxTowers = 0` bleibt 0), damit
parallele Trainings-Tabs nicht identisch spielen.

---

## Strategie-Sets je Skill-Level

Quelle: `strategy-bot.factory.ts::getStrategiesForSkillLevel`.

| Priority | Strategie | beginner | casual | strategist | meta |
|---:|---|:--:|:--:|:--:|:--:|
| 97 | NuclearStrike | ✓ | ✓ | ✓ | ✓ |
| 96 | FrostBomb | ✓ | ✓ | ✓ | ✓ |
| 95 | ResearchCenterPlacement | ✓ | ✓ | ✓ | ✓ |
| 94 | Emp | ✓ | ✓ | ✓ | ✓ |
| 93 | OrbitalLaser | ✓ | ✓ | ✓ | ✓ |
| 90 | AntiAirPlacement | | ✓ | ✓ | ✓ |
| 88 | AntiEtherealPlacement | | ✓ | ✓ | ✓ |
| 85 | SplashDefensePlacement | | ✓ | ✓ | ✓ |
| 80 | ResearchPick | ✓ | ✓ | ✓ | ✓ |
| 75 | PathCoverageUpgrade | | ✓ | ✓ | ✓ |
| 72 | SellUnderperformer | | | ✓ | |
| 65 | DistributedPlacement | | | ✓ | |
| 60 | CoverageFill | ✓ | ✓ | | ✓ |
| 30 | AutoStartWave | (✓) | (✓) | (✓) | (✓) |

`(✓)` = wird nur angehängt, wenn `createBot(skill, autoStartWaves = true)`.

NuclearStrike steht in jedem Set, feuert aber nur mit erforschtem
`nuclear-strike`, und das erforschen nur strategist und meta (ResearchPick).
Dasselbe gilt für FrostBomb und `frost-bomb`, Emp und `emp`, OrbitalLaser und
`orbital-laser`.

**casual und meta haben dasselbe Strategie-Set**; sie unterscheiden sich nur in
Reaktionszeit (1500 vs. 400 ms) und Turm-Cap (15 vs. 20).

Das Training fährt `strategist` (`TrainingSession` schaltet bei
`control: start` auf Timescale 75 und `enableBot('strategist')`). Der
Strategist ist damit der Build, gegen den das Wave-Design gemessen wird — bei
Änderungen an seinen Strategien ändern sich alle Trainingszahlen mit.

---

## Strategien im Einzelnen

### ResearchCenterPlacement — 95

Baut das Research-Center, solange `state.research.centerLevel === 0`. Wartet, bis
Center **plus** ein Archer bezahlbar sind (75 + 45), damit der Bot sich nicht
in die Forschung leerkauft und ohne Verteidigung dasteht. Position über
`findStrategicPositions` — das Center braucht keine Reichweite, aber der Service
liefert bereits validierte straßennahe Punkte.

Höchste Priorität, weil ohne Center kein Tower-Unlock passiert und damit fast
das gesamte Spiel verschlossen bleibt.

### AntiAirPlacement — 90

Aktiv bei `vulnerabilities.airDefenseGap`, ab Welle 4, unterhalb `maxTowers`,
sobald ein luftfähiger Turm bezahlbar ist.

Wählt nach **effektiver DPS pro Credit gegen `light`** — nicht nach roher
DPS-pro-Kosten. Nach roher DPS gewann immer der Archer: der schließt die Lücke
formal (er kann Luft treffen), lässt die Verteidigung aber ohne echte Antwort
auf einen Dragon. `light` ist die Rüstung, die die ersten Luftwellen schicken.

### AntiEtherealPlacement — 88

Aktiv bei `vulnerabilities.etherealGap`, ab Welle 9.

Ethereal ist die eine Rüstungsklasse, die sich nicht mit Masse erschlagen lässt:
physical, pierce und fire liegen alle bei 0.1×, nur magic (2.0×), ice (1.5×),
lightning (1.5×) und chaos (1.0×) kommen durch. Das Curriculum forciert `ghost_surge` auf
W13 und `wraith_storm` auf W17, und ein forciertes Template ignoriert das
Capability-Gate — ohne diese Strategie verliert der Bot dort schlicht. Vorher
entstanden Ethereal-Konter nur zufällig über den „neuen Typ probieren"-Zweig der
Coverage-Strategien.

Welle 9 als Start, damit Forschung und Bau bis W13 fertig werden. Auswahl über
`getTowerValueVsArmor(t, 'ethereal')`.

### SplashDefensePlacement — 85

Aktiv bei `vulnerabilities.splashGap`, ab Welle 3. Liest Splash aus
`isSplashTower`, das ihn aus der Tower-Config ableitet (Projektil mit
`splashRadius`, Beam, Chain): Cannon, Ice, Poison, Fire und Lightning. Die
Rocket hat keinen Splash und zählt nicht. Auswahl nach `getTowerValueVsArmor`,
gewichtet mit `expectedArmorDistribution` (ohne Verteilung roh nach `getTowerValue`):
seit der Matrix-Spreizung 2026-09 ist die Cannon gegen weiche Schwärme schwach (0,5).

### ResearchPick — 80

Feuert, wenn ein Center steht, ein Slot frei ist und die nächste Node bezahlbar
ist und ihre Prereqs erfüllt sind.

- **beginner:** nur `gatling-tech`.
- **casual:** `gatling-tech, ice-magic, toxic-compounds, siege-engineering,
  fire-alchemy`.
- **strategist / meta:** primär **adaptiv** — bewertet alle offenen Nodes gegen
  `state.expectedArmorDistribution` (effektive DPS pro Credit des freigeschalteten
  Turms gegen den erwarteten Rüstungsmix, Tier-Unlocks nach Bedarf). Nur wenn
  daraus nichts kommt, greift die statische Liste
  (`gatling-tech → ice-magic → tentacle-biology → siege-engineering → rocketry →
  aa-retrofit → arcane-studies → toxic-compounds → fire-alchemy →
  advanced-weaponry → nuclear-strike → frost-bomb → storm-mastery → emp →
  master-engineering → orbital-laser → chaos-rift → advanced-engineering →
  transcendent-tech`, `research-pick.strategy.ts`), die am Wave-Curriculum
  ausgerichtet ist: AA fertig vor
  `bat_swarm` (W7), Cannon vor `boss_herbert` (W10), Magic vor `ghost_surge`
  (W13).
- **Keine Stufe** erforscht `mercenary-contract` (Held, [HERO.md](HERO.md)):
  `BOT_SKIPPED_RESEARCH` nimmt die Node aus der adaptiven Wahl und der Liste.
  Bots heuern den Helden nie an, eine Aktion dafür gibt es nicht; ohne den
  Ausschluss hätte die adaptive Wahl den Global-Perk wie jeden anderen
  bewertet und 600 Credits ausgegeben.

Zwei Sonderregeln, beide aus konkreten Fehlern:

- **Anti-Air-Dringlichkeit:** Enthält das Curriculum-Template der *nächsten*
  Welle Lufteinheiten und die Verteidigung hat keine Luftfähigkeit, bekommen
  `rocketry` und `aa-retrofit` +100 auf den Score. Ohne den Bump gewinnt die
  reine Matrix-Bewertung mit einem Turm, der Luft nicht trifft (Gatling ohne
  AA-Retrofit, 1,6× gegen light), gegen Rocket (0,5×), und der Bot geht
  wehrlos in eine forcierte Luftwelle.
- **`hasAntiAirCapability`** liest bevorzugt `defense.capabilities.hasAntiAir`
  (was wirklich gebaut ist und reicht) und fällt sonst auf die Unlock-Flags
  *aller* luftfähigen Türme zurück. Die alte Prüfung sah nur `rocket`, also galt
  eine Verteidigung voller Archer — die Luft treffen — als „keine Anti-Air" und
  der Bot kaufte weiter Rocketry.

### PathCoverageUpgrade — 75

**War `NearSpawnUpgradeStrategy`; umbenannt, weil sich das Verhalten geändert
hat.** Datei: `strategies/upgrade/path-coverage-upgrade.strategy.ts`.

Bedingungen: ≥ 3 Türme, ≥ 50 Credits, mindestens ein bezahlbares Upgrade
vorhanden. Feuerrate 70 % pro Entscheidung, 90 % ab 2000 Credits — damit
hortende Bots ihre Kasse tatsächlich in Upgrades leeren statt auf 300k zu
sitzen.

Ablauf:

1. Türme mit verfügbaren Upgrades nach Distanz zum nächsten Spawn sortieren.
2. **Kandidaten abwechselnd von BEIDEN Enden der Liste nehmen** (bis zu 8).
   Die Liste läuft spawn-nächster → spawn-fernster, und spawn-fernst ist
   HQ-nächst — es braucht also keine zweite Distanzrechnung. Vorne zuerst je
   Paar, weil die Eröffnungswellen am Spawn entschieden werden und ein junger
   Run zu wenige Türme hat, als dass das ferne Ende zählt.
3. Pro Kandidat die bezahlbaren Upgrades filtern, Tier-Gate über das geteilte
   `requiredUpgradeTier()` (`research-slots` ist ausgenommen).
4. Das Upgrade mit dem **niedrigsten** aktuellen Level wählen, Gleichstand
   zufällig — so bleiben die drei Upgrade-Tracks eines Turms auf ähnlicher Höhe
   statt einer maximiert.

Warum acht Kandidaten und nicht einer: Vorher wurde nur `towersWithDistance[0]`
betrachtet. War dessen nächstes Upgrade unbezahlbar oder tier-gesperrt, gab die
Strategie `null` zurück und die Platzierungsstrategien (niedriger priorisiert,
aber praktisch immer anwendbar) bekamen jeden Zug. Mit der Late-Game-Gold-Kurve
ergab das eine Verteidigung aus ~300 Türmen auf niedrigem Level statt einer
kompakten hochgezogenen.

Warum von beiden Enden: siehe [nächster Abschnitt](#warum-die-platzierung-so-aussieht).

Das eigene Tier-Mapping ist ebenfalls entfallen — der Bot trug eine strengere
lokale Kopie (Tier 2 schon ab Level 1, Tier 3 ab Level 2, darüber nichts) und
lehnte damit Upgrades ab, die die Engine akzeptiert hätte; Tier 4 und 5 waren
für ihn unerreichbar.

### SellUnderperformer — 72 (nur Strategist)

Verkauft **unaufgerüstete Archer**, wenn ≥ 2000 Credits da sind, ≥ 5 Türme
stehen, der Sell-Cooldown (4 s Game-Time) abgelaufen ist und ein teurerer,
freigeschalteter, bezahlbarer Alternativturm existiert. Zweck: die
Early-Game-Platzhalter loswerden, wenn Geld für Besseres da ist — ohne
Verkaufsmechanismus entstanden 300k-Gold-Horte.

Der Kommentar im Code beschreibt eine Auswahl „nächster am Pfadende"; implementiert
ist bewusst `archers[0]`.

### DistributedPlacement — 65 (nur Strategist)

Zonenbasierte Platzierung über `findDistributedPositions` (5 Zonen entlang des
Pfades, unterversorgte Zonen scoren höher). Auswahl-Logik:

1. Erste 2 Türme: der billigste bezahlbare (Bootstrap).
2. Ein noch nicht gebauter Typ bezahlbar? Diesen bauen (Varianz zuerst).
3. Fehlende Typen zu teuer? Mit 30 % auf den billigsten fehlenden sparen
   (`wait`), mit 70 % den am wenigsten vertretenen vorhandenen Typ verstärken.
4. Alle Typen vorhanden: den am wenigsten vertretenen verstärken.

**Archer-Cap:** `max(4, häufigsterNichtArcher × 2)`. Archer sind billig, ohne
Deckel endete der Bot bei 92 Archern und je einem von allem anderen. Der Cap
wächst mit dem Mix mit, verbietet aber reinen Archer-Spam; ist nur Archer
bezahlbar und der Cap erreicht, spart der Bot auf den billigsten Nicht-Archer.

### CoverageFill — 60

Dieselbe Varianz-/Verstärkungslogik wie DistributedPlacement, aber über
`findStrategicPositions` statt Zonen und mit 50/50 statt 30/70 beim
Spar-Entscheid; gespart wird auf einen zufälligen fehlenden Typ statt auf den
billigsten. Erster Turm: der billigste. Gleicher Archer-Cap.

### NuclearStrike (97)

Feuert den Nuklearschlag ([ABILITIES.md](ABILITIES.md)): während einer Welle,
sobald die Fähigkeit bereit ist (`AbilityManager.checkUse`), und nur, wenn
mindestens 10 Gegner im letzten Fünftel ihrer Route stehen (Pfadfortschritt ab
0,8). Ziel ist der Gegner in diesem Abschnitt mit den meisten anderen im
Strike-Radius von 25 m. Geprüft werden höchstens 48 Kandidaten, gleichmäßig
über den Abschnitt verteilt, damit ein Mega-Schwarm billig bleibt. Die Aktion
`use-ability` geht als `command:use-ability` an den AbilityManager, der das
Ziel wie einen Klick auf die Route snappt.

Die Gegner liest die Strategie aus dem GameStateManager, nicht aus dem
Snapshot: der trägt keine Positionen und geht unverändert ans Backend.

**Vergleichbarkeit:** Strategist (der Trainings-Bot) und meta erforschen die
Fähigkeit für 1.000 Gold und setzen sie ein. Ihre Läufe sind mit Läufen vor dem
2026-09-13 nicht direkt vergleichbar: anderes Gold, eine andere
Forschungsfolge, weniger Lecks in Wellen mit Einsatz. Beginner und casual
erforschen sie nie und spielen unverändert. Das Fairness-Gate bucht die Kills
als Leck, im Frontend wie im Backend (`gate_leak_share`), die Wellengröße
wächst also nicht durch den Einsatz. Das Encoder-Merkmal `research_progress`
(abgeschlossen durch gesamt) zählt seit 2026-09-14 nur die elf Knoten, die das
Modell kennt (`ENCODER_RESEARCH_IDS`); neue Knoten wie dieser verschieben es
nicht ([AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md), Abschnitt 7).

### FrostBomb (96)

Wirft die Frostbombe ([ABILITIES.md](ABILITIES.md#frostbombe-in-zahlen)):
während einer Welle, sobald sie bereit ist, und nur, wenn irgendwo in der
zweiten Hälfte der Route (Pfadfortschritt ab 0,5) mindestens 8 Gegner im
Radius von 20 m um einen von ihnen stehen. Ziel ist dieser Gegner, gewählt wie
beim Nuklearschlag (`densestCenter` in `strategies/ability/ability-aim.ts`,
höchstens 48 Kandidaten). Steht beides bereit, geht der Nuklearschlag (97)
vor.

**Vergleichbarkeit:** strategist und meta erforschen `frost-bomb` direkt nach
`nuclear-strike` (700 Gold). Ihre Läufe sind mit Läufen vor dem 2026-09-14
nicht direkt vergleichbar; beginner und casual spielen unverändert.

### Emp (94)

Setzt das EMP ein ([ABILITIES.md](ABILITIES.md#emp-in-zahlen)): während einer
Welle, sobald es bereit ist, wenn mindestens 3 Maschinen (`mechanical`) ab
Pfadfortschritt 0,4 im Radius von 30 m um eine von ihnen stehen, dort stoppt
es sie 6 s; sonst, wenn mindestens 12 Gegner beliebiger Art in den letzten
40 % der Route (Pfadfortschritt ab 0,6) im Radius um einen stehen. Ziel ist die
Maschine mit den meisten Maschinen im Radius, sonst der Gegner der Menge mit
den meisten anderen (`densestCenter`).

**Vergleichbarkeit:** strategist und meta erforschen `emp` direkt nach
`storm-mastery` (800 Gold). Beginner und casual spielen unverändert.

### OrbitalLaser (93)

Ruft den Orbitallaser ([ABILITIES.md](ABILITIES.md#orbitallaser-in-zahlen)):
während einer Welle, sobald er bereit ist, wenn ein Gegner ab Pfadfortschritt
0,5 auf derselben Route mindestens 10 Gegner hinter sich hat, höchstens 72 m
zurück (so weit brennt der Strahl Richtung Spawn). Ziel ist der Gegner mit den
meisten dahinter; geprüft werden höchstens 48 Kandidaten. Die Zählung nimmt
die Strecke auf der Mittellinie und prüft nicht, ob ein Gegner seitlich
außerhalb der 5 m des Strahls läuft.

**Vergleichbarkeit:** strategist und meta erforschen `orbital-laser` direkt
nach `master-engineering` (1.500 Gold). Beginner und casual spielen
unverändert.

### AutoStartWave — 30

Nur im Auto-Modus und nur in der Setup-Phase, ab 1 Turm. Wartet auf laufende
Forschung (ein Mensch startet keine Welle mitten im Upgrade), verlangt 1 s
Game-Time seit der letzten Action, und will vor Welle 3 lieber 2 Türme sehen,
solange noch ≥ 20 Credits da sind. Nach 5 s Game-Time in Setup wird die Welle
erzwungen — sonst wartet der Bot in Situationen ohne laufende Forschung
unbegrenzt.

Alle drei Timer laufen in Game-Time über `tickCooldowns`.

---

## Warum die Platzierung so aussieht

Der wichtigste Teil dieses Dokuments, weil das Ergebnis kontraintuitiv ist.

### Der Befund

Gemessen über 1834 Wellen mit der alten Platzierung (lineares Gewicht auf
Spawn-Nähe, 0.6) und der alten Upgrade-Strategie (nur der spawn-nächste Turm):

| | |
|---|---:|
| Wellen, in denen die Verteidigung **alles** tötete | 70 % |
| Wellen, in denen > 5 % durchkamen | 28 % |
| dazwischen | 2 % |

Die Verteidigung war **binär**. In Wellen ohne Durchbruch starb der weiteste
Gegner bei median **12 %** des Pfades. Sobald ein Gegner 80 % passierte, kam in
**95 %** der Fälle einer an. Es gab kein „knapp abgefangen": eine Killzone am
Spawn, dahinter ein unverteidigter Korridor.

Das ist der Grund, warum sich der Wave Director nicht trainieren ließ. Seine
Reward-Funktion verlangt Near-Misses — den Anteil einer Welle, der 80 % des
Pfades passiert **ohne** anzukommen. Erreichbar war das in 2.2 % der Wellen, weil
auf der letzten Strecke nichts tötet. Vier Wave-Designer, so verschieden wie ein
Policy-Netz und ein Gleichverteilungs-Sampler, erzeugten statistisch identische
Läufe.

### Die Änderung

Zwei Stellen, gemeinsam:

- `strategic-placement.service.ts::endZoneProximity(t)` — U-förmiges Gewicht über
  die normalisierte Pfadposition (0 = Spawn, 1 = HQ) statt linearer Spawn-Nähe:

  ```ts
  const END_ZONE_HQ_WEIGHT = 0.8;
  endZoneProximity(t) = max(1 - t, 0.8 * t)
  ```

  Beide Enden schlagen die Mitte; das Spawn-Ende behält knapp die Nase vorn. Die
  Asymmetrie ist Absicht: ein Zwei-Turm-Anfang platziert genau dort, wo er vorher
  platzierte, die frühen Wellen ändern sich nicht. Ab etwa dem vierten Turm
  schlägt das HQ-Ende die Mitte und eine zweite Killzone entsteht. Das Minimum
  liegt bei `t = 1/(1+0.8) ≈ 0.556`, also leicht hinter der Mitte, weil der
  Spawn-Ast der steilere ist. Die Form ist in
  `strategic-placement.service.spec.ts` direkt asserted.

  Das Gewicht geht mit 0.6 in `calculatePlacementScore` ein; die restlichen 0.4
  verteilen sich auf Pfadabdeckung (0.2) und Straßenabstand (0.2, Optimum 20 m).

- `path-coverage-upgrade.strategy.ts` — Upgrade-Kandidaten abwechselnd von beiden
  Enden der spawn-sortierten Liste. Diese Strategie überholt jede
  Platzierungsstrategie und feuert auf den meisten Ticks; solange sie nur das
  Spawn-Ende bediente, landete praktisch das gesamte Upgrade-Gold in einem
  Cluster, egal wie gut die Platzierung verteilte.

### Das Ergebnis

| | vorher | nachher |
|---|---:|---:|
| Gegner, die 80 % passieren und ankommen | 95 % | 75 % |
| Near-Miss-Quote | 0.031 | 0.058 |

Die Kill-Quoten-Verteilung blieb bimodal. Das ist eine **Kapazitäts**- und keine
Platzierungseigenschaft: entweder die Verteidigung hat genug DPS für die Welle
oder nicht.

### Warum nicht einfach gleichmäßig verteilen

Gleichverteilung wäre die naheliegende Antwort und sie wäre falsch. Fünf Türme
decken nur einen Bruchteil eines Pfades ab. Türme stehen 15–25 m von der Straße
entfernt; die Pfad-Sehne, die ein Turm mit Reichweite `r` bei 20 m Abstand
abdeckt, ist `2·√(r² − 20²)`:

| Turm | range | Sehne bei 20 m Abstand |
|---|---:|---:|
| Archer | 30 | ~45 m |
| Dual-Gatling | 50 | ~92 m |
| Magic | 70 | ~134 m |
| Cannon | 70 | ~134 m |
| Rocket | 100 | ~196 m |

Spawns liegen 500–1000 m vom HQ. Fünf Türme decken damit grob 25–50 % des Pfades.
Überall dünn heißt überall durchlässig — dann stirbt niemand mehr irgendwo
zuverlässig, und die Kurve wird nicht spannender, sondern nur schlechter.

Die spielbare Lösung ist **eine zweite Killzone vor dem HQ**, nicht
Gleichverteilung. Genau das macht das U-Gewicht: es verschiebt die Reihenfolge
(HQ-Ende vor Mitte), nicht die Dichte.

---

## Integration

Bot-Logik, Steuerung und Stats liegen nicht in der Component, sondern in zwei
Teilen:

- **`TrainingClientService`** (im Spiel-Chunk): die Signale, die Templates und
  Game-Loop lesen (`botEnabled`, `botStats`, `isConnected`, `stats`, ...), plus
  Weiterleitungen. Die Facades und das Training-Debug-Fenster kennen nur ihn.
- **`TrainingSession`** (eigener Lazy-Chunk `training-session`): WebSocket-Client,
  Bot, Strategien, Action-Ausführung. Der Service lädt sie per
  `import('./training-session')` beim ersten `enableBot()`, `connect()` oder
  `connectToBackend()` und legt sie über `runInInjectionContext` an. Sie schreibt
  in die Signale des Service.

```typescript
// TrainingClientService
enableBot(skillLevel: BotSkillLevel): void
disableBot(): void
updateBot(getSnapshot: () => GameStateSnapshot, deltaTime: number): boolean  // ohne Session: false
```

`updateBot` läuft nur in Phase `setup` oder `wave`. `TrainingSession.executeBotAction`
prüft noch einmal gegen den echten Spielstand (Platzierungsregeln über
`TowerPlacementService.validateTowerPosition`, Kosten, Existenz des Turms,
Max-Level des Upgrades) und führt dann aus: Platzieren und Verkaufen direkt am
`GameStateManager`, Upgrade und Wellenstart (nur in `setup`) über die
Facade-Callbacks, Forschung über `command:start-research` bzw.
`command:cancel-research`.

`enableBot` wird **gepuffert** (`pendingBotSkill`), solange die Session nicht
steht: der Chunk lädt noch, oder `initialize()` lief noch nicht. Die zweite
Reihenfolge erzeugt ein Tab-Reload. Vorher kehrte der Aufruf still zurück, und
der Client meldete sich anschließend als verbunden und gesund, ohne je zu
spielen. `disableBot()` verwirft eine gepufferte Anfrage. `initialize()` selbst
lädt nichts, es läuft in jedem Spiel.

Für die Verbindung gilt dasselbe: der letzte Wunsch gewinnt. Ein `disconnect()`,
während `connect()` oder `connectToBackend()` noch auf den Chunk warten, bricht
den Aufbau ab (Zähler `connectionRequest`). Scheitert der Chunk-Import, versucht
der Service es bis zu dreimal (1 s, 2 s Pause) und schreibt danach eine Meldung
in `sessionError`, die das Training-Debug-Fenster anzeigt. Gepufferte Wünsche
bleiben stehen; der nächste Aufruf startet eine neue Runde. Ob ein erneuter
Import im Browser wirklich neu lädt, ist nicht garantiert (fehlgeschlagene
Module können gecacht bleiben), dann hilft nur ein Reload des Tabs.

### Warum die Session ein eigener Chunk ist

Im normalen Spiel laufen weder Bot noch Backend-Verbindung, trotzdem lagen Bots,
Strategien und WebSocket-Client im Spiel-Chunk. Production-Build vom 2026-09-11,
Raw-Größen aus `ng build --stats-json`:

| | vorher | nachher |
|---|---:|---:|
| Initial-Bundle | 358,5 kB | 358,5 kB |
| Chunks, die der Spielstart statisch lädt | 2244,9 kB | 2217,1 kB |
| davon Training-Code | 51,4 kB | 17,5 kB |
| `training-session` (lazy, nur Training) | | 29,8 kB |

Die verbleibenden 17,5 kB sind das Training-Debug-Fenster (15 kB) und der
Service. Das Fenster bleibt eager: es per `@defer` zu laden, zieht 8 kB
Defer-Runtime aus `@angular/core` ins Initial-Bundle. Lohnt erst, wenn alle
Debug-Fenster (zusammen rund 160 kB) gemeinsam deferred werden.

Die geschätzte gzip-Transfergröße ändert sich kaum (326,8 → 327,9 kB): Spiel und
Session teilen Module (Configs, Store, Data-Collector), die esbuild in einen
eigenen Shared-Chunk legt, und zwei gzip-Streams komprimieren etwas schlechter
als einer. Gewonnen ist JS, das beim Spielstart nicht mehr geparst und
ausgeführt wird.

Die Trennung hält nur, solange außerhalb von `ai/training/` niemand einen Wert
aus Session, `bots/` oder `strategies/` importiert (`import type` ist frei). Das
prüft `training-client.service.spec.ts`; das Budget `training-session` in
`angular.json` warnt ab 48 kB.

### Wie der Bot angeschaltet wird

`TowerDefenseFacadeService.initialize()` liest `?bot=` aus der URL:

| Kontext | Verhalten |
|---|---|
| `?devworld` (ohne `?bot=manual`) | `botAutoMode = true` **und** `enableBot('strategist')` — der Tab spielt sofort selbst |
| `?devworld&bot=manual` | kein Bot, kein Auto-Wave |
| sonst mit `?bot=auto` | nur `botAutoMode = true`; der Bot selbst wird über die Debug-UI oder das Dashboard aktiviert |
| Dashboard-Kommando `start` | Timescale 75 + `enableBot('strategist')` |

DevWorld startet den Bot bewusst **selbst**, statt auf den `start`-Broadcast des
Dashboards zu warten: Ein Tab, der neu lädt, verpasst diesen Broadcast — er wird
nicht wiederholt — und saß danach dauerhaft in der Setup-Phase, während er sich
weiter als verbunden und gesund meldete. Analog `?bot=auto` als Pflichtangabe
zusätzlich zu `?devworld`: der Bot baute dann Türme, startete aber nie eine Welle,
und der Lauf produzierte keine Trainingsdaten.

`botAutoMode` steuert nur, ob `AutoStartWaveStrategy` überhaupt Teil des
Strategie-Sets ist (`createBot(skill, autoStartWaves)`), und wird zum
Erzeugungszeitpunkt gelesen — eine spätere Änderung wirkt erst beim nächsten
`enableBot`.

---

## Troubleshooting

### Bot platziert keine Türme

1. Bot aktiv? → `botEnabled()`
2. Genug Credits? → Konsole, „Not enough credits"
3. Valide Positionen? → `StrategicPlacementService` gibt nur Kandidaten zurück,
   die `TowerPlacementService.placementChecker()` besteht (dieselben Regeln wie
   Vorschau und Klick). Keine Kandidaten, keine Platzierung
4. `canExecute()` der Strategie — Turm-Cap (`maxTowers`, gejittert!) erreicht?
5. Reaktions-Cooldown abgelaufen? → `reactionTimeMs`, ebenfalls gejittert

### Bot upgradet nicht

1. Upgrades verfügbar? → `tower.getAvailableUpgrades()`
2. Bezahlbar? → `tower.getNextUpgradeCost(upgradeId)` (dynamisch)
3. Tier-Gate? → `requiredUpgradeTier(level)` gegen `state.research.maxUpgradeTier`
4. Feuerrate getroffen? → 70 %, bzw. 90 % ab 2000 Credits
5. ≥ 3 Türme und ≥ 50 Credits vorhanden?

### Bot startet Wellen im Dauerfeuer

1. `WAVE_START_DELAY` (1 s Game-Time) seit der letzten Action
2. Nur Phase `setup`
3. Force-Start nach `MAX_SETUP_WAIT` (5 s Game-Time)
4. Laufende Forschung blockiert den Start

### Bot hortet Gold

Erwartetes Symptom, wenn PathCoverageUpgrade nicht durchkommt (Tier-Gate, keine
bezahlbaren Upgrades) und die Platzierungsstrategien am Turm-Cap hängen. Die
90 %-Feuerrate ab 2000 Credits und SellUnderperformer sind die Gegenmaßnahmen;
beim Strategist greifen beide, bei den anderen Skill-Levels nur die erste.

---

## Changelog

### 2026-09-14: Orbitallaser
- Neue Strategie OrbitalLaser (93) in allen Skill-Stufen; `orbital-laser` in
  den Forschungslisten von strategist und meta nach `master-engineering`.

### 2026-09-14: EMP
- Neue Strategie Emp (94) in allen Skill-Stufen; `emp` in den Forschungslisten
  von strategist und meta nach `storm-mastery`.

### 2026-09-14: Frostbombe
- Neue Strategie FrostBomb (96) in allen Skill-Stufen; `frost-bomb` in den
  Forschungslisten von strategist und meta nach `nuclear-strike`. Die
  Zielhilfen des Nuklearschlags liegen jetzt in `ability-aim.ts`.

### 2026-09-13: Nuklearschlag
- Neue Aktion `use-ability`, neue Strategie NuclearStrike (97) in allen
  Skill-Stufen; `nuclear-strike` in den Forschungslisten von strategist und
  meta nach `advanced-weaponry`. Folgen für Messungen:
  [NuclearStrike (97)](#nuclearstrike-97).

### 2026-09-12: Platzierungsregeln aus einer Quelle
- `TowerManager.validatePosition` und `StrategicPlacementService.meetsPlacementConstraints`
  entfernt. Die Kandidatensuche prüft mit `TowerPlacementService.placementChecker()`
  gegen `checkTowerPlacement`, dieselben Regeln wie Vorschau und Klick. Neu im
  Bot-Filter: der Spielbereich (Bounds). Spawns kommen aus dem Store statt aus
  dem Stand von `initializeWithContext`.
- Die Strategien nehmen den besten Kandidaten direkt; die zweite Prüfschleife
  pro Kandidat entfällt.

### 2026-09-12: Chaos Tower
- `chaos` in `ALL_COMBAT_TOWERS`, `chaos-rift` in den Research-Listen von
  strategist und meta, nach Master Engineering.
- Keine neue Strategie: Chaos zählt als Anti-Air und Anti-Ethereal
  (`isAntiEtherealTower`, Schwelle 1,0), die bestehenden Placement-Strategien
  wählen ihn nach Wert pro Credit. Gegen Ethereal (0,30) liegt er dort hinter
  Magic (0,86) und Lightning (0,71), gegen Light hinter Gatling und Lightning.

### 2026-09 — Platzierung an beiden Pfadenden
- `NearSpawnUpgradeStrategy` → **`PathCoverageUpgradeStrategy`**, Datei
  `near-spawn-upgrade.strategy.ts` → `path-coverage-upgrade.strategy.ts`.
  Kandidaten jetzt abwechselnd von beiden Enden der spawn-sortierten Liste.
- `StrategicPlacementService`: lineares Spawn-Gewicht → U-förmiges
  `endZoneProximity(t)` (`END_ZONE_HQ_WEIGHT = 0.8`), plus Spec, die die Form
  asserted.
- Begründung und Messwerte: [Warum die Platzierung so
  aussieht](#warum-die-platzierung-so-aussieht).

### 2026-08 — Training-Refresh (P3 im [Handover](HANDOVER_TRAINING_REFRESH.md))
- `lightning` in `ALL_COMBAT_TOWERS`, `storm-mastery` in den Research-Listen.
- Neue **AntiEtherealPlacementStrategy** (88) + `etherealGap` im Snapshot.
- Tower-Bewertung über `computeTowerDPSFromLevels`; Anti-Air und Splash nach
  Wirksamkeit statt hartkodierter Turmliste.
- Upgrade-Tier-Regel geteilt (`requiredUpgradeTier`), bis Tier 5.
- `maxTowers` 300 → 80 → **20**; Upgrade-Strategie über 8 statt 1 Turm.
- Toter Auswahl-Code (Damage-Matrix-Pfad in `base-tower-bot.ts`) entfernt.
- Fehler-Simulation (`mistakeRate`, `makeSuboptimalAction`) und `plansAhead`
  existieren nicht mehr; Variation kommt aus dem Factory-Jitter.

### Phase 5.16 (2026-04 ff.) — Research-aware Bots
- **ResearchCenterPlacement** (95), **ResearchPick** (80, curriculum-aligned,
  strategist/meta adaptiv), **SellUnderperformer** (72, nur Strategist).
- Alle Skill-Level bekommen die Research-Strategien.
- Factory-Jitter auf `reactionTimeMs` / `maxTowers`.

### Phase 5.12 — Game-Time-Cooldowns
- Bot- und Strategie-Cooldowns von `Date.now()` auf Game-Time-Akkumulatoren
  umgestellt; `tickCooldown` von `update` getrennt, damit der Snapshot-Bau
  übersprungen werden kann.

### 2026-01 — Distributed Placement / Strategy Pattern
- `DistributedPlacementStrategy` + `findDistributedPositions` (Zonen-Scoring).
- Komplette Ablösung des monolithischen SmartBots durch Strategy Pattern +
  Composition.

---

## Verwandte Dokumente

- [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) — die Wellenseite:
  Regel-Director und Fairness-Gate, gegen die der Bot spielt
- [HANDOVER_TRAINING_REFRESH.md](HANDOVER_TRAINING_REFRESH.md) — Trainings- und
  Messhistorie, inklusive der Befunde, die zu dieser Platzierung geführt haben
- [WAVE_SYSTEM.md](WAVE_SYSTEM.md) — Wave-Management und Spawn-Pipeline
- [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) — Damage-Matrix und
  Rüstungsklassen, auf denen die Turmauswahl rechnet
- `training-backend/docs/AI_TRAINING_BACKEND.md` — Python-Trainingspfad
