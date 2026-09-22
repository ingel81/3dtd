# Druck-Regler: Plan

**Stand:** 2026-09-21. Ersetzt den Leck-Regler (`leak-controller.ts`) durch einen Regler auf den HP-Druck.
Ziel ist ein langer, durchgehend knapper Lauf statt zwölf toter Wellen und einer Wand.
Messgrundlage: 360 Könner-Läufe auf `00ab77bf`, Baseline vom 2026-09-21.

## 1. Der Befund

Der Leck-Regler regelt nicht, er schwingt.

| Welle | leakMultiplier | am unteren Anschlag | Deckel | gespawnt | Leck |
|---|---|---|---|---|---|
| 1 | 1,00 | 0 % | 14 | 20 | 71 % |
| 6 | 0,50 | 100 % | 11 | 17 | 24 % |
| 9 | 0,50 | 100 % | 5 | 8 | 0 % |
| 15 | 0,50 | 90 % | 5 | 7 | 0 % |
| 18 | 0,91 | 7 % | 10 | 15 | 0 % |
| 21 | 2,23 | 2 % | 348 | 365 | 0 % |
| 27 | 6,91 | 0 % | 24 | 18 | 40 % |
| 36 | 7,37 | 0 % | 41 | 136 | 0 % |

Über alle Wellen klebt der Multiplikator zu 34,6 % am unteren Anschlag. Der Deckel wandert zwischen 5 und 348.

Drei Ursachen, alle strukturell:

**1. Die Regelgröße hat keine Auflösung.** Das Zielband ist eine Leck-Quote von 8 bis 16 %. Bei sieben
gespawnten Gegnern sind nur 0 %, 14 % und 29 % darstellbar. Der Regler fährt sich selbst in den Bereich, in dem
er nicht mehr messen kann, und sieht dort abwechselnd "viel zu wenig" und "zu viel".

**2. Die Anfangswellen treiben ihn in die Sättigung.** Die Wellen 1 bis 3 lecken 71, 37 und 10 %, weil der
Spieler noch keine Türme hat. Das Mittel über das Fenster liegt bei ~35 %, der Fehler ist voll negativ, und
nach zwei Wellen steht der Multiplikator auf `LEAK_MULT_MIN`. Klassischer Windup.

**3. Einzelne Wellentypen verziehen ihn dauerhaft.** Die Kampagne pinnt Luftwellen auf W7, W8, W12, W16 und W21.
Gegen eine Abwehr ohne Luftziel lecken sie stark (gemessen W12: 28,6 %). Der Regler liest das als "zu schwer"
und schrumpft danach auch jede Bodenwelle. Ein Mittelwert über vier Wellen ist gegen so einen Ausreißer wehrlos.

Das erklärt die tote Mitte (W9 bis W21 kosten 1 bis 3 % der Läufe HP), das Überschwingen auf 365 Gegner in W21
und die Wand bei W24 bis W27, an der 75 % der Läufe sterben.

## 2. Der Ansatz

### 2.1 Regelgröße: Druck statt Leck

```
pressure(w) = hpLost(w) / hpAtWaveStart(w)
```

Der Anteil des **aktuellen** HP-Bestands, den eine Welle kostet.

Warum das die richtige Größe ist:

- **Sie misst Spannung.** Der Spieler erlebt sinkende HP, nicht eine Leck-Quote.
- **Sie löst auch bei kleinen Wellen auf.** Jeder Gegnertyp macht anderen Leck-Schaden, der Wert ist stetig statt
  einer Stufenfunktion über der Gegnerzahl.
- **Sie überlebt Heilung.** Das ist die Bedingung, unter der der Regler auch dann noch stimmt, wenn Pickups oder
  gekaufte Heilung dazukommen: Heilt der Spieler, steigt der Nenner, die Welle darf absolut mehr kosten, und der
  relative Druck bleibt gleich. Ein Regler auf den HP-Restbestand oder auf kumulierten Schaden würde in dem
  Moment brechen. Geheilte HP sind damit echter Fortschritt (mehr überlebte Wellen), ohne die Kurve zu
  verflachen.

### 2.2 Zielkurve aus der gewünschten Lauflänge

