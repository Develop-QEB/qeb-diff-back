import { simpleGit, SimpleGit } from 'simple-git';
import { config, RepoName } from '../config.js';
import { ignoredHashesByRepo } from './ignored.js';

const gits = new Map<RepoName, SimpleGit>();

export const BRANCHES = ['main', 'stage', 'dev', 'release'] as const;
export type BranchName = typeof BRANCHES[number];

function git(repo: RepoName): SimpleGit {
  const cached = gits.get(repo);
  if (cached) return cached;
  const g = simpleGit(config.repos[repo]);
  gits.set(repo, g);
  return g;
}

let lastFetch = new Map<RepoName, number>();
const FETCH_TTL_MS = 60_000;

export async function maybeFetch(repo: RepoName): Promise<void> {
  if (!config.autoFetch) return;
  const now = Date.now();
  const last = lastFetch.get(repo) ?? 0;
  if (now - last < FETCH_TTL_MS) return;
  await git(repo).fetch(['--all', '--prune']);
  lastFetch.set(repo, now);
}

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  isMerge: boolean;
  isRevert: boolean;
  asanaId?: string;
}

const ASANA_GID_RE = /#(\d{10,})/;

function extractAsanaId(subject: string): string | undefined {
  const m = subject.match(ASANA_GID_RE);
  return m ? m[1] : undefined;
}

function parseCommits(raw: string): Commit[] {
  if (!raw.trim()) return [];
  return raw.split('\n').map((line) => {
    const [hash, author, email, date, subject, parents] = line.split('\x1f');
    const parentList = (parents ?? '').trim().split(/\s+/).filter(Boolean);
    return {
      hash,
      shortHash: hash.slice(0, 7),
      author,
      email,
      date,
      subject,
      isMerge: parentList.length > 1,
      isRevert: /^revert\b/i.test(subject),
      asanaId: extractAsanaId(subject),
    };
  });
}

export async function listCommits(repo: RepoName, branch: BranchName, limit = 300): Promise<Commit[]> {
  await maybeFetch(repo);
  const out = await git(repo).raw([
    'log',
    `origin/${branch}`,
    `--max-count=${limit}`,
    '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P',
  ]);
  return parseCommits(out);
}

export interface BranchHead {
  branch: BranchName;
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export async function heads(repo: RepoName): Promise<BranchHead[]> {
  await maybeFetch(repo);
  const out: BranchHead[] = [];
  for (const b of BRANCHES) {
    try {
      const raw = await git(repo).raw(['log', `origin/${b}`, '-1', '--pretty=format:%H%x1f%an%x1f%aI%x1f%s']);
      const [hash, author, date, subject] = raw.split('\x1f');
      out.push({ branch: b, hash, shortHash: hash.slice(0, 7), author, date, subject });
    } catch {
      void 0;
    }
  }
  return out;
}

export type DiffKind = 'exclusivo' | 'equivalente';
export type CommitPresence = 'exact' | 'equivalent' | 'absent';
export interface DiffCommit extends Commit {
  kind: DiffKind;
  equivalentOf?: string;
  isIgnored?: boolean;
  presence: Record<BranchName, CommitPresence>;
}

export interface BranchDiff {
  onlyInA: DiffCommit[];
  onlyInB: DiffCommit[];
  common: string;
  summary: { exclusivosA: number; exclusivosB: number; equivalentesA: number; equivalentesB: number; mergesA: number; mergesB: number; revertsA: number; revertsB: number };
}

async function cherryEquivalentHashes(g: SimpleGit, upstream: string, head: string): Promise<Set<string>> {
  const out = await g.raw(['cherry', `origin/${upstream}`, `origin/${head}`]).catch(() => '');
  const equiv = new Set<string>();
  for (const line of out.split('\n')) {
    const m = line.match(/^-\s+([0-9a-f]{40})/);
    if (m) equiv.add(m[1]);
  }
  return equiv;
}

export async function fullSubjectIndex(repo: RepoName, branch: BranchName): Promise<Map<string, string>> {
  await maybeFetch(repo);
  const g = git(repo);
  const raw = await g.raw(['log', `origin/${branch}`, '--pretty=format:%H%x1f%an%x1f%s']).catch(() => '');
  const m = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const [hash, author, subject] = line.split('\x1f');
    const k = `${author}|${subject}`;
    if (!m.has(k)) m.set(k, hash);
  }
  return m;
}

