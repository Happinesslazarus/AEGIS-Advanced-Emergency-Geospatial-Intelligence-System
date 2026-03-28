// E2E test: submit a report and verify AI analysis
const http = require('http');

function postReport() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      incidentCategory: 'flood',
      incidentSubtype: 'river_flooding',
      description: 'Major flooding on the River Thames near Henley. Water level has risen 2 meters above normal. Multiple roads submerged and 3 houses evacuated. Emergency services deployed.',
      severity: 'high',
      locationText: 'Henley-on-Thames, Oxfordshire',
      lat: 51.5358,
      lng: -0.9021,
    });
    
    const req = http.request('http://localhost:3001/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log(`Report Submit: Status ${res.statusCode}`);
        try {
          const j = JSON.parse(data);
          // Show key AI fields
          if (j.data) {
            const r = j.data;
            console.log(`  ID: ${r.id}`);
            console.log(`  Report #: ${r.report_number}`);
            console.log(`  Category: ${r.incident_category}`);
            console.log(`  Severity: ${r.severity}`);
            console.log(`  AI Confidence: ${r.ai_confidence}`);
            console.log(`  AI Analysis: ${JSON.stringify(r.ai_analysis, null, 2).slice(0, 800)}`);
          } else {
            console.log(JSON.stringify(j, null, 2).slice(0, 800));
          }
        } catch { console.log(data.slice(0, 800)); }
        resolve();
      });
    });
    req.on('error', e => { console.log(`ERROR: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

postReport();
