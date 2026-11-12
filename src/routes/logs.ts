import { Router } from 'express';
import { fetchLogs, listSources } from '../lib/logs.js';

const router = Router();

router.get('/sources', (_req, res) => res.json(listSources()));

router.get('/:source', async (req, res, next) => {
  try {
    const source = String(req.params.source);
    const cursor = typeof req.query.since === 'string' && req.query.since.length > 0 ? req.query.since : null;
    const lines = typeof req.query.lines === 'string' ? Number(req.query.lines) : 200;
    res.json(await fetchLogs(source, cursor, lines));
  } catch (e) {
    next(e);
  }
});

export default router;
