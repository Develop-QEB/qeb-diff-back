import { Router } from 'express';
import { BRANCHES, BranchName, compareBranches, commitDetail, fileDiff, filesChanged, heads, listCommits } from '../lib/git.js';
import { REPO_NAMES, RepoName } from '../config.js';

const router = Router();

function parseRepo(v: unknown): RepoName {
  if (typeof v !== 'string' || !REPO_NAMES.includes(v as RepoName)) throw new Error('repo invalido');
  return v as RepoName;
}
function parseBranch(v: unknown): BranchName {
  if (typeof v !== 'string' || !(BRANCHES as readonly string[]).includes(v)) throw new Error('branch invalida');
  return v as BranchName;
}

router.get('/heads/:repo', async (req, res, next) => {
  try { res.json(await heads(parseRepo(req.params.repo))); } catch (e) { next(e); }
});

router.get('/commits/:repo/:branch', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    res.json(await listCommits(parseRepo(req.params.repo), parseBranch(req.params.branch), limit));
  } catch (e) { next(e); }
});

router.get('/compare/:repo/:a/:b', async (req, res, next) => {
  try {
    res.json(await compareBranches(parseRepo(req.params.repo), parseBranch(req.params.a), parseBranch(req.params.b)));
  } catch (e) { next(e); }
});

router.get('/files/:repo/:a/:b', async (req, res, next) => {
  try {
    res.json(await filesChanged(parseRepo(req.params.repo), parseBranch(req.params.a), parseBranch(req.params.b)));
  } catch (e) { next(e); }
});

router.get('/file-diff/:repo/:a/:b', async (req, res, next) => {
  try {
    const file = String(req.query.file ?? '');
    if (!file) throw new Error('file requerido');
    res.type('text/plain').send(await fileDiff(parseRepo(req.params.repo), parseBranch(req.params.a), parseBranch(req.params.b), file));
  } catch (e) { next(e); }
});

router.get('/commit/:repo/:hash', async (req, res, next) => {
  try {
    const hash = String(req.params.hash);
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('hash invalido');
    res.json(await commitDetail(parseRepo(req.params.repo), hash));
  } catch (e) { next(e); }
});

export default router;
