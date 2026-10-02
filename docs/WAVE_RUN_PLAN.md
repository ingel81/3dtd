# Laufplan: ein Weg für alle Wellen

**Stand:** 2026-10-02, gebaut: der Budget-Source ist der Standard, der adaptive Director ist entfernt
(Abschnitt 13, [WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md), Abschnitt 18). Die Abschnitte 1 bis 12 sind das
Konzept vom 2026-09-28; Abschnitt 16 die Vielfalt, das Gold, die Forschung und die Mutatoren nach dem
menschlichen Lauf bis W60.

Verwandt: [WAVE_SOURCE_PLAN.md](WAVE_SOURCE_PLAN.md) (Quellen, Vertrag), [WAVE_DIRECTOR.md](archive/WAVE_DIRECTOR.md)
(adaptiver Director, archiviert), [WAVE_SYSTEM.md](WAVE_SYSTEM.md) (Boss-Wellen), TODO E54, E67.

## 1. Anlass

Skarnax war nach der Kampagne mal zu hart, mal zu leicht, und keine Zahl stellt ihn direkt ein. Seine Stärke hängt
an einer Golem-Welle, die der Director plant und die nie gespielt wird. Gewünscht (User, 2026-09-28): den Verlauf
über den ganzen Lauf fest planen, Boss-Wellen mit eigener, einstellbarer Stärke, ein einheitlicher Weg für alle
Wellen. Die Anpassung an die Abwehr bleibt; der Tabellen-Source passt nicht, er ist komplett fest.

## 2. Heute: drei Wege zu einer Welle

| Wellen | Was kommt | Wie groß und zäh |
|---|---|---|
| W1 bis W30 außer Boss | Template fest aus der Kampagne (`campaign.config.ts`) | Director: Deckel, DPS-Rampe, Intensität der Kampagne, Druck-Regler |
| W10 | Herbert-Template, fest | wie oben, ein Herbert plus Begleiter |
| W20, W30 | Ooze bzw. Skarnax **ersetzt** eine geplante Herbert-Welle | Gesamt-HP der geplanten Herbert-Welle |
| ab W31 außer Boss | Director wählt das Template selbst (Kandidaten, Abklingzeit, Tie-Break) | Director, dazu Endgame-HP `1 + 0,05 · (W − 20)`, höchstens ×4 |
| W40, W50, … | Director wählt ein Boss-Template (Herbert, Golem, Drache) | Director |
| W35, W55, … / W45, W65, … | Skarnax bzw. Ooze **ersetzt** das geplante Boss-Template | seit `a06cb4bc` Gesamt-HP der geplanten Welle, vorher deren Faktor je Segment |

Folgen:
- Die Stärke der Varianten ist eine Nebenwirkung. Im Referenzlauf ging W35 durch die Normierung von ×17,6 auf ×1,16
  je Segment; in 140 Bot-Läufen verlor der Bot in 48 von 51 Wellen 35 keine HP (vorher im Median 85 bis 101).
- Boss-Varianten laufen am Deckel vorbei (ihre Größe ist fest), die Templates nicht.
- Ab W31 steht nirgends, was kommt. Die Vorschau kennt es erst, wenn der Director geplant hat.

## 3. Grundsatz (User, 2026-09-28)

- Der Director bleibt adaptiv: Er reagiert auf die Stärke der Abwehr und den HP-Verlust.
- Ein Grundprinzip für jede Welle, Boss oder nicht. Keine Welle wird durch eine andere ersetzt, keine Sonderregel für
  einzelne Wellen oder Gegner. Jede Sonderregel ist ein Zeichen, dass das Prinzip nicht trägt.
- Der Tabellen-Source ist nicht das Ziel (komplett fest).
- Überblick zurückgewinnen (User): Die Planung soll so klein sein, dass eine Seite beschreibt, was sie tut, und
  jede Regel darauf steht. Heute weiß niemand mehr genau, was die Logik alles macht. Maßstab für den Umbau: Was sich
  nicht in diese eine Seite fügt, fällt weg oder wird Teil des Prinzips.

## 4. Vorschlag: ein Laufplan, der Director regelt darin

Ein Plan über den ganzen Lauf, eine Zeile je Welle, im Stil der Kampagne:
- **Was:** ein Template oder ein Boss. Bosse sind Zeilen wie alle anderen, nichts ersetzt mehr eine andere Welle.
- **Wie stark gedacht:** eine Soll-Stärke je Zeile. Für Bosse die einstellbare Zahl, die heute fehlt.
- **Wie viel Gold:** wie heute in der Kampagne.
- **Danach:** eine Regel statt einer endlosen Liste (zum Beispiel ab Welle X den Abschnitt wiederholen, Stärke je
  Runde mal einen Faktor).

Der Director bleibt und macht in jeder Welle dasselbe: Er misst die Abwehr und passt Anzahl und HP an, aber nur in
einem Band um die Soll-Stärke. Damit gibt es einen Weg für alle Wellen: Zeile lesen, anpassen, ausliefern.

Was wegfällt: die Rotation der Boss-Varianten, das Ersetzen einer geplanten Welle, die freie Template-Wahl ab W31
(oder sie bleibt als Werkzeug, um die Zeilen einmalig vorzuschlagen). Was bleibt: Deckel, DPS-Rampe, Druck-Regler,
Run-Log, Vorschau (sie kann jetzt jede Welle vorher nennen).

## 5. Entscheidungen (User, 2026-09-28, Entscheidungsseite)

| Frage | Entscheidung |
|---|---|
| Grundmodell | **Budget je Welle prüfen** (Vorbild Risk of Rain 2): Budget aus einer stetigen Kurve, verschoben vom Regler; jeder Gegner kostet nach seiner Zähigkeit, ein Boss ist nur teuer; der Deckel bleibt die Grenze. Ausarbeiten und gegen den Referenzlauf nachrechnen. |
| Was nach Welle 30 kommt | Plan-Zeilen bis Welle 60, danach läuft ein Abschnitt erneut, je Runde stärker gedacht. |
| Stärke einer Plan-Zeile | Faktor auf die Spannungskurve: 1 normal, 0,5 Atempause, 1,5 fordernd; für jede Zeile gleich gemeint, Boss oder nicht. |
| Boss-Wellen | Genau wie jede Welle: Deckel und Regler bemessen um die gedachte Stärke. |
| Spielraum des Reglers | Etwa halb bis doppelt um die gedachte Stärke. |
| Luft oder Geister ohne passende Abwehr | Plan hat Vorrang, der Deckel hält sie überlebbar, die Vorschau warnt eine Welle vorher. |
| Drei Kurven nach Wellennummer | Auf eine zurückführen (die Spannungskurve); vorher nachrechnen, dass der Verlauf gleich bleibt. |
| Skarnax fordernder | Nach dem Umbau, eigenes Konzept (E67). |
| Bestandsliste | Vorschläge gelten, wo nicht umgeklickt (Abschnitt 7). |
| Weiter | Konzept ausarbeiten, User liest, dann Umbau in Schritten mit Referenzlauf und Bot-Messung je Schritt. |
| Was aus dem Plan kommt | Die Anzahl; die HP füllen das Budget. Ein Schwarm bleibt ein Schwarm, ein Boss bleibt einer. |
| Budget-Kurve bei Stärke 1 | Heutiger Median als Start, dann per Bot-Messung justieren. |

