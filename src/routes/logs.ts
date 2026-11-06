import { Router } from 'express';
import { fetchLogs, LOG_ENVS, LogEnv } from '../lib/logs.js';

const router = Router();

function parseEnv(v: unknown): LogEnv {
  if (typeof v !== 'string' || !LOG_ENVS.includes(v as LogEnv)) throw new Error('env invalido');
  return v as LogEnv;
}

router.get('/:env', async (req, res, next) => {
  try {
    const env = parseEnv(req.params.env);
    const cursor = typeof req.query.since === 'string' && req.query.since.length > 0 ? req.query.since : null;
    const lines = typeof req.query.lines === 'string' ? Number(req.query.lines) : 200;
    res.json(await fetchLogs(env, cursor, lines));
  } catch (e) {
    next(e);
  }
});

export default router;
