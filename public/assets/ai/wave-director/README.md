# AI Wave Director Model

This folder will contain the trained TensorFlow.js model for the Wave Director AI.

## Status: Placeholder

The model file (`model.json` and weight files) will be generated after training.

## Training

1. Run the training backend:
   ```
   # Windows
   .\scripts\start-training.ps1

   # Linux/Mac
   ./scripts/start-training.sh
   ```

2. Start the game in DevWorld mode and play through waves

3. After sufficient training, export the model:
   - The Python backend will save checkpoints to `training-backend/checkpoints/`
   - Convert to TensorFlow.js format and place here

## Expected Files

After training and export:
- `model.json` - Model architecture and weights manifest
- `group1-shard1of1.bin` - Weight data (or multiple shards)

## Fallback Behavior

If no model is present, the game uses rule-based wave generation.
This is fully functional and provides a good gameplay experience.