async function branchContainment(repo: RepoName, branch: BranchName): Promise<Set<string>> {
  const g = git(repo);
  const out = await g.raw(['log', `origin/${branch}`, '--pretty=format:%H']).catch(() => '');
  return new Set(out.split('\n').map((s: string) => s.trim()).filter(Boolean));
}

export async function compareBranches(repo: RepoName, a: BranchName, b: BranchName): Promise<BranchDiff> {
  await maybeFetch(repo);
  const g = git(repo);
  const [a2b, b2a, mergeBase, equivInA, equivInB, ignored, ...perBranch] = await Promise.all([
    g.raw(['log', `origin/${b}..origin/${a}`, '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P']),
    g.raw(['log', `origin/${a}..origin/${b}`, '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P']),
    g.raw(['merge-base', `origin/${a}`, `origin/${b}`]).catch(() => ''),
    cherryEquivalentHashes(g, b, a),
    cherryEquivalentHashes(g, a, b),
    ignoredHashesByRepo(repo),
    ...BRANCHES.flatMap((br) => [branchContainment(repo, br), fullSubjectIndex(repo, br)]),
  ]);

  const containByBranch = {} as Record<BranchName, Set<string>>;
  const subjectByBranch = {} as Record<BranchName, Map<string, string>>;
  BRANCHES.forEach((br, i) => {
    containByBranch[br] = perBranch[i * 2] as Set<string>;
    subjectByBranch[br] = perBranch[i * 2 + 1] as Map<string, string>;
  });

  const presenceOf = (c: Commit): Record<BranchName, CommitPresence> => {
    const key = `${c.author}|${c.subject}`;
    const p = {} as Record<BranchName, CommitPresence>;
    for (const br of BRANCHES) {
      if (containByBranch[br].has(c.hash)) p[br] = 'exact';
      else if (subjectByBranch[br].has(key)) p[br] = 'equivalent';
      else p[br] = 'absent';
    }
    return p;
  };

  const parsedA = parseCommits(a2b);
  const parsedB = parseCommits(b2a);

  const tag = (commits: Commit[], equiv: Set<string>, otherSide: BranchName): DiffCommit[] =>
    commits.map((c) => {
      const key = `${c.author}|${c.subject}`;
      const match = subjectByBranch[otherSide].get(key);
      const isEquiv = equiv.has(c.hash) || (!!match && match !== c.hash);
      return {
        ...c,
        kind: isEquiv ? 'equivalente' : 'exclusivo',
        equivalentOf: isEquiv ? (match ? match.slice(0, 7) : undefined) : undefined,
        isIgnored: ignored.has(c.hash),
        presence: presenceOf(c),
      } as DiffCommit;
    });

  const taggedA = tag(parsedA, equivInA, b);
  const taggedB = tag(parsedB, equivInB, a);

  return {
    onlyInA: taggedA,
    onlyInB: taggedB,
    common: mergeBase.trim(),
    summary: {
      exclusivosA: taggedA.filter((c) => c.kind === 'exclusivo').length,
      exclusivosB: taggedB.filter((c) => c.kind === 'exclusivo').length,
      equivalentesA: taggedA.filter((c) => c.kind === 'equivalente').length,
      equivalentesB: taggedB.filter((c) => c.kind === 'equivalente').length,
      mergesA: taggedA.filter((c) => c.isMerge).length,
      mergesB: taggedB.filter((c) => c.isMerge).length,
      revertsA: taggedA.filter((c) => c.isRevert).length,
      revertsB: taggedB.filter((c) => c.isRevert).length,
    },
  };
}

export async function filesChanged(repo: RepoName, a: BranchName, b: BranchName): Promise<string[]> {
  await maybeFetch(repo);
  const out = await git(repo).raw(['diff', '--name-only', `origin/${a}..origin/${b}`]);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function fileDiff(repo: RepoName, a: BranchName, b: BranchName, file: string): Promise<string> {
  await maybeFetch(repo);
  return git(repo).raw(['diff', `origin/${a}..origin/${b}`, '--', file]);
}

export async function commitDetail(repo: RepoName, hash: string): Promise<{ files: string[]; diff: string }> {
  const files = (await git(repo).raw(['show', '--name-only', '--pretty=format:', hash])).split('\n').map((s) => s.trim()).filter(Boolean);
  const diff = await git(repo).raw(['show', hash]);
  return { files, diff };
}
