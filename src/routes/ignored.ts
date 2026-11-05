import { Router } from 'express';
import { REPO_NAMES, RepoName } from '../config.js';
import { addIgnored, listIgnored, removeIgnored } from '../lib/ignored.js';

const router = Router();

function parseRepo(v: unknown): RepoName {
  if (typeof v !== 'string' || !REPO_NAMES.includes(v as RepoName)) throw new Error('repo invalido');
  return v as RepoName;
}

router.get('/', async (req, res, next) => {
  try {
    const repo = req.query.repo ? parseRepo(req.query.repo) : undefined;
    res.json(await listIgnored(repo));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { repo, hash, subject, reason } = req.body ?? {};
    const r = parseRepo(repo);
    if (typeof hash !== 'string' || !/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('hash invalido');
    await addIgnored({ repo: r, hash, subject: typeof subject === 'string' ? subject : '', reason: typeof reason === 'string' ? reason : undefined });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/', async (req, res, next) => {
  try {
    const { repo, hash } = req.body ?? {};
    const r = parseRepo(repo);
    if (typeof hash !== 'string') throw new Error('hash invalido');
    await removeIgnored(r, hash);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