Nicht Teil davon: der Tabellen-Source bleibt, wie er ist.

## 6. Ideen des Users (2026-09-28, aus der Entscheidungsseite)

- **Spawn-Abstand als Gestaltungsmittel:** Der Abstand entscheidet mit, ob etwas tötbar ist. Ein Zombie-Schwarm mit
  30 bis 100 ms ist etwas ganz anderes als heute und macht Laune. Offen: wie das sinnvoll ins Prinzip kommt.
- **Golems brauchen deutlich mehr Abstand** als heute (Vorlage 600 ms, Typ 1200 ms).
- **180 s Höchstdauer ist fraglich:** Sie arbeitet gegen einen sinnvollen Abstand, der eine Welle ausmachen kann, und
  der Tausch „weniger Gegner, mehr HP“ ändert mühsam Designtes. Beide Regeln auf „prüfen“.
- **DPS-Rampe:** Irgendwas muss aus einer Liste kommen; die Frage ist, ob Anzahl oder HP.
- **Vorschau:** Dass sie nach Welle 30 nichts weiß, ist eine Folge der freien Wahl; mit Plan kennt sie jede Welle.

## 7. Bestand der Sonderregeln und was aus ihnen wird

Erhoben 2026-09-28 (42 Regeln, Einzelheiten und Fundstellen auf der Entscheidungsseite). Stand nach den Klicks des
Users; „prüfen“ heißt erst messen oder besprechen.

- **Fällt weg:** Mindestwelle je Vorlage, Rückfälle auf Boss-Wellen, Abklingzeit und Wiederholungsverbot, Herbert
  genau einmal, Welle 20/30 tauschen Herbert, Boss-Rotation, Variante ersetzt geplante Welle, Wurm zählt mit voller
  Länge, Golem-Vorlagen mit 600 ms, Endgame-HP, ungültige Vorlage, Anti-Windup nach Varianten, Vorlagenwahl nach
  Reglerzustand.
- **Geht im Prinzip auf:** Kampagne legt die Vorlage fest (wird der Plan), Boss-Takt (Plan-Zeilen), Vorschau (kennt
  jede Welle), Kampagnen-Intensität (wird die gedachte Stärke je Zeile).
- **Prüfen:** Schwierigkeitsrampe bis W60, Kill-Realismus mit Sprung bei W10, Leckschaden-Sprung bei W31/W61,
  Luft und Geister nur mit Abwehr (entschieden: Plan hat Vorrang), DPS-Rampe, Band des Reglers (entschieden: halb bis
  doppelt), Höchstdauer 180 s, Tausch weniger Gegner mehr HP, Ausreißer gedeckelt.
- **Bleibt:** Spannungskurve des Reglers, Planung am Ende der Vorwelle, Luft gegen eigenen Schaden, Untergrenze beim
  Boden-Matchup, Splitter mit ganzem Baum, Leckkosten je Typ, Spawn-Mindestabstand je Typ, Coop je Spur, mindestens
  5 Gegner, immer 1 HP Leck, Deckel durch Dauer begrenzt, Deckel unter dem Vorlagen-Minimum, Aufwärmen, geschummelte
  Wellen, Anti-Windup, Neustart je Lauf.

Stand nach dem Entfernen des adaptiven Directors (2026-09-29):
- **Weg** (mit dem Code): alle 13 aus „Fällt weg“ außer dem Wurm mit voller Länge; die 4 aus „Geht im Prinzip
  auf“ (jetzt Laufplan und Stärke je Zeile); aus „Prüfen“ Schwierigkeitsrampe, Kill-Realismus mit Sprung (das
  Budget rechnet mit einem Wert, `BUDGET_REALISM`), Luft und Geister nur mit Abwehr, DPS-Rampe, Tausch weniger
  Gegner mehr HP; aus „Bleibt“ die Untergrenze beim Boden-Matchup (das Budget liest die reine Matrix),
  mindestens 5 Gegner und der Deckel unter dem Vorlagen-Minimum (beides Teil des alten Deckels).
- **Bleibt** im Budget-Source oder geteilt: Wurm mit voller Länge (`enemyHp`), Band des Reglers (halb bis
  doppelt), Ausreißer gedeckelt, Spannungskurve, Planung am Ende der Vorwelle, Luft gegen eigenen Schaden,
  Splitter mit ganzem Baum, Leckkosten je Typ, Spawn-Mindestabstand je Typ, Coop je Spur, immer 1 HP Leck,
  Deckel durch die Dauer der Welle, Aufwärmen, geschummelte Wellen, Anti-Windup, Neustart je Lauf.
- **Nur noch im Tabellen-Source:** der Leckschaden-Sprung bei W31/W61 (dort unverändert) und die Höchstdauer
  von 180 s als Prüfung der Zeilen; das Budget kennt beide nicht mehr.

## 8. Nachgerechnet: was eine Welle heute kostet

Referenzlauf W1 bis W60 gegen seine künstliche Abwehr (Schaden `120 + 90 · (W − 1)`, Rüstung abgestuft), je Welle die
Sekunden Abwehr-Schaden für alle HP (Skript `tmp/nightly-2026-09-28/budget-probe.tmp.spec.ts`, nicht im Repo):
- Innerhalb von zehn Wellen kostet die teuerste normale Welle das 3- bis 55-Fache der billigsten (W2 0,6 s, W18 262 s).
- Bosse sind nie die Spitzen: W20 Ooze 39 s gegen W18 262 s, W35 Skarnax 50 s gegen W32 309 s.
- Gleitender Median: rund 14 s bei W1, 55 bis 62 s von W11 bis W30, rund 100 s bei W60.
- Grenzen: künstliche Abwehr, Luft so stark wie Boden, Lecks und Laufzeit nicht drin; ein Teil der Spreizung ist
  gewollt (Konter).

## 9. Budget-Modell (Entwurf, noch nicht gebaut)

