# start-dev.ps1 — Windows PowerShell development startup script
# Cross-platform alternative to start-dev.sh

<#
.SYNOPSIS
    Start AEGIS v6 development environment on Windows

.DESCRIPTION
    Starts all three services (server, client, ai-engine) in development mode.
    Creates .env files if missing and validates dependencies.

.PARAMETER Service
    Optional: Start only a specific service (server, client, ai-engine, all)

.PARAMETER SkipInstall
    Skip npm install and pip install steps

.EXAMPLE
    .\start-dev.ps1
    Starts all services

.EXAMPLE
    .\start-dev.ps1 -Service server
    Starts only the backend server
#>

param(
    [ValidateSet('server', 'client', 'ai-engine', 'all')]
    [string]$Service = 'all',
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# Color helpers
function Write-Status { param($msg) Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "[ERR] $msg" -ForegroundColor Red }

# Dependency checks

function Test-Command($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

Write-Status "Checking dependencies..."

# Node.js
if (-not (Test-Command "node")) {
    Write-Error "Node.js not found. Install from https://nodejs.org/"
    exit 1
}
$nodeVersion = (node -v).TrimStart('v')
Write-Success "Node.js v$nodeVersion"

# Python
$pythonCmd = if (Test-Command "python") { "python" } elseif (Test-Command "python3") { "python3" } else { $null }
if (-not $pythonCmd) {
    Write-Warning "Python not found. AI Engine will not start."
} else {
    $pythonVersion = & $pythonCmd --version 2>&1
    Write-Success $pythonVersion
}

# PostgreSQL (optional check)
if (Test-Command "psql") {
    Write-Success "PostgreSQL CLI available"
} else {
    Write-Warning "psql not in PATH (PostgreSQL may still be running via Docker)"
}

# Create .env files if missing

function Ensure-EnvFile($path, $template) {
    if (-not (Test-Path $path)) {
        Write-Status "Creating $path..."
        $template | Out-File -FilePath $path -Encoding utf8
        Write-Warning "Created $path — please update with real values"
    }
}

$serverEnvTemplate = @"
# Server Configuration
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis
JWT_SECRET=$(New-Guid)
AI_ENGINE_URL=http://localhost:8000

# Required for internal API auth
INTERNAL_API_KEY=$(New-Guid)
N8N_WEBHOOK_SECRET=$(New-Guid)

# Optional: Add your API keys here
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# SMTP_HOST=
# SMTP_USER=
# SMTP_PASS=
"@

$clientEnvTemplate = @"
# Client Configuration
VITE_API_URL=http://localhost:3001
VITE_MAPBOX_TOKEN=pk.your_mapbox_token_here
"@

$aiEngineEnvTemplate = @"
# AI Engine Configuration
ENV=development
HOST=0.0.0.0
PORT=8000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis
API_SECRET_KEY=$(New-Guid)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
"@

Ensure-EnvFile "$ProjectRoot\server\.env" $serverEnvTemplate
Ensure-EnvFile "$ProjectRoot\client\.env" $clientEnvTemplate
Ensure-EnvFile "$ProjectRoot\ai-engine\.env" $aiEngineEnvTemplate

# Install dependencies

if (-not $SkipInstall) {
    if ($Service -in @('all', 'server')) {
        Write-Status "Installing server dependencies..."
        Push-Location "$ProjectRoot\server"
        npm install
        Pop-Location
    }

    if ($Service -in @('all', 'client')) {
        Write-Status "Installing client dependencies..."
        Push-Location "$ProjectRoot\client"
        npm install
        Pop-Location
    }

    if ($Service -in @('all', 'ai-engine') -and $pythonCmd) {
        Write-Status "Installing AI Engine dependencies..."
        Push-Location "$ProjectRoot\ai-engine"
        
        # Create venv if not exists
        if (-not (Test-Path "venv")) {
            & $pythonCmd -m venv venv
        }
        
        # Activate and install
        & .\venv\Scripts\Activate.ps1
        pip install -r requirements.txt
        deactivate
        Pop-Location
    }
}

# Start services

Write-Status "Starting services..."

$jobs = @()

# Start Server
if ($Service -in @('all', 'server')) {
    Write-Status "Starting backend server on port 3001..."
    $jobs += Start-Job -Name "aegis-server" -ScriptBlock {
        param($root)
        Set-Location "$root\server"
        npm run dev
    } -ArgumentList $ProjectRoot
}

# Start Client
if ($Service -in @('all', 'client')) {
    Write-Status "Starting frontend client on port 5173..."
    $jobs += Start-Job -Name "aegis-client" -ScriptBlock {
        param($root)
        Set-Location "$root\client"
        npm run dev
    } -ArgumentList $ProjectRoot
}

# Start AI Engine
if ($Service -in @('all', 'ai-engine') -and $pythonCmd) {
    Write-Status "Starting AI Engine on port 8000..."
    $jobs += Start-Job -Name "aegis-ai-engine" -ScriptBlock {
        param($root, $py)
        Set-Location "$root\ai-engine"
        & .\venv\Scripts\Activate.ps1
        & $py -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    } -ArgumentList $ProjectRoot, $pythonCmd
}

Write-Success "Services starting!"
Write-Host ""
Write-Host "    Server:    http://localhost:3001"
Write-Host "    Client:    http://localhost:5173"
Write-Host "    AI Engine: http://localhost:8000/docs"
Write-Host ""
Write-Host "Press Ctrl+C to stop all services"
Write-Host ""

# Monitor jobs and forward output
try {
    while ($true) {
        foreach ($job in $jobs) {
            Receive-Job -Job $job -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "[$($job.Name)] $_"
            }
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Status "Stopping services..."
    $jobs | Stop-Job -PassThru | Remove-Job
    Write-Success "All services stopped"
}
