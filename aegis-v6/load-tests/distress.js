import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

const distressListDuration = new Trend('distress_list_duration', true);
const distressErrors = new Rate('distress_errors');

export const options = {
  scenarios: {
    //Distress HTTP endpoints stress test
    list_distress: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '10s',
      duration: '60s',
      preAllocatedVUs: 4,
      maxVUs: 8,
      exec: 'listDistress',
    },
  },
  thresholds: {
    distress_list_duration: ['p(95)<500', 'p(99)<1500'],
    distress_errors: ['rate<0.01'],
  },
};

export function listDistress() {
  const res = http.get(`${BASE}/api/distress/active`, {
    headers: ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {},
  });
  distressListDuration.add(res.timings.duration);
  const ok = check(res, {
    'distress 200': (r) => r.status === 200,
  });
  distressErrors.add(!ok);
  sleep(0.1);
}
