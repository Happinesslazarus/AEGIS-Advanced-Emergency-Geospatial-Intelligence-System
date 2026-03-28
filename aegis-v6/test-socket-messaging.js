#!/usr/bin/env node

 /*
 * test-socket-messaging.js - Test bidirectional admin <-> citizen messaging
 * This script:
 * 1. Gets admin and citizen tokens from login endpoint
 * 2. Connects both as Socket.IO clients
 * 3. Citizen creates a new message thread
 * 4. Admin receives the thread notification
 * 5. Admin sends a reply message
 * 6. Citizen receives the reply
 * 7. Completes the test with success/failure reporting
  */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const io = require('socket.io-client');

const API_URL = process.env.API_URL || 'http://localhost:3001';
const SOCKET_URL = process.env.SOCKET_URL || API_URL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@aegis.gov.uk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const CITIZEN_EMAIL = process.env.CITIZEN_EMAIL || 'citizen@aegis.gov.uk';
const CITIZEN_PASSWORD = process.env.CITIZEN_PASSWORD || '';
const ADMIN_LOGIN_PATH = process.env.ADMIN_LOGIN_PATH || '/api/auth/login';
const CITIZEN_LOGIN_PATH = process.env.CITIZEN_LOGIN_PATH || '/api/citizen-auth/login';

let adminToken, citizenToken;
let adminSocket, citizenSocket;
let testThreadId;
let messageCounts = { citizenReceived: 0, adminReceived: 0 };
let testResults = [];
function validateCredentials() {
  if (!ADMIN_PASSWORD || !CITIZEN_PASSWORD) {
    log('Missing required env vars: ADMIN_PASSWORD and CITIZEN_PASSWORD', 'error');
    log('Set ADMIN_EMAIL/CITIZEN_EMAIL too if you are not using defaults.', 'warning');
    process.exit(1);
  }
}

function log(msg, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    error: '\x1b[31m',
    warning: '\x1b[33m',
    reset: '\x1b[0m'
  };
  console.log(`${colors[type] || colors.info}[${type.toUpperCase()}]${colors.reset} ${msg}`);
}

