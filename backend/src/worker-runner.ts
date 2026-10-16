import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createEmailWorker } from './workers/email.worker.js';
import { outboxService } from './services/outbox.service.js';
import { prisma } from './config/prisma.js';
import { redisClient } from './config/redis.js';

async function runStandaloneWorker() {
  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Starting standalone BullMQ worker process...');

  const worker = createEmailWorker(env.WORKER_CONCURRENCY);
  outboxService.startBackgroundReconciliation(10000);

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down worker process...`);
    outboxService.stopBackgroundReconciliation();

    try {
      await worker.close();
      await redisClient.quit();
      await prisma.$disconnect();
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

runStandaloneWorker().catch((err) => {
  logger.error({ err }, 'Worker process fatal error');
  process.exit(1);
});