Kostet jede Welle im Mittel den Anteil `p`, sind nach `N` Wellen noch `(1 - p)^N` der HP übrig. Umgekehrt:

```
basePressure = 1 - RESIDUAL_HP ^ (1 / TARGET_RUN_WAVES)
```

Mit `TARGET_RUN_WAVES = 80` und `RESIDUAL_HP = 0.05` sind das **3,67 % pro Welle**. Die gewünschte Lauflänge ist
damit ein einziger Design-Parameter, kein Ergebnis von Tuning.

Darüber eine Form, damit der Lauf nicht gleichförmig ist:

```
shape(w)  = SHAPE_START + (SHAPE_END - SHAPE_START) * clamp01(w / TARGET_RUN_WAVES)
target(w) = basePressure * shape(w)
```

`SHAPE_START = 0.5`, `SHAPE_END = 1.5`. Der Mittelwert über den Lauf bleibt 1, die Aufbauphase ist milder, das
Endspiel härter. Die Form ist der Ort, an dem Spannungsdesign passiert; die Höhe kommt aus der Lauflänge.

### 2.3 Ein Sollwert für zwei Stellen

`survivableCount` hat mit `FAIRNESS_WAVE_HP_BUDGET = 0.06` bereits einen Zieldruck, nur an anderer Stelle, mit
anderem Wert und ohne Bezug zum Regler. Beide bekommen künftig `target(w)`. Damit gibt es eine Zahl, die sagt,
was eine Welle kosten soll, statt zweier, die gegeneinander arbeiten.

### 2.4 Regler

```
measured = median(pressure über PRESSURE_WINDOW Wellen)
error    = ln(target / max(measured, PRESSURE_FLOOR))
step     = exp(PRESSURE_GAIN * clamp(error, -MAX_STEP, +MAX_STEP))
mult     = clamp(mult * step, MULT_MIN, MULT_MAX)
```

- **Median statt Mittel** gegen die Luftwellen-Ausreißer aus Ursache 3.
- **Logarithmischer Fehler**, damit "halb so viel" und "doppelt so viel" gleich schwer wiegen. Der bisherige
  relative Fehler `(target - measured) / target` ist nach oben auf +1 begrenzt, nach unten unbegrenzt und
  deshalb einseitig hart.
- **`PRESSURE_FLOOR`** fängt den Fall `measured = 0` ab, der sonst `ln(∞)` ergibt.
- **Warmup:** Die ersten `WARMUP_WAVES` Wellen kommen nicht ins Fenster. Sie messen einen Spieler ohne Türme,
  nicht die Verteidigung. Das ist der Anti-Windup gegen Ursache 2.
- **Kein Sonderfall für den Tod.** Der bisherige `backed-off`-Zweig wirkt erst nach dem Ende des Laufs und ist
  für dessen Verlauf wirkungslos. Ein zu hoher Druck wird über denselben Fehlerterm zurückgenommen.

### 2.5 Der Deckelboden muss weg

`FAIRNESS_MIN_COUNT = 5` ist der Grund, warum der Regler in der toten Mitte blind wird: Der Deckel kann nicht
unter fünf Gegner, also misst der Regler dort nur noch Rauschen. Der Boden wird an das Template gekoppelt statt
an eine Konstante, damit eine Welle immer genug Körper hat, um überhaupt eine Aussage zu erzeugen.

## 3. Offene Entscheidungen

| # | Frage | Vorschlag |
|---|---|---|
| E1 | Ziel-Lauflänge | 80 Wellen bei 5 % Rest-HP, also 3,67 % Druck je Welle |
| E2 | Form der Kurve | linear 0,5 bis 1,5 über die Ziel-Lauflänge |
| E3 | Fensterbreite | 5 Wellen, Median |
| E4 | Warmup | 4 Wellen |
| E5 | Deckelboden | an die Template-Untergrenze koppeln statt fester 5 |

Alle fünf sind Zahlen in `director-params.ts` und in einem Bot-Lauf messbar.

## 4. Umbau

Kein Parallelsystem: Der Leck-Regler wird ersetzt, nicht ergänzt.

