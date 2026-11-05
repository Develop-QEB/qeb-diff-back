import { Router } from 'express';
import { isValidToken } from '../lib/auth.js';
import { config } from '../config.js';

const router = Router();

router.post('/login', (req, res) => {
  const password = String(req.body?.password ?? '');
  if (!isValidToken(password)) {
    res.status(401).json({ error: 'password invalida' });
    return;
  }
  res.json({ token: config.authPassword });
});

router.get('/check', (req, res) => {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? '';
  res.json({ ok: isValidToken(token) });
});

export default router;
