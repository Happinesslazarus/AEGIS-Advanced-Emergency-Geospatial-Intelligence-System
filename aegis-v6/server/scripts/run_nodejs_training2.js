// Create admin user in DB and trigger training
const http = require('http');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'aegis',
  user: 'postgres',
  password: process.env.DB_PASSWORD
});

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    
    const req = http.request({
      hostname: 'localhost', port: 3001, path, method: 'POST',
      headers, timeout: 120000
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
  // 1. Create admin user with bcrypt hash
  console.log('1. Creating admin user...');
  const hash = await bcrypt.hash('Admin123!@#', 12);
  
  try {
    await pool.query(`
      INSERT INTO citizens (email, password_hash, display_name, role, email_verified, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, true, true, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = $4
    `, ['admin@aegis.com', hash, 'AEGIS Admin', 'admin']);
    console.log('  Admin user created/updated');
  } catch (e) {
    console.log('  DB error:', e.message);
  }
  
  // 2. Login
  console.log('\n2. Logging in...');
  const loginRes = await post('/api/auth/login', {
    email: 'admin@aegis.com',
    password: 'Admin123!@#'
  });
  
  if (loginRes.status !== 200) {
    console.log('  Login failed:', loginRes.status, JSON.stringify(loginRes.body).substring(0, 300));
    await pool.end();
    return;
  }
  
  const token = loginRes.body.token;
  console.log('  Got JWT token');
  
  // 3. Trigger training
  console.log('\n3. Triggering ML training pipeline...');
  const trainRes = await post('/api/training/run', {}, token);
  console.log('  Status:', trainRes.status);
  console.log('  Response:', JSON.stringify(trainRes.body, null, 2).substring(0, 3000));
  
  await pool.end();
}

main().catch(console.error);