| Schritt | Dateien |
|---|---|
| 1 | `director/pressure-controller.ts` neu, `leak-controller.ts` und `.spec.ts` gelöscht |
| 2 | `templates.ts`: `survivableCount` nimmt `targetPressure` statt `FAIRNESS_WAVE_HP_BUDGET`, Boden gekoppelt |
| 3 | `wave-config-builder.ts`, `wave-director.ts`, `state-snapshot.service.ts`: Verdrahtung |
| 4 | `wave-outcome-tracker.ts`: `hpAtWaveStart` mitführen |
| 5 | `decision-explainer.ts`: Begründung nennt Druck statt Leck |
| 6 | Run-Log Format 3: `pressureMultiplier`, `targetPressure`, `pressure` je Welle |
| 7 | Specs: `leak-wiring`, `determinism`, `wave-reference`, `wave-director`, Facade-Specs |
| 8 | `bot-server/analysis`: liest beide Formate |
| 9 | `WAVE_DIRECTOR.md` Abschnitt 6, `BALANCING_PLAN.md` |

## 5. Messung

Abnahmekriterien gegen die Baseline `00ab77bf` (360 Könner-Läufe, Median-Welle 25):

| Kennzahl | Baseline | Ziel |
|---|---|---|
| Median-Welle Könner | 25 | deutlich höher, Richtung 40+ |
| Wellen ohne HP-Verlust am Stück | 12 | höchstens 3 |
| Multiplikator am Anschlag | 34,6 % | unter 5 % |
| Spannweite des Deckels im Lauf | 5 bis 348 | innerhalb einer Größenordnung |
| Anteil Wellen im Zielband | nicht gemessen | über 50 % |

Gemessen wird mit `bot-server/analyze_runs.py`, das dafür die Regler-Diagnose als eigenen Abschnitt bekommt.

## 6. Iterationen

Gebaut, gemessen, korrigiert. Jede Runde mit acht Bot-Clients gegen dieselbe Kampagne; die Läufe liegen unter
`bot-server/runs/` in einem Ordner je Runde.

### Runde 0: die Baseline (`baseline-leak-00ab77bf`, 790 Läufe)

Der Leck-Regler. Könner: Median-Welle 25, tote Strecke 10,9 Wellen, 35 % der Wellen am Anschlag,
Deckel-Spanne ×48 innerhalb eines Laufs.

### Runde 1: Druck-Regler mit angehobenem Deckelboden (`iter1-floor-00ab77bf`, 40 Läufe)

Die Regelgüte sprang sofort: tote Strecke 0,8 statt 10,9, Anschlag 2 % statt 35 %, Deckel-Spanne ×8 statt ×48.
Die Läufe wurden trotzdem viel kürzer, Median-Welle 9 statt 25.

**Ursache, und sie war hausgemacht:** Entscheidung E5, den Deckelboden an die Template-Untergrenze zu koppeln.
Welle 2 spawnte damit 75 Gegner statt 30 und kostete 45 % der HP. Der Deckel ist die einzige Bremse gegen eine
Welle, die eine junge Verteidigung nicht halten kann, und ein Boden darüber hebelt genau sie aus. Der Kommentar
an der Stelle im Code warnte davor; das Argument für den Boden stammte außerdem aus dem alten Regler, dessen
Leck-Quote unter fünf Gegnern nicht mehr auflöste. Der Druck hat dieses Problem nicht, weil jeder Gegnertyp
anderen Leck-Schaden macht. **E5 verworfen.**

### Runde 2: ohne Boden, Median über 5 Wellen (`iter2-median-00ab77bf`, 29 Läufe)

Median-Welle 22, tote Strecke 5,9, Anschlag 12 %, Deckel-Spanne ×11. Besser als die Baseline in jeder
Regelgröße, aber nur 6 % der Wellen im Zielband, und der Multiplikator stand über die halbe Kampagne auf ×1,00,
obwohl die Wellen 10 bis 30 % der HP kosteten statt der angepeilten 2 %.

**Ursache:** Der Druck ist bimodal. Eine Welle kostet fast nichts, wenn die Abwehr zum Template passt, und 20
bis 30 %, wenn nicht. Der Median über fünf Wellen traf verlässlich die harmlose Mitte und meldete "im Band",
während der Lauf im Schnitt 12 % pro Welle verlor. Bei 12 % ist ein Lauf nach 22 Wellen vorbei, und genau da
endete er.

