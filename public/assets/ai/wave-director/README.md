# Wave Director AI Model

ONNX Model für Browser-Inference via ONNX Runtime Web.

## Dateien

- `wave-director.onnx` - Das trainierte AI Model (~108 KB)
- `metadata.json` - Konstanten und Versionsinformation

## Model aktualisieren

Nach Training mit neuem Checkpoint:

```bash
cd training-backend
python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_XXXX.pt
```

Siehe `training-backend/docs/AI_MODEL_EXPORT.md` für Details.

## Model Format

**Input:** 74 Features (kodierter Spielzustand)
- Tensor Name: `state`
- Shape: `[1, 74]`

**Output:** 10 Werte
- Tensor Name: `action`
- Shape: `[1, 10]`

| Index | Bedeutung |
|-------|-----------|
| 0-5 | Enemy Type Logits (zombie, bat, tank, wallsmasher, penguin, herbert) |
| 6 | kill_time (sigmoid → 2.0-5.0) |
| 7 | count_factor (sigmoid → 0-1) |
| 8 | delay_factor (sigmoid → 0-1) |
| 9 | variation (sigmoid → 0-0.3) |

## WASM Runtime

Benötigt ONNX Runtime Web WASM-Dateien in `/assets/onnx-wasm/`.
Diese werden automatisch bei `npm install` kopiert (postinstall script).

## Status

⚠️ Model hat starke Präferenz für bestimmte Enemy-Typen (Training-Artefakt).
Frontend hat Variety-Regeln die das überschreiben.
Weiteres Feintuning notwendig.
