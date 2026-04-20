//End-to-end test: submit a report and check AI analysis
const http = require('http');

const JWT = (() => {
  const crypto = require('crypto');
  const secret = 'aeg1s-pr0d-s3cr3t-x7k9m2n4p6q8r0t1w3y5v7b9d1f3h5j7l9';
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: '5c963449-c7b1-41ab-8c07-2051c9c99610',
    email: 'admin@aegis.com',
    role: 'admin',
    type: 'operator',
    iat: Math.floor(Date.now()/1000),
    exp: Math.floor(Date.now()/1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
})();

//Test 1: Get AI prediction status
function testEndpoint(path, label) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:3001${path}`, {
      headers: { 'Authorization': `Bearer ${JWT}` }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log(`\n${label}: Status ${res.statusCode}`);
        try {
          const j = JSON.parse(data);
          console.log(JSON.stringify(j, null, 2).slice(0, 500));
        } catch { console.log(data.slice(0, 500)); }
        resolve();
      });
    });
    req.on('error', e => { console.log(`${label}: ERROR - ${e.message}`); resolve(); });
  });
}

//Test 2: Submit a test report (citizen endpoint, no auth needed)
function testReportSubmission() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      incident_category: 'flood',
      incident_subtype: 'river_flooding',
      description: 'Major flooding on the River Thames near Henley. Water level has risen 2 meters above normal. Multiple roads submerged and 3 houses evacuated.',
      severity: 'high',
      location_text: 'Henley-on-Thames, Oxfordshire',
      coordinates: { lat: 51.5358, lng: -0.9021 },
      reporter_name: 'E2E Test'
    });
    
    const req = http.request('http://localhost:3001/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log(`\nReport Submit: Status ${res.statusCode}`);
        try {
          const j = JSON.parse(data);
          console.log(JSON.stringify(j, null, 2).slice(0, 1000));
        } catch { console.log(data.slice(0, 1000)); }
        resolve();
      });
    });
    req.on('error', e => { console.log(`Report Submit: ERROR - ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== AEGIS E2E AI Verification ===');
  await testEndpoint('/api/health', 'Health Check');
  await testEndpoint('/api/ai/status', 'AI Status');
  await testEndpoint('/api/training/status', 'Training Status');
  await testReportSubmission();
}

main();