Für jede Welle N dieselben Schritte:

1. **Plan-Zeile:** Vorlage (Gegnermischung), Anzahl je Gegnertyp, Stärke k (1 normal, 0,5 Atempause, 1,5 fordernd),
   Gold. Ein Boss ist eine Zeile mit einem Boss und optional Begleitern.
2. **Budget** in Sekunden Abwehr-Schaden: `B = S(N) · k · R`.
   - `S(N)` eine stetige Kurve, Start beim heutigen Median, etwa `15 + 85 · (1 − e^(−(N−1)/15))` Sekunden.
   - `R` der Druck-Regler, zwischen 0,5 und 2, aus dem HP-Verlust der letzten Wellen gegen die Spannungskurve.
3. **Abwehr messen:** Schaden je Sekunde gegen jede Rüstung, Boden und Luft getrennt (wie heute).
4. **HP verteilen:** ein gemeinsamer HP-Faktor für die ganze Welle, so dass alle Gegner zusammen `B` Sekunden kosten:
   `hpMult = B / Σ (Anzahl_t · HP_t / Schaden gegen t)`.
5. **Grenze:** der Deckel begrenzt `B` auf das, was die Abwehr in der Laufzeit der Welle plus erlaubtem Leck schafft.
6. **Physik:** Spawn-Abstände je Gegnertyp (Idee des Users: auch aus der Plan-Zeile, zum Beispiel 30 bis 100 ms für
   einen Zombie-Schwarm), dann ausliefern; die Vorschau kennt jede Welle.

Damit fallen weg: Endgame-HP, Schwierigkeitsrampe, DPS-Rampe (geht in `S` und `R` auf), Kampagnen-Intensität (wird
`k`), alle Boss-Sonderwege.

Entschieden (User, 2026-09-28):
- **Leckschaden** wächst stetig mit der Budget-Kurve, ohne Sprünge; wie stark, per Bot-Messung.
- **Spawn-Abstände:** Standard je Gegnertyp, eine Plan-Zeile darf ihn für ihre Welle überschreiben; der Deckel
  rechnet mit dem echten Abstand.
- **Höchstdauer 180 s fällt weg.** Eine Welle dauert, was Anzahl mal Abstand ergibt; der Deckel rechnet mit der
  echten Dauer, die Plan-Zeile ist dafür verantwortlich.
- **Coop:** jede Spur bekommt die ganze Zeile, mit eigenem Budget gegen die Abwehr an dieser Spur.
- **Nachrechnen jetzt,** vor dem Bau: den Referenzlauf mit dem Modell durchspielen und gegen heute zeigen.

## 10. Durchgerechnet: Budget-Modell gegen heute (Rechenwerte, keine Bot-Messung)

Referenzlauf W1 bis W60 mit Anzahl und Spawn-Abständen der heutigen Folge, `k = 1` (W24 bis W27 mit der heutigen
Intensität), `R = 1`, Deckel = Spawn-Dauer plus Zeit unter Feuer ohne erlaubtes Leck (Skript
`tmp/nightly-2026-09-28/budget-sim.tmp.spec.ts`, nicht im Repo):
- Normale Wellen liegen enger: innerhalb von zehn Wellen das 1,2- bis 4,2-Fache statt heute 3- bis 55-Fache.
- Der Deckel greift auf 34 von 60 Wellen, darunter alle neun Boss-Wellen: die heutigen Anzahlen und Abstände sind
  für die Kurve oft zu kurz.
- Einzelne Bosse bekommen nur die geschätzte Zeit unter Feuer (60 m durch Tempo), 13 bis 20 s gegen 90 s der
  Nachbarn. Das liegt an der Schätzung, nicht an einer Boss-Regel.
- Der HP-Faktor streut von 0,3 bis 63; Rattenwellen mit 1200 Ratten bekommen 55 bis 63 (heute 19 bis 25).

Entschieden (User, 2026-09-28):
- **Welle zu kurz für ihr Budget:** Plan-Zeilen werden passend gemacht (Anzahl und Abstände), das Skript prüft jede
  Zeile; der Deckel lässt wie heute einen bezahlten Teil als HP-Verlust durch und fängt sonst nur Fehler im Plan.
- **Zeit unter Feuer** wird aus der Route gemessen: Meter des Wegs in Reichweite der Tower durch das Tempo des
  Gegners, gleich für alle Wellen.

## 11. Entwurf des Laufplans W1 bis W60 (Rechenwerte)

Skript `tmp/nightly-2026-09-28/plan-draft.tmp.spec.ts` (nicht im Repo), gleiche künstliche Abwehr. Festlegungen des
Entwurfs, alle änderbar:
- Reihenfolge wie die heutige Testfolge; ein Boss alle zehn Wellen, ohne Wechsel bei W30 (Herbert, Ooze, Skarnax,
  Steingolem, Drachenflug, Skarnax); W35, W45, W55 werden normale Wellen.
- Stärke `k` 1, Boss-Zeilen 1,3, die Welle nach einem Boss 0,7; die Intensität W24 bis W27 entfällt.
- Abstände: Schwärme 100 ms, Golems doppelt so weit wie heute, sonst wie heute. Anzahl so, dass die Welle lange
  genug auf dem Weg ist, um ihr Budget abzuarbeiten.
- Zeit unter Feuer bis zur Messung aus der Route: 150 m durch das Tempo; Kill-Realismus einheitlich 0,9.
- Neu, für jeden Gegner in jeder Welle: kein Gegner bekommt mehr HP, als die Abwehr in seiner Zeit unter Feuer
  schafft (90 %). Wer daran stößt, bleibt dort, der Rest des Budgets geht an mehr Gegner der Zeile. Das ersetzt die
  Boss-Sonderwege.

Ergebnis: alle 60 Zeilen passen zu ihrem Budget. Schwärme werden größer und dichter, schwere Vorlagen kleiner und
zäher (W16 Chaos Wave 89 statt 267 Gegner, W15 Golem Squad 6 statt 33). Bosse tragen 21 bis 44 % des Budgets, den
Rest ihr Gefolge; Skarnax selbst bleibt bei HP-Faktor 0,5 bis 1,1. Ratten bekommen HP-Faktor 74 bis 84, weil die
Rechnung Schaden kennt, aber nicht die Schusszahl; das prüft erst die Bot-Messung.

