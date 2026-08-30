---
name: dashboard-analysis
description: Analyze the synthetic Grafana service dashboard using its Prometheus metrics and SLA thresholds.
---

# Dashboard analysis

Use Grafana MCP to query the service dashboard's live metrics through the
`local-prom` Prometheus datasource. The metrics are synthetic and produced by
`prometheus-data-generator` from `config/data-generator.yml`.

## Metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http_requests_total` | counter | `endpoint`, `status` (`200`/`404`/`500`) | HTTP requests served |
| `http_request_duration_seconds_bucket` | histogram | `endpoint`, `le` | request latency, for `histogram_quantile` |
| `active_users` | gauge | `region` | currently active users |
| `queue_length` | gauge | `worker` | pending jobs in a worker queue |
| `cpu_load_percent` | gauge | `host` | CPU load percentage (0–100) |

Endpoints are paths (`/`, `/api/products`, `/api/checkout`). Regions are
`eu`/`us`/`asia`, workers are `emails`/`thumbnails`, and hosts are
`web-01`/`web-02`/`worker-01`.

The datasource name and UID are both `local-prom`. Use that UID when a Grafana
MCP tool asks for one; list datasources first if needed.

## Health thresholds

- **5xx ratio** per endpoint: `sum by (endpoint) (rate(http_requests_total{status=~"5.."}[5m])) / sum by (endpoint) (rate(http_requests_total[5m]))`. Healthy < 1%, watch 1–5%, breaching > 5%.
- **p95 latency** per endpoint: `histogram_quantile(0.95, sum by (endpoint, le) (rate(http_request_duration_seconds_bucket[5m])))`. Target < 500ms; anything over ~1s is slow.
- **CPU load** per host: `cpu_load_percent`. Watch > 80%; sustained > 90% is an incident.
- **Queue backlog** per worker: `queue_length`. A steadily growing queue is a warning even if nothing is erroring.
- **4xx** responses are usually client-side; report them but do not classify them as an outage.
- **active_users** per region is context, not health; use it to explain load, not to page.

Use a rate window of at least `[2m]`; the series update every few seconds and a
narrower window can return no data.

## Answer style

Lead with the verdict and the single figure that supports it. Name the endpoint,
host, or region and compare it with the threshold above. If one endpoint is both
erroring and slow, treat it as the primary problem. Keep the answer to a few
sentences.
