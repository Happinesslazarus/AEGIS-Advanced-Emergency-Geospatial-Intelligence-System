import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

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

const aiStatusDuration = new Trend('ai_status_duration', true);
const aiPredictionDuration = new Trend('ai_prediction_duration', true);
const aiModelsDuration = new Trend('ai_models_duration', true);
const aiErrors = new Rate('ai_errors');

export const options = {
  scenarios: {
    ai_status: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '10s',
      duration: '60s',
      preAllocatedVUs: 4,
      maxVUs: 8,
      exec: 'checkAIStatus',
    },
    ai_predictions: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '10s',
      duration: '60s',
      preAllocatedVUs: 3,
      maxVUs: 6,
      exec: 'fetchPredictions',
    },
    ai_models: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '10s',
      duration: '60s',
      preAllocatedVUs: 3,
      maxVUs: 6,
      exec: 'listModels',
    },
  },
  thresholds: {
    ai_status_duration: ['p(95)<500', 'p(99)<1500'],
    ai_prediction_duration: ['p(95)<2000', 'p(99)<5000'],
    ai_models_duration: ['p(95)<500', 'p(99)<1500'],
    ai_errors: ['rate<0.02'],
  },
};

export function checkAIStatus() {
  const res = http.get(`${BASE}/api/ai/status`);
  aiStatusDuration.add(res.timings.duration);
  const ok = check(res, {
    'ai status 200': (r) => r.status === 200,
  });
  aiErrors.add(!ok);
  sleep(0.1);
}

export function fetchPredictions() {
  const res = http.post(`${BASE}/api/ai/predict`, buildAIPredictionPayload(), {
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
    },
  });
  aiPredictionDuration.add(res.timings.duration);
  const ok = check(res, {
    'predictions 200': (r) => r.status === 200,
  });
  aiErrors.add(!ok);
  sleep(0.2);
}

export function listModels() {
  const res = http.get(`${BASE}/api/ai/governance/models`);
  aiModelsDuration.add(res.timings.duration);
  const ok = check(res, {
    'models 200': (r) => r.status === 200,
  });
  aiErrors.add(!ok);
  sleep(0.2);
}
