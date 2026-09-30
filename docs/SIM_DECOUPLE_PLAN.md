# Plan: Simulation läuft frei, die Darstellung liest nur

Stand 2026-09-30, Branch `perf/decouple` (von `simu-worker`). Schritte 1 bis 3 gebaut, 4 bis 6 offen. Offene Arbeit
steht in [TODO.md](../TODO.md) (E85); Architektur in [SIM_WORKER.md](SIM_WORKER.md).

## Ziel

Simulation und Darstellung sind **ganz entkoppelt** (Entscheidung User, 2026-09-30):

- Der Worker loopt mit eigener Uhr und rechnet so viele Sub-Steps, wie Tempo und Wanduhr verlangen. Er wartet auf
  kein Bild und auf keinen Auftrag des Hauptthreads.
- Der Hauptthread nimmt je Bild den **neuesten fertigen Stand** und die Events, die seit dem letzten Bild kamen. Er
  schickt nur Eingaben (Befehle, Tempo, Pause) und Aufrufe (Replay, Snapshot).
- FPS hängen nur noch an Zeichnen und Einräumen eines Stands je Bild, das Tempo nur noch am Worker.

## Vor dem Umbau (gemessen und im Code nachgesehen)

- Der Hauptthread schickt je Bild einen Tick (`SimClient.frame` → `sendTick`); immer nur einer ist unterwegs. Der
  Worker rechnet die Wanduhr seit dem letzten Tick nach, höchstens 50 ms (`GameClock.MAX_CATCHUP_MS`), und schickt ein
  Paket zurück. Dauert ein Tick über 35 ms, geht der nächste sofort los (früher Tick, zwei Tabellensätze).
- Jedes Paket wird ganz eingeräumt: Stand, Renderer-Ops, Events, Präsentation (`SimClient.apply`). Es liegt praktisch
  nie mehr als eins je Bild an (Chromium, 16 000 Gegner: 27 Pakete je Sekunde bei 135 FPS).
- Folgen: Der Worker steht nach jedem Paket bis zum nächsten Bild (rund 30 % Leerlauf im Profil bei 16 000 Gegnern).
  Sinken die FPS, bekommt er seltener Arbeit, und ab 50 ms je Bild wird das Spiel zur Zeitlupe. Umgekehrt kostet jedes
  Paket den Hauptthread 6 ms (Chromium) bis 8 bis 15 ms (Firefox).

## Entwurf

### 1. Der Loop im Worker

- Eigene Uhr: `performance.now()` im Worker. Soll-Spielzeit = Summe aus Wanduhr × Tempo seit dem letzten Stand,
  Pause hält sie an. Gerechnet wird in festen Sub-Steps (`FIXED_STEP_MS`), das Ergebnis bleibt bitgleich wie heute.
- Ein Durchgang rechnet die fälligen Sub-Steps, höchstens ein Budget an Wanduhr (Startwert 8 ms), veröffentlicht den
  Stand und gibt den Thread frei (Selbst-Nachricht über einen `MessageChannel`, nicht `setTimeout`, das Browser
  drosseln). So kommen Befehle und Aufrufe zwischen zwei Durchgängen an.
- Ohne fällige Arbeit schläft der Loop bis zum nächsten fälligen Sub-Step.
- Kommt der Worker nicht nach, fällt die Spielzeit zurück wie heute; eine Obergrenze des Rückstands (Startwert
  250 ms) verhindert, dass er nach einer Pause des Tabs minutenlang nachholt.
