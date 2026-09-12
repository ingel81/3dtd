# Tower-Kandidaten: Herkunft und Lizenzen

Modell für den Chaos Tower. Wird es ins Spiel übernommen, kommt es in
`src/app/configs/attributions.config.ts`.

Messwerte aus `tools/model-budget/model-inspect.ts`. Ein drehbarer Turret braucht laut
[docs/TOWER_CREATION.md](../../../../../docs/TOWER_CREATION.md) ein Mesh namens `turret_top`;
das Modell hat noch keins, der passende Teil wäre umzubenennen.

## kenney-tower-defense-kit/tower-round-crystals.glb

| | |
|---|---|
| Modell | tower-round-crystals aus „Tower Defense Kit 2.1“, Textur `Textures/colormap.png` |
| Autor | Kenney (www.kenney.nl) |
| Lizenz | CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/ |
| Quelle | https://kenney.nl/assets/tower-defense-kit |
| Download | https://kenney.nl/media/pages/assets/tower-defense-kit/a402493eaa-1726471567/kenney_tower-defense-kit.zip (daraus `Models/GLB format/tower-round-crystals.glb` und `Models/GLB format/Textures/colormap.png`) |
| Abgerufen | 2026-09-12, unverändert |

Lizenztext (`License.txt` im Zip): „License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/ You can use this content for personal,
educational, and commercial purposes.“ Nennung erbeten, nicht verpflichtend.

Gemessen: 6 Meshes, 1.248 Vertices, 688 Dreiecke. Turmkörper 688 Vertices / 408 Dreiecke,
dazu fünf Kristalle (je 112 / 56) als eigene Nodes, die sich drehen oder pulsieren lassen.
Externe Textur 512² (das GLB verweist relativ auf `Textures/colormap.png`). Das Kit ist
modular (Basis, Mittelteile, Dächer, Waffen wie `weapon-turret` mit eigenem `barrel`-Node),
weitere Teile liegen im selben Zip.
