# AEGIS Load & Performance Tests

[k6](https://k6.io/) load testing suite covering critical paths.

## Prerequisites

```bash
# Install k6 (Windows — choco or scoop)
choco install k6
# or: scoop install k6

# macOS / Linux
brew install k6
```

## Running

```bash
# Individual scenarios
k6 run load-tests/reports.js
k6 run load-tests/alerts.js
k6 run load-tests/distress.js
k6 run load-tests/ai-predictions.js
k6 run load-tests/chat-stream.js

# Full suite
k6 run load-tests/full-suite.js
```

## Configuration

Set `BASE_URL` via environment or edit the scripts:

```bash
k6 run -e BASE_URL=http://localhost:3001 load-tests/full-suite.js
```

## Thresholds

All scenarios enforce:
- **p95 < 500ms** for read endpoints
- **p99 < 2s** for write endpoints
- **Error rate < 1%** globally
