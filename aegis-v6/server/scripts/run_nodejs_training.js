// Call Node.js training pipeline via HTTP
const http = require('http');

// First login as admin to get JWT
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: 120000
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function postWithAuth(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function main() {
  console.log('1. Logging in as admin...');
  const loginRes = await post('/api/auth/login', {
    email: 'admin@aegis.com',
    password: 'adminpassword'
  });
  
  if (loginRes.status !== 200 || !loginRes.body.token) {
    console.log('Login failed:', loginRes.status, JSON.stringify(loginRes.body).substring(0, 200));
    // Try to register admin first
    console.log('Trying to register admin...');
    const regRes = await post('/api/auth/register', {
      email: 'admin@aegis.com',
      password: 'adminpassword',
      name: 'AEGIS Admin',
      role: 'admin'
    });
    console.log('Registration:', regRes.status, JSON.stringify(regRes.body).substring(0, 200));
    
    // Try login again
    const loginRes2 = await post('/api/auth/login', {
      email: 'admin@aegis.com',
      password: 'adminpassword'
    });
    if (loginRes2.status !== 200 || !loginRes2.body.token) {
      console.log('Login still failed:', loginRes2.status, JSON.stringify(loginRes2.body).substring(0, 200));
      return;
    }
    loginRes.body = loginRes2.body;
  }
  
  const token = loginRes.body.token;
  console.log('  Got JWT token');
  
  console.log('\n2. Triggering training pipeline...');
  const trainRes = await postWithAuth('/api/training/run', token);
  console.log('  Status:', trainRes.status);
  console.log('  Response:', JSON.stringify(trainRes.body, null, 2).substring(0, 2000));
}

main().catch(console.error);