**Nach W60** (User, 2026-09-29): Die Kurve steigt weiter, `S(N) = Basis(N) + 10 · ((N − 1) / 60)²` (`budgetSeconds`,
+9,7 s bei W60, +27 s bei W100, +61 s bei W150); das Leck folgt nur der sättigenden Basis und bleibt bei rund 2,2. Die
Zeilen 31 bis 60 wiederholen sich (`RUN_PLAN_REPEAT` = 30, alle drei späten Bosse). Eine wiederholte Zeile bringt ihre
Anzahl mal `S(N) / S(Zeilenwelle)` (`planEnemies`, innerhalb des Plans 1), der Wurm bleibt einer. Über
`MAX_BODIES_PER_LANE` = 2500 Körper je Spur (Teilungen mitgezählt, die größte Plan-Zeile W48 hat 2460) schrumpft die
Anzahl zurück, die HP tragen den Rest. Gemessen (2026-09-29, Prod-Build, DevWorld, ein Rechner mit RTX 5080): die Grenze
greift ab den Skelett-Zeilen ab W78 und bei Einzelkörpern ab etwa W254; gleichzeitig leben höchstens rund 700 je
Spur, weil der Spawnabstand fest ist (mehr Körper machen die Welle länger, nicht dichter). Vier Spuren bei Tempo 4:
Bild 12 bis 14 ms im Median, p95 bis 20 ms, gleich schwer wie W48 aus dem Plan; solo unter 8 ms.

## 12. Trennung der Wellenquelle geprüft (2026-09-28)

Umgeschaltet wird an einer Stelle (`DEFAULT_WAVE_SOURCE` in `configs/director.config.ts`, dazu das Debug-Fenster),
jede Quelle hat ihren Ordner unter `director/sources/`. Außerhalb der Quellen lesen aber noch Stellen Regeln einer
bestimmten Quelle direkt nach der Wellennummer; bei einem Tausch liefen sie weiter nach der alten Logik:

| Stelle | liest direkt | gehört in |
|--------|--------------|-----------|
| `managers/enemy.manager.ts`, `managers/ooze-bodies.ts` | Leckschaden je Welle (`enemyBaseDamageForWave`) | geplante Welle |
| `managers/game-state/wave-preview.ts`, `wave-panel/upcoming-waves.ts` | Leckschaden je Welle | Vorschau der Quelle |
| `managers/enemy.manager.ts`, `services/economy.service.ts` | Gold je Welle (`waveGold`) | geplante Welle |
| `game-engine/background-music.service.ts` | Boss-Welle (`isBossWave`) | geplante Welle |
| `wave-panel/wave-alert.ts` | Luftwarnung aus der Kampagnen-Vorlage | Vorschau der Quelle (Luft und ätherisch) |
| `director/state-snapshot-parts.ts` | kommende Gegner aus der Kampagnen-Vorlage | Vorschau der Quelle |
| `bots/strategies/research/research-pick.strategy.ts` | kommende Luftwelle aus der Kampagne | Vorschau der Quelle |
| `debug-window/wave-debugger.component.ts` | Name der Sprungwelle aus Kampagne und Boss-Varianten | Vorschau der Quelle |
| `run-log/config-hash.ts` | Kampagne, Vorlagen, Boss-Varianten im Hash | Hash der aktiven Quelle |
| `bots/bot-session.ts`, `run-log/run-log.facade.ts` | Stellschrauben des adaptiven Directors | nur, wenn die Quelle welche hat |

Sauber geteilt sind `director/defense-analyzer.ts` (Abwehr messen, von allen genutzt) und der Vertrag selbst.

Geschlossen am 2026-09-28 (WAVE_SOURCE_PLAN.md, Abschnitt 17): die Stellen lesen jetzt `waveRules()` der aktiven
Quelle. Bleiben bewusst geteilt: der Konfigurations-Hash und die Stellschrauben des adaptiven Directors.

## 13. Stand des Baus (2026-09-28)

- Regeln je Welle über den Vertrag (Abschnitt 12), gebaut.
- Druck-Regler geteilt (`director/pressure-controller.ts`), Spielraum je Quelle; Budget-Quelle halb bis doppelt.
- Zeit unter Feuer aus der Route: `metersUnderFire` im Schnappschuss, gemessen mit der Sichtlinie der Tower,
  Boden und Luft getrennt, gemittelt über die Spuren.
- `sources/budget/`: `run-plan.json` (der Entwurf aus Abschnitt 11), `budget.ts` (die Schritte aus Abschnitt 9 mit
  Grenze je Gegner), `budget-source.ts`. Leckschaden wächst stetig mit der Kurve (`LEAK_GROWTH`). Gold: ruhige Kurve mal
  Stärke der Zeile (`planBaseGold`, die Kampagnentabelle ohne die Spitzen W10/W20/W30, danach ihre Verjüngung;
  ein Boss 1,3 zahlt 1,3-fach, kein Boss-×2).
- 2026-09-29: Standard (`DEFAULT_WAVE_SOURCE = 'budget'`), der adaptive Source mit Templates, Kampagnen-Pins,
  Boss-Rotation und Endgame-HP entfernt; `table` bleibt, `?waves=table` schaltet einen Tab um.

## 14. Kalibrierung mit Bots (Nacht 2026-09-28/29, Bot-Werte)

Solo-Läufe in der DevWorld, Tempo 16, je Stand 3 bis 6 Läufe, verglichen mit 12 Läufen des adaptiven Directors
(Todeswelle 25 bis 42, HP nach W10/W20/W30: 353/277/223). Was sich dabei an der Rechnung geändert hat, jeweils für jeden
Gegner in jeder Welle:

| Befund der Bots | Änderung |
|---|---|
| Frühe Wellen kosteten 40 bis 60 HP, obwohl die HP schon bei 0,3 bis 0,9 lagen | Anzahl W2 bis W30 aus dem, was Bots unter dem adaptiven Director schaffen; Treffer-Anteil 0,6; Regler ab Welle 2 |
| Die Ooze kostete mit einem Durchbruch 91 HP | Ooze und Skarnax ohne Begleiter; wessen eines Leck mehr kostet als die Welle darf, bekommt ein Viertel des Schadens unter Feuer |
| 62 Mammuts mit HP-Faktor 4 bis 7 kosteten 133 bis 184 HP | Rechnung gegen die reine Schadenstabelle statt der Werte mit Mindestanteil gegen Festung |
| Zeit unter Feuer war die Vereinigung aller Strecken mal dem ganzen Schaden (Review) | Grenze je Gegner aus Schaden mal Strecke je Tower; das Zeitfenster der Welle aus der Vereinigung |
| Skarnax rechnete als ein Gegner mit 240 Segmenten, 0 HP Verlust in 17 Läufen | Jedes Segment ist ein Körper, das Zeitfenster enthält das Herauskommen der Kette |
| Dichte schnelle Schwärme leckten bei niedrigen HP | Versucht: Körper zugleich in Reichweite teilen sich das Feuer. Zurückgenommen, damit hing fast jeder Gegner an seiner Grenze, der Regler kam nicht mehr an, die Bots hatten bei W40 noch 456 HP |
| Welle 1 kostete im Coop 58 HP (geplant, bevor ein Tower steht) | Zeile 1 leichter; was die Abwehr nicht treffen kann, bekommt die Stärke der Zeile als HP-Faktor |