- **Gebaut (Schritt 3):** `SimLoop` (`sim/worker/sim-loop.ts`) treibt den `SimCore` über `pass(now, deadline)` und
  `idleMs()`: ein Durchgang mit `PASS_BUDGET_MS` (8 ms) als Frist, dann das Paket, dann entweder sofort weiter
  (Selbst-Nachricht über einen `MessageChannel`), ein `setTimeout` bis zum nächsten fälligen Sub-Step, oder Schlaf bis
  zur nächsten Nachricht (Pause, keine Welt, Coop-Barriere, angehaltenes Replay). Jede Nachricht weckt ihn. Ein
  Durchgang ohne Sub-Step und ohne Änderung veröffentlicht nichts. Die `GameClock` hält den Rückstand auf
  `MAX_BACKLOG_MS` (250 ms) mal Tempo; die 50-ms-Klammer je Tick, `MAX_REMAINDER_MS` und die 600 Sub-Steps je Bild
  sind weg. `GameStateManager.update` und `SimReplay.play` nehmen die Frist und beginnen danach keinen Sub-Step mehr
  (mindestens einer läuft). Die Uhr des Workers ist sein eigenes `performance.now()`.
- **Veröffentlichen auf Abruf (Nachbesserung Schritt 3):** Der Worker rechnet frei, schreibt die Tabellen und schickt
  ein Paket aber nur, wenn der Hauptthread das letzte bekommen hat. Der Hauptthread setzt dazu am Anfang des Bilds,
  das es anwendet (der Worker schreibt das nächste derweil in einen anderen Satz),
  ein Feld im Kontrollwort (`TableViews.demand`; ein Durchgang sieht es nach seinem Sub-Step) und schickt eine kleine
  Nachricht `demand` (sie weckt einen Loop, der mit unveröffentlichten Sub-Steps schläft; ohne SAB der einzige Weg),
  der Worker nimmt den Abruf beim Veröffentlichen (`TableStore.takeDemand`). Ohne Abruf veröffentlicht er nur nach einer Eingabe, einer
  Einstellung oder einem Aufruf, bevor der Loop unbefristet schläft (Pause, Barriere), oder wenn das letzte Paket
  `MAX_PUBLISH_GAP_MS` (100 ms) alt ist. Was dazwischen lief, geht mit dem nächsten Paket: Events und Ops in
  Reihenfolge aus ihren Sammlern, Sub-Steps und Rechenzeit summiert. Grund (Messung Firefox, 25 000 Gegner): je
  Sub-Step zu veröffentlichen kostete den Worker das Schreiben der Tabellen je Sub-Step (Last 0,80 statt 0,55 bei
  Tempo 1) und den Hauptthread Bilder. Ein wartender Abruf beendet den Durchgang nach dem laufenden Sub-Step, das
  Paket geht also höchstens einen Sub-Step nach dem Abruf raus. Der Hauptthread ruft erst wieder ab, wenn ein Paket
  gekommen ist (sonst kämen zwei Pakete für ein Bild). Hängt der Worker hinterher (nach dem Durchgang sind noch
  Sub-Steps fällig), beantwortet er einen Abruf frühestens `MIN_PUBLISH_GAP_BEHIND_MS` (33 ms) nach dem letzten Paket:
  bei Überlast kostet jeder Stand Worker- und Hauptthread-Zeit, die dem Tempo fehlt (Messung Firefox, 16 000 und
  25 000 Gegner, Tempo 4). Kommt er mit, antwortet er auf jeden Abruf.
- Abweichung: `setTimeout` für das Warten auf den nächsten Sub-Step (nicht für „sofort“). Bei hohem Tempo drosseln
  Browser verschachtelte Timer auf 4 ms; dann laufen je Durchgang mehrere Sub-Steps, das Tempo bleibt.

### 2. Stände: drei Tabellensätze im SAB

- Heute zwei Sätze (`TableStore.begin`); künftig drei: einer wird geschrieben, einer ist der neueste fertige, einer
  liest der Hauptthread. Ein Kontrollwort im SAB hält per `Atomics` Folgenummer und Satz des neuesten Stands und den
  Satz, den der Hauptthread gerade liest. Der Worker schreibt nie in diese beiden.
- Der Hauptthread liest je Bild den neuesten Stand einmal: Spiegel und Präsentation (`applyState`, `present`) je Bild,
  nicht je Paket.
- Ohne Isolation (kein SAB, Inline-Transport): Kopie des Stands je Veröffentlichung per `postMessage`, der
  Hauptthread nimmt die neueste. Inline im Hauptthread (Specs) läuft der Loop synchron je Bild wie heute.

