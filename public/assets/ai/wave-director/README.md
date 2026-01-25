# Wave Director AI Model

ONNX model for browser-based inference via ONNX Runtime Web.

## Files

- `wave-director.onnx` - ONNX model (committed to repo)
- `metadata.json` - Constants and version info

## Generating/Updating Model

```bash
cd training-backend
pip install -r requirements.txt
python scripts/export_to_tfjs.py --checkpoint checkpoints/checkpoint_XXXX.pt
```

## Model Format

- **Input**: 74 features (encoded game state), tensor name: `state`
- **Output**: 10 values, tensor name: `action`
  - `[0-5]` Enemy type logits (zombie, bat, tank, wallsmasher, penguin, herbert)
  - `[6]` kill_time param (apply sigmoid, scale to 2.0-5.0)
  - `[7]` count_factor param (apply sigmoid, 0-1)
  - `[8]` delay_factor param (apply sigmoid, 0-1)
  - `[9]` variation param (apply sigmoid, scale to 0-0.3)

## Browser Runtime

Uses `onnxruntime-web` package with WASM/WebGPU backend.
