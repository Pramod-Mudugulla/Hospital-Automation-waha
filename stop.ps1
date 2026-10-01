# ==============================================================================
# DemoCare Hospital AI Automation - Stop All Services
# ==============================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "Stopping DemoCare Hospital services..." -ForegroundColor Yellow
Write-Host ""

# 1. Stop WAHA Docker container
Write-Host "  Stopping WAHA..." -ForegroundColor Yellow
docker compose -f WAHA_Hospital_Automation/docker-compose.waha.yml stop 2>&1 | Out-Null
Write-Host "  WAHA: Stopped (session data preserved in WAHA_Hospital_Automation/waha_data/)" -ForegroundColor Green

# 2. Stop Express HMS server
$pidFile = Join-Path $PSScriptRoot ".hms_pid"
if (Test-Path $pidFile) {
    $pid = Get-Content $pidFile
    try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        Write-Host "  HMS Server: Stopped (PID $pid)" -ForegroundColor Green
    } catch {
        Write-Host "  HMS Server: Already stopped" -ForegroundColor DarkGray
    }
    Remove-Item $pidFile -Force
} else {
    # Fallback: find and kill node server/server.js processes
    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server/server.js*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "  HMS Server: Stopped" -ForegroundColor Green
}

# 3. n8n was running in foreground - it stops when you press Ctrl+C in start.ps1
Write-Host "  n8n: Was running in foreground (stopped via Ctrl+C)" -ForegroundColor DarkGray

Write-Host ""
Write-Host "All services stopped. WhatsApp session is saved - no re-scan needed next time." -ForegroundColor Cyan
Write-Host ""
