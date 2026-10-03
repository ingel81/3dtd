# Druck an einer Stelle (E47 bis E50)

Stand 2026-09-27, gebaut und gemessen. Entschieden per AUQ am 2026-09-26 abends, Grundlage ist der Coop-Playtest Heilbronn W1 bis W38
(`tmp/coop-playtest/ANALYSE.md`). Gebaut wird ohne Zwischenhalt; dieses Dokument hält fest, was gebaut wird und
woran es gemessen wird.

## Befund

Der Multiplikator des Druck-Reglers wirkte an vier Stellen zugleich (`wave-sizing.ts`, `wave-config-builder.ts`):

1. im Kill-Budget des Deckels, dort mit einem Pol: Bei `budget × Abstand ≥ 1` war der Deckel unbegrenzt, knapp davor
   riesig;
2. im Anzahl-Faktor, wenn der Deckel nicht band (`countFactor × Multiplikator`);
3. als Aufschlag über die Template-Obergrenze hinaus, bis 5000 Gegner (`COUNT_OVERRIDE_MAX`);
4. als HP-Hebel (`√Multiplikator`, bis ×2).

Daraus W15 (490 statt 300 Golems je Lane) und W38 (120 × 4,08 = 490 Bären). Ein einzelner Ausreißer ging voll in den
Messwert ein (bis 100 %), das Gedächtnis des Reglers hielt ihn danach lange zu (W18 bis W30 ohne HP-Verlust). Jeder
Gegner kostete beim Leck dasselbe (1 HP, ab W31 2), ein Golem so viel wie eine Ratte. `spawnStartDelay` je Typ stand
in der Config, wirkte aber nirgends; E21 hat dafür einen Kampagnen-Boden für drei Wellen eingebaut.

## Entscheidungen

| # | Was | Wie |
|---|---|---|
| E47 | Multiplikator nur im Kill-Budget | Anzahl-Faktor, Aufschlag und HP-Hebel fallen weg. Der Deckel wird stetig: höchstens, was in der Wellendauer (3 min) tötbar ist, kein Pol, nie mehr unbegrenzt. |
| E48 | Messwert kappen | Eine Welle zählt höchstens das Dreifache des Sollwerts, die Glättung 0,35 bleibt. |
| E49 | Leckschaden je Typ | `round(√baseHp / 5)`, geklemmt 1 bis 50, mal dem Wellenaufschlag (`enemyBaseDamageForWave`, +1 je 30 Wellen). startHealth 500 bleibt. |
| E50 | Spawn-Boden je Typ | `spawnStartDelay` als harter Mindestabstand, nach der Streuung; ohne Angabe 300 ms. Ersetzt `minSpawnDelayMs` der Kampagne (E21). |
| – | Coop | Die Welle je Lane bleibt im Durchschnitt, wie sie ist. |

### Der stetige Deckel (E47)

Bisher, mit `b` = Kills je Sekunde × Realismus × Multiplikator, `d` = Abstand in s, `E` = Zeit unter Feuer, `L` =
erlaubte Lecks:

    n = (b·E + L) / (1 − b·d),   unbegrenzt bei b·d ≥ 1

Neu gilt dazu die Grenze der Wellendauer `T` = 180 s: Mehr als in `T + E` tötbar ist, kann keine Welle wegstecken.

    n = min( (b·E + L) / (1 − b·d),  b·(T + E) + L ),   bei b·d ≥ 1 nur der zweite Term

Beide Terme treffen sich genau bei `n·d = T`, der Deckel ist also stetig. Er ist immer endlich; eine starke Abwehr
bekommt einen hohen Deckel, keinen unendlichen. Ob er bindet, entscheidet weiter der Vergleich mit der Template-Spanne
nach der DPS-Rampe. Bindet er nicht, hat der Multiplikator keine Wirkung, und das Anti-Windup hält den Regler an.

Damit wird eine Welle nie größer als die Template-Obergrenze. Die Schwierigkeit über sie hinaus liefern die
HP-Spanne des Templates und der Endgame-Multiplikator; ob das reicht, zeigt die Messung (Block 3 kalibriert das
Kill-Modell, das bisher die Abwehr unterschätzt).

### Leckschaden (E49)

| Typ | baseHp | Leck |
|---|---:|---:|
| Ratte, Fledermaus, Pinguin, Skelett, Minion | 5 bis 30 | 1 |
| Zombie, Spinne, Geist, Hornisse, Wraith | 60 bis 120 | 2 |
| Panzer, Wallsmasher, Soldat, Bär, Schleimklumpen | 160 bis 300 | 3 |
| Golem, Mammut, Drache, Mech | 400 bis 500 | 4 |
| Herbert | 4000 | 13 |
| Ooze | 60 000 | 49 |
| Wurm (240 Segmente à 400) | 96 000 | 50 |

Auslegung für Körper aus vielen Teilen (nicht per AUQ gefragt, folgt der Formel): Ooze und Wurm kosten ihren Wert
**einmal für den ganzen Körper**, verteilt auf seine Teile, wie die Ooze es heute schon je Meter tut
(`leakDamageFactor` entfällt). Je Wurmsegment 4 HP hätten bis zu 960 HP gekostet, mehr als das ganze HQ.

