# Held: Herkunft und Lizenzen

Nennung im Spiel in `src/app/configs/attributions.config.ts`.

## mercenary.glb

| | |
|---|---|
| Modell | „SWAT“ von Quaternius (Poly Pizza) |
| Autor | Quaternius (https://quaternius.com) |
| Lizenz | CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/ |
| Quelle | https://poly.pizza/m/Btfn3G5Xv4 |
| Download | https://static.poly.pizza/713f6535-f4f3-4367-a4c6-ced126ae0936.glb (SHA-256 `a835107bac833eb916c494e10997ae1709e85957ea6f6c59ace3c9a66f6d1fec`) |
| Abgerufen | 2026-09-13 |

Lizenz laut Quellseite: „Public Domain (CC0)“, im Seiten-JSON `"Licence":"CC0 1.0"`. Nennung
nicht verpflichtend.

Geändert mit `tools/blender/hero_mercenary.py`: sechs der 24 Clips behalten und umbenannt,
Materialien umgefärbt (Uniform oliv statt blaugrau, Metallic 0 statt 0,4 auf Stoff und Haut),
eine Maschinenpistole (140 Dreiecke, im Skript gebaut) und der Knoten `Muzzle` an der rechten
Hand ergänzt.

Gemessen (`tools/model-budget/model-inspect.ts`): 5 Meshes (4 geskinnt, die Waffe starr am
Handknochen), 14.665 Vertices, 7.892 Dreiecke, 62 Knochen, keine Texturen (Farben aus den
Materialien), 1,1 MB.

| Clip | Dauer s | Quelle |
|---|---:|---|
| `idle` | 1,667 | `Idle_Gun` (Waffe gesenkt an der Hüfte) |
| `walk` | 1,333 | `Walk` |
| `run` | 0,792 | `Run` |
| `run_shoot` | 0,833 | `Run_Shoot` (rechter Arm vorn, mit Rückstoß) |
| `aim` | 1,667 | `Idle_Gun_Pointing` (rechter Arm vorn, ruhig) |
| `shoot` | 0,583 | `Gun_Shoot` (ein Schuss, Rückstoß) |

Alle Clips sind Loops (erster und letzter Frame gleich) und keyen alle 62 Knochen.
