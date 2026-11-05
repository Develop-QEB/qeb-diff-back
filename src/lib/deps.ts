import { simpleGit } from 'simple-git';
import { config, RepoName } from '../config.js';
import { BRANCHES, BranchName, maybeFetch } from './git.js';

export interface DepRow {
  name: string;
  kind: 'dep' | 'devDep';
  byBranch: Record<BranchName, string | null>;
  divergente: boolean;
}

export interface DepsReport {
  repo: RepoName;
  branches: BranchName[];
  rows: DepRow[];
  nodeEngine: Record<BranchName, string | null>;
}

async function readPackageJson(repo: RepoName, branch: BranchName): Promise<any | null> {
  const g = simpleGit(config.repos[repo]);
  try {
    const raw = await g.raw(['show', `origin/${branch}:package.json`]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function depsReport(repo: RepoName): Promise<DepsReport> {
  await maybeFetch(repo);
  const pkgs = await Promise.all(BRANCHES.map(async (b) => ({ b, p: await readPackageJson(repo, b) })));
  const byBranch: Record<BranchName, any | null> = {} as any;
  for (const { b, p } of pkgs) byBranch[b] = p;

  const nodeEngine: Record<BranchName, string | null> = {} as any;
  for (const b of BRANCHES) nodeEngine[b] = byBranch[b]?.engines?.node ?? null;

  const rowsMap = new Map<string, DepRow>();
  const ensure = (name: string, kind: DepRow['kind']): DepRow => {
    const k = `${kind}::${name}`;
    let r = rowsMap.get(k);
    if (!r) {
      r = { name, kind, byBranch: { main: null, dev: null, release: null, stage: null } as any, divergente: false };
      rowsMap.set(k, r);
    }
    return r;
  };

  for (const b of BRANCHES) {
    const p = byBranch[b];
    if (!p) continue;
    for (const [name, version] of Object.entries(p.dependencies ?? {})) ensure(name, 'dep').byBranch[b] = String(version);
    for (const [name, version] of Object.entries(p.devDependencies ?? {})) ensure(name, 'devDep').byBranch[b] = String(version);
  }

  const rows = Array.from(rowsMap.values()).map((r) => {
    const vals = BRANCHES.map((b) => r.byBranch[b]).filter((v) => v !== null) as string[];
    const divergente = new Set(vals).size > 1 || vals.length !== BRANCHES.length;
    return { ...r, divergente };
  });

  rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));

  return { repo, branches: [...BRANCHES], rows, nodeEngine };
}
