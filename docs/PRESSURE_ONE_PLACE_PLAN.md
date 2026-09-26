# Druck an einer Stelle (E47 bis E50)

Stand 2026-09-26. Entschieden per AUQ am 2026-09-26 abends, Grundlage ist der Coop-Playtest Heilbronn W1 bis W38
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

## Ergebnis

(folgt nach der Messung)