Der Median war als Schutz gegen die gepinnten Luftwellen gedacht. Er war zu robust: Die Lauflänge hängt am
**Erwartungswert** des Drucks, nicht an seinem Median, denn nach N Wellen sind `(1-p)^N` der HP übrig.
**E3 korrigiert:** Mittelwert über acht Wellen statt Median über fünf.

### Runde 3: Mittelwert über 8 Wellen (`iter3-mean-00ab77bf`)

Könner: Median-Welle 17, tote Strecke 5,9, Anschlag 22 %, 5 % im Band. Der Regler bewegte sich jetzt, aber zu
spät und dann sofort an den Anschlag: Warmup 4 plus Fenster 8 heißt, dass er erst ab Welle 12 überhaupt regelt,
und da hat ein Lauf, der bei Welle 17 endet, das meiste schon verloren.

Wichtiger war, was die Zahlen darunter zeigten. Die Wellen kosteten 9 bis 23 % der HP gegen ein Ziel von 2 %,
und selbst am unteren Anschlag (×0,50, also die kleinstmögliche Welle) blieb es dabei. Welle 12 kostete 22,8 %
bei sechs gespawnten Gegnern.

**Damit war klar, dass der Engpass nicht im Regler liegt.**

### Runde 4: das HP-Budget (`f2f66b4b`)

Die Arithmetik, die die drei Runden davor unmöglich machte:

- 100 HP Start, ein Leck kostet 1 bis 4 HP, wachsend mit der Welle
- ein Lauf hat damit ein Budget von rund 40 Lecks
- auf 80 Wellen verteilt: **0,5 Lecks je Welle**

In jeder zweiten Welle durfte also nichts durchkommen, und genau das ist die tote Welle. Dazu kam, dass der
Leck-Schaden wächst, während die HP fallen: Bei Welle 40 kostete ein einzelner Durchbruch rund 17 % der
Rest-HP. Zwischen "kostet nichts" und "kostet ein Sechstel" lag nichts, was ein Regler hätte treffen können.

Zwei Änderungen, beide an der Auflösung und nicht an der Härte:

| | vorher | jetzt |
|---|---|---|
| `startHealth` | 100 | 500 |
| Leck-Schaden | +1 je 10 Wellen | +1 je 30 Wellen |

Damit hat ein Lauf gut 300 Lecks statt 40, also drei bis vier je Welle. Ein einzelner Durchbruch macht eine
Welle spannend, statt sie zu entscheiden. Alles, was HP liest, rechnet in Anteilen (Close Call bei 30 %, der
Leck-Spielraum des Deckels, der Regler selbst), also ändert sich am Spielgefühl nichts außer der Anzeige und
der Steuerbarkeit.

Die Balance-Config ändert sich damit, der Hash wandert von `00ab77bf` auf `f2f66b4b`, und die Läufe trennen
sich von selbst.

Ergebnis Runde 4: Median-Welle 23 beim Könner, 17 beim Anfänger, aber der Druck lag erstmals in der
Größenordnung des Ziels (1 bis 6 % statt 9 bis 23 %), einzelne Wellen zu 100 % im Band, längster Lauf 61.
Die Deckel-Spanne fiel von ×48 auf ×7.

### Runde 5: der Regler greift ab drei Messwerten (`iter5-fast-f2f66b4b`)

Er wartete bisher auf ein volles Fenster, also auf Warmup 4 plus Fenster 8: Bei einem Lauf, der um Welle 16
endet, hätte er nach der halben Lebenszeit angefangen zu regeln. Drei Messwerte sind eine grobe, aber
rechtzeitige Aussage.

**Median-Welle 40 gegen 25 in der Baseline**, längster Lauf 56, und die Wellen 4 bis 14 lagen zu 57 bis 100 %
im Zielband. Das ist der Punkt, an dem der Regler zum ersten Mal tut, wofür er gebaut ist.

