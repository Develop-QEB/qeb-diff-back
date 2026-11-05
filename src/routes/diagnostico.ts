import { Router } from 'express';
import { REPO_NAMES, RepoName } from '../config.js';
import { migrationsReport } from '../lib/migrations.js';
import { depsReport } from '../lib/deps.js';
import { envReport } from '../lib/envSchema.js';

const router = Router();

function parseRepo(v: unknown): RepoName {
  if (typeof v !== 'string' || !REPO_NAMES.includes(v as RepoName)) throw new Error('repo invalido');
  return v as RepoName;
}

router.get('/migrations', async (_req, res, next) => {
  try { res.json(await migrationsReport()); } catch (e) { next(e); }
});

router.get('/deps/:repo', async (req, res, next) => {
  try { res.json(await depsReport(parseRepo(req.params.repo))); } catch (e) { next(e); }
});

router.get('/env/:repo', async (req, res, next) => {
  try { res.json(await envReport(parseRepo(req.params.repo))); } catch (e) { next(e); }
});

export default router;
