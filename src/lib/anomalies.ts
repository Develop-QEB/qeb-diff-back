import { BRANCHES, BranchName, fullSubjectIndex, maybeFetch } from './git.js';
import { ignoredHashesByRepo } from './ignored.js';
import { config, DbName, DB_NAMES, RepoName } from '../config.js';
import { snapshotSchema } from './schema.js';
import { simpleGit } from 'simple-git';

const FLOW: BranchName[] = ['stage', 'dev', 'release', 'main'];
const DB_FLOW: DbName[] = ['stage', 'dev', 'release', 'main'];

export interface BranchAnomaly {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  isMerge: boolean;
  presence: Record<BranchName, 'exact' | 'equivalent' | 'absent'>;
  tipo: string;
  asanaId?: string;
}

function extractAsanaIdFromSubject(subject: string): string | undefined {
  const m = subject.match(/#(\d{10,})/);
  return m ? m[1] : undefined;
}

async function branchContainment(repo: RepoName, branch: BranchName): Promise<Map<string, boolean>> {
  const g = simpleGit(config.repos[repo]);
  const out = await g.raw(['log', `origin/${branch}`, '--pretty=format:%H']);
  const m = new Map<string, boolean>();
  for (const h of out.split('\n').map((s) => s.trim()).filter(Boolean)) m.set(h, true);
  return m;
}

async function cherryEquivalentsIntoBranch(repo: RepoName, target: BranchName): Promise<Set<string>> {
  const g = simpleGit(config.repos[repo]);
  const equiv = new Set<string>();
  for (const other of FLOW) {
    if (other === target) continue;
    try {
      const out = await g.raw(['cherry', `origin/${target}`, `origin/${other}`]).catch(() => '');
      for (const line of out.split('\n')) {
        const m = line.match(/^-\s+([0-9a-f]{40})/);
        if (m) equiv.add(m[1]);
      }
    } catch {
      void 0;
    }
  }
  return equiv;
}

export async function branchAnomalies(repo: RepoName): Promise<BranchAnomaly[]> {
  await maybeFetch(repo);
  const g = simpleGit(config.repos[repo]);

  const contain: Record<BranchName, Map<string, boolean>> = {} as any;
  const equivInto: Record<BranchName, Set<string>> = {} as any;
  const subjectIndex: Record<BranchName, Map<string, string>> = {} as any;
  await Promise.all(FLOW.map(async (b) => {
    const [c, e, s] = await Promise.all([
      branchContainment(repo, b),
      cherryEquivalentsIntoBranch(repo, b),
      fullSubjectIndex(repo, b),
    ]);
    contain[b] = c; equivInto[b] = e; subjectIndex[b] = s;
  }));

  const meta = new Map<string, { author: string; date: string; subject: string; parents: number }>();
  for (const b of FLOW) {
    const raw = await g.raw(['log', `origin/${b}`, '--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1f%P']).catch(() => '');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const [h, author, date, subject, parents] = line.split('\x1f');
      if (meta.has(h)) continue;
      meta.set(h, { author, date, subject, parents: (parents ?? '').trim().split(/\s+/).filter(Boolean).length });
    }
  }
  const allHashes = new Set<string>(meta.keys());

  const presenceOf = (hash: string, m: { author: string; subject: string }): Record<BranchName, 'exact' | 'equivalent' | 'absent'> => {
    const key = `${m.author}|${m.subject}`;
    const p: Record<BranchName, 'exact' | 'equivalent' | 'absent'> = {} as any;
    for (const b of FLOW) {
      if (contain[b].has(hash)) p[b] = 'exact';
      else if (equivInto[b].has(hash) || subjectIndex[b].has(key)) p[b] = 'equivalent';
      else p[b] = 'absent';
    }
    return p;
  };

  const isAnomaly = (p: Record<BranchName, 'exact' | 'equivalent' | 'absent'>): string | null => {
    const have = (b: BranchName) => p[b] !== 'absent';
    if (have('main') && !have('release')) return 'en main pero no en release (hotfix directo)';
    if (have('release') && !have('dev')) return 'en release pero no en dev (salto de rama)';
    if (have('dev') && !have('stage')) return 'en dev pero no en stage (saltaron stage)';
    if (!have('stage') && !have('dev') && have('release') && !have('main')) return 'solo en release (huerfano arriba)';
    if (!have('stage') && !have('dev') && !have('release') && have('main')) return 'solo en main (huerfano total)';
    return null;
  };

  const anomalies: BranchAnomaly[] = [];
  const ignored = await ignoredHashesByRepo(repo);
  for (const hash of allHashes) {
    const m = meta.get(hash);
    if (!m) continue;
    if (m.parents > 1) continue;
    if (/^revert\b/i.test(m.subject)) continue;
    if (ignored.has(hash)) continue;
    const presence = presenceOf(hash, m);
    const tipo = isAnomaly(presence);
    if (!tipo) continue;
    anomalies.push({
      hash,
      shortHash: hash.slice(0, 7),
      author: m.author,
      date: m.date,
      subject: m.subject,
      isMerge: m.parents > 1,
      presence,
      tipo,
      asanaId: extractAsanaIdFromSubject(m.subject),
    });
  }

  anomalies.sort((a, b) => (a.date < b.date ? 1 : -1));
  return anomalies;
}

