# Gegner: Herkunft und Lizenzen

Nennung im Spiel in `src/app/configs/attributions.config.ts`, für alle Gegner. Hier stehen dazu die
Modelle, deren Lizenz einen Vermerk beim Asset verlangt.

## jumper.glb

| | |
|---|---|
| Modell | Jumper, Roboter von KingKong Robotics, Ausführung „Apocalypse“ |
| Urheber | Copyright 2026 KingKong Robotics |
| Lizenz | Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0 |
| Quelle | https://github.com/KingKongRobotics/jumper |

NOTICE der Quelle (Auszug zum Roboter):

> Jumper
> Copyright 2026 KingKong Robotics.
>
> Licensed under the Apache License, Version 2.0 (see LICENSE).

Geändert mit `tools/blender/jumper_boss.py`: Meshes reduziert und weich schattiert, Materialien
vereinfacht, Turm und Geschütz als eigene Knoten abgetrennt (`turret_yaw`, `turret_pitch`,
Mündungen `muzzle_L`, `muzzle_R`), Wurzel in Dezimetern. Die Clips `Walk`, `Scuttle` (Krebsgang)
und `Death` sind im Skript neu gebaut; die Quelle hat keine Keyframe-Animationen.
