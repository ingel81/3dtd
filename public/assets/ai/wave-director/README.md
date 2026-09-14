# Wave Director AI Model

ONNX Model für Browser-Inference via ONNX Runtime Web.

**Stand des aktuell deployten Modells:** Phase 5.10 (Template-Based), Checkpoint 7350.

## Dateien

- `wave-director.onnx` - Das trainierte AI Model (289.959 Byte)
- `metadata.json` - Templates, Ranges, Enemy-Base-HP, Decoder-Konstanten

## Model aktualisieren

Nach Training mit neuem Checkpoint:

```bash
npm run export-ai
```

Wrapper für `python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_latest.pt --output ../public/assets/ai/wave-director` aus `training-backend/`.

Siehe `training-backend/docs/AI_MODEL_EXPORT.md` für Details (Skript exportiert ONNX, nicht TF.js; der Name ist historisch).

## Model Format (Phase 5.10/5.11)

**Input:** 156 Features (encoded game state)
- Tensor Name: `state`
- Shape: `[1, 156]`
- Layout: 116 scalar features + 40 spatial features

**Output:** 36 Werte
- Tensor Name: `action`
- Shape: `[1, 36]`

| Index | Bedeutung |
|-------|-----------|
| 0–31 | Template Logits (32 Slots; 18 aktive Templates, Rest reserviert) |
| 32–35 | Continuous Params: count_factor, spawn_delay_factor, hp_mult_factor, variation |

Die continuous Params werden im Frontend pro gewähltem Template auf die Template-spezifischen Ranges aus `metadata.json` gemappt. Constraints (Curriculum-Gates, Capability-Gates, Boss-Cooldown, DPS-Caps, Wave-Duration-Cap) werden im Decoder angewendet, siehe `docs/AI_WAVE_DIRECTOR_PLAN.md`.

## WASM Runtime

Benötigt ONNX Runtime Web WASM-Dateien in `/assets/onnx-wasm/`.
Diese werden automatisch bei `npm install` kopiert (postinstall script).

## Live-Stand

- **Frontend:** Die Wellen wählt ein Regel-Director im Client; dieses Modell ist nur ein Opt-in im Training-Debug-Fenster („Load ONNX model"). Siehe `docs/AI_WAVE_DIRECTOR_PLAN.md`.
- **Deployed Modell:** stammt aus Phase 5.10 und erwartet 156 Eingänge. Der Encoder liefert seit Schema v5 208; `OnnxPolicy.load()` lehnt das Modell deshalb ab, und das Spiel bleibt auf den Regeln. Details: `training-backend/docs/AI_MODEL_EXPORT.md`.