| Regler am Anschlag (doppelt) ab W23, dann kosteten die schlechtesten Paarungen 60 bis 210 HP | Regler halb bis 1,5 statt halb bis doppelt |
| Geister (W24, W35), Mammuts (W25), Spinnenschwarm (W6) blieben die teuersten Wellen, im Coop je Spur doppelt | Stärke dieser Zeilen 0,8; Welle 1 mit zehn Zombies |

Endstand mit dem neuen Bot (je 6 Solo-Läufe, Bot-Werte):

| | Todeswelle | HP nach W10/W20/W30 |
|---|---|---|
| Adaptiver Director | 30 bis 36 | 436/325/225 |
| Budget-Quelle | 37 bis 40 | 405/321/235 |

Coop zu zweit (Chromium gegen Firefox, 3 Räume je Stand): keine Abweichung zwischen den Browsern; Todeswelle vor der
letzten Anpassung 23, 34 und 35, der adaptive Director (alter Bot) 27 bis 41. Die Budget-Quelle ist damit bei den Bots
mindestens gleichauf; wie sie sich gegen einen Menschen anfühlt, zeigen erst dessen Läufe.

Der Bot baut seit 2026-09-28 erst aus, dann rüstet er auf (vier Tower und einer mehr je Welle, Obergrenze 20):
vorher standen bis W10 nur 3 bis 4 Tower.

## 15. Nächster Schritt

Spielen und messen: menschliche Läufe und Bot-Läufe mit dem Budget-Source als Standard, dann Laufplan,
`BUDGET_REALISM` und `LEAK_GROWTH` justieren.

## 16. Vielfalt, Gold, Forschung, Mutatoren (2026-10-02)

Anlass: ein menschlicher Solo-Lauf bis W60 (TODO E95), Urteil „zu leicht und monoton, alles zu früh erforscht“.
Befunde aus dem Run-Log: alle 21 Forschungen in W26 fertig für 19.670 Gold, 1,3 % des Einkommens; Bank W23 bis
W34 meist 46.000 bis 147.000; ab W45 rund 6.000 Gold je Welle, eine Upgrade-Stufe über L20 kostet 4.337 bis
10.588, die Lücken bei W52 (Wraiths, -108 HP) und W58 (Luft, -218 HP) ließen sich nicht mehr schließen. Im Plan
19 Vorlagen für 54 Zeilen, 26 Zeilen mit nur einem Gegnertyp, nur `interleaved` und `clustered`. Die Werte unten
sind Rechenwerte (Plan-Gold ohne Skill-Boni, ein Modell der Tower), keine Bot- oder Spielmessung.

### 16.1 Laufplan

Neu sind W17, W21 bis W29 und W31 bis W59 außer den Boss-Zeilen; W1 bis W16 bleiben, wie die Bots sie
kalibriert haben (Streuung ±25 % auf den frühen Schwärmen, W16 `random`). Danach: 47 Namen für 54 Zeilen,
9 Zeilen mit einem Typ, jedes Spawn-Muster in Gebrauch, Stärke 1,5 bei W36, W44, W55, Atempausen 0,7 bis 0,9,
Mittel 0,98 wie vorher. Luft kommt in W26, W27, W35, W42, W44, W47, W54, W57 bis W59, ätherisch in W24, W29,
W32, W35, W37, W45, W49, W52, W53, W57, W59. Die Anzahlen folgen den alten Zeilen gleicher Typen und Phase,
so dass jede Zeile lang genug für ihr Budget bleibt (Zeilendauer nach W20 30 bis 100 s, Anzahl mal
`spawnDelay`).

| Welle | Name | Gegner | Stärke | Muster | Mutator |
|---|---|---|---:|---|---|
| W17 | Night Flight | 9 wraith, 24 bat | 1 | random, ±20 % |  |
| W21 | Dusk Flock | 260 bat, 120 penguin | 0,7 | random, ±30 % | Swarm |
| W22 | Armored Push | 40 tank, 30 zombie-soldier, 300 rat | 1 | front-loaded |  |
| W23 | Spider Nest | 380 spider, 40 wallsmasher | 1 | back-loaded, ±25 % |  |
| W24 | Phantom March | 120 zombie, 20 ghost, 8 wraith | 0,9 | interleaved |  |
| W25 | Siege Line | 30 mammoth, 6 stone-golem, 24 wallsmasher | 0,8 | clustered |  |
| W26 | Horde and Hornets | 420 zombie, 60 zombie-v2, 60 hornet | 1 | random, ±30 % |  |
| W27 | Dragon Patrol | 60 bat, 40 hornet, 10 dragon | 1 | wave-in-wave |  |
| W28 | Mech Army | 40 mech, 30 zombie-soldier | 1 | interleaved | Regeneration |
| W29 | Final Mix | 60 zombie, 40 tank, 40 hornet, 40 bear, 20 ghost | 1 | random, ±20 % |  |
| W31 | Penguin Breather | 300 penguin, 60 rat | 0,7 | interleaved, ±30 % |  |
| W32 | Armor Gauntlet | 27 rat, 27 tank, 27 mammoth, 27 ghost | 1 | sequential |  |
| W33 | Golem Guard | 12 stone-golem, 200 spider | 1 | front-loaded |  |
| W34 | Mammoth Stampede | 40 mammoth, 30 bear | 1 | clustered |  |
| W35 | Wraith Night | 150 wraith, 120 bat | 0,9 | interleaved, ±20 % | Bounty |
| W36 | Great Horde | 560 zombie, 80 zombie-v2, 60 zombie-soldier | 1,5 | random, ±35 % |  |
| W37 | Ghost Riders | 90 ghost, 40 bear | 1 | interleaved |  |
| W38 | Bone Tide | 600 skeleton, 150 spider | 1 | back-loaded, ±30 % |  |
| W39 | Plague and Iron | 20 mech, 700 rat | 1 | front-loaded |  |
| W41 | Bear Pack | 80 bear | 0,7 | - |  |
| W42 | Dragon Night | 80 bat, 60 hornet, 45 dragon | 1 | wave-in-wave | Swift |
| W43 | Wall Breakers | 110 wallsmasher, 30 tank | 1 | interleaved |  |
| W44 | Swarm Surge | 500 rat, 250 spider, 150 bat | 1,5 | wave-in-wave, ±30 % |  |
| W45 | Haunted Pack | 70 bear, 60 wraith, 30 ghost | 1 | random |  |
| W46 | Mech Column | 40 mech, 40 tank, 30 zombie-soldier | 1 | clustered |  |
| W47 | Hornet Raid | 150 hornet, 80 wallsmasher | 1 | interleaved, ±20 % |  |
| W48 | Skeleton Swarm | 820 skeleton | 0,8 | -, ±30 % |  |
| W49 | Ether Assault | 150 penguin, 120 wraith, 60 ghost | 1 | random | Swarm |
| W51 | Mammoth Siege | 25 mammoth, 10 wallsmasher | 0,7 | interleaved |  |
| W52 | Wraith Storm | 150 zombie, 150 wraith | 1 | interleaved |  |
| W53 | Fortress | 14 stone-golem, 30 mammoth, 30 ghost | 1 | clustered |  |
| W54 | Spider Swarm | 700 spider, 100 bat | 1 | random, ±30 % |  |
| W55 | Chaos Wave | 46 zombie, 46 tank, 30 hornet, 30 bear | 1,5 | random, ±20 % |  |
| W56 | Iron Night | 50 tank, 30 mech, 300 rat | 1 | front-loaded | Regeneration |
| W57 | Ghost Surge | 140 ghost, 40 wraith, 40 hornet | 1 | interleaved |  |
| W58 | Sky Siege | 80 bat, 160 hornet, 25 dragon | 1 | wave-in-wave |  |
| W59 | Last Stand | 200 rat, 31 tank, 31 mammoth, 32 ghost, 10 dragon | 1 | random |  |