Was offen blieb: tote Strecke 9,0 und Deckel-Spanne ×54. Beides in derselben Phase — ab Welle 16 kostet nichts
mehr, der Regler öffnet über sechs Wellen von ×1,04 auf ×8,6, und bei Welle 26 stehen dann 673 Gegner im Feld
und kosten 31,7 % der HP.

### Runde 6: Anti-Windup am Deckel (`iter6-antiwindup-f2f66b4b`)

Der Multiplikator wirkt ausschließlich über den Überlebbarkeits-Deckel. Bindet der nicht, weil die Welle
ohnehin kleiner ist als erlaubt, hat der Regler keine Wirkung und öffnet gegen eine Sättigung. `capIsBinding`
meldet das zurück, und weiteres Öffnen unterbleibt; Schließen bleibt immer erlaubt.

Median-Welle 41, längster Lauf 71. Die tote Strecke bewegte sich aber kaum (9,0 auf 8,1), also ist Windup
nicht die Hauptursache.

### Runde 7: EWMA statt Fenster (`f2f66b4b`)

Die verbliebene Ursache ist Trägheit. Ein gleitendes Mittel über acht Wellen braucht vier Wellen, um auf einen
Umschwung zu reagieren, und genau so lange bleibt der Lauf tot, nachdem die Verteidigung stark geworden ist.
Ein exponentiell gewichteter Mittelwert (`PRESSURE_SMOOTHING = 0.35`) gewichtet die letzte Welle sofort mit
35 % und behält ein Gedächtnis von rund drei Wellen.

Ergebnis Runde 7: **Median-Welle 52** beim Könner, längster Lauf 63, Multiplikator nur noch zu 2 % am Anschlag.
Die tote Strecke blieb bei 8,8, und der Verlauf zeigte warum:

| Welle | gespawnt | Deckel bindet | Druck |
|---|---|---|---|
| 24 | 26 | 100 % | 0,1 % |
| 26 | 584 | 16 % | 8,6 % |
| 28 | 47 | 95 % | 0,1 % |
| 36 | 287 | 33 % | 11,8 % |

Wo der Deckel greift, ist die Welle zu klein und kostet nichts; wo er nicht greift, kommen 584 Gegner. Das ist
keine Trägheit mehr, sondern ein Loch im Modell.

### Runde 8: der Deckel ist nie unbegrenzt (`f2f66b4b`)

`survivableCount` löst nach der Wellengröße auf und teilt dabei durch `1 - killsPerSecond * REALISM * delay`.
Wird der Nenner null oder negativ, tötet die Verteidigung rechnerisch schneller, als Gegner nachkommen, und die
Funktion gab `null` zurück: kein Deckel, die Welle so groß wie die Template-Spanne erlaubt.

Das ist die Stelle, an der die Wellen mit 584 Gegnern entstanden, und mit ihnen der ganze Zickzack. Eine Welle
ist aber nie unbegrenzt, weil sie nur begrenzt Zeit hat: Über `MAX_WAVE_DURATION_MS` kommt keine, dafür sorgt
der Dauer-Deckel. Die ehrliche Obergrenze ist also, was die Verteidigung in dieser Zeit schafft.

Nebenwirkung, die erwünscht ist: Der Multiplikator hat damit in **jeder** Welle Autorität. Vorher war er in
genau den Wellen wirkungslos, die den Schaden anrichteten.

**Ergebnis Runde 8: verschlechtert, zurückgenommen.** Median-Welle 53 auf 38, Deckel-Spanne ×115 auf ×534. Der
Grund ist offensichtlich, sobald man die Zahl ausrechnet: `budget × 180 s` liegt bei einer starken Verteidigung
weit über der Template-Spanne, die vorher die faktische Grenze war. Die Formel hatte recht — ein negativer
Nenner heißt wirklich, dass die Verteidigung jede Zahl schafft. Die großen Wellen kommen aus der
Template-Spanne und nicht aus dem Deckel.

### Runde 9: eine billige Welle ohne bindenden Deckel ist kein Messwert (`f2f66b4b`)

Die Kehrseite des Anti-Windup aus Runde 6, und der zweite Anlauf auf dieselbe Beobachtung.

