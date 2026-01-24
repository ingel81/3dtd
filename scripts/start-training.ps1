# Start Training Backend
# PowerShell script for Windows

$ErrorActionPreference = "Stop"

# Navigate to training-backend directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "..\training-backend"

Push-Location $BackendDir

try {
    # Check if Python is available
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Error "Python is not installed or not in PATH"
        exit 1
    }

    # Check if venv exists
    if (-not (Test-Path "venv")) {
        Write-Host "Creating virtual environment..." -ForegroundColor Yellow
        python -m venv venv
    }

    # Activate venv
    Write-Host "Activating virtual environment..." -ForegroundColor Yellow
    . .\venv\Scripts\Activate.ps1

    # Install dependencies
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    pip install -r requirements.txt --quiet

    # Create checkpoints directory
    if (-not (Test-Path "checkpoints")) {
        New-Item -ItemType Directory -Path "checkpoints" | Out-Null
    }

    # Start the server
    Write-Host ""
    Write-Host "Starting AI Training Server..." -ForegroundColor Green
    Write-Host "WebSocket: ws://localhost:3001" -ForegroundColor Cyan
    Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
    Write-Host ""

    python server.py
}
finally {
    Pop-Location
}
