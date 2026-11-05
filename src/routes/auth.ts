import { Router } from 'express';
import { issueToken, verifyCredentials, verifyToken } from '../lib/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!verifyCredentials(username, password)) {
    res.status(401).json({ error: 'usuario o password invalido' });
    return;
  }
  res.json({ token: issueToken(username), username });
});

router.get('/check', (req, res) => {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] ?? '';
  const username = verifyToken(token);
  res.json({ ok: Boolean(username), username });
});

export default router;
