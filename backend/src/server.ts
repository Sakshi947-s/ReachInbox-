import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redisClient } from './config/redis.js';
import { getOrCreateEtherealTransport, verifyEmailTransport } from './integrations/email/ethereal.js';
import { initElasticsearch } from './integrations/elasticsearch/client.js';
import { outboxService } from './services/outbox.service.js';
import { createEmailWorker } from './workers/email.worker.js';

async function bootstrap() {
  logger.info('Starting ReachInbox Email Job Scheduler backend...');

  // 1. Initialize Ethereal Email transport (auto-generates test account if needed)
  try {
    await getOrCreateEtherealTransport();
    await verifyEmailTransport();
  } catch (err) {
    logger.error({ err }, 'Warning: Ethereal SMTP initialization issue');
  }

  // 2. Initialize Elasticsearch index
  try {
    await initElasticsearch();
  } catch (err) {
    logger.warn({ err }, 'Elasticsearch initialization failed; search will use database fallback');
  }

  // 3. Start transactional outbox reconciliation (crash recovery)
  outboxService.startBackgroundReconciliation(10000);

  // 4. Start BullMQ worker in this process (supports both unified & split deployment)
  const worker = createEmailWorker(env.WORKER_CONCURRENCY);

  // 5. Create Express app and HTTP server
  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(`🚀 Backend server listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`📊 Bull Board Queue Monitor: http://localhost:${env.PORT}/admin/queues`);
    logger.info(`🔗 API Health check: http://localhost:${env.PORT}/api/health`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Gracefully shutting down...`);

    // Stop accepting new HTTP requests
    server.close(async () => {
      logger.info('HTTP server closed');

      // Stop outbox reconciliation
      outboxService.stopBackgroundReconciliation();

      // Close BullMQ worker safely
      try {
        await worker.close();
        logger.info('BullMQ worker closed');
      } catch (err) {
        logger.error({ err }, 'Error closing BullMQ worker');
      }

      // Disconnect Redis
      try {
        await redisClient.quit();
        logger.info('Redis client disconnected');
      } catch (err) {
        logger.error({ err }, 'Error disconnecting Redis');
      }

      // Disconnect Prisma
      try {
        await prisma.$disconnect();
        logger.info('PostgreSQL connection disconnected');
      } catch (err) {
        logger.error({ err }, 'Error disconnecting Prisma');
      }

      process.exit(0);
    });

    // Force exit if shutdown hangs after 10s
    setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded. Forcing exit.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Fatal error during server bootstrap');
  process.exit(1);
});
