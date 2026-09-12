# Tower-Kandidaten: Herkunft und Lizenzen

Messwerte aus `tools/model-budget/model-inspect.ts`.

## kenney-tower-defense-kit/tower-round-crystals.glb (übernommen)

Seit 2026-09-12 das Modell des Chaos Tower: liegt als `towers/chaos.glb`, die Textur als
`towers/Textures/colormap.png` (das GLB verweist relativ darauf), Nennung in
`src/app/configs/attributions.config.ts`. Ein `turret_top` braucht es nicht, die
Tower-Config benennt den drehbaren Kristall über `turretNode: 'crystal'`.

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
