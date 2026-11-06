import { Router } from 'express';
import { DB_NAMES, DbName } from '../config.js';
import { fetchHuerfanas } from '../lib/huerfanas.js';

const router = Router();

function parseDb(v: unknown): DbName {
  if (typeof v !== 'string' || !DB_NAMES.includes(v as DbName)) throw new Error('db invalida');
  return v as DbName;
}

router.get('/:db', async (req, res, next) => {
  try {
    res.json(await fetchHuerfanas(parseDb(req.params.db)));
  } catch (e) {
    next(e);
  }
});

export default router;
