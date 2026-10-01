# ==============================================================================
# DemoCare Hospital AI Automation - One-Command Startup
# ==============================================================================
#
# This script starts all 3 services needed for the hospital automation:
#   1. WAHA (WhatsApp gateway via Docker)  -> port 3000
#   2. Express HMS server                  -> port 3001
#   3. n8n workflow engine                 -> port 5678
#
# Prerequisites:
#   - Docker Desktop running
#   - Ollama running (ollama serve) with gemma3:4b pulled
#   - Node.js installed
#   - npm install already run in this directory
#
# Usage:
#   .\start.ps1
#
# To stop everything:
#   Press Ctrl+C in the n8n window, then run: .\stop.ps1
# ==============================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  DemoCare Hospital AI - Starting Services"    -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Docker
$dockerRunning = docker info 2>&1 | Select-String "Server Version"
if (-not $dockerRunning) {
    Write-Host "  ERROR: Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker: OK" -ForegroundColor Green

# Ollama
try {
    $ollamaCheck = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method GET -ErrorAction Stop
    $hasGemma = @($ollamaCheck.models | Where-Object { $_.name -like "gemma3:4b*" }).Count -gt 0
    if ($hasGemma) {
        Write-Host "  Ollama: OK (gemma3:4b available)" -ForegroundColor Green
    } else {
        Write-Host "  Ollama: Running but gemma3:4b not found. Pull it with: ollama pull gemma3:4b" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  WARNING: Ollama not running. AI replies will fail. Start with: ollama serve" -ForegroundColor Yellow
}

# Node modules
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing Node dependencies..." -ForegroundColor Yellow
    npm install 2>&1 | Out-Null
}
Write-Host "  Node modules: OK" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------------
# 2. Start WAHA via Docker Compose
# ---------------------------------------------------------------------------
Write-Host "[2/5] Starting WAHA WhatsApp Gateway (Docker)..." -ForegroundColor Yellow

# Ensure WAHA container is started via compose
$wahaContainerRunning = docker ps --filter "name=waha_hospital_demo" --filter "status=running" -q
if (-not $wahaContainerRunning) {
    docker compose -f WAHA_Hospital_Automation/docker-compose.waha.yml up -d 2>&1 | Out-Null
}

# Create data directory for session persistence
$wahaDataDir = Join-Path $PSScriptRoot "WAHA_Hospital_Automation\waha_data"
if (-not (Test-Path $wahaDataDir)) {
    New-Item -ItemType Directory -Path $wahaDataDir -Force | Out-Null
}

docker compose -f WAHA_Hospital_Automation/docker-compose.waha.yml up -d 2>&1 | Out-Null

# Wait for WAHA to be ready
$wahaReady = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/sessions" -Method GET -Headers @{ "X-Api-Key" = "62aaee3c52fd40a68de689e6319beb30" } -ErrorAction Stop
        $wahaReady = $true
        break
    } catch { }
}

if ($wahaReady) {
    Write-Host "  WAHA: Running on http://localhost:3000" -ForegroundColor Green

    # Ensure Demo1 session exists (auto-create if first run or data wiped)
    $wahaHeaders = @{ "X-Api-Key" = "62aaee3c52fd40a68de689e6319beb30" }
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/sessions/Demo1" -Method GET -Headers $wahaHeaders -ErrorAction Stop
    } catch {
        # Session doesn't exist yet - create and start it
        Write-Host "  Creating WhatsApp session 'Demo1'..." -ForegroundColor Yellow
        try {
            $sessionBody = '{"name":"Demo1","config":{"webhooks":[{"url":"http://host.docker.internal:5678/webhook/waha-inbound","events":["message"]}]}}'
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/sessions" -Method POST -ContentType "application/json" -Headers $wahaHeaders -Body $sessionBody -ErrorAction Stop
            Start-Sleep -Seconds 2
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/sessions/Demo1/start" -Method POST -ContentType "application/json" -Headers $wahaHeaders -Body '{}' -ErrorAction Stop
            Write-Host "  Session created. Waiting for initialization..." -ForegroundColor Yellow
            Start-Sleep -Seconds 10
        } catch {
            Write-Host "  WARNING: Could not auto-create session. Create it manually at http://localhost:3000" -ForegroundColor Red
        }
    }

    # Check if WhatsApp session is authenticated
    try {
        $session = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/sessions/Demo1" -Method GET -Headers $wahaHeaders -ErrorAction Stop
        if ($session.status -eq "WORKING") {
            Write-Host "  WhatsApp: Linked as $($session.me.pushName) ($($session.me.id))" -ForegroundColor Green
        } elseif ($session.status -eq "SCAN_QR_CODE") {
            Write-Host "  WhatsApp: QR code scan needed! Open http://localhost:3000 and scan." -ForegroundColor Yellow
        } else {
            Write-Host "  WhatsApp Session: $($session.status)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  WhatsApp: Session check failed - open http://localhost:3000 to set up." -ForegroundColor Yellow
    }
} else {
    Write-Host "  WARNING: WAHA did not start in time. Check Docker logs." -ForegroundColor Red
}
Write-Host ""

# ---------------------------------------------------------------------------
# 3. Start Express HMS Server (background)
# ---------------------------------------------------------------------------
Write-Host "[3/5] Starting Hospital Data Service..." -ForegroundColor Yellow
$hmsRunning = $false
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/conversations" -Method GET -TimeoutSec 2 -ErrorAction Stop
    $hmsRunning = $true
} catch { }

if (-not $hmsRunning) {
    $hmsJob = Start-Process -FilePath "node" -ArgumentList "server/server.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden
    $hmsJob.Id | Out-File -FilePath (Join-Path $PSScriptRoot ".hms_pid") -Force
    Write-Host "  HMS Server: Started on http://localhost:3001 (PID: $($hmsJob.Id))" -ForegroundColor Green
} else {
    Write-Host "  HMS Server: Already running on http://localhost:3001" -ForegroundColor Green
}
Write-Host ""

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
Write-Host "[4/5] All background services started!" -ForegroundColor Yellow
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Services Summary"                            -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  WAHA Dashboard:  http://localhost:3000 (No password needed)" -ForegroundColor White
Write-Host "  HMS API:         http://localhost:3001"      -ForegroundColor White
Write-Host "  n8n Editor:      http://localhost:5678"      -ForegroundColor White
Write-Host ""
Write-Host "  WAHA API Key:    62aaee3c52fd40a68de689e6319beb30" -ForegroundColor DarkGray
Write-Host "  Ollama Model:    gemma3:4b"                  -ForegroundColor DarkGray
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  If WhatsApp is not linked, open http://localhost:3000" -ForegroundColor Yellow
Write-Host "  and scan the QR code with WhatsApp > Linked Devices."  -ForegroundColor Yellow
Write-Host ""

# ---------------------------------------------------------------------------
# 5. Start n8n in foreground (so Ctrl+C stops it cleanly)
# ---------------------------------------------------------------------------
Write-Host "[5/5] Starting n8n (foreground - press Ctrl+C to stop)..." -ForegroundColor Yellow
Write-Host ""

npx n8n
