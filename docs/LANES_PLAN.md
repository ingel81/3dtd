# Spuren: eine je Spawn, mehrere je Spieler

Stand 2026-10-01, Branch `lanes`. Entscheidungen des Users per AUQ am 2026-10-01.

## Entschieden

| Nr. | Punkt | Entscheidung |
|-----|-------|--------------|
| L1 | Einzelspiel mit mehreren Spawns | Jeder Spawn ist eine Spur wie im Coop: jede Welle kommt komplett auf jeder Spur, Kill-Gold je Spur, die Wellengröße gegen den Anteil der Abwehr je Spur |
| L2 | Startgold | 100 je Spur des Spielers (`GAME_BALANCE.player.startCredits` mal Spuren, mindestens einmal) |
| L3 | Spawns ändern | Nur vor der ersten Welle; das Startgold folgt bis dahin (nie unter das schon Ausgegebene). Ab Welle 1 gesperrt, auch HQ verschieben (beides baut den Lauf neu) |
| L4 | Coop: Spurwahl | Jeder nimmt in der Lobby beliebig viele freie Spuren und gibt sie ab; Start erst, wenn jede Spur einen Spieler hat und jeder mindestens eine |
| L5 | Coop: wer setzt Spawns | Nur der Host, wie bisher; ein neuer oder verschobener Spawn lässt die Bereit-Meldungen fallen |
| L6 | Längen-Leiste | Beim Setzen und Verschieben eines Spawns eine Tafel mit allen Spuren: Balken in Spurfarbe, Meter, die bearbeitete hervorgehoben, live; Einzelspiel und Coop |
| L7 | Balance | Prüft der User selbst; keine Bot-Messreihe im Branch |

## Umsetzung

- **Spurmodell** (`managers/game-state/coop-room.ts`): Liste von `{ spawnId, playerId }`, im Coop aus den Paaren des
  Raums (`setLanes`), allein aus allen Spawns. `laneSpawnsOf`, `laneOwnerOf`. Das Paket trägt `laneSpawns` und
  `laneOwners` parallel; der Spiegel liest die Besitzer daraus statt aus der Roster-Position.
- **Startgold** (`CreditsLedger.setStartCredits`, `followStart`): beim Laufstart und bei jeder Spuränderung vor der
  ersten Welle.
- **Sperre**: `canPlaceOnMap` (Header) und `MapRelocationService.applySpawns` ab Welle 1.
- **Coop** (offen): Protokoll `spawnId` wird zur Liste, `pick` nimmt oder gibt eine Spur, Relay prüft und startet mit
  allen Paaren, Lobby-Tabelle und automatische Wahl, Zuordnung von Kills und Lecks (`coop-run-counts.ts`) über die
  Spur statt den Spieler, Spieler-Leiste.
- **Längen-Leiste** (offen): `laneStats` (Länge, Laufzeit) aus `coop/lane-stats.ts`, die Route des Spawns unter der
  Maus gedrosselt neu.
