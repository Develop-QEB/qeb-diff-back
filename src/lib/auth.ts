import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config.js';

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(username: string): string {
  return crypto.createHmac('sha256', config.authSecret).update(username).digest('hex');
}

export function issueToken(username: string): string {
  return `${username}.${sign(username)}`;
}

export function verifyToken(token: string): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const username = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!config.users.has(username)) return null;
  const expected = sign(username);
  if (!constantTimeEqual(sig, expected)) return null;
  return username;
}

export function verifyCredentials(username: string, password: string): boolean {
  const expected = config.users.get(username);
  if (!expected) return false;
  return constantTimeEqual(password, expected);
}

const EXEMPT_PREFIXES = ['/api/health', '/api/auth'];

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? '';
  const username = verifyToken(token);
  if (!username) {
    res.status(401).json({ error: 'auth requerido' });
    return;
  }
  (req as any).username = username;
  next();
};
