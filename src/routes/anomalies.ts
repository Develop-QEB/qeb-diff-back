import { Router } from 'express';
import { REPO_NAMES, RepoName } from '../config.js';
import { branchAnomalies, schemaAnomalies } from '../lib/anomalies.js';

const router = Router();

function parseRepo(v: unknown): RepoName {
  if (typeof v !== 'string' || !REPO_NAMES.includes(v as RepoName)) throw new Error('repo invalido');
  return v as RepoName;
}

router.get('/branches/:repo', async (req, res, next) => {
  try { res.json(await branchAnomalies(parseRepo(req.params.repo))); } catch (e) { next(e); }
});

router.get('/schema', async (_req, res, next) => {
  try { res.json(await schemaAnomalies()); } catch (e) { next(e); }
});

export default router;
