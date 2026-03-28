#!/usr/bin/env node
/**
 * start-dev.mjs — Cross-platform development startup script
 * 
 * Works on Windows, macOS, and Linux.
 * Uses Node.js child processes instead of shell-specific commands.
 * 
 * Usage:
 *   node start-dev.mjs          # Start all services
 *   node start-dev.mjs server   # Start only server
 *   node start-dev.mjs client   # Start only client
 *   node start-dev.mjs ai       # Start only AI engine
 */

import { spawn, execSync } from 'child_process'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
}

const log = {
  info: (msg) => console.log(`${colors.cyan}[*] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[OK] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!]  ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[ERR] ${msg}${colors.reset}`),
}

// Dependency checks

function commandExists(cmd) {
  try {
    execSync(isWindows ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function checkDependencies() {
  log.info('Checking dependencies...')

  // Node.js (obviously exists if we're running this)
  const nodeVersion = process.version
  log.success(`Node.js ${nodeVersion}`)

  // npm
  if (!commandExists('npm')) {
    log.error('npm not found')
    process.exit(1)
  }
  log.success('npm available')

  // Python
  const pythonCmd = commandExists('python3') ? 'python3' : commandExists('python') ? 'python' : null
  if (pythonCmd) {
    try {
      const version = execSync(`${pythonCmd} --version`, { encoding: 'utf8' }).trim()
      log.success(version)
    } catch {
      log.warn('Python found but version check failed')
    }
  } else {
    log.warn('Python not found — AI Engine will not start')
  }

  return { pythonCmd }
}

// Environment setup

function ensureEnvFile(filePath, template) {
  if (!existsSync(filePath)) {
    log.info(`Creating ${filePath}...`)
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, template, 'utf8')
    log.warn(`Created ${filePath} — please update with real values`)
    return true
  }
  return false
}

function setupEnvFiles() {
  const serverEnv = `# Server Configuration
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis
JWT_SECRET=${randomUUID()}
AI_ENGINE_URL=http://localhost:8000

# Required for internal API auth
INTERNAL_API_KEY=${randomUUID()}
N8N_WEBHOOK_SECRET=${randomUUID()}

# Optional: Add your API keys here
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
`

  const clientEnv = `# Client Configuration
VITE_API_URL=http://localhost:3001
VITE_MAPBOX_TOKEN=pk.your_mapbox_token_here
`

  const aiEngineEnv = `# AI Engine Configuration
ENV=development
HOST=0.0.0.0
PORT=8000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis
API_SECRET_KEY=${randomUUID()}
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
`

  ensureEnvFile(join(__dirname, 'server', '.env'), serverEnv)
  ensureEnvFile(join(__dirname, 'client', '.env'), clientEnv)
  ensureEnvFile(join(__dirname, 'ai-engine', '.env'), aiEngineEnv)
}

// Service spawning

function spawnService(name, cwd, command, args = [], env = {}) {
  log.info(`Starting ${name}...`)

  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n')
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`${colors.dim}[${name}]${colors.reset} ${line}`)
      }
    })
  })

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n')
    lines.forEach((line) => {
      if (line.trim()) {
        console.log(`${colors.yellow}[${name}]${colors.reset} ${line}`)
      }
    })
  })

  proc.on('error', (err) => {
    log.error(`${name} failed to start: ${err.message}`)
  })

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log.warn(`${name} exited with code ${code}`)
    }
  })

  return proc
}

// Main

async function main() {
  const service = process.argv[2] || 'all'
  const validServices = ['all', 'server', 'client', 'ai']

  if (!validServices.includes(service)) {
    log.error(`Invalid service: ${service}`)
    console.log(`Valid options: ${validServices.join(', ')}`)
    process.exit(1)
  }

  console.log('')
  console.log('  AEGIS v6 Development Environment')
  console.log('')

  const { pythonCmd } = checkDependencies()
  setupEnvFiles()

  console.log('')
  log.info('Starting services...')
  console.log('')

  const processes = []

  // Install dependencies and start server
  if (service === 'all' || service === 'server') {
    log.info('Installing server dependencies...')
    try {
      execSync('npm install', { cwd: join(__dirname, 'server'), stdio: 'inherit' })
    } catch (e) {
      log.warn('npm install for server had warnings')
    }
    processes.push(
      spawnService('server', join(__dirname, 'server'), 'npm', ['run', 'dev'])
    )
  }

  // Install dependencies and start client
  if (service === 'all' || service === 'client') {
    log.info('Installing client dependencies...')
    try {
      execSync('npm install', { cwd: join(__dirname, 'client'), stdio: 'inherit' })
    } catch (e) {
      log.warn('npm install for client had warnings')
    }
    processes.push(
      spawnService('client', join(__dirname, 'client'), 'npm', ['run', 'dev'])
    )
  }

  // Setup venv and start AI engine
  if ((service === 'all' || service === 'ai') && pythonCmd) {
    const aiDir = join(__dirname, 'ai-engine')
    const venvDir = join(aiDir, 'venv')
    const venvPython = isWindows
      ? join(venvDir, 'Scripts', 'python.exe')
      : join(venvDir, 'bin', 'python')

    // Create venv if not exists
    if (!existsSync(venvDir)) {
      log.info('Creating Python virtual environment...')
      execSync(`${pythonCmd} -m venv venv`, { cwd: aiDir, stdio: 'inherit' })
    }

    // Install requirements
    log.info('Installing AI Engine dependencies...')
    try {
      execSync(`"${venvPython}" -m pip install -r requirements.txt`, {
        cwd: aiDir,
        stdio: 'inherit',
      })
    } catch (e) {
      log.warn('pip install had warnings')
    }

    processes.push(
      spawnService(
        'ai-engine',
        aiDir,
        `"${venvPython}"`,
        ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000', '--reload']
      )
    )
  }

  console.log('')
  log.success('Services starting!')
  console.log('')
  console.log('[-] Server:    http://localhost:3001')
  console.log('[-] Client:    http://localhost:5173')
  console.log('[-] AI Engine: http://localhost:8000/docs')
  console.log('')
  console.log('Press Ctrl+C to stop all services')
  console.log('')

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('')
    log.info('Shutting down...')
    processes.forEach((p) => {
      try {
        if (isWindows) {
          spawn('taskkill', ['/F', '/T', '/PID', p.pid.toString()])
        } else {
          p.kill('SIGTERM')
        }
      } catch {
        // Process may already be dead
      }
    })
    log.success('All services stopped')
    process.exit(0)
  })

  // Keep alive
  await new Promise(() => {})
}

main().catch((err) => {
  log.error(err.message)
  process.exit(1)
})

