import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config.js';

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function isValidToken(token: string): boolean {
  if (!token) return false;
  return constantTimeEqual(token, config.authPassword);
}

const EXEMPT_PREFIXES = ['/api/health', '/api/auth'];

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? '';
  if (!isValidToken(token)) {
    res.status(401).json({ error: 'auth requerido' });
    return;
  }
  next();
};
