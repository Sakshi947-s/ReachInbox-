import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

prisma.$connect()
  .then(() => {
    logger.info('Connected to PostgreSQL successfully');
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to connect to PostgreSQL');
  });