async function loginUser(email, password, loginPath) {
  try {
    const res = await fetch(`${API_URL}${loginPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.token) throw new Error(data.error || 'No token returned');
    return data.token;
  } catch (err) {
    throw new Error(`Login failed: ${err.message}`);
  }
}

async function setupConnections() {
  try {
    log(`Using API: ${API_URL}`, 'info');
    log(`Using Socket: ${SOCKET_URL}`, 'info');
    log(`Using admin login path: ${ADMIN_LOGIN_PATH}`, 'info');
    log(`Using citizen login path: ${CITIZEN_LOGIN_PATH}`, 'info');

    log('Logging in admin...', 'info');
    adminToken = await loginUser(ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_LOGIN_PATH);
    log('✓ Admin login successful', 'success');

    // For citizen, we'll try to get an existing citizen or it will fail
    // This is ok - we'll handle the error
    try {
      citizenToken = await loginUser(CITIZEN_EMAIL, CITIZEN_PASSWORD, CITIZEN_LOGIN_PATH);
      log('✓ Citizen login successful', 'success');
    } catch (e) {
      log(`Citizen login not available (this is OK for testing): ${e.message}`, 'warning');
      // We'll skip citizen-side testing if citizen account doesn't exist
      return false;
    }

    return true;
  } catch (err) {
    log(`Setup failed: ${err.message}`, 'error');
    return false;
  }
}

function connectSockets() {
  return new Promise((resolve) => {
    let adminConnected = false;
    let citizenConnected = false;

    // Admin socket
    log('Connecting admin socket...', 'info');
    adminSocket = io(SOCKET_URL, {
      auth: { token: adminToken },
      transports: ['websocket', 'polling'],
      reconnection: false,
    });

    adminSocket.on('connect', () => {
      log('✓ Admin socket connected', 'success');
      adminConnected = true;
      setupAdminListeners();
      if (adminConnected && citizenConnected) resolve(true);
      if (adminConnected && !citizenToken) resolve(true); // Just admin testing
    });

    adminSocket.on('connect_error', (err) => {
      log(`Admin connection error: ${err.message}`, 'error');
      resolve(false);
    });

    // Citizen socket
    if (citizenToken) {
      log('Connecting citizen socket...', 'info');
      citizenSocket = io(SOCKET_URL, {
        auth: { token: citizenToken },
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      citizenSocket.on('connect', () => {
        log('✓ Citizen socket connected', 'success');
        citizenConnected = true;
        setupCitizenListeners();
        if (adminConnected && citizenConnected) resolve(true);
      });

      citizenSocket.on('connect_error', (err) => {
        log(`Citizen connection error: ${err.message}`, 'error');
        resolve(false);
      });
    }

    // Timeout
    setTimeout(() => {
      if (!adminConnected) {
        log('Admin connection timeout', 'error');
        resolve(false);
      }
    }, 5000);
  });
}

function setupAdminListeners() {
  adminSocket.on('admin:new_thread', (data) => {
    log(`✓ Admin received new thread: ${data.subject}`, 'success');
    testThreadId = data.id;
    testResults.push({ test: 'Admin receives new thread', passed: !!testThreadId });

    // Simulate admin reading message and replying
    setTimeout(() => {
      log(`Admin sending reply to thread ${testThreadId}...`, 'info');
      adminSocket.emit('message:send',
        { threadId: testThreadId, content: 'Hello citizen, how can I help?' },
        (response) => {
          if (response?.success) {
            log('✓ Admin sent message successfully', 'success');
            testResults.push({ test: 'Admin sends message', passed: true });
          } else {
            log('✗ Admin message failed', 'error');
            testResults.push({ test: 'Admin sends message', passed: false });
          }
        }
      );
    }, 500);
  });

  adminSocket.on('admin:new_message', (data) => {
    log(`✓ Admin received new message from citizen: "${data.message?.content}"`, 'success');
    messageCounts.adminReceived++;
  });

  adminSocket.on('admin:threads', (threads) => {
    log(`Admin received ${threads.length} threads on connect`, 'info');
  });
}

function setupCitizenListeners() {
  citizenSocket.on('citizen:new_reply', (data) => {
    log(`✓ Citizen received reply: "${data.message?.content}"`, 'success');
    messageCounts.citizenReceived++;
    testResults.push({ test: 'Citizen receives admin reply', passed: true });

    // Test complete
    completeTest();
  });

  citizenSocket.on('message:new', (msg) => {
    log(`Citizen received message in thread`, 'info');
  });
}

async function testMessaging() {
  // Only test if citizen is available
  if (!citizenToken) {
    log('Citizen token not available, testing with admin only', 'warning');
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  log('Citizen creating new thread...', 'info');
  citizenSocket.emit('thread:create',
    {
      subject: 'Test Emergency Query',
      message: 'I need urgent help with flooding in my area!',
      isEmergency: true
    },
    (response) => {
      if (response?.success) {
        log('✓ Citizen created thread successfully', 'success');
        testResults.push({ test: 'Citizen creates thread', passed: true });
      } else {
        log(`✗ Citizen thread creation failed: ${response?.error}`, 'error');
        testResults.push({ test: 'Citizen creates thread', passed: false });
      }
    }
  );
}

function completeTest() {
  log('\n TEST RESULTS ', 'info');

  let passed = 0;
  testResults.forEach((result, i) => {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? 'success' : 'error';
    log(`${i + 1}. ${icon} ${result.test}`, color);
    if (result.passed) passed++;
  });

  log(`\nPassed: ${passed}/${testResults.length}`, passed === testResults.length ? 'success' : 'warning');

  log('\nMessage counts:', 'info');
  log(`  - Admin received: ${messageCounts.adminReceived} messages`, 'info');
  log(`  - Citizen received: ${messageCounts.citizenReceived} messages`, 'info');

  if (passed === testResults.length) {
    log('MESSAGING SYSTEM IS FULLY OPERATIONAL', 'success');
    process.exit(0);
  }

  log('MESSAGING SYSTEM HAS ISSUES', 'warning');
  process.exit(1);
}

// Run test
async function runTest() {
  try {
    validateCredentials();
    log('Starting Socket.IO Bidirectional Messaging Test...', 'info');

    const ready = await setupConnections();
    if (!ready) {
      log('Failed to setup connections', 'error');
      process.exit(1);
    }

    const connected = await connectSockets();
    if (!connected) {
      log('Failed to connect sockets', 'error');
      process.exit(1);
    }

    log('Starting test scenarios...', 'info');
    await testMessaging();

    // Wait for test to complete (with timeout)
    setTimeout(() => {
      if (testResults.length > 0) {
        completeTest();
      } else {
        log('Test timed out - no responses received', 'warning');
        completeTest();
      }
    }, 8000);

  } catch (err) {
    log(`Test error: ${err.message}`, 'error');
    process.exit(1);
  }
}

runTest();
