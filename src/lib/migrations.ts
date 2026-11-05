import { query } from './mysql.js';
import { DB_NAMES, DbName } from '../config.js';

export interface MigrationRow {
  name: string;
  startedAt: string | null;
  finishedAt: string | null;
  rolledBackAt: string | null;
  checksum: string | null;
  appliedStepsCount: number | null;
}

export interface MigrationCell {
  present: boolean;
  finishedAt: string | null;
  rolledBackAt: string | null;
  mismatch: 'ok' | 'rolled-back' | 'in-progress' | 'checksum-divergente';
}

export interface MigrationsReport {
  dbs: DbName[];
  dbsSinTabla: DbName[];
  matriz: Array<{
    name: string;
    firstSeen: string | null;
    byDb: Record<DbName, MigrationCell | null>;
    anomalia: string | null;
  }>;
}

async function readMigrations(db: DbName): Promise<{ ok: true; rows: MigrationRow[] } | { ok: false; error: string }> {
  try {
    const rows = await query<any>(
      db,
      `SELECT migration_name AS name, started_at, finished_at, rolled_back_at, checksum, applied_steps_count
       FROM _prisma_migrations
       ORDER BY started_at`
    );
    return {
      ok: true,
      rows: rows.map((r) => ({
        name: r.name,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
        finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        rolledBackAt: r.rolled_back_at ? new Date(r.rolled_back_at).toISOString() : null,
        checksum: r.checksum ?? null,
        appliedStepsCount: r.applied_steps_count == null ? null : Number(r.applied_steps_count),
      })),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

const FLOW_ORDER: DbName[] = ['stage', 'dev', 'release', 'main'];

export async function migrationsReport(): Promise<MigrationsReport> {
  const resultados = await Promise.all(DB_NAMES.map(async (d) => ({ db: d, res: await readMigrations(d) })));
  const dbsSinTabla: DbName[] = [];
  const byDbRows: Record<DbName, MigrationRow[]> = {} as any;
  for (const { db, res } of resultados) {
    if (!res.ok) { dbsSinTabla.push(db); byDbRows[db] = []; }
    else byDbRows[db] = res.rows;
  }

  const allNames = new Set<string>();
  for (const d of DB_NAMES) for (const r of byDbRows[d]) allNames.add(r.name);

  const firstSeen = new Map<string, string>();
  for (const n of allNames) {
    let min: string | null = null;
    for (const d of DB_NAMES) {
      const r = byDbRows[d].find((x) => x.name === n);
      if (r?.startedAt && (!min || r.startedAt < min)) min = r.startedAt;
    }
    if (min) firstSeen.set(n, min);
  }

  const matriz = Array.from(allNames).map((name) => {
    const byDb: Record<DbName, MigrationCell | null> = {} as any;
    const checksums = new Set<string>();
    for (const d of DB_NAMES) {
      if (dbsSinTabla.includes(d)) { byDb[d] = null; continue; }
      const r = byDbRows[d].find((x) => x.name === name);
      if (!r) { byDb[d] = { present: false, finishedAt: null, rolledBackAt: null, mismatch: 'ok' }; continue; }
      let mismatch: MigrationCell['mismatch'] = 'ok';
      if (r.rolledBackAt) mismatch = 'rolled-back';
      else if (!r.finishedAt) mismatch = 'in-progress';
      byDb[d] = { present: true, finishedAt: r.finishedAt, rolledBackAt: r.rolledBackAt, mismatch };
      if (r.checksum) checksums.add(r.checksum);
    }
    if (checksums.size > 1) {
      for (const d of DB_NAMES) {
        const cell = byDb[d];
        if (cell && cell.present && cell.mismatch === 'ok') cell.mismatch = 'checksum-divergente';
      }
    }

    let anomalia: string | null = null;
    const presenceFlags: Record<DbName, boolean> = {} as any;
    for (const d of DB_NAMES) presenceFlags[d] = byDb[d]?.present === true;
    if (presenceFlags.main && !presenceFlags.release) anomalia = 'aplicada en main pero no en release';
    else if (presenceFlags.release && !presenceFlags.dev) anomalia = 'aplicada en release pero no en dev';
    else if (presenceFlags.dev && !presenceFlags.stage) anomalia = 'aplicada en dev pero no en stage';
    else if (checksums.size > 1) anomalia = 'checksum divergente entre BDs (misma migration, SQL distinto)';
    else {
      const rolled = DB_NAMES.filter((d) => byDb[d]?.mismatch === 'rolled-back');
      if (rolled.length > 0 && rolled.length < DB_NAMES.length - dbsSinTabla.length) anomalia = `rolled back en ${rolled.join(',')} pero aplicada en otros`;
    }

    return { name, firstSeen: firstSeen.get(name) ?? null, byDb, anomalia };
  });

  matriz.sort((a, b) => (a.firstSeen ?? '').localeCompare(b.firstSeen ?? ''));

  return { dbs: FLOW_ORDER, dbsSinTabla, matriz };
}