Rollen: Panzer mit Schwarm dahinter (`front-loaded`: W22, W39, W56), Luft über Boden (W26, W47), ätherisch
in einer Horde (W24, W49, W52), Golems vor Spinnen (W33), Schübe mit drei Sekunden Pause (`wave-in-wave`: W27,
W42, W44, W58). `wave-in-wave` verlängert die Welle um die Pausen, das Budget rechnet ohne sie (der Deckel
greift also eher früher).

### 16.2 Mutatoren der Blutmond-Wellen

`WaveRules.mutator(wave)`, Werte in `configs/wave-mutators.config.ts`, beim Budget-Source eine feste Folge über
die Blutmond-Wellen (W14, W21, W28, …), ohne Zufall; der Tabellen-Source hat keine.

| Mutator | Wirkung | Budget | Wo |
|---|---|---:|---|
| Swift | Tempo jeder Gruppe ×1,25 | ×0,8 | `BudgetWaveSource.plan` (`speedMultiplier`) |
| Swarm | Anzahl ×1,5 | ×1 | `planEnemies` (Vorschau und Plan gleich) |
| Regeneration | 2 % der max. HP je Sekunde, nicht solange er brennt | ×0,85 | `EnemyManager.tickRegeneration` |
| Bounty | Kill-Gold ×2 | ×1 | `RUN_PLAN_RULES.gold` |

Folge: W14 Swift, W21 Swarm, W28 Regeneration, W35 Bounty, W42 Swift, W49 Swarm, W56 Regeneration, W63 Bounty.
Die Budget-Faktoren sollen eine Mutator-Welle etwa so teuer halten wie ihre Zeile; ob sie das tun, zeigt erst
eine Messung. Regeneration heilt auf der Spieluhr allein (kein Zustand je Gegner), wie die Eigenschaft Regen
(Mammoth, Slime Clump, [MASTER_GAME_DESIGN.md](game-design/MASTER_GAME_DESIGN.md) §2.5). Vorschau (Tag in der
Detailzeile, Tooltip) und Banner nennen den Mutator auch mit ausgeschaltetem Look.

### 16.3 Gold

W21 bis W30 ×1,1 je Welle statt ×1,2 (`CAMPAIGN`, W30 ohne Spitze), danach ×0,9 statt ×0,85 bis auf 30 % von
W30 statt 5 % (`GOLD_TAPER_PER_WAVE`, `GOLD_SUSTAIN_FRACTION`). Plan-Gold mal Stärke der Zeile; vorher mit dem
alten Plan, nachher mit dem neuen und Bounty:

| Welle | je Welle vorher | je Welle nachher | Summe vorher | Summe nachher |
|---|---:|---:|---:|---:|
| W5 | 650 | 650 | 2.250 | 2.250 |
| W10 | 1.829 | 1.829 | 7.439 | 7.439 |
| W15 | 4.500 | 4.500 | 22.199 | 22.199 |
| W20 | 20.930 | 20.039 | 76.629 | 75.738 |
| W23 | 31.050 | 24.000 | 148.749 | 135.348 |
| W25 | 35.880 | 23.160 | 214.509 | 182.268 |
| W28 | 77.400 | 38.550 | 410.109 | 287.868 |
| W30 | 144.846 | 60.704 | 647.805 | 391.021 |
| W32 | 80.501 | 37.823 | 794.601 | 458.262 |
| W35 | 39.550 | 41.359 | 960.739 | 564.299 |
| W38 | 30.361 | 20.101 | 1.068.840 | 643.957 |
| W40 | 28.516 | 21.166 | 1.123.163 | 683.214 |
| W42 | 15.849 | 14.009 | 1.152.064 | 707.479 |
| W45 | 9.733 | 14.009 | 1.186.719 | 756.509 |
| W48 | 5.977 | 11.207 | 1.208.001 | 795.733 |
| W50 | 7.242 | 18.211 | 1.220.814 | 827.953 |
| W55 | 5.571 | 21.013 | 1.246.998 | 900.797 |
| W60 | 7.242 | 18.211 | 1.276.524 | 975.042 |

Bis W20 bleibt alles gleich. W23 bis W34 wächst die Bank langsamer (Summe W30 391.000 statt 648.000), ab W42
bleiben 11.000 bis 21.000 je Welle statt 5.600 bis 16.000: eine Stufe über L20 oder ein neuer Tower bis L15
(rund 11.000 für zwei Tracks) je Welle. Das Budget misst die Abwehr, eine kleinere Bank macht die Wellen also
nicht leichter, sondern die Entscheidungen knapper.

### 16.4 Forschung

`minWave` je Forschung: sie öffnet in der Bauphase vor dieser Welle und lässt sich vorher weder starten noch
einreihen (Manager, Bot und Baum lesen dieselbe Regel, `researchWaitsForWave`). Kosten der gesperrten
Forschungen nach dem Einkommen der Welle, in der sie öffnen (nachher, Plan-Gold ohne Boni):

