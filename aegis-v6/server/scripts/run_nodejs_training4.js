// Create admin operator and trigger Node.js ML training
const http = require('http');
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost', port: 5432, database: 'aegis',
  user: 'postgres', password: process.env.DB_PASSWORD
});

const JWT_SECRET = 'aeg1s-pr0d-s3cr3t-x7k9m2n4p6q8r0t1w3y5v7b9d1f3h5j7l9';

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
  // 1. Check if admin exists
  const existing = await pool.query("SELECT id FROM operators WHERE email = 'admin@aegis.com' LIMIT 1");
  
  if (existing.rows.length === 0) {
    console.log('1. Creating admin operator...');
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Admin123!@#', 12);
    await pool.query(`
      INSERT INTO operators (email, password_hash, display_name, role, department, is_active, email_verified)
      VALUES ($1, $2, $3, 'admin', 'System', true, true)
    `, ['admin@aegis.com', hash, 'AEGIS Admin']);
    console.log('  Admin operator created');
  } else {
    console.log('1. Admin operator already exists');
  }
  
  // 2. Get admin ID
  const adminRow = await pool.query("SELECT id FROM operators WHERE email = 'admin@aegis.com' LIMIT 1");
  const adminId = adminRow.rows[0].id;
  console.log('  Admin ID:', adminId);
  
  // 3. Generate JWT directly with correct secret
  console.log('\n2. Generating JWT...');
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { id: adminId, role: 'admin', email: 'admin@aegis.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log('  JWT generated');
  
  // 4. Trigger training
  console.log('\n3. Triggering ML training pipeline...');
  const trainRes = await httpReq('POST', '/api/training/run', {}, token);
  console.log('  Status:', trainRes.status);
  const output = JSON.stringify(trainRes.body, null, 2);
  console.log('  Response:', output.substring(0, 4000));
  if (output.length > 4000) console.log('  ... [truncated]');
  
  await pool.end();
}

main().catch(console.error);
