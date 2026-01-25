# AI Wave Director - Training Backend

Python training server for the AI Wave Director with real-time web dashboard.

## Quick Start (Windows)

```bash
start.bat
```

This starts:
- **WebSocket Server** on `ws://localhost:3001` (game communication)
- **Web Dashboard** on `http://localhost:3002` (live monitoring)

## Manual Setup

```bash
# Create venv and install dependencies
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Start server
python server.py
```

## Architecture

| File | Purpose |
|------|---------|
| `server.py` | WebSocket server, state encoding, action decoding |
| `model.py` | Conv1D + Dense neural network (74 features input) |
| `trainer.py` | PPO training algorithm |
| `reward.py` | Reward function (Gaussian at 55% progress) |
| `config.py` | Hyperparameters and settings |
| `dashboard/` | FastAPI web dashboard with Chart.js |
| `tui_logger.py` | Console output + JSONL file logging |

## Web Dashboard

Open `http://localhost:3002` for live training visualization:

- Reward, Progress, Near-Miss charts with trendlines
- Model metrics (policy loss, entropy, grad norm)
- Progress distribution (boring/low/moderate/sweet/danger)
- Per-client DPS profiles (ground + air, 20 bins)
- Wave log and training log

## Training Workflow

1. Start backend: `start.bat` (or `python server.py`)
2. Start frontend: `npm start` in project root
3. Open game, training auto-connects to `:3001`
4. Bot places towers, AI generates waves
5. Monitor on dashboard `:3002`

## Requirements

- Python 3.8+
- PyTorch 2.0+
- FastAPI + uvicorn
- websockets

## Configuration

Edit `config.py`:
- `SERVER_PORT`: WebSocket port (default 3001)
- `LEARNING_RATE`: Adam LR (default 0.0003)
- `BATCH_SIZE`: Episodes per PPO update (default 16)
- `EPISODE_LENGTH`: Waves per episode (default 20)
- `CHECKPOINT_INTERVAL`: Save frequency (default 10)
- `REWARD_PROGRESS_CENTER`: Target progress (default 0.55)

## Checkpoints

Auto-saved to `checkpoints/checkpoint_*.pt` every 10 episodes.
Server auto-loads latest checkpoint on startup.

## Logs

Structured JSONL logs in `logs/training_*.jsonl` for post-hoc analysis.

## Documentation

See `docs/AI_TRAINING_BACKEND.md` (in this folder) for full technical documentation.