| Forschung | Kosten vorher | Kosten nachher | ab Welle | Einkommen dieser Welle (nachher) | Kosten in Wellen-Einkommen |
|---|---:|---:|---:|---:|---:|
| Advanced Weaponry (T2) | 800 | 2.000 | W7 | 800 | 2,5 |
| Master Engineering (T3) | 1.500 | 8.000 | W15 | 4.500 | 1,8 |
| Advanced Engineering (T4) | 2.500 | 30.000 | W25 | 23.160 | 1,3 |
| Transcendent Tech (T5) | 4.000 | 100.000 | W38 | 20.101 | 5,0 |
| Frost Bomb | 700 | 1.000 | W6 | 560 | 1,8 |
| EMP | 800 | 2.500 | W12 | 2.500 | 1,0 |
| Nuclear Strike | 1.000 | 4.000 | W12 | 2.500 | 1,6 |
| Chaos Rift | 1.000 | 8.000 | W20 | 20.039 | 0,4 |
| Orbital Laser | 1.500 | 12.000 | W22 | 21.750 | 0,6 |
| Fire Alchemy | 550 | 800 | W6 | 560 | 1,4 |
| Storm Mastery | 700 | 1.200 | W9 | 1.100 | 1,1 |

Der ganze Baum kostet 174.120 statt 19.670, rund ein Viertel des Plan-Golds bis W40, und ist frühestens in W38
komplett. Coop: jeder Spieler forscht für sich, die Welle ist für alle dieselbe.

### 16.5 Tower

Menschlicher Lauf bis W60, Schaden je Gold: Fire 17,3, Lightning 14,8, Kanone 11,9, Chaos 8,7, Magic 8,2,
Gatling 5,3, Archer 3,6, Poison 3,4, Rakete 2,8, Eis 2,5, Tentacle 0,9. Geändert: Archer 25 auf 30 Schaden und
Upgrades zu 0,6; Rakete 40 auf 60 und Upgrades zu 0,75 (bleibt nur Luft, E15); Tentacle 30 auf 45 und ein
Schlag trifft bis 4 Nachbarn in 5 m mit 50 %; Fire 35 auf 30 DPS; Lightning 35 auf 32.

Modell (Skript außerhalb des Repos): Schaden je 1000 Gold bei L15 auf Damage und Rate, Range L10, Matrix
gegen den HP-Mix jeder Zeile des neuen Plans, gewichtet mit ihrer Stärke, Mehrfachtreffer in Schwarm-Zeilen
(Abstand bis 250 ms) geschätzt (Kanone 3,5, Rakete 2,5, Fire 4, Lightning 2,19, Tentacle-Schlag 2,5).
Reichweite und Platzierung kennt es nicht, deshalb liegt der Tentacle (25 m) dort zu hoch:

| Tower | vorher | nachher |
|---|---:|---:|
| Archer | 4,8 | 8,8 |
| Gatling mit AA | 13,4 | 13,4 |
| Kanone | 10,8 | 10,8 |
| Magic | 17,6 | 17,6 |
| Rakete (nur der Luft-Anteil zählt) | 1,2 | 2,3 |
| Fire | 16,3 | 13,9 |
| Tentacle | 8,0 | 20,7 |
| Lightning | 13,2 | 12,1 |
| Chaos | 17,5 | 17,5 |

### 16.6 Gegner-Eigenschaften

Regen (`regenPerSecond`: Mammoth 1 %, Slime Clump 2 % je Sekunde, nicht solange er brennt) und Phasing
(`immuneToSlow`: Wraith). Beide ohne Zustand je Gegner. Shielded, Camo und Aura sind nicht gebaut.

### 16.7 Offen

Nichts davon ist mit Bots oder im Spiel gemessen. Zu prüfen: ob die Mutator-Wellen mit ihren Budget-Faktoren
etwa so viel kosten wie ihre Zeile, ob die Stärke-1,5-Zeilen (W36, W44, W55) den Regler an den Anschlag
treiben, ob Regen am Mammoth die Zeilen W14, W25, W34, W51 zu teuer macht, und wie sich die Forschungssperre
und das knappere Gold W21 bis W34 anfühlen.

## 17. Regler, Deckel, Bosse, Elite (2026-10-02)

Anlass: der menschliche Solo-Lauf bis W60 (TODO E95), Urteil „zu leicht“, „Herbert W10 zu schwach, Ooze W20 zu
schwach, ab W30 keine Bosse“. Aus Run-Log und Replay: der Regler stand von W11 bis W60 am Anschlag 1,5, 37 Wellen
kosteten nichts, dann W52 −108, W58 −218, Tod in W60. Herbert kam mit HP-Faktor 0,1 (400 HP neben Panzern mit
719), die Ooze mit 0,12 und starb nach einem Fünftel der Route, ein Skarnax-Segment kostete im HQ 0,46 HP,
W40 und W50 hießen Boss-Wellen und hatten keinen Boss.

### Rechenwerkzeug

`tools/balance-calc` (README dort) spielt den echten Budget-Source Welle für Welle gegen die Abwehr dieses Laufs
(Tower und Upgrades zur Planung und zum Start, aus dem Replay): Laufplan, Budget, Regler sind der Code des Spiels.
Geschätzt sind die Meter unter Feuer (aus dem geloggten Fenster zurückgelesen) und das Leck: die Abwehr arbeitet
die HP der Welle mit einem Anteil `u` ihres Matrix-Schadens ab, solange die Welle unter Feuer ist, der Rest kommt
durch. `u` ist am Lauf kalibriert (Boden 0,65, Luft 0,58, ätherisch 0,55; W5 bis W7 übernimmt es wie gelaufen);
mit dem alten Planer zeichnet die Schätzung die Summe der Verluste nach, nicht jede Welle. Ein schwächerer und ein
stärkerer Spieler sind `u` mal 0,7 und 1,3 (geschätzte Spanne, nicht gemessen).

### Was sich geändert hat

Stand nach dem Rebase auf den Laufplan, die Mutatoren und die Tower-Werte von Abschnitt 16, dort nachgestellt.