Bindet der Deckel nicht, kam die Wellengröße aus der Template-Spanne. Dass eine solche Welle nichts kostet,
sagt nichts darüber aus, ob der Multiplikator zu niedrig steht — der Multiplikator hat sie nicht freigegeben.
Sie trotzdem zu zählen war der Grund, warum der Regler die toten Wellen nicht auffüllte: Die wenigen sehr
großen Wellen hielten den geglätteten Druck oben, während die Wellen, die er wirklich steuerte, 0,1 % kosteten.

Die Ausnahme ist Absicht: Eine **teure** Welle zählt auch ohne bindenden Deckel. Sonst könnte ein Lauf an
Wellen sterben, die der Regler nie zu sehen bekommt, und Schließen wirkt auch dort, weil es den Deckel senkt,
bis er wieder bindet. Die Kosten eines Fehlers sind asymmetrisch: zu leicht ist langweilig, zu schwer beendet
den Lauf.

**Ergebnis Runde 9:** Median-Welle 41, tote Strecke 9,5, Deckel-Spanne ×64 gegen ×115. Die Spanne wurde
besser, die Lauflänge lag innerhalb der Streuung von Runde 7 (n = 16 gegen 21). Die Änderung ist begründet und
bleibt, entschieden ist sie durch diese Stichprobe nicht.

### Runde 10: der Multiplikator greift auch am Anzahl-Faktor (`f2f66b4b`)

Bis hier wirkte der Multiplikator ausschließlich über den Deckel. Bindet der nicht, hat der Regler **keinen
Stellhebel** — und das sind gemessen genau die Wellen, die nichts kosten. Alle Iterationen seit Runde 6 haben
um dieses Loch herum gearbeitet.

Jetzt verschiebt er in diesen Wellen stattdessen den Anzahl-Faktor innerhalb der Template-Spanne. Mehr als
`countRange[1]` wird eine Welle dadurch nie, der Designer behält also die Obergrenze; der Regler bekommt den
Bereich darunter.

Damit hat er in jeder Welle genau einen wirksamen Griff: den Deckel, wo er bindet, und den Faktor, wo nicht.

**Ergebnis Runde 10 und 11** (mit Raketen-Splash, 37 Könner-Läufe): Median-Welle 46, längster Lauf 72,
Multiplikator zu 4 % am Anschlag, 0 Abgleichfehler. Der Anfänger liegt zu 45 % im Zielband bei einer toten
Strecke von 1,5. Beim Könner bleiben 8,9.

### Runde 12: der Gleichstand entscheidet nach Passung (`f2f66b4b`)

Die tote Strecke beim Könner ist mit Wellengröße nicht zu beheben, und das ist kein Einstellungsproblem: Ein
Template, gegen das die Abwehr gut steht, kostet auch groß nichts, und eines, gegen das sie schlecht steht,
kostet auch klein viel. Der Regler trifft den Erwartungswert, die Streuung bleibt.

Der Director nimmt das älteste zulässige Template und würfelt unter den gleich alten. Gewürfelt wird oft: Über
die Kampagne hinaus stehen regelmäßig neun Kandidaten gleichauf. Diese Wahl ist der dritte Stellhebel, und
anders als die beiden anderen wirkt sie auf die Streuung statt auf den Mittelwert.

`buildWaveContext` rechnet dafür je Kandidat aus, wie viel Luft der Deckel ihm lässt — eine Zahl, die es für
den ersten Kandidaten ohnehin schon gab. Steht der Regler auf "zu leicht", bekommt der Spieler unter den
gleich alten den, gegen den seine Abwehr am schlechtesten steht; auf "zu schwer" den umgekehrten. Hält er,
bleibt es beim Zufall: Im Zielzustand wird nicht nachgeholfen.

Die Älteste-zuerst-Regel bleibt unangetastet, Abwechslung wird weiter erzwungen. Es hört nur das Würfeln
*innerhalb* der gleich alten Kandidaten auf.

**Ergebnis Runde 12: marginal, und der Grund ist strukturell.** Median-Welle 48 gegen 47, tote Strecke 9,0
gegen 9,5, Zielband 23 % gegen 21 % — alles innerhalb der Streuung. Die Template-Verteilung über W31 bis W60
ist praktisch unverändert, jedes Template liegt bei rund 5 %.