Der Deckel rechnet das erlaubte Leck in Gegnern mit dem Leckschaden der Welle: gewichtet nach den Anteilen des
Templates, ein Gegner, der sich teilt, mit dem, was seine Enden kosten. Der Regler misst ohnehin den echten
HP-Verlust. Sichtbar wird der Wert in der Wellen-Vorschau (je Typ und als Summe „max. HQ-Schaden“), im Gegner-Tooltip
und als Zahl am HQ beim Leck.

### Spawn-Boden (E50)

Der Abstand vor einem Gegner ist mindestens der Boden des Typs davor und des Typs selbst (der größere). Lane-Kopien
im Coop spawnen weiter gleichzeitig. Der Director rechnet mit dem Boden: Der Abstand einer Welle ist mindestens der
Boden ihrer Typen, nach ihren Anteilen gewichtet (der Spawner wirkt je Nachbarpaar, der größte Boden hätte eine
gemischte Welle zu lang geschätzt), und passt die Welle dann nicht in 3 min, kommen weniger Gegner mit entsprechend
mehr HP (die Regel von E21, jetzt für alle Typen). `EnemyManager.startAll` (toter Code) fällt weg.

Folge des Standardbodens von 300 ms: Ein Schwarm-Template passt höchstens 600 Gegner je Lane in 3 min (Ratten bei
150 ms 1200); die Zombie-Horde bis 2000 kommt dann mit 600 und der HP der ganzen Welle.

## Messung

Bot-Läufe in DevWorld (`/bots`), Könner und Anfänger, je 20 Läufe vor und nach dem Umbau, gleiche Seeds.

- Wellengröße: keine Welle über der Template-Obergrenze; Spitzen wie W15/W38 verschwinden.
- Regler: Anteil der Wellen im Zielband, Sprünge des Multiplikators nach einer teuren Welle.
- Lauflänge (Median) und HP-Verlauf: Der Umbau soll glätten, nicht leichter oder schwerer machen. Weicht der
  Median um mehr als ein Viertel ab, wird nachgezogen (Realismus, Sollwert) und es steht hier, womit.

## Ergebnis (2026-09-27, Bot-Läufe in DevWorld)

Vier Stände, je 4 bis 8 headless Tabs mit Tempo 75. „Vorher“ ist der Stand vor E47, „nachher“ E47 bis E50,
„kalibriert“ dazu E51 (Realismus 0,85 bis W10, danach 1,0).

| | vorher | nachher | kalibriert |
|---|---|---|---|
| Läufe (beendet) | 22 (19) | 19 (10) | 22 (12) |
| Welle erreicht, Median Anfänger / Experte | 19 / 21 | 35 / 35 | 31,5 / 35,5 |
| größte Welle | 3453 | 1200 | 1200 |
| Wellen über 2000 Gegner | 7 | 0 | 0 |
| Multiplikator max | ×8,17 | ×6,22 | ×4,08 |
| Wellen ohne HP-Verlust / über 10 % | 20 % / 7 % | 42 % / 13 % | 40 % / 14 % |

- Vorher starben die Läufe gehäuft an W19 (Skelett-Schwarm bis 3453): der Aufschlag über die Template-Spanne.
  Nachher gibt es keine Welle über der Template-Obergrenze, die Wellen bleiben im Rahmen, die Läufe werden länger.
- **Kill-Modell (E51):** Getötete Gegner lebten im Median 28 s, das Modell rechnete mit 10 s unter Feuer. Wo die
  Abwehr überrannt wurde (Lecks über dem Erlaubten), tötete sie das 1,3-fache des Modells bis W10 und das 1,6- bis
  2,1-fache danach. Kalibriert auf 0,85 / 1,0 liegt sie in 209 solchen Wellen beim 1,11-fachen (W1 bis W30: 1,09
  bis 1,25; W31 bis W40: 0,67 bei nur 18 Wellen). Ein erster Versuch mit 1,1 ab W11 überschoss W21 bis W30 (0,80)
  und brachte die Anfänger-Tode an W19 zurück.
- Die Lauflänge nach der Kalibrierung liegt innerhalb eines Viertels der ungekalibrierten; nichts nachgezogen.
- **Offen:** Skarnax (W35) beendet 4 von 12 kalibrierten Läufen, mit 113 bis 206 Segmenten im HQ. Boss-Varianten
  laufen am Deckel vorbei (ihre HP nimmt die Variante vom Director, ihre Größe ist fest).

### Tower-Balance (E52, nur Messung)

Experten-Bot, nachher, Anteil am Gold, am Schaden und Schaden je Gold:

| Tower | Gold | Schaden | Schaden/Gold |
|---|---:|---:|---:|
| Kanone | 20 % | 47 % | 4,25 |
| Magic | 2 % | 3 % | 3,66 |
| Poison | 11 % | 15 % | 2,36 |
| Gatling | 19 % | 15 % | 1,40 |
| Archer | 23 % | 12 % | 0,96 |
| Tentacle | 8 % | 4 % | 0,90 |
| Ice | 9 % | 4 % | 0,68 (bremst, Schaden ist nicht seine Rolle) |
| Rocket | 8 % | 1 % | 0,24 |

Vorschlag, nicht umgesetzt: Kanone um etwa ein Viertel im Schaden zurück, Rocket deutlich hoch (vierfacher Abstand
zum nächsten), Archer/Tentacle leicht hoch. Lightning und Chaos baut der Bot nicht; der Heilbronn-Lauf nennt sie
schwach, messen geht erst mit einem Bot, der sie baut (Strategie-Gewichte), oder aus menschlichen Läufen.