| Hebel | vorher | jetzt | Wo |
|---|---|---|---|
| Bemessung | HP am Ende der Vorwelle, vor den Käufen der Pause | Gegner, Anzahl, Abstände am Ende der Vorwelle fest, HP beim Start neu gegen die Abwehr | `WaveSource.sizeAtStart` |
| Deckel | Fenster der Welle mal `BUDGET_REALISM` 0,6, dazu erlaubte Lecks als Anteil des Budgets | Fenster mal `min(R, 1,5)` mal 0,55; erlaubte Lecks als Anteil der Zeit, höchstens die Hälfte der Körper | `CAP_FOLLOWS_REGULATOR`, `CAP_REGULATOR_MAX`, `BUDGET_REALISM`, `MAX_ALLOWED_LEAK_SHARE` |
| Regler | 0,5 bis 1,5, öffnet bis ×1,42 je Welle | 0,5 bis 2,5, öffnet höchstens ×1,105 je Welle, schließt wie bisher | `BUDGET_REGULATOR_LIMITS`, `PRESSURE_MAX_OPEN_STEP` |
| Leck einer Welle | ein Schwarm trug 2000 bis 3500 HP Leck gegen ein HQ von 350 | alle Körper außer Bossen zusammen höchstens 40 mal die Leckskala, ein voller Schwarm teilt das auf | `WAVE_LEAK_POTENTIAL`, `waveLeakScale(wave, type)` |
| Regeneration | vom Budget nicht gesehen | ein heilender Körper kostet, was er in einem Viertel seiner Zeit auf der Route heilt (Regen-Eigenschaft, Regeneration-Mutator) | `REGEN_TIME_SHARE` |
| Sicherheitsanteil | 0,25, sobald ein Leck mehr kostet als die Welle darf (wenige HP) | 0,5, erst wenn ein Leck mehr als 15 % des HQ kostet | `SURE_KILL_SHARE`, `SURE_KILL_HQ_SHARE` |
| Boss-Untergrenze | keine | mindestens 3× der zäheste Begleiter, so zäh wie dessen Elite, 0,25 der Basis; die Wut zahlt das Budget mit | `BOSS_OVER_ESCORT`, `BOSS_OVER_ELITE`, `BOSS_MIN_HP_MULT`, `rageFactor` |
| Skarnax | Leck 50 auf 240 Segmente | Leck 150 (`leakDamage`), spät rund 1,4 HP je Segment | `enemy-types.config.ts` |
| Boss-Zeilen | W20 Ooze allein, W40 Golems, W50 Drachen | W20 Ooze mit 100 Schleimklumpen im Abstand von 450 ms, W40 Golem King, W50 Dragon Matriarch | `run-plan.json`, `renderAs` |
| Boss-Mechanik | keine | Wut: Herbert unter 50 % (×1,35 Tempo, 75 % Schaden), Golem King unter 40 %, Dragon Matriarch unter 50 %; die Ooze zerfällt in Klumpen mit drei Zehnteln ihrer HP | `traits.rage`, `splitOnDeath` |
| Elite | keine | rund jeder zwanzigste einer Art ab zehn, 4,5-fache HP bis zur Grenze der Art, im selben Budget; gold und ein Viertel größer | `ELITE_SHARE`, `ELITE_HP_FACTOR` |
| Zeilen | W17 Night Flight Stärke 1, W44 Swarm Surge 1,5 | 0,85 und 1,3: die beiden teuersten Zeilen für jeden Spieler | `run-plan.json` |

### Zahlen (Rechenwerkzeug, keine Messung)

HQ nach W10 / 20 / 30 / 40 / 50 / 60, Sollkurve des Reglers 405 / 313 / 230 / 162 / 108 / 69. „vorher“ ist `next`
vor dem Nachtlauf, „nur Inhalt“ Abschnitt 16 ohne diesen, „jetzt“ beides:

| Abwehr | vorher | nur Inhalt | jetzt |
|---|---|---|---|
| Lauf, aufgezeichnet | 363 / 357 / 356 / 356 / 330 / 0 | | |
| Mensch ×1 | 363 / 348 / 315 / 315 / 224 / 21 | 363 / 351 / 311 / 299 / 237, Tod in W56 | 363 / 331 / 247 / 166 / 97 / 58 |
| Mensch ×0,7 | 337 / 265, Tod in W23 | 337 / 251, Tod in W23 | 363 / 262 / 174 / 125 / 29, Tod in W55 |
| Mensch ×1,3 | 363 / 362 / 354 / 354 / 354 / 354 | 363 / 362 / 362 / 362 / 362 / 134 | 363 / 351 / 318 / 263 / 203 / 139 |

Wellen ohne Verlust ab W8 (von 53): Mensch ×1 vorher 45, jetzt 35; ×1,3 vorher 51, jetzt 30. Mit `u` ±10 % und
einem Tower-Anteil der Meter von 0,15 oder 0,3 bleibt das Bild: Mensch ×1 lebt in W60 mit 54 bis 66 HP, ×0,7
stirbt in W55 oder lebt in W60 (3 von 5), ×1,3 verliert regelmäßig und hat in W60 87 bis 273. Vorher stirbt ×0,7
in jeder Variante in W23, und ×1,3 verliert nach W10 fast nichts.

Bosse, Mensch ×1, HP eines Bosses beim Start:

| Welle | vorher | jetzt |
|---|---|---|
| W10 Herbert | 440 | 3532 (dazu die Wut ab 50 %) |
| W20 Ooze (mit ihrem Zerfall) | 7920 | 19500, dazu 100 Klumpen als Begleiter |
| W30 Skarnax | 201.000 auf 241 Segmente | 273.000, Leck 1,3 statt 0,42 je Segment |
| W40 | 21 Golems, kein Boss | Golem King 24.922 |
| W50 | 40 Drachen, kein Boss | Dragon Matriarch 31.442 |

Grenzen: eine Abwehr, ein Ort, das Leck ist eine Schätzung mit scharfer Kante (eine Welle kostet nichts oder
merklich), der Held fehlt, Fähigkeiten fehlen; die Wirkung der Mutatoren außer Tempo und Heilung kennt es nicht.
Gegen Bots und Menschen gemessen ist nichts davon.

## 18. Camo (2026-10-03, nicht nachgerechnet)

Eine Zeile darf `camo` tragen: Anteil je Art, 1 für alle (mindestens einer, wo der Anteil über 0 liegt). Gesetzt ab
W22 (Scouting öffnet ab W16): W22 ein Zehntel der Ratten, W26 alle Zombie v2, W33 ein Viertel der Spinnen, W36 alle
Zombie-Soldaten, W41 ein Viertel der Bären, W46 die Hälfte der Panzer, W52 die Hälfte der Zombies, W56 die ganze
Welle. Getarnte kommen mit 0,75 der HP (`CAMO_HP_FACTOR`); das Budget rechnet sonst nicht mit ihnen. Ohne Späher
laufen sie bis auf Flächenschaden durch. Bots kennen Pfade noch nicht.
