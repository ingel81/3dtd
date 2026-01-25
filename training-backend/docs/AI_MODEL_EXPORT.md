# AI Model Export Guide

Anleitung zum Exportieren des trainierten PyTorch-Models für Browser-Inference.

## Übersicht

```
Training (Python/PyTorch)
         │
         ▼
    checkpoint.pt
         │
    export_to_tfjs.py
         │
         ▼
   wave-director.onnx  ──►  Browser (ONNX Runtime Web)
```

## Voraussetzungen

### Python Environment

```bash
cd training-backend
pip install -r requirements.txt
```

**Benötigte Packages für Export:**
- `torch` (bereits für Training installiert)
- `onnx` >= 1.14.0

**WICHTIG:** TensorFlow.js wird NICHT benötigt! Wir verwenden ONNX Runtime Web direkt.

### Bekannte Probleme

#### tensorflowjs Dependency Hell (Windows)
Falls du versuchst `tensorflowjs` zu installieren - TU ES NICHT!
- tensorflow-decision-forests ist auf Windows broken
- Massive Versionskonflikte zwischen tensorflow, jax, flax
- Lösung: Wir nutzen ONNX direkt, keine Konvertierung zu TF.js

## Export durchführen

### 1. Checkpoint auswählen

```bash
ls checkpoints/
# checkpoint_1000.pt
# checkpoint_5000.pt
# checkpoint_6500.pt  ← neuester
```

### 2. Export Script ausführen

```bash
cd training-backend
python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_6500.pt
```

**Output:**
```
Loading checkpoint: checkpoints/checkpoint_6500.pt
Validating model...
  Input shape: torch.Size([1, 74])
  Output shape: torch.Size([1, 10])
  Validation passed!

Exporting ONNX to: ../public/assets/ai/wave-director/wave-director.onnx
  ONNX file size: 108.7 KB

Metadata written to: ../public/assets/ai/wave-director/metadata.json

==================================================
Export complete!
==================================================
```

### 3. Ergebnis prüfen

```
public/assets/ai/wave-director/
├── wave-director.onnx   # 108 KB - Das AI Model
├── metadata.json        # Konstanten und Version
└── README.md            # Kurzanleitung
```

## Model Format

### Input (74 Features)

Der GameStateEncoder kodiert den Spielzustand in 74 Float-Werte:
- Scalar features (34): Wave, Lives, Credits, Tower stats, etc.
- Spatial DPS profile (40): Ground DPS + Air DPS entlang des Pfads (je 20 Bins)

### Output (10 Werte)

| Index | Bedeutung | Nachbearbeitung |
|-------|-----------|-----------------|
| 0-5 | Enemy Type Logits | Softmax → Wahrscheinlichkeiten |
| 6 | kill_time | Sigmoid → Scale 2.0-5.0 |
| 7 | count_factor | Sigmoid → 0-1 |
| 8 | delay_factor | Sigmoid → 0-1 |
| 9 | variation | Sigmoid → Scale 0-0.3 |

**Enemy Types (Index-Reihenfolge):**
```
0: zombie
1: bat
2: tank
3: wallsmasher
4: penguin
5: herbert
```

## Browser Integration

### ONNX Runtime Web

Das Frontend nutzt `onnxruntime-web` für Inference:

```typescript
// Lazy load
const ort = await import('onnxruntime-web');
ort.env.wasm.wasmPaths = '/assets/onnx-wasm/';

// Session erstellen
const session = await ort.InferenceSession.create(
  '/assets/ai/wave-director/wave-director.onnx',
  { executionProviders: ['wasm'] }
);

// Inference
const inputTensor = new ort.Tensor('float32', encodedState, [1, 74]);
const results = await session.run({ state: inputTensor });
const output = results.action.data;
```

### WASM Files

ONNX Runtime benötigt WASM-Dateien (~60MB total). Diese werden automatisch kopiert:

```bash
npm run postinstall
# Kopiert node_modules/onnxruntime-web/dist/*.wasm nach public/assets/onnx-wasm/
```

**Dateien:**
- `ort-wasm-simd-threaded.wasm` (12 MB)
- `ort-wasm-simd-threaded.jsep.wasm` (24 MB)
- `ort-wasm-simd-threaded.asyncify.wasm` (25 MB)
- Plus zugehörige `.mjs` Worker-Dateien

Diese sind in `.gitignore` - werden bei `npm install` automatisch kopiert.

## NPM Scripts

```json
{
  "postinstall": "...",  // Kopiert WASM files
  "export-ai": "cd training-backend && python scripts/export_to_tfjs.py ..."
}
```

## Troubleshooting

### "No module named 'onnx'"
```bash
pip install onnx
```

### "WASM files not found" (Browser Console)
```bash
npm run postinstall
```

### Model gibt immer den gleichen Enemy Type
Das Model hat Präferenzen gelernt. Der WaveDirectorService hat Variety-Regeln:
- Wave 0-1: Immer Zombie
- Wave 2-3: Nur Zombie/Tank/Penguin
- Ab Wave 4: Alle Typen, Cooldown von 2 Waves pro Typ

