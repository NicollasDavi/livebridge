import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as cfg from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerRecordingsRoutes } from './routes/recordings.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { setupPrometheusMetrics } from './middleware/metricsHttp.js';
import { hasR2 } from './r2.js';

export function createApp() {
  const app = express();
  app.use(compression({ threshold: 1024 }));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin && cfg.corsOriginSet.has(origin)) {
          callback(null, origin);
        } else if (!origin) {
          callback(null, cfg.corsOrigins[0]);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Live-Hls-Path-Prefix']
    })
  );
  app.use(cookieParser());
  app.use(express.json());

  registerHealthRoutes(app);
  setupPrometheusMetrics(app);

  app.use((req, res, next) => {
    const path = req.path || '';
    const noisy =
      path === '/api/health' ||
      path === '/api/ready' ||
      path === '/metrics' ||
      path === '/api/check-video-access' ||
      path.startsWith('/api/recordings/hls/segment');
    if (!noisy || cfg.API_LOG_ALL_REQUESTS) {
      console.log(`[API] ${req.method} ${req.url}`);
    }
    next();
  });

  registerLiveRoutes(app);
  registerRecordingsRoutes(app);
  registerCatalogRoutes(app);

  return app;
}

export function logStartupHints() {
  if (!cfg.VIDEO_ACCESS_SECRET) {
    console.log('VIDEO_ACCESS_SECRET não configurado — vídeo e live exigem token JWT do Java');
  }
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
  if (!cfg.hasLessonsApi) console.log('API Lessons não configurada — metadata desabilitada');
}