### 3. Events und Ops: ein geordneter Strom

- Events (Töne, VFX, Kills, UI) und Renderer-Ops müssen jedes genau einmal und in Reihenfolge ankommen, auch wenn der
  Hauptthread Stände überspringt. Sie gehen je Veröffentlichung als Nachricht mit Folgenummer; der Hauptthread spielt
  alle seit dem letzten Bild ab, in Reihenfolge, und dann den neuesten Stand.
- Events tragen heute die Zahlen ihres Moments (Event-Refs); das bleibt so, sie brauchen keinen Stand von damals.
- **Gebaut (Schritt 2):** Jede Veröffentlichung bleibt eine Nachricht (Stand und Strom zusammen, `frame` als
  Folgenummer). Der `SimClient` faltet alle seit dem letzten Bild angekommenen zu einem Paket (`merge-packets.ts`):
  Tabellen, Skalare und Helden vom neuesten, Ops und Events aller in Reihenfolge, Tower-Änderungen so, als hätte ein
  Tick sie alle gerechnet. Das ist dieselbe Lage wie heute ein Tick mit vielen Sub-Steps; Spiegel, Presenter und die
  Leser je Bild (LOS, Coop, Replay, Lastzahlen) bleiben unverändert. `LoadStats.packets` zählt die Veröffentlichungen
  über `frame`, `applies` die Bilder, die welche einräumten.
- **Gegendruck:** Liegt der Hauptthread mehr als eine Grenze hinter dem Strom (Startwert 250 ms Spielzeit oder
  64 Veröffentlichungen), wartet der Worker. Ohne das wüchse der Speicher bei einem hängenden Hauptthread
  unbegrenzt. Im normalen Spiel greift es nicht.

### 4. Eingaben, Tempo, Pause, Aufrufe

- Befehle, Tempo und Pause gehen als Nachricht an den Worker und wirken ab dem nächsten Sub-Step. Heute reisen sie
  mit dem Tick; das Ergebnis ist dasselbe, nur der Zeitpunkt hängt nicht mehr am Bild.
- **Gebaut (Schritt 3):** Eine Nachricht `input` (`SimInput`: Befehle, Tempo, Pause, Rendering, Replay-Steuerung,
  Relay-Ticks), vom `SimClient` einmal je Bild und nur, wenn sich etwas geändert hat oder Befehle da sind
  (`flushInput`). Vor jedem Aufruf (`rpc`) geht die Eingabe voraus, Nachrichten kommen in Reihenfolge an; der eigene
  Aufruf `applyCommands` ist weg. Die Eingabe, die eine Pause oder ein angehaltenes Replay beendet, stellt deren Uhr
  auf jetzt, sonst spränge das Spiel um den Rückstand. Eingabe, Einstellung (`configure`) und Aufruf lassen den
  nächsten Durchgang ein Paket veröffentlichen, auch ohne Sub-Step.
- **Lauf-Epoche:** `SimClient.newRun` schickt erst `unload` (der Worker rechnet ohne Welt nichts und veröffentlicht
  nichts), dann `epoch`; der Worker stempelt jede Veröffentlichung mit der Epoche, der Hauptthread verwirft Pakete
  einer älteren. `SimClient.unloadWorld` ist in `newRun` aufgegangen.
- **Gebaut (Schritt 5), Abweichung:** Kein eigenes Anhalten und Fortsetzen. Alles, was der Hauptthread in einer
  Aufgabe (Task) schickt, geht als eine Nachricht (`batch`) an den Worker, der sie am Stück abarbeitet, ohne Durchgang
  dazwischen (`WorkerTransport.post`). Damit wirken etwa beim Coop-Start `reset`, Spieler, Lanes und Lockstep an
  derselben Grenze; ohne das konnte zwischen `reset` und dem Lockstep ein Sub-Step laufen (mit Tick auf Anfrage lag
  dazwischen nie ein Tick). Die Aufrufe mit festem Stand brauchen darüber hinaus nichts: Der Replay-Einstieg schickt
  die Pause mit seiner Eingabe voraus und die Simulation prüft selbst, ob ihr Stand still ist; im Replay rechnet der
  Loop nur das Replay, der Live-Stand liegt als Snapshot daneben; der Resync greift an der Barriere zu, an der der Loop
  schläft. Ein Replay-Sprung rechnet weiter in Scheiben von 60 ms je Durchgang, dazwischen kommen neue Ziele an.
