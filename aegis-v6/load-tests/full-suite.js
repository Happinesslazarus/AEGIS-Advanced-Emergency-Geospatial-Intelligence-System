 * AEGIS Full Load Test Suite
 *
 * Runs all critical path scenarios concurrently:
 * Report listing + submission
 * Alert fetching
 * Distress endpoint
 * AI status + predictions + models
 * Chat streaming
 *
 * Usage:
 *   k6 run load-tests/full-suite.js
 *   k6 run -e BASE_URL=http://staging:3001 load-tests/full-suite.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';
const OPERATOR_HEADERS = ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};

function buildReportPayload() {
  const latitude = 57.15 + Math.random() * 0.1;
  const longitude = -2.09 + Math.random() * 0.1;
  return JSON.stringify({
    incidentCategory: 'flood',
    incidentSubtype: 'river_flood',
    displayType: 'Flood - River Flood',
    description: `Load test ${Date.now()} automated production drill payload`,
    severity: 'medium',
    trappedPersons: 'no',
    locationText: 'Aberdeen, Scotland',
    lat: String(latitude),
    lng: String(longitude),
  });
}

function buildAIPredictionPayload() {
  return JSON.stringify({
    hazard_type: 'flood',
    region_id: 'uk-default',
    latitude: 57.1497,
    longitude: -2.0943,
    forecast_horizon: 48,
    include_contributing_factors: true,
  });
}

//Metrics
const reportListDuration   = new Trend('report_list_duration', true);
const reportSubmitDuration = new Trend('report_submit_duration', true);
const alertListDuration    = new Trend('alert_list_duration', true);
const distressDuration     = new Trend('distress_list_duration', true);
const aiStatusDuration     = new Trend('ai_status_duration', true);
const aiPredictionDuration = new Trend('ai_prediction_duration', true);
const chatStreamDuration   = new Trend('chat_stream_duration', true);

const errorRate = new Rate('errors');
const reportsSubmitted = new Counter('reports_submitted');

//Options
export const options = {
  scenarios: {
    list_reports: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '10s', duration: '2m',
      preAllocatedVUs: 6, maxVUs: 12,
      exec: 'listReports',
    },
    submit_reports: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 6,
      maxDuration: '2m30s',
      exec: 'submitReport',
    },
    fetch_alerts: {
      executor: 'constant-arrival-rate',
      rate: 20, timeUnit: '10s', duration: '2m',
      preAllocatedVUs: 6, maxVUs: 12,
      exec: 'fetchAlerts',
    },
    list_distress: {
      executor: 'constant-arrival-rate',
      rate: 10, timeUnit: '10s', duration: '2m',
      preAllocatedVUs: 4, maxVUs: 8,
      exec: 'listDistress',
    },
    ai_status: {
      executor: 'constant-arrival-rate',
      rate: 10, timeUnit: '10s', duration: '2m',
      preAllocatedVUs: 4, maxVUs: 8,
      exec: 'checkAIStatus',
    },
    ai_predictions: {
      executor: 'constant-arrival-rate',
      rate: 5, timeUnit: '10s', duration: '2m',
      preAllocatedVUs: 3, maxVUs: 6,
      exec: 'fetchPredictions',
    },
    chat_stream: {
      executor: 'ramping-arrival-rate',
      startRate: 0, timeUnit: '10s',
      stages: [
        { duration: '30s', target: 1 },
        { duration: '60s', target: 1 },
        { duration: '30s', target: 0 },
      ],
      preAllocatedVUs: 2, maxVUs: 4,
      exec: 'streamChat',
    },
  },
  thresholds: {
    report_list_duration:   ['p(95)<500',   'p(99)<1500'],
    report_submit_duration: ['p(95)<2000',  'p(99)<5000'],
    alert_list_duration:    ['p(95)<300',   'p(99)<1000'],
    distress_list_duration: ['p(95)<500',   'p(99)<1500'],
    ai_status_duration:     ['p(95)<500',   'p(99)<1500'],
    ai_prediction_duration: ['p(95)<2000',  'p(99)<5000'],
    chat_stream_duration:   ['p(95)<10000', 'p(99)<20000'],
    errors:                 ['rate<0.01'],
  },
};

//Handlers
export function listReports() {
  const r = http.get(`${BASE}/api/reports`);
  reportListDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(0.1);
}

export function submitReport() {
  const payload = buildReportPayload();
  const r = http.post(`${BASE}/api/reports`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  reportSubmitDuration.add(r.timings.duration);
  const ok = r.status >= 200 && r.status < 300;
  if (ok) {
    reportsSubmitted.add(1);
  }
  errorRate.add(!ok);
  sleep(0.5);
}

export function fetchAlerts() {
  const r = http.get(`${BASE}/api/alerts`);
  alertListDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(0.05);
}

export function listDistress() {
  const r = http.get(`${BASE}/api/distress/active`, { headers: OPERATOR_HEADERS });
  distressDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(0.1);
}

export function checkAIStatus() {
  const r = http.get(`${BASE}/api/ai/status`);
  aiStatusDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(0.1);
}

export function fetchPredictions() {
  const r = http.post(`${BASE}/api/ai/predict`, buildAIPredictionPayload(), {
    headers: {
      'Content-Type': 'application/json',
      ...OPERATOR_HEADERS,
    },
  });
  aiPredictionDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(0.2);
}

const QUESTIONS = [
  'What should I do during a flood?',
  'How do I prepare an emergency kit?',
  'Is there a drought warning in my area?',
];

export function streamChat() {
  const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const r = http.post(`${BASE}/api/chat/stream`, JSON.stringify({ message: q }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });
  chatStreamDuration.add(r.timings.duration);
  errorRate.add(!check(r, { '200': (x) => x.status === 200 }));
  sleep(1);
}

