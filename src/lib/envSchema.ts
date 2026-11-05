import { simpleGit } from 'simple-git';
import { config, RepoName } from '../config.js';
import { BRANCHES, BranchName, maybeFetch } from './git.js';

const CANDIDATES = ['.env.example', '.env.sample', '.env.template'];

export interface EnvKeyRow {
  key: string;
  byBranch: Record<BranchName, { present: boolean; value: string | null }>;
  divergente: boolean;
}

export interface EnvReport {
  repo: RepoName;
  branches: BranchName[];
  file: Record<BranchName, string | null>;
  contenido: Record<BranchName, string | null>;
  keys: EnvKeyRow[];
}

function parseEnv(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (k) out.set(k, v);
  }
  return out;
}

async function readEnvFile(repo: RepoName, branch: BranchName): Promise<{ file: string | null; raw: string | null }> {
  const g = simpleGit(config.repos[repo]);
  for (const cand of CANDIDATES) {
    try {
      const raw = await g.raw(['show', `origin/${branch}:${cand}`]);
      return { file: cand, raw };
    } catch {
      continue;
    }
  }
  return { file: null, raw: null };
}

export async function envReport(repo: RepoName): Promise<EnvReport> {
  await maybeFetch(repo);
  const reads = await Promise.all(BRANCHES.map(async (b) => ({ b, ...(await readEnvFile(repo, b)) })));
  const file: Record<BranchName, string | null> = {} as any;
  const contenido: Record<BranchName, string | null> = {} as any;
  const parsed: Record<BranchName, Map<string, string>> = {} as any;
  for (const r of reads) {
    file[r.b] = r.file;
    contenido[r.b] = r.raw;
    parsed[r.b] = r.raw ? parseEnv(r.raw) : new Map();
  }

  const allKeys = new Set<string>();
  for (const b of BRANCHES) for (const k of parsed[b].keys()) allKeys.add(k);

  const keys: EnvKeyRow[] = Array.from(allKeys).sort().map((key) => {
    const byBranch: EnvKeyRow['byBranch'] = {} as any;
    const presentes = new Set<boolean>();
    for (const b of BRANCHES) {
      const has = parsed[b].has(key);
      byBranch[b] = { present: has, value: has ? parsed[b].get(key)! : null };
      presentes.add(has);
    }
    return { key, byBranch, divergente: presentes.size > 1 };
  });

  return { repo, branches: [...BRANCHES], file, contenido, keys };
}
