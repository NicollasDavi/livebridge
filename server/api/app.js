import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import * as cfg from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerRecordingsRoutes } from './routes/recordings.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerMediaMtxHttpAuth } from './routes/mediamtxHttpAuth.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { syncRecordLiveToMediaMtx } from './services/settings.js';
import { setupPrometheusMetrics } from './middleware/metricsHttp.js';
import { hasR2 } from './r2.js';

export function createApp() {
  const app = express();
  registerMediaMtxHttpAuth(app);
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
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Access-Token']
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: cfg.API_JSON_LIMIT }));

  registerHealthRoutes(app);
  registerSettingsRoutes(app);
  setupPrometheusMetrics(app);

  app.use((req, res, next) => {
    const path = req.path || '';
    const noisy =
      path === '/api/health' ||
      path === '/api/ready' ||
      path === '/metrics' ||
      path === '/api/check-video-access' ||
      path === '/api/internal/mediamtx-auth' ||
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
    console.log('VIDEO_ACCESS_SECRET não configurado — live/VOD usam cookie opaco (dev). Produção: definir segredo + JWT do Java.');
  } else {
    console.log('VIDEO_ACCESS_SECRET ativo — gravações/VOD exigem JWT (sem fallback por cookie).');
  }
  if (cfg.RTMP_PUBLISH_AUTH_REQUIRED) {
    if (cfg.RTMP_PUBLISH_TOKENS.length) {
      console.log(`RTMP publish protegido (${cfg.RTMP_PUBLISH_TOKENS.length} token(s) configurado(s)).`);
    } else {
      console.warn('RTMP_PUBLISH_AUTH_REQUIRED=1 mas RTMP_PUBLISH_TOKEN vazio — publish OBS será negado até configurar token.');
    }
  } else {
    console.warn('RTMP_PUBLISH_AUTH_REQUIRED=0 — publish RTMP aberto (apenas dev local).');
  }
  if (!hasR2) console.log('R2 não configurado — aba Gravações desabilitada');
  if (!cfg.hasLessonsApi) console.log('API Lessons não configurada — metadata desabilitada');
  syncRecordLiveToMediaMtx()
    .then((v) => console.log(`[API] recordLive sincronizado com MediaMTX: ${v}`))
    .catch((e) => console.warn('[API] sync recordLive (MediaMTX pode ainda não estar up):', e?.message));
}
