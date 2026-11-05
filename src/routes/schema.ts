import { Router } from 'express';
import { DB_NAMES, DbName } from '../config.js';
import { diffSchemas, schemaMatrixDetailed, snapshotSchema } from '../lib/schema.js';

const router = Router();

const cache = new Map<DbName, { ts: number; data: Awaited<ReturnType<typeof snapshotSchema>> }>();
const TTL = 60_000;

function parseDb(v: unknown): DbName {
  if (typeof v !== 'string' || !DB_NAMES.includes(v as DbName)) throw new Error('db invalida');
  return v as DbName;
}

async function getSnapshot(db: DbName, force = false) {
  const now = Date.now();
  const c = cache.get(db);
  if (!force && c && now - c.ts < TTL) return c.data;
  const data = await snapshotSchema(db);
  cache.set(db, { ts: now, data });
  return data;
}

router.get('/list', (_req, res) => res.json(DB_NAMES));

router.get('/matrix', async (_req, res, next) => {
  try { res.json(await schemaMatrixDetailed()); } catch (e) { next(e); }
});

router.get('/snapshot/:db', async (req, res, next) => {
  try {
    const force = req.query.refresh === '1';
    res.json(await getSnapshot(parseDb(req.params.db), force));
  } catch (e) { next(e); }
});

router.get('/compare/:a/:b', async (req, res, next) => {
  try {
    const a = parseDb(req.params.a);
    const b = parseDb(req.params.b);
    const force = req.query.refresh === '1';
    const [sa, sb] = await Promise.all([getSnapshot(a, force), getSnapshot(b, force)]);
    res.json({ a: { db: sa.db, database: sa.database, version: sa.version }, b: { db: sb.db, database: sb.database, version: sb.version }, diff: diffSchemas(sa, sb) });
  } catch (e) { next(e); }
});

router.get('/ping', async (_req, res, next) => {
  try {
    const results: Record<string, { ok: boolean; version?: string; tables?: number; tablesBase?: number; views?: number; routines?: number; columns?: number; columnsBase?: number; columnsViews?: number; error?: string }> = {};
    await Promise.all(DB_NAMES.map(async (db) => {
      try {
        const s = await getSnapshot(db, true);
        const colsBase = s.tables.reduce((n, t) => n + t.columns.length, 0);
        const colsViews = s.views.reduce((n, v) => n + v.columns.length, 0);
        results[db] = {
          ok: true,
          version: s.version,
          tables: s.tables.length + s.views.length,
          tablesBase: s.tables.length,
          views: s.views.length,
          routines: s.routines.length,
          columns: colsBase + colsViews,
          columnsBase: colsBase,
          columnsViews: colsViews,
        };
      } catch (e: any) {
        results[db] = { ok: false, error: e?.message ?? String(e) };
      }
    }));
    res.json(results);
  } catch (e) { next(e); }
});

export default router;
