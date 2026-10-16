import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { env } from './config/env.js';
import { redisClient } from './config/redis.js';
import { logger } from './config/logger.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import emailRoutes from './routes/email.routes.js';
import slackRoutes from './routes/slack.routes.js';
import { setupBullBoard } from './routes/bullboard.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export function createApp(): Express {
  const app = express();

  // 1. Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows Bull Board styles & frontend embeds
    })
  );

  // 2. CORS Configuration for Frontend Origin
  app.use(
    cors({
      origin: [env.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  // 3. Body Parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 4. Redis-backed Server-Side Session Storage
  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'sess:reachinbox:',
  });

  app.use(
    session({
      store: redisStore,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: 'reachinbox.sid',
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      },
    })
  );

  // 5. Request Logging
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/health') && !req.path.startsWith('/admin/queues/static')) {
      logger.debug({ method: req.method, path: req.path }, 'Incoming API request');
    }
    next();
  });

  // 6. Bull Board Queue Monitoring Dashboard
  const { router: bullBoardRouter, middleware: bullBoardAuth } = setupBullBoard();
  app.use('/admin/queues', bullBoardAuth, bullBoardRouter);

  // 7. REST API Routes
  app.get('/', (req, res) => {
    // If opened in a web browser, redirect to frontend dashboard
    if (req.accepts('html')) {
      res.redirect(env.FRONTEND_URL);
      return;
    }
    res.json({
      name: 'ReachInbox Email Job Scheduler API',
      status: 'online',
      frontendUrl: env.FRONTEND_URL,
      bullBoardUrl: `${env.BACKEND_URL}/admin/queues`,
      healthCheck: `${env.BACKEND_URL}/api/health`,
    });
  });

  app.use('/api', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/slack', slackRoutes);

  // 8. Global Error Handler
  app.use(errorHandler);

  return app;
}
