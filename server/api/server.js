import 'dotenv/config';
import cluster from 'node:cluster';
import os from 'node:os';
import { createApp, logStartupHints } from './app.js';
import { isPrometheusMetricsEnabled } from './middleware/metricsHttp.js';

const PORT = process.env.PORT || 3000;

function desiredWorkerCount() {
  const raw = process.env.CLUSTER_WORKERS;
  if (raw === undefined || raw === '' || raw === '1') return 1;
  if (raw === 'auto') return Math.min(32, Math.max(1, os.availableParallelism()));
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(32, n) : 1;
}

function listen() {
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API rodando na porta ${PORT} (pid ${process.pid})`);
    logStartupHints();
  });
}

const workers = desiredWorkerCount();

if (isPrometheusMetricsEnabled() && workers > 1 && cluster.isPrimary) {
  console.warn(
    '[API] PROMETHEUS_METRICS com vários workers: /metrics e histogramas HTTP ficam inconsistentes. ' +
      'Use CLUSTER_WORKERS=1 (ex.: docker-compose.observability.yml).'
  );
}

if (workers > 1 && cluster.isPrimary) {
  console.log(`[API] cluster: ${workers} workers (CLUSTER_WORKERS=${process.env.CLUSTER_WORKERS || 'auto'})`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[API] worker pid=${worker.process.pid} exited code=${code} signal=${signal} — a reiniciar`);
    cluster.fork();
  });
} else {
  listen();
}
