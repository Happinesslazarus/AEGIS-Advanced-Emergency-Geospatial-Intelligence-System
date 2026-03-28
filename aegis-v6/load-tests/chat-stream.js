import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';

const chatStreamDuration = new Trend('chat_stream_duration', true);
const chatStreamErrors = new Rate('chat_stream_errors');
const chatStreamsCompleted = new Counter('chat_streams_completed');

export const options = {
  scenarios: {
    chat_stream: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      stages: [
        { duration: '15s', target: 5 },
        { duration: '30s', target: 5 },
        { duration: '15s', target: 0 },
      ],
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'streamChat',
    },
  },
  thresholds: {
    chat_stream_duration: ['p(95)<10000', 'p(99)<20000'],
    chat_stream_errors: ['rate<0.05'],
  },
};

const QUESTIONS = [
  'What should I do during a flood?',
  'How do I prepare an emergency kit?',
  'Is there a drought warning in my area?',
  'What are the evacuation routes near Aberdeen?',
  'How to report a broken water main?',
];

export function streamChat() {
  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const payload = JSON.stringify({ message: question });

  const res = http.post(`${BASE}/api/chat/stream`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });

  chatStreamDuration.add(res.timings.duration);
  chatStreamsCompleted.add(1);

  const ok = check(res, {
    'stream 200': (r) => r.status === 200,
    'has body': (r) => r.body && r.body.length > 0,
  });

  chatStreamErrors.add(!ok);
  sleep(1);
}
