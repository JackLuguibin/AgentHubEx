import { randomBytes } from "node:crypto";

type Labels = Record<string, string>;

type Series = { name: string; labels: Labels; value: number };

const counters = new Map<string, Series>();
const gauges = new Map<string, Series>();
const histograms = new Map<string, { name: string; labels: Labels; values: number[] }>();
const spans: { traceId: string; name: string; durationMs: number }[] = [];

function idOf(name: string, labels: Labels) {
  const parts = Object.entries(labels)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`);
  return `${name}|${parts.join(",")}`;
}

function add(store: Map<string, Series>, name: string, labels: Labels, delta: number) {
  const id = idOf(name, labels);
  const current = store.get(id);
  if (current) current.value += delta;
  else store.set(id, { name, labels: { ...labels }, value: delta });
}

export function routeLabel(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").slice(0, 120);
}

export function recordRequest(path: string, status: number, seconds: number) {
  const route = routeLabel(path);
  const code = String(status);
  add(counters, "hub_http_requests_total", { route, code }, 1);
  const id = idOf("hub_http_request_seconds", { route });
  const hist = histograms.get(id) ?? { name: "hub_http_request_seconds", labels: { route }, values: [] };
  hist.values.push(seconds);
  if (hist.values.length > 512) hist.values.shift();
  histograms.set(id, hist);
}

export function recordProxyLatency(instance: string, seconds: number) {
  const id = idOf("hub_proxy_upstream_latency_seconds", { instance });
  const hist = histograms.get(id) ?? {
    name: "hub_proxy_upstream_latency_seconds",
    labels: { instance },
    values: [],
  };
  hist.values.push(seconds);
  if (hist.values.length > 512) hist.values.shift();
  histograms.set(id, hist);
}

export function setGauge(name: string, labels: Labels, value: number) {
  gauges.set(idOf(name, labels), { name, labels: { ...labels }, value });
}

function labelsText(labels: Labels): string {
  const parts = Object.entries(labels).map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

/** Prometheus text. Alertmanager rules in deploy/observability/alerts.yml read these names. */
export function renderPrometheus(): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const series of counters.values()) {
    if (!seen.has(series.name)) {
      lines.push(`# TYPE ${series.name} counter`);
      seen.add(series.name);
    }
    lines.push(`${series.name}${labelsText(series.labels)} ${series.value}`);
  }
  for (const hist of histograms.values()) {
    if (!seen.has(hist.name)) {
      lines.push(`# TYPE ${hist.name} histogram`);
      seen.add(hist.name);
    }
    const sorted = [...hist.values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, value) => acc + value, 0);
    lines.push(`${hist.name}_count${labelsText(hist.labels)} ${count}`);
    lines.push(`${hist.name}_sum${labelsText(hist.labels)} ${sum}`);
    if (count > 0) {
      const p95 = sorted[Math.min(count - 1, Math.ceil(count * 0.95) - 1)] ?? 0;
      lines.push(`${hist.name}_p95${labelsText(hist.labels)} ${p95}`);
    }
  }
  for (const series of gauges.values()) {
    if (!seen.has(series.name)) {
      lines.push(`# TYPE ${series.name} gauge`);
      seen.add(series.name);
    }
    lines.push(`${series.name}${labelsText(series.labels)} ${series.value}`);
  }
  return `${lines.join("\n")}\n`;
}

/** OTLP/HTTP JSON document an intranet collector can accept. No SaaS endpoint is required. */
export function otlpMetricsJson() {
  const metrics = [...counters.values()].map((series) => ({
    name: series.name,
    sum: {
      dataPoints: [
        {
          asInt: series.value,
          attributes: Object.entries(series.labels).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
      ],
      aggregationTemporality: 2,
      isMonotonic: true,
    },
  }));
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "hub-api" } }],
        },
        scopeMetrics: [{ scope: { name: "agenthub" }, metrics }],
      },
    ],
  };
}

export function recentSpans() {
  return spans.slice(-50);
}

export function startSpan(name: string): { traceId: string; end: () => void } {
  const traceId = randomBytes(16).toString("hex");
  const started = Date.now();
  return {
    traceId,
    end() {
      spans.push({ traceId, name, durationMs: Date.now() - started });
      if (spans.length > 200) spans.shift();
    },
  };
}

export async function exportOtlp(endpoint: string): Promise<void> {
  const url = endpoint.replace(/\/$/, "");
  await fetch(`${url}/v1/metrics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(otlpMetricsJson()),
  });
}
