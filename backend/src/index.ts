// Import config first: it loads .env and validates required secrets (e.g.
// JWT_SECRET), throwing a clear error at startup if they are missing/weak.
import './lib/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import servicesRoutes from './routes/services';
import adminRoutes from './routes/admin';
import oidcRoutes from './routes/oidc';
import samlRoutes from './routes/saml';
import subscriptionRoutes from './routes/subscriptions';
import categoriesRoutes from './routes/categories';
import adminServicesRoutes from './routes/adminServices';
import usersRoutes from './routes/users';
import notificationsRoutes from './routes/notifications';
import apiKeysRoutes from './routes/apiKeys';
import webhooksRoutes from './routes/webhooks';
import healthRouter from './routes/health';
import incidentsRoutes from './routes/incidents';
import adminIncidentsRoutes from './routes/adminIncidents';
import adminMaintenanceRoutes from './routes/adminMaintenance';
import { startNotificationProcessor, stopNotificationProcessor } from './lib/notifications';
import { PgRateLimitStore } from './lib/pgRateLimitStore';
import { resolveTrustProxy } from './lib/trustProxy';
import { accountClientLimiter, accountLimiter } from './lib/loginThrottle';
import logger from './lib/logger';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// JWT_SECRET is required and validated at import time by ./lib/config
// (imported at the top of this file), which throws a clear startup error if
// the secret is missing or shorter than 16 characters — in every environment.

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy: only peers at these addresses may set X-Forwarded-For, so
// req.ip (rate limiting, logging) can't be forged by a direct client. See
// lib/trustProxy.ts.
const trustProxy = resolveTrustProxy();
trustProxy.warnings.forEach((w) => logger.warn(w));
app.set('trust proxy', trustProxy.value);

// Bind to loopback by default so only a same-host reverse proxy can reach the
// API. Containers and split-host deployments set HOST=0.0.0.0 explicitly.
const HOST = process.env.HOST || '127.0.0.1';

// Rate limiters (PostgreSQL-backed store persists across restarts)
// publicLimiter can be disabled when a load balancer/upstream proxy already
// rate limits these endpoints, to avoid redundant limiting.
const publicLimiterEnabled = process.env.RATE_LIMIT_PUBLIC_ENABLED !== 'false';
const publicLimiter: express.RequestHandler = publicLimiterEnabled
  ? rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
      store: new PgRateLimitStore('public'),
    })
  : (_req, _res, next) => next();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
  store: new PgRateLimitStore('auth'),
});

const subscriptionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many subscription attempts, please try again later' },
  store: new PgRateLimitStore('sub'),
});

// Allowed origins for CORS and CSP frame-ancestors. Derived from FRONTEND_URL
// and PUBLIC_URL env vars (each supports a comma-separated list). Localhost
// defaults are included only outside production. No hardcoded hostnames.
const defaultOrigins =
  process.env.NODE_ENV !== 'production' ? ['http://localhost:3001', 'http://localhost:5173'] : [];
const configuredOrigins = [process.env.FRONTEND_URL, process.env.PUBLIC_URL]
  .filter((v): v is string => !!v)
  .flatMap((v) => v.split(','))
  .map((v) => v.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins]));

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-ancestors': ["'self'", ...allowedOrigins],
    },
  },
}));
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Parse cookies before any route so authMiddleware can read the session cookie.
app.use(cookieParser());

// Health routes (/ = liveness probe, /detailed = admin-protected system health)
app.use('/health', healthRouter);

// Routes with rate limiting
app.use('/api/services', publicLimiter, servicesRoutes);
app.use('/api/incidents', publicLimiter, incidentsRoutes);
app.use('/api/admin/incidents', adminIncidentsRoutes);
app.use('/api/admin/maintenance', adminMaintenanceRoutes);
app.use('/api/admin/login', authLimiter, accountClientLimiter, accountLimiter);
app.use('/api/admin/cas', authLimiter);
app.use('/api/admin/oidc', authLimiter);
app.use('/api/admin/saml', authLimiter);
// Rate-limit the one-time-code exchange (not the lightweight providers probe).
app.use('/api/admin/auth/exchange', authLimiter);
app.use('/api/admin/oidc', oidcRoutes);
app.use('/api/admin/saml', samlRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/categories', categoriesRoutes);
app.use('/api/admin/services', adminServicesRoutes);
app.use('/api/admin/users', usersRoutes);
app.use('/api/admin/notifications', notificationsRoutes);
app.use('/api/admin/api-keys', apiKeysRoutes);
app.use('/api/admin/webhooks', webhooksRoutes);
app.use('/api/subscriptions', subscriptionLimiter, subscriptionRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Always log the real error server-side.
  logger.error({ err }, 'Unhandled error');

  const status = err.status || 500;

  // In production, never leak internal error details to clients for 5xx errors;
  // return a generic message. In development, surface the real message to aid debugging.
  if (process.env.NODE_ENV === 'production' && status >= 500) {
    return res.status(status).json({ error: 'Internal server error' });
  }

  res.status(status).json({
    error: err.message || 'Internal server error'
  });
});

const server = app.listen(Number(PORT), HOST, () => {
  logger.info({ host: HOST, port: PORT, env: process.env.NODE_ENV, frontendUrl: process.env.FRONTEND_URL }, 'HE Status API started');

  // Start notification queue processor
  startNotificationProcessor();
});

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully');

  // Stop the notification queue processor so no new work is picked up mid-shutdown.
  stopNotificationProcessor();

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      const { pool } = await import('./db/connection');
      await pool.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error({ err }, 'Error closing database pool');
    }
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    logger.fatal('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