export interface SchemaAnomalyElement {
  tipo: 'tabla' | 'columna' | 'indice' | 'fk' | 'vista' | 'routine';
  tabla?: string;
  nombre: string;
  presence: Record<DbName, boolean>;
  anomalia: string;
}

function key(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('::');
}

export interface SchemaMatrixElement {
  tipo: SchemaAnomalyElement['tipo'];
  tabla?: string;
  nombre: string;
  presence: Record<DbName, boolean>;
  anomalia: string | null;
}

async function buildSchemaMatrix(): Promise<SchemaMatrixElement[]> {
  const snaps = await Promise.all(DB_FLOW.map((d) => snapshotSchema(d)));
  const byDb: Record<DbName, typeof snaps[0]> = {} as any;
  DB_FLOW.forEach((d, i) => (byDb[d] = snaps[i]));

  const elements = new Map<string, { tipo: SchemaAnomalyElement['tipo']; tabla?: string; nombre: string; presence: Record<DbName, boolean> }>();
  const ensure = (k: string, meta: { tipo: SchemaAnomalyElement['tipo']; tabla?: string; nombre: string }) => {
    let e = elements.get(k);
    if (!e) {
      e = { ...meta, presence: { main: false, dev: false, release: false, stage: false } };
      elements.set(k, e);
    }
    return e;
  };

  for (const db of DB_FLOW) {
    const s = byDb[db];
    for (const t of s.tables) {
      ensure(key(['tabla', t.name]), { tipo: 'tabla', nombre: t.name }).presence[db] = true;
      for (const c of t.columns) ensure(key(['columna', t.name, c.name]), { tipo: 'columna', tabla: t.name, nombre: c.name }).presence[db] = true;
      for (const i of t.indexes) ensure(key(['indice', t.name, i.name]), { tipo: 'indice', tabla: t.name, nombre: i.name }).presence[db] = true;
      for (const f of t.foreignKeys) ensure(key(['fk', t.name, f.name]), { tipo: 'fk', tabla: t.name, nombre: f.name }).presence[db] = true;
    }
    for (const v of s.views) ensure(key(['vista', v.name]), { tipo: 'vista', nombre: v.name }).presence[db] = true;
    for (const r of s.routines) ensure(key(['routine', r.name]), { tipo: 'routine', nombre: r.name }).presence[db] = true;
  }

  const classify = (p: Record<DbName, boolean>): string | null => {
    if (p.main && !p.release) return 'en main pero no en release';
    if (p.release && !p.dev) return 'en release pero no en dev';
    if (p.dev && !p.stage) return 'en dev pero no en stage';
    if (!p.stage && !p.dev && p.release && !p.main) return 'solo en release';
    if (!p.stage && !p.dev && !p.release && p.main) return 'solo en main';
    return null;
  };

  const matrix: SchemaMatrixElement[] = [];
  for (const e of elements.values()) {
    matrix.push({ ...e, anomalia: classify(e.presence) });
  }
  return matrix;
}

export async function schemaMatrix(): Promise<SchemaMatrixElement[]> {
  return buildSchemaMatrix();
}

export async function schemaAnomalies(): Promise<SchemaAnomalyElement[]> {
  const m = await buildSchemaMatrix();
  const out: SchemaAnomalyElement[] = m
    .filter((e) => e.anomalia !== null)
    .map((e) => ({ tipo: e.tipo, tabla: e.tabla, nombre: e.nombre, presence: e.presence, anomalia: e.anomalia! }));
  return out.sort((a, b) => a.anomalia.localeCompare(b.anomalia) || a.tipo.localeCompare(b.tipo) || (a.tabla ?? '').localeCompare(b.tabla ?? '') || a.nombre.localeCompare(b.nombre));
}