- Aufrufe (`rpc`: Replay, Snapshot, Hash, Tower-Ziele) laufen zwischen zwei Durchgängen. Aufrufe, die einen festen
  Stand brauchen (Replay-Einstieg, Resync), halten den Loop an und lassen ihn danach weiterlaufen.

### 5. Coop

- Der Lockstep bleibt, wie er ist: Die Simulation rechnet nur bis zur Grenze des Ticks, den das Relay freigegeben
  hat. Die freigegebenen Ticks mit ihren Befehlen gehen per Nachricht an den Worker, sobald sie im Hauptthread ankommen
  (heute: mit dem nächsten Tick). Der Loop wartet an der Grenze.
- **Gebaut (Schritt 4):** Die Ticks des Relays gehen an den Worker, sobald sie ankommen (`LockstepLink.onTick`,
  `SimClient.ticksCame`), nicht erst mit dem nächsten Bild. An der Barriere schläft der Loop, bis eine Nachricht
  kommt (`GameStateManager.dueInMs`), und veröffentlicht vorher seinen letzten Stand; darauf verlässt sich der Resync,
  der den Spiegel an der Grenze liest. Die Glätte-Meldung (`noteFrame`) zählt jetzt Durchgänge des Loops, die einen
  Sub-Step rechneten oder an der Barriere hingen, nicht mehr Bilder.
- Später möglich: die Relay-Verbindung in den Worker verlegen, damit ein langsames Bild auch die Freigaben nicht
  aufhält. Nicht Teil dieses Plans.

### 6. Darstellung zwischen zwei Ständen

- Veröffentlicht der Worker seltener, als gezeichnet wird, stünden Gegner zwischen zwei Ständen still. Heute passt
  ein Paket je Bild und fällt nicht auf. Erste Stufe: nichts tun und messen, wie oft der Worker veröffentlicht. Zweite
  Stufe, nur falls es ruckelt: zwischen den beiden neuesten Ständen interpolieren (Position und Drehung).

### 7. Hintergrund-Tab

- Der Worker läuft im versteckten Tab weiter, sein Loop hängt nicht an `requestAnimationFrame`. Der Hauptthread
  zeichnet dann nicht, der Gegendruck hält den Strom kurz; beim Zurückkommen spielt der Hauptthread die Events ab (oder
  verwirft Show-Events älter als eine Grenze, Töne und VFX ohne Nutzen). Der Heartbeat-Worker wird dafür unnötig, sofern
  nichts anderes an ihm hängt; prüfen.

## Was bleibt, was geht

- Bleibt: Sub-Steps, Determinismus, Prüfsummen, Snapshots, Replay-Dateien, Coop-Protokoll.
- Geht: Tick auf Anfrage (`sendTick`, `inFlight`), früher Tick (`EARLY_TICK_MS`, `?earlyTick=`), die
  50-ms-Obergrenze je Tick als Zeitlupen-Ursache, zwei statt drei Tabellensätze. Kein zweites System daneben.

## Bauschritte

Jeder Schritt mit grünen Specs, E2E (`npm run e2e`) und einem Messcheck (`e2e/perf/sim-load.ts`, beide Browser,
5000/16 000/25 000 Gegner, Tempo 4 und 1).

0. **Messbasis:** Reihe von `simu-worker`, dazu je Lauf Veröffentlichungen je Sekunde und Leerlauf des Workers.
1. **Drei Sätze und Kontrollwort** im `TableStore`, der Hauptthread liest den neuesten; noch mit Tick auf Anfrage.
2. **Event-Strom mit Folgenummer** getrennt vom Stand; der Hauptthread spielt Events aller Veröffentlichungen, den
   Stand nur den neuesten.
