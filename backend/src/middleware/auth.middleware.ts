import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauthState?: string;
    slackState?: string;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl?: string | null;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session?.userId;

  if (!userId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'You must be logged in to access this resource',
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });

    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Session user no longer exists',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
