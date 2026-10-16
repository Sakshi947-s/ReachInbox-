import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { redisClient } from '../config/redis.js';
import { isElasticsearchAvailable, getElasticsearchClient } from '../integrations/elasticsearch/client.js';

export async function getLiveness(req: Request, res: Response): Promise<void> {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

export async function getReadiness(req: Request, res: Response): Promise<void> {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overallHealthy = true;

  // 1. PostgreSQL check
  const pgStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { status: 'up', latencyMs: Date.now() - pgStart };
  } catch (err: any) {
    overallHealthy = false;
    checks.postgres = { status: 'down', error: err.message };
  }

  // 2. Redis check
  const redisStart = Date.now();
  try {
    const ping = await redisClient.ping();
    if (ping === 'PONG') {
      checks.redis = { status: 'up', latencyMs: Date.now() - redisStart };
    } else {
      overallHealthy = false;
      checks.redis = { status: 'degraded', error: `Unexpected ping response: ${ping}` };
    }
  } catch (err: any) {
    overallHealthy = false;
    checks.redis = { status: 'down', error: err.message };
  }

  // 3. Elasticsearch check
  const esStart = Date.now();
  try {
    const esClient = getElasticsearchClient();
    const esPing = await esClient.ping();
    checks.elasticsearch = {
      status: esPing ? 'up' : 'down',
      latencyMs: Date.now() - esStart,
    };
  } catch (err: any) {
    checks.elasticsearch = {
      status: 'down',
      error: 'Elasticsearch unavailable (PostgreSQL fallback active for search)',
    };
    // ES is treated as non-fatal for overall readiness since search gracefully falls back to Postgres
  }

  res.status(overallHealthy ? 200 : 503).json({
    status: overallHealthy ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks,
  });
}
