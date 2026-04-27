import client from 'prom-client';

const enabled =
  process.env.PROMETHEUS_METRICS === '1' || process.env.PROMETHEUS_METRICS === 'true';

let register;

function normalizeRoute(path) {
  if (!path || typeof path !== 'string') return 'unknown';
  const p = path.split('?')[0];
  if (p === '/metrics' || p === '/api/health' || p === '/api/ready') return p;
  if (p.startsWith('/api/recordings')) return '/api/recordings/*';
  if (p.startsWith('/api/live')) return '/api/live/*';
  if (p.startsWith('/api/lessons')) return '/api/lessons/*';
  if (p.startsWith('/api/videos')) return '/api/videos/*';
  if (p.startsWith('/api/catalog')) return '/api/catalog/*';
  if (p.startsWith('/api/captions')) return '/api/captions/*';
  if (p.startsWith('/api/check-video-access')) return '/api/check-video-access';
  if (p.startsWith('/api/')) return '/api/*';
  return p.length > 48 ? `${p.slice(0, 48)}…` : p;
}

function statusClass(code) {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  return '2xx';
}

export function setupPrometheusMetrics(app) {
  if (!enabled) return;

  register = new client.Registry();
  client.collectDefaultMetrics({ register, prefix: 'nodejs_' });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração dos pedidos HTTP da API',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.005, 0.01, 0.03, 0.1, 0.3, 0.5, 1, 2, 5, 15, 60],
    registers: [register]
  });

  const httpInflight = new client.Gauge({
    name: 'http_requests_inflight',
    help: 'Pedidos HTTP em curso (por worker)',
    registers: [register]
  });

  app.use((req, res, next) => {
    if (req.path === '/metrics') return next();
    const route = normalizeRoute(req.path || req.url);
    const end = httpDuration.startTimer({ method: req.method, route });
    httpInflight.inc();
    res.on('finish', () => {
      httpInflight.dec();
      end({ status_class: statusClass(res.statusCode) });
    });
    next();
  });

  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
}

export function isPrometheusMetricsEnabled() {
  return enabled;
}
