import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';

const alertListDuration = new Trend('alert_list_duration', true);
const alertErrors = new Rate('alert_errors');

export const options = {
  scenarios: {
    fetch_alerts: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 40,
      maxVUs: 80,
      exec: 'fetchAlerts',
    },
  },
  thresholds: {
    alert_list_duration: ['p(95)<300', 'p(99)<1000'],
    alert_errors: ['rate<0.01'],
  },
};

export function fetchAlerts() {
  const res = http.get(`${BASE}/api/alerts`);
  alertListDuration.add(res.timings.duration);
  const ok = check(res, {
    'alerts 200': (r) => r.status === 200,
  });
  alertErrors.add(!ok);
  sleep(0.05);
}
