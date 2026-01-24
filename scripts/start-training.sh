#!/bin/bash
# Start Training Backend
# Bash script for Linux/Mac

set -e

# Navigate to training-backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../training-backend"

cd "$BACKEND_DIR"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt --quiet

# Create checkpoints directory
mkdir -p checkpoints

# Start the server
echo ""
echo "Starting AI Training Server..."
echo "WebSocket: ws://localhost:3001"
echo "Press Ctrl+C to stop"
echo ""

python server.py
