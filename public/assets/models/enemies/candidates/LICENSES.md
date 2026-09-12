# Kandidaten: Herkunft und Lizenzen

Gilt für die Unterordner unten. Für die übrigen Dateien in diesem Ordner gibt es hier
keinen Lizenznachweis (Stand 2026-09-12).

Wird ein Modell ins Spiel übernommen, kommt es in `src/app/configs/attributions.config.ts`.
Das Projekt führt dort auch CC0-Modelle (z. B. Bat von Quaternius).

Messwerte aus `tools/model-budget/model-inspect.ts`, Budget und Bedeutung der Spalten in
[docs/ENEMY_MODEL_BUDGET.md](../../../../../docs/ENEMY_MODEL_BUDGET.md).

## kaykit-skeletons/Skeleton_Minion.glb

| | |
|---|---|
| Modell | Skeleton_Minion aus „KayKit Character Pack: Skeletons 1.0“ |
| Autor | Kay Lousberg (www.kaylousberg.com) |
| Lizenz | CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/ |
| Quelle | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 |
| Download | https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0/main/addons/kaykit_character_pack_skeletons/Characters/gltf/Skeleton_Minion.glb |
| Abgerufen | 2026-09-12, unverändert |

Lizenztext (`LICENSE.txt` im Repository): „License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/ This content is free to use in personal,
educational and commercial projects.“ Nennung erbeten, nicht verpflichtend.

Gemessen: 9 Meshes, alle geskinnt, 4.858 Vertices, 5.288 Dreiecke, 41 Knochen, eine
1024²-Textur (Atlas), 95 Clips. Für einen Swarm-Gegner brauchbar: `Walking_A` bis
`Walking_D_Skeletons` (1,07 bis 1,60 s), `Running_A` bis `Running_C` (0,80 bis 1,07 s),
`Death_A` (0,80 s), `Death_B` (2,63 s), `Death_C_Skeletons` (2,00 s). Die 4,8 MB kommen fast
nur von den Clips; das Spiel backt nur die konfigurierten.

## kenney-graveyard-kit/character-skeleton.glb

| | |
|---|---|
| Modell | character-skeleton aus „Graveyard Kit 5.0“, Textur `Textures/colormap.png` |
| Autor | Kenney (www.kenney.nl) |
| Lizenz | CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/ |
| Quelle | https://kenney.nl/assets/graveyard-kit |
| Download | https://kenney.nl/media/pages/assets/graveyard-kit/ba8d4b4517-1760691807/kenney_graveyard-kit_5.0.zip (daraus `Models/GLB format/character-skeleton.glb` und `Models/GLB format/Textures/colormap.png`) |
| Abgerufen | 2026-09-12, unverändert |

Lizenztext (`License.txt` im Zip): „License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/ You can use this content for personal,
educational, and commercial purposes.“ Nennung erbeten, nicht verpflichtend.

Gemessen: 6 starre Meshes ohne Skin, bewegt über Node-Animation. Der Renderer backt so ein
Modell über `bakeObjectAnimVAT` (wie Mech und Hornet). 1.156 Vertices, 658 Dreiecke, externe
Textur 512² (das GLB verweist relativ auf `Textures/colormap.png`, der Ordner muss mit).
32 Clips, darunter `walk` (0,67 s), `sprint` (0,50 s), `die` (0,33 s), `idle` (1,33 s).
Blockiger Kenney-Stil.