Das musste so kommen: **Die Älteste-zuerst-Regel erzwingt Gleichverteilung.** Wer immer den ältesten Kandidaten
nimmt, spielt langfristig jedes Template gleich oft, egal wie der Gleichstand aufgelöst wird. Der Tie-Break
kann nur beeinflussen, *wann* ein Template kommt, nicht *wie oft*. Ein schweres Template ein paar Wellen früher
zu bringen ist etwas wert, aber es glättet keine Streuung.

Die Änderung bleibt drin, weil sie begründet ist und nichts kostet. Für die tote Strecke heißt der Befund
allerdings: **Es gibt hier einen Zielkonflikt, und er ist eine Design-Entscheidung, keine Einstellung.**
Erzwungene Abwechslung und passende Schwierigkeit widersprechen sich. Wer die Streuung wirklich glätten will,
muss die Älteste-zuerst-Regel antasten, und die ist bewusst so gebaut ("Abwechslung wird erzwungen, nicht
belohnt", director-rules.ts). Das gehört dem Menschen entschieden und steht als E19 in TODO.md.

## 7. Stand

| Kennzahl | Baseline (Leck-Regler) | jetzt |
|---|---|---|
| Median-Welle Könner | 25 | 47 bis 48 |
| Median-Welle Anfänger | 21 | 32 bis 35 |
| längster Lauf | 39 | 84 |
| Multiplikator am Anschlag | 34,6 % | 5 bis 9 % |
| Zielband Anfänger | 2 % | 46 % |
| Zielband Könner | 3 % | 23 % |
| tote Strecke Anfänger | 3,1 | 1,7 |
| tote Strecke Könner | 10,9 | 9,0 |
| Abgleichfehler | 0 | 0 |

Vier der fünf Abnahmekriterien aus Abschnitt 5 sind erfüllt oder übererfüllt. Das fünfte, die tote Strecke,
ist beim Anfänger erreicht und beim Könner nicht: Dort liegt sie bei neun Wellen gegen ein Ziel von drei. Der
Grund ist oben benannt und ist keine Einstellung, sondern eine Entscheidung über die Template-Wahl.

## 8. Die Belohnung zog in die andere Richtung

Der Regler soll dafür sorgen, dass jede Welle etwas kostet. Gemessen über 16471 Wellen der alten Baseline
verteilte sich das Wellengold aber so:

| Posten | Anteil |
|---|---|
| base | 67,8 % |
| **perfect** (nichts durchgelassen) | **19,5 %** |
| combo (Serie perfekter Wellen) | 11,7 % |
| **closeCall** (knapp überstanden) | **0,86 %** |
| comeback | 0,03 % |

Fast ein Drittel des Bonusgolds ging an die Welle, in der nichts passiert, und praktisch nichts an die knapp
überstandene. Die Ökonomie belohnte genau das, was der Regler verhindern soll, und das Erlebnis, um das es
geht, war nichts wert.

**Dazu ein Fehler, den erst der Wechsel auf 500 HP sichtbar machte.** `closeCallHpThreshold: 25` wurde an zwei
Stellen mit verschiedenen Einheiten gelesen: im `GameStore` gegen `healthPercent()`, also als 25 %, im
`WaveManager` gegen den HP-Stand, also als 25 HP. Bei 100 Start-HP war beides zufällig dasselbe. Danach
meldete der Store "kritisch" ab 125 HP, während der Bonus erst ab 25 zahlte — sein Anteil fiel von 0,86 % auf
0,11 %. Beide lesen jetzt `closeCallHp()`, eine Funktion über `startHealth`.

Geändert:

| | vorher | jetzt |
|---|---|---|
| Perfect-Bonus | 35 % des Budgets | 20 % |
| CloseCall-Bonus | 12 %, Schwelle absolut 25 HP | 35 %, Schwelle 25 % der Start-HP |
| Comeback | Deckel 15 Gold, je HP-Punkt | Anteil des Budgets, je verlorenem HP-Anteil |

Perfektes Spiel bleibt belohnt, nur nicht mehr am stärksten. Der knappe Sieg zahlt jetzt am meisten, und das
wirkt zugleich als Ausgleich: Wer angeschlagen aus einer Welle kommt, bekommt die Mittel, sich zu erholen,
statt in eine Abwärtsspirale zu geraten. Das ist der Teil des Auftrags, der "Belohnung" hieß.

**Runde 13 zeigte prompt, dass "umverteilen" und "kürzen" zwei verschiedene Dinge sind.** Perfect von 0,35 auf
0,2 zu senken, ohne es gegenzurechnen, nahm dem Spiel Gold: Der Bonusanteil am Wellengold fiel von 32 % auf
20 %, und mit ihm die mediane Runlänge von 47 auf 32. Die Verteilung stimmte (perfect 19,5 % auf 9,0 %,
closeCall 0,86 % auf 3,4 %, comeback 0,03 % auf 1,9 %), die Summe nicht.

Runde 14 rechnet sie gegen: Bei rund der Hälfte perfekter und einem Zehntel knapper Wellen hält
`0,5 × 0,27 + 0,1 × 0,55` ungefähr das alte `0,5 × 0,35 + 0,1 × 0,12`. Der knappe Sieg zahlt jetzt das
Doppelte des perfekten, ohne dass insgesamt weniger Gold im Spiel ist.

Die Kennzahl darunter sagt mehr als die Gold-Anteile:

| | Baseline | mit Druck-Regler |
|---|---|---|
| Wellen, die gar nichts kosten | **50,1 %** | 37,1 % |
| Wellen, die knapp ausgehen | 5,2 % | 3,8 % |

In der alten Baseline kostete **jede zweite Welle nichts**. Das ist die Zahl hinter der flachen Kurve, und sie
erklärt zugleich, warum der Perfect-Bonus so viel ausschüttete: Er zahlte auf die Hälfte aller Wellen.

Zwischen den beiden Spalten liegt auch die Reparatur der Knapp-Schwelle. Mit der absoluten 25 fiel sie nach dem
Wechsel auf 500 HP auf 1,0 % der Wellen; relativ gerechnet sind es wieder 3,8 %.

## 9. Der HP-Hebel: naheliegend, gebaut, verworfen

Die Beobachtung war richtig und ist es immer noch: Welle 19 schickte 2820 Skelette und nahm dem Spieler 0,08 %
seiner HP ab. Der Deckel band dort zu 4 %, die Welle stand am oberen Ende ihrer Template-Spanne. "Mehr Gegner"
ist da keine Antwort mehr, also lag es nahe, sie zäher zu machen: der HP-Multiplikator als vierter Griff des
Reglers.

Über drei Runden mit zusammen 480 Läufen zahlt sich das nicht aus.

| Runde | n | Median-Welle | tote Strecke | tot je Lauf |
|---|---|---|---|---|
| 14, ohne den Hebel | 236 | **48** | 9,0 | 19 % |
| 15/16, Hebel ungedämpft | 136 | 37 | 7,1 | 19 % |
| 17, Hebel gedämpft | 109 | 37 | 8,0 | 22 % |

Ungedämpft machte er Welle 19 von der harmlosesten zur **tödlichsten** Einzelwelle: dieselben 2820 Skelette,
nur alle so zäh wie das Template maximal zulässt, beendeten 6 % aller Läufe. Gedämpft (Wurzel des
Multiplikators, höchstens ×1,5) verschwand die Wand und mit ihr der Nutzen.

In beiden Fällen kostete er elf Wellen Runlänge für eine Welle weniger Durststrecke. Auf die Lauflänge bezogen
war der Zustand davor sogar besser.

**Warum es nicht funktioniert:** Zähigkeit und Anzahl multiplizieren sich. Derselbe Faktor ist bei 2820 Gegnern
etwas völlig anderes als bei dreißig, und ein Regler, der eine einzige Zahl kennt, trifft beides nicht. Wer es
noch einmal versuchen will, müsste auf die **Gesamthärte** regeln (Anzahl mal Zähigkeit mal Matchup) statt auf
einen der Faktoren.

Zurückgebaut. `pressure-wiring.spec.ts` hält einen Test, der das Wiedereinbauen bemerkt, damit der naheliegende
Griff nicht ein zweites Mal ohne diese Messung entsteht.
