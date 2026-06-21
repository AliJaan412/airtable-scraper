import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

import { config } from './config';
import { connectDatabase } from './common/db';
import { closeRedis, isRedisCompatible } from './common/redis';
import { requestLogger } from './common/middleware/request-logger';
import { orgContext } from './common/middleware/org-context';
import { startScraperWorker, closeScraperQueue } from './modules/scraper/queues/scraper.queue';
import { startAirtableWorker, closeAirtableQueue } from './modules/airtable/queues/airtable.queue';

import airtableRouter from './modules/airtable/routes/airtable.routes';
import scraperRouter from './modules/scraper/routes/scraper.routes';
import rawDataRouter from './modules/raw-data/routes/raw-data.routes';

async function bootstrap() {
  await connectDatabase();

  const redisReady = await isRedisCompatible();
  if (redisReady) {
    startScraperWorker();
    startAirtableWorker();
    console.log('[Queue] Scraper and Airtable workers started (Redis connected)');
  } else {
    console.warn('[Queue] Queues disabled. Jobs will run inline without retry.');
  }

  const app = express();

  // Security
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: [config.frontendUrl, 'http://localhost:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  }));

  // Rate limiting
  app.use('/api/', rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true }));

  // Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Logging
  if (config.nodeEnv !== 'test') app.use(morgan('dev'));
  app.use(requestLogger);

  // Org context (multi-tenant)
  app.use(orgContext);

  // Swagger
  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title: 'Sred.io Airtable API', version: '1.0.0' },
      servers: [{ url: `http://localhost:${config.port}` }],
    },
    apis: ['./src/modules/**/*.ts'],
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Routes
  app.use('/api/airtable', airtableRouter);
  app.use('/api/scraper', scraperRouter);
  app.use('/api/raw-data', rawDataRouter);

  // Health
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // 404
  app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

  // Global error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
  });

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    console.log(`Swagger UI: http://localhost:${config.port}/api/docs`);
  });
}

async function shutdown(signal: string) {
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  await closeScraperQueue();
  await closeAirtableQueue();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