## Enemy Type Override (ohne Retraining)

### Wie funktioniert das?

Das Neural Network gibt für jeden Enemy-Typ einen "Score" (Logit) aus:

```
Model Output (Beispiel):
  zombie:      -0.39  ──┐
  bat:         -1.96    │
  tank:        -0.45    │  Softmax
  wallsmasher: +0.69  ──┼─────────►  wallsmasher gewinnt (höchster Score)
  penguin:     +0.44    │
  herbert:     -0.01  ──┘
```

**Normalerweise:** Der Typ mit dem höchsten Score wird gewählt.

**Mit Override:** Wir können NACH dem Model eingreifen:
1. Model berechnet Scores für alle 6 Typen
2. WIR entscheiden, welchen wir tatsächlich nehmen
3. Das Model wird nicht verändert - nur unsere Entscheidung

```
                    ┌─────────────────────────────────┐
Game State ──► Model ──► Scores ──► UNSERE REGELN ──► Finaler Enemy Type
                    └─────────────────────────────────┘
                                        ▲
                                        │
                              "wallsmasher war
                               letzte Wave, nimm
                               den zweitbesten"
```

Das ist wie ein Filter: Das Model schlägt vor, wir haben das letzte Wort.

### Reihenfolge der Enemy Types

```typescript
// wave-director.service.ts
const ENEMY_TYPES: EnemyTypeId[] = [
  'zombie',      // Index 0
  'bat',         // Index 1
  'tank',        // Index 2
  'wallsmasher', // Index 3
  'penguin',     // Index 4
  'herbert'      // Index 5
];
```

### Variety-Regeln anpassen

In `wave-director.service.ts` → `selectEnemyTypeWithVariety()`:

```typescript
// Early waves: force zombie
if (waveNumber < 2) {
  return 'zombie';
}

// Waves 2-3: limited selection
if (waveNumber < 4) {
  const allowed = [0, 2, 4]; // zombie, tank, penguin indices
  // ... wählt besten aus allowed
}

// Ab Wave 4: Cooldown-System
// Typ der letzten N Waves wird nicht wiederholt
```

### Eigene Regeln hinzufügen

**Beispiel: Herbert erst ab Wave 10 erlauben:**
```typescript
private selectEnemyTypeWithVariety(probs: number[], waveNumber: number): EnemyTypeId {
  // Herbert (Index 5) blockieren vor Wave 10
  if (waveNumber < 10) {
    probs = [...probs];
    probs[5] = -999; // Herbert-Wahrscheinlichkeit auf 0 setzen
  }
  // ... Rest der Logik
}
```

**Beispiel: Bestimmten Typ erzwingen:**
```typescript
// Jede 5. Wave ist eine Bat-Wave
if (waveNumber % 5 === 0 && waveNumber > 0) {
  return 'bat';
}
```

### Cooldown anpassen

```typescript
// wave-director.service.ts
private readonly TYPE_COOLDOWN_WAVES = 2; // Standard: 2 Waves

// Ändern auf 3 für mehr Variety:
private readonly TYPE_COOLDOWN_WAVES = 3;
```

### Deprecation Warning beim Export
```
DeprecationWarning: You are using the legacy TorchScript-based ONNX export
```
Kann ignoriert werden - funktioniert trotzdem.

## Status & Feintuning

### Aktueller Stand (Januar 2026)

Die Browser-Integration funktioniert technisch:
- ✅ ONNX Model lädt im Browser
- ✅ Inference läuft (~10ms)
- ✅ Output wird korrekt decoded
- ✅ Variety-Regeln verhindern Wiederholung

**Noch notwendiges Feintuning:**
- ⚠️ Model hat starke Wallsmasher-Präferenz (Trainings-Artefakt)
- ⚠️ Variety-Regeln sind Workaround, nicht vom Model gelernt
- ⚠️ Health Multiplier oft zu niedrig/hoch
- ⚠️ Count-Berechnung könnte besser auf DPS reagieren

### Empfohlene nächste Schritte

1. **Training mit mehr Diversity-Reward** - Model soll selbst abwechseln lernen
2. **Längere Trainingssessions** - Mehr als 6500 Episodes
3. **A/B Testing** - Verschiedene Checkpoints im Browser vergleichen
4. **Reward-Tuning** - Sweet Spot (10-30% Damage) ggf. anpassen

## Weiterentwicklung

### Neues Model trainieren
1. Training mit `python server.py` starten
2. Checkpoints werden automatisch gespeichert
3. Nach Training: Export mit neuem Checkpoint

### Model-Architektur ändern
Bei Änderungen an `model.py`:
1. `INPUT_SIZE` / `OUTPUT_SIZE` in config.py anpassen
2. Frontend `ENCODED_STATE_SIZE` anpassen
3. `decodeModelOutput()` in wave-director.service.ts anpassen
