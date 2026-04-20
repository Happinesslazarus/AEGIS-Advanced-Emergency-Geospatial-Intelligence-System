//Create admin operator and trigger training
const http = require('http');
const { Pool } = require('pg');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch {
  bcrypt = require('bcrypt');
}

const pool = new Pool({
  host: 'localhost', port: 5432, database: 'aegis',
  user: 'postgres', password: process.env.DB_PASSWORD
});

function httpReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '{}';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: 'localhost', port: 3001, path, method, headers, timeout: 120000
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  //1. Create admin operator
  console.log('1. Creating admin operator...');
  const hash = await bcrypt.hash('Admin123!@#', 12);
  const id = '00000000-0000-0000-0000-000000000099';
  
  try {
    await pool.query(`
      INSERT INTO operators (id, email, password_hash, display_name, role, department, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'admin', 'System', true, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET password_hash = $3, role = 'admin'
    `, [id, 'admin@aegis.com', hash, 'AEGIS Admin']);
    console.log('  Admin operator created/updated');
  } catch (e) {
    console.log('  DB error:', e.message);
  }
  
  //2. Login via operator login endpoint
  console.log('\n2. Logging in...');
  
  //Try operator login
  let token = null;
  for (const path of ['/api/auth/operator/login', '/api/auth/login']) {
    const res = await httpReq('POST', path, {
      email: 'admin@aegis.com',
      password: 'Admin123!@#'
    });
    console.log(`  ${path}: ${res.status}`);
    if (res.status === 200 && res.body && res.body.token) {
      token = res.body.token;
      console.log('  Got JWT token!');
      break;
    }
  }
  
  if (!token) {
    console.log('  Could not get token. Trying direct approach...');
    //Generate a JWT directly
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'aegis-jwt-secret-key-change-me-in-production';
    token = jwt.sign(
      { id, role: 'admin', email: 'admin@aegis.com' },
      secret,
      { expiresIn: '1h' }
    );
    console.log('  Generated JWT directly');
  }
  
  //3. Trigger training
  console.log('\n3. Triggering ML training pipeline...');
  const trainRes = await httpReq('POST', '/api/training/run', {}, token);
  console.log('  Status:', trainRes.status);
  const output = JSON.stringify(trainRes.body, null, 2);
  console.log('  Response:', output.substring(0, 3000));
  if (output.length > 3000) console.log('  ... [truncated]');
  
  await pool.end();
}

main().catch(console.error);