3. **Loop im Worker** mit eigener Uhr, Budget je Durchgang, Nachrichten für Befehle, Tempo, Pause; Tick auf Anfrage
   und früher Tick entfernt. Inline-Transport synchron. **Gebaut 2026-09-30.**
4. **Coop:** Freigaben per Nachricht, Loop wartet an der Grenze; Coop-Bot-Lauf zu zweit ohne Abweichung, Resync-Lauf
   (`e2e/coop-bots/run.ts --falsify-at-wave --big-wave`). **Gebaut 2026-09-30.**
5. **Aufrufe und Replay:** Loop anhalten und fortsetzen; Replay-Sprünge (`e2e/perf/replay-seek.ts`).
   **Gebaut 2026-09-30** als Bündel je Aufgabe statt Anhalten, siehe Abschnitt 4.
6. **Gegendruck und Hintergrund-Tab**, dann die volle Messreihe und Doku (SIM_WORKER.md).
7. Nur bei Bedarf: Interpolation zwischen zwei Ständen.

## Später: Paket direkt aus der Tabelle

Heute kopiert der Worker jeden Gegner je Paket in die Gegner-Tabelle (`writeEnemies`, rund 6,5 % des Workers bei
16 000 Gegnern in Chromium). Liegen die Gegnerdaten selbst in einer Tabelle im SAB (Bewegungstabelle aus
[MULTI_WORKER_PLAN.md](MULTI_WORKER_PLAN.md), Branch `perf/multi-worker`), veröffentlicht der Worker einen Satz dieser
Tabelle, statt zu kopieren. Setzt beide Umbauten voraus; entscheiden nach den Messungen. Nicht Teil dieses Plans.

## Risiken

- Mehr CPU: Worker und Hauptthread arbeiten beide durchgehend. Auf schwachen Rechnern mit zwei Kernen kann das
  langsamer sein als heute; die Worker-Last-Anzeige und der Benchmark zeigen es.
- Ruckeln durch seltene Veröffentlichung (Punkt 6), messbar über Veröffentlichungen je Sekunde.
- Bot und Run-Log lesen den Spiegel je Bild; sie sehen weiter jeden Bild-Stand, aber nicht mehr jeden Tick. Das ist
  heute schon so (Bot entscheidet je Bild).
- Offen nach Schritt 3: Ohne Gegendruck (Schritt 6) rechnet der Worker weiter, solange der Hauptthread keine Bilder
  rechnet, und veröffentlicht dann alle 100 ms; die Liste der Pakete wächst so lange. Der Stand eines Bilds ist so alt
  wie die Zeit zwischen Abruf (Anfang des vorigen Bilds) und Anwenden; ob das bei langen Bildern stört, zeigt die
  Messung.
- Specs, die einen Tick je `frame()` annehmen, müssen auf den Loop umgestellt werden.

## Zum Multi-Worker-Umbau

Unabhängig davon ([MULTI_WORKER_PLAN.md](MULTI_WORKER_PLAN.md), Branch `perf/multi-worker`). Die Entkopplung
nimmt dem Worker das Warten auf das Bild und dem Hauptthread das Einräumen je Tick; mehrere Worker machen nur den
Worker selbst schneller. Vorschlag: die Entkopplung zuerst, weil sie in beiden Browsern wirkt und der Multi-Worker-Umbau
dann gegen einen Worker ohne Leerlauf misst.

## Offene Entscheidungen

1. Reihenfolge gegenüber dem Multi-Worker-Umbau. Vorschlag: Entkopplung zuerst.
2. Eigener Branch von `simu-worker` (Vorschlag: `perf/decouple`) oder direkt auf `simu-worker`. Vorschlag: eigener
   Branch, Übernahme nach Messung.
3. Budget je Durchgang (8 ms), Rückstandsgrenze (250 ms), Gegendruck-Grenze: Startwerte, per Messung festlegen.
