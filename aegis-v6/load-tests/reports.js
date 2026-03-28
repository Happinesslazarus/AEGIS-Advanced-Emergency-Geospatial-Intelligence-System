import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';

function buildReportPayload() {
  const latitude = 57.15 + Math.random() * 0.1;
  const longitude = -2.09 + Math.random() * 0.1;
  return JSON.stringify({
    incidentCategory: 'flood',
    incidentSubtype: 'river_flood',
    displayType: 'Flood - River Flood',
    description: `Load test report ${Date.now()} automated production drill payload`,
    severity: 'medium',
    trappedPersons: 'no',
    locationText: 'Aberdeen, Scotland',
    lat: String(latitude),
    lng: String(longitude),
  });
}

const reportSubmitDuration = new Trend('report_submit_duration', true);
const reportListDuration = new Trend('report_list_duration', true);
const reportErrors = new Rate('report_errors');
const reportCount = new Counter('reports_submitted');

export const options = {
  scenarios: {
    list_reports: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '10s',
      duration: '60s',
      preAllocatedVUs: 6,
      maxVUs: 12,
      exec: 'listReports',
    },
    submit_reports: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 4,
      maxDuration: '90s',
      exec: 'submitReport',
    },
  },
  thresholds: {
    report_list_duration: ['p(95)<500', 'p(99)<1500'],
    report_submit_duration: ['p(95)<2000', 'p(99)<5000'],
    report_errors: ['rate<0.01'],
  },
};

export function listReports() {
  const res = http.get(`${BASE}/api/reports`);
  reportListDuration.add(res.timings.duration);
  const ok = check(res, {
    'list 200': (r) => r.status === 200,
    'is array': (r) => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  });
  reportErrors.add(!ok);
  sleep(0.1);
}

export function submitReport() {
  const payload = buildReportPayload();

  const res = http.post(`${BASE}/api/reports`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  reportSubmitDuration.add(res.timings.duration);
  const ok = res.status === 200 || res.status === 201;
  if (ok) {
    reportCount.add(1);
  }
  reportErrors.add(!ok);
  sleep(0.5);
}
