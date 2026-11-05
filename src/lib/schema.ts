import { query } from './mysql.js';
import { config, DbName, DB_NAMES } from '../config.js';

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  extra: string;
  key: string;
  position: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
  type: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface TableInfo {
  name: string;
  engine: string | null;
  rows: number | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface ViewInfo {
  name: string;
  definition: string;
  columns: ColumnInfo[];
}

export interface RoutineInfo {
  name: string;
  type: 'PROCEDURE' | 'FUNCTION';
  returns: string | null;
  definition: string;
}

export interface SchemaSnapshot {
  db: DbName;
  database: string;
  version: string;
  tables: TableInfo[];
  views: ViewInfo[];
  routines: RoutineInfo[];
}

export async function snapshotSchema(db: DbName): Promise<SchemaSnapshot> {
  const dbName = config.dbs[db].database;
  const ver = await query<{ v: string }>(db, 'SELECT VERSION() as v');

  const cols = await query<any>(
    db,
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY, ORDINAL_POSITION
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [dbName]
  );

  const tables = await query<any>(
    db,
    `SELECT TABLE_NAME, ENGINE, TABLE_ROWS, TABLE_TYPE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE','VIEW')
     ORDER BY TABLE_NAME`,
    [dbName]
  );

  const stats = await query<any>(
    db,
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, INDEX_TYPE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [dbName]
  );

  const fkRefs = await query<any>(
    db,
    `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
            k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            r.UPDATE_RULE, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [dbName]
  );

  const views = await query<any>(
    db,
    `SELECT TABLE_NAME, VIEW_DEFINITION
     FROM information_schema.VIEWS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME`,
    [dbName]
  );

  const routines = await query<any>(
    db,
    `SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION
     FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ?
     ORDER BY ROUTINE_NAME`,
    [dbName]
  );

  const colsByTable = new Map<string, ColumnInfo[]>();
  for (const c of cols) {
    const list = colsByTable.get(c.TABLE_NAME) ?? [];
    list.push({
      name: c.COLUMN_NAME,
      type: c.COLUMN_TYPE,
      nullable: c.IS_NULLABLE === 'YES',
      default: c.COLUMN_DEFAULT,
      extra: c.EXTRA ?? '',
      key: c.COLUMN_KEY ?? '',
      position: Number(c.ORDINAL_POSITION),
    });
    colsByTable.set(c.TABLE_NAME, list);
  }

  const idxByTable = new Map<string, Map<string, IndexInfo>>();
  for (const s of stats) {
    const t = idxByTable.get(s.TABLE_NAME) ?? new Map<string, IndexInfo>();
    const existing = t.get(s.INDEX_NAME);
    const idx: IndexInfo = existing ?? { name: s.INDEX_NAME, unique: s.NON_UNIQUE === 0, columns: [], type: s.INDEX_TYPE };
    idx.columns.push(s.COLUMN_NAME);
    t.set(s.INDEX_NAME, idx);
    idxByTable.set(s.TABLE_NAME, t);
  }

  const fkByTable = new Map<string, Map<string, ForeignKeyInfo>>();
  for (const f of fkRefs) {
    const t = fkByTable.get(f.TABLE_NAME) ?? new Map<string, ForeignKeyInfo>();
    const existing = t.get(f.CONSTRAINT_NAME);
    const fk: ForeignKeyInfo = existing ?? {
      name: f.CONSTRAINT_NAME,
      columns: [],
      refTable: f.REFERENCED_TABLE_NAME,
      refColumns: [],
      onUpdate: f.UPDATE_RULE,
      onDelete: f.DELETE_RULE,
    };
    fk.columns.push(f.COLUMN_NAME);
    fk.refColumns.push(f.REFERENCED_COLUMN_NAME);
    t.set(f.CONSTRAINT_NAME, fk);
    fkByTable.set(f.TABLE_NAME, t);
  }

  const viewNames = new Set(views.map((v) => v.TABLE_NAME));
  return {
    db,
    database: dbName,
    version: ver[0].v,
    tables: tables.filter((t) => !viewNames.has(t.TABLE_NAME)).map((t) => ({
      name: t.TABLE_NAME,
      engine: t.ENGINE,
      rows: t.TABLE_ROWS == null ? null : Number(t.TABLE_ROWS),
      columns: colsByTable.get(t.TABLE_NAME) ?? [],
      indexes: Array.from(idxByTable.get(t.TABLE_NAME)?.values() ?? []),
      foreignKeys: Array.from(fkByTable.get(t.TABLE_NAME)?.values() ?? []),
    })),
    views: views.map((v) => ({
      name: v.TABLE_NAME,
      definition: v.VIEW_DEFINITION ?? '',
      columns: colsByTable.get(v.TABLE_NAME) ?? [],
    })),
    routines: routines.map((r) => ({
      name: r.ROUTINE_NAME,
      type: r.ROUTINE_TYPE,
      returns: r.DTD_IDENTIFIER ?? null,
      definition: r.ROUTINE_DEFINITION ?? '',
    })),
  };
}

export interface SchemaDiff {
  tables: {
    onlyInA: string[];
    onlyInB: string[];
    inBoth: Array<{
      name: string;
      columns: { onlyInA: string[]; onlyInB: string[]; changed: Array<{ name: string; a: ColumnInfo; b: ColumnInfo; fields: string[] }> };
      indexes: { onlyInA: IndexInfo[]; onlyInB: IndexInfo[]; changed: Array<{ name: string; a: IndexInfo; b: IndexInfo; fields: string[] }> };
      foreignKeys: { onlyInA: ForeignKeyInfo[]; onlyInB: ForeignKeyInfo[]; changed: Array<{ name: string; a: ForeignKeyInfo; b: ForeignKeyInfo; fields: string[] }> };
    }>;
  };
  views: { onlyInA: string[]; onlyInB: string[]; changed: Array<{ name: string; a: string; b: string }> };
  routines: { onlyInA: string[]; onlyInB: string[]; changed: Array<{ name: string; a: RoutineInfo; b: RoutineInfo; fields: string[] }> };
}

function normalizeType(t: string): string {
  if (!t) return '';
  let s = t.trim().toLowerCase();
  s = s.replace(/\b(tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)/g, '$1');
  s = s.replace(/\binteger\b/g, 'int');
  s = s.replace(/\s+zerofill\b/g, '');
  s = s.replace(/\s+/g, ' ');
  return s;
}

function normalizeDefault(def: string | null | undefined, nullable: boolean): string {
  if (def == null) return nullable ? 'null' : '';
  let s = String(def).trim();
  if (/^null$/i.test(s)) return 'null';
  s = s.replace(/current_timestamp\s*(?:\(\s*\d*\s*\))?/gi, 'current_timestamp');
  s = s.replace(/\bnow\s*\(\s*\)/gi, 'current_timestamp');
  if (s.startsWith("b'") && s.endsWith("'")) return s.toLowerCase();
  const low = s.toLowerCase();
  if (low === 'current_timestamp') return low;
  const stripped = s.replace(/^'(.*)'$/s, (_, inner) => inner.replace(/''/g, "'"));
  return stripped.toLowerCase();
}

function normalizeExtra(extra: string | null | undefined): string {
  if (!extra) return '';
  let s = extra.trim().toLowerCase();
  s = s.replace(/\bdefault_generated\b/g, '').trim();
  s = s.replace(/on update current_timestamp\s*(?:\(\s*\d*\s*\))?/g, 'on update current_timestamp');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function colEqual(a: ColumnInfo, b: ColumnInfo): { equal: boolean; fields: string[] } {
  const fields: string[] = [];
  if (normalizeType(a.type) !== normalizeType(b.type)) fields.push('type');
  if (a.nullable !== b.nullable) fields.push('nullable');
  if (normalizeDefault(a.default, a.nullable) !== normalizeDefault(b.default, b.nullable)) fields.push('default');
  if (normalizeExtra(a.extra) !== normalizeExtra(b.extra)) fields.push('extra');
  return { equal: fields.length === 0, fields };
}

function idxEqual(a: IndexInfo, b: IndexInfo): { equal: boolean; fields: string[] } {
  const fields: string[] = [];
  if (a.unique !== b.unique) fields.push('unique');
  if (a.columns.join(',') !== b.columns.join(',')) fields.push('columns');
  if (a.type !== b.type) fields.push('type');
  return { equal: fields.length === 0, fields };
}

function fkEqual(a: ForeignKeyInfo, b: ForeignKeyInfo): { equal: boolean; fields: string[] } {
  const fields: string[] = [];
  if (a.columns.join(',') !== b.columns.join(',')) fields.push('columns');
  if (a.refTable !== b.refTable) fields.push('refTable');
  if (a.refColumns.join(',') !== b.refColumns.join(',')) fields.push('refColumns');
  if (a.onUpdate !== b.onUpdate) fields.push('onUpdate');
  if (a.onDelete !== b.onDelete) fields.push('onDelete');
  return { equal: fields.length === 0, fields };
}

export function diffSchemas(a: SchemaSnapshot, b: SchemaSnapshot): SchemaDiff {
  const aTables = new Map(a.tables.map((t) => [t.name, t]));
  const bTables = new Map(b.tables.map((t) => [t.name, t]));

  const onlyA = [...aTables.keys()].filter((n) => !bTables.has(n));
  const onlyB = [...bTables.keys()].filter((n) => !aTables.has(n));
  const both = [...aTables.keys()].filter((n) => bTables.has(n));

  const inBoth = both.map((name) => {
    const ta = aTables.get(name)!;
    const tb = bTables.get(name)!;
    const aCols = new Map(ta.columns.map((c) => [c.name, c]));
    const bCols = new Map(tb.columns.map((c) => [c.name, c]));
    const colOnlyA = [...aCols.keys()].filter((n) => !bCols.has(n));
    const colOnlyB = [...bCols.keys()].filter((n) => !aCols.has(n));
    const colChanged = [...aCols.keys()]
      .filter((n) => bCols.has(n))
      .map((n) => ({ n, a: aCols.get(n)!, b: bCols.get(n)!, eq: colEqual(aCols.get(n)!, bCols.get(n)!) }))
      .filter((x) => !x.eq.equal)
      .map((x) => ({ name: x.n, a: x.a, b: x.b, fields: x.eq.fields }));

    const aIdx = new Map(ta.indexes.map((i) => [i.name, i]));
    const bIdx = new Map(tb.indexes.map((i) => [i.name, i]));
    const idxOnlyA = [...aIdx.values()].filter((i) => !bIdx.has(i.name));
    const idxOnlyB = [...bIdx.values()].filter((i) => !aIdx.has(i.name));
    const idxChanged = [...aIdx.values()]
      .filter((i) => bIdx.has(i.name))
      .map((i) => ({ i, b: bIdx.get(i.name)!, eq: idxEqual(i, bIdx.get(i.name)!) }))
      .filter((x) => !x.eq.equal)
      .map((x) => ({ name: x.i.name, a: x.i, b: x.b, fields: x.eq.fields }));

    const aFk = new Map(ta.foreignKeys.map((f) => [f.name, f]));
    const bFk = new Map(tb.foreignKeys.map((f) => [f.name, f]));
    const fkOnlyA = [...aFk.values()].filter((f) => !bFk.has(f.name));
    const fkOnlyB = [...bFk.values()].filter((f) => !aFk.has(f.name));
    const fkChanged = [...aFk.values()]
      .filter((f) => bFk.has(f.name))
      .map((f) => ({ f, b: bFk.get(f.name)!, eq: fkEqual(f, bFk.get(f.name)!) }))
      .filter((x) => !x.eq.equal)
      .map((x) => ({ name: x.f.name, a: x.f, b: x.b, fields: x.eq.fields }));

    return {
      name,
      columns: { onlyInA: colOnlyA, onlyInB: colOnlyB, changed: colChanged },
      indexes: { onlyInA: idxOnlyA, onlyInB: idxOnlyB, changed: idxChanged },
      foreignKeys: { onlyInA: fkOnlyA, onlyInB: fkOnlyB, changed: fkChanged },
    };
  }).filter((t) => t.columns.onlyInA.length || t.columns.onlyInB.length || t.columns.changed.length || t.indexes.onlyInA.length || t.indexes.onlyInB.length || t.indexes.changed.length || t.foreignKeys.onlyInA.length || t.foreignKeys.onlyInB.length || t.foreignKeys.changed.length);

  const normView = (def: string, schemaA: string, schemaB: string): string =>
    def
      .replace(new RegExp(`\`?${schemaA}\`?\\.`, 'gi'), '')
      .replace(new RegExp(`\`?${schemaB}\`?\\.`, 'gi'), '')
      .replace(/\s+/g, ' ')
      .replace(/\(\s*/g, '(')
      .replace(/\s*\)/g, ')')
      .replace(/`/g, '')
      .toLowerCase()
      .trim();

  const aViews = new Map(a.views.map((v) => [v.name, v.definition]));
  const bViews = new Map(b.views.map((v) => [v.name, v.definition]));
  const viewOnlyA = [...aViews.keys()].filter((n) => !bViews.has(n));
  const viewOnlyB = [...bViews.keys()].filter((n) => !aViews.has(n));
  const viewChanged = [...aViews.keys()]
    .filter((n) => bViews.has(n) && normView(aViews.get(n)!, a.database, b.database) !== normView(bViews.get(n)!, a.database, b.database))
    .map((n) => ({ name: n, a: aViews.get(n)!, b: bViews.get(n)! }));

  const aRout = new Map(a.routines.map((r) => [r.name, r]));
  const bRout = new Map(b.routines.map((r) => [r.name, r]));
  const routOnlyA = [...aRout.keys()].filter((n) => !bRout.has(n));
  const routOnlyB = [...bRout.keys()].filter((n) => !aRout.has(n));
  const normDef = (s: string): string =>
    s
      .replace(new RegExp(`\`?${a.database}\`?\\.`, 'gi'), '')
      .replace(new RegExp(`\`?${b.database}\`?\\.`, 'gi'), '')
      .replace(/\s+/g, ' ')
      .replace(/`/g, '')
      .toLowerCase()
      .trim();
  const routChanged = [...aRout.values()]
    .filter((r) => bRout.has(r.name))
    .map((r) => {
      const o = bRout.get(r.name)!;
      const fields: string[] = [];
      if (r.type !== o.type) fields.push('type');
      if (normalizeType(r.returns ?? '') !== normalizeType(o.returns ?? '')) fields.push('returns');
      if (normDef(r.definition ?? '') !== normDef(o.definition ?? '')) fields.push('definition');
      return { name: r.name, a: r, b: o, fields };
    })
    .filter((r) => r.fields.length > 0);

  return {
    tables: { onlyInA: onlyA, onlyInB: onlyB, inBoth },
    views: { onlyInA: viewOnlyA, onlyInB: viewOnlyB, changed: viewChanged },
    routines: { onlyInA: routOnlyA, onlyInB: routOnlyB, changed: routChanged },
  };
}

export interface MatrixVariant { db: DbName; valor: string | null }
export interface MatrixItem {
  tipo: 'tabla' | 'columna' | 'indice' | 'fk' | 'vista' | 'routine';
  tabla?: string;
  nombre: string;
  variantes: MatrixVariant[];
}
export interface MatrixReport {
  dbs: DbName[];
  tablas: Record<string, { estaEn: DbName[]; columnas: MatrixItem[]; indices: MatrixItem[]; fks: MatrixItem[] }>;
  vistas: MatrixItem[];
  routines: MatrixItem[];
}

function colToSig(c: ColumnInfo): string {
  const t = normalizeType(c.type);
  const n = c.nullable ? 'NULL' : 'NOT NULL';
  const d = normalizeDefault(c.default, c.nullable);
  const e = normalizeExtra(c.extra);
  return `${t} ${n}${d ? ` default ${d}` : ''}${e ? ` ${e}` : ''}`.trim();
}
function idxToSig(i: IndexInfo): string {
  return `(${i.columns.join(',')})${i.unique ? ' UNIQUE' : ''} ${i.type ?? ''}`.trim();
}
function fkToSig(f: ForeignKeyInfo): string {
  return `(${f.columns.join(',')}) -> ${f.refTable}(${f.refColumns.join(',')}) ON UPDATE ${f.onUpdate} ON DELETE ${f.onDelete}`;
}

export async function schemaMatrixDetailed(): Promise<MatrixReport> {
  const dbs = DB_NAMES;
  const snaps = await Promise.all(dbs.map((d) => snapshotSchema(d)));
  const byDb: Record<DbName, SchemaSnapshot> = {} as any;
  dbs.forEach((d, i) => (byDb[d] = snaps[i]));

  const tablas: MatrixReport['tablas'] = {};
  const allTableNames = new Set<string>();
  for (const s of snaps) for (const t of s.tables) allTableNames.add(t.name);

  for (const name of allTableNames) {
    const perDb: Record<DbName, { table?: TableInfo }> = {} as any;
    const estaEn: DbName[] = [];
    for (const d of dbs) {
      const t = byDb[d].tables.find((x) => x.name === name);
      perDb[d] = { table: t };
      if (t) estaEn.push(d);
    }

    const colNames = new Set<string>();
    for (const d of dbs) for (const c of perDb[d].table?.columns ?? []) colNames.add(c.name);
    const columnas: MatrixItem[] = [];
    for (const cn of colNames) {
      const variantes = dbs.map((d) => {
        const c = perDb[d].table?.columns.find((x) => x.name === cn);
        return { db: d, valor: c ? colToSig(c) : null };
      });
      const vals = variantes.map((v) => v.valor);
      const uniq = new Set(vals);
      if (uniq.size > 1) columnas.push({ tipo: 'columna', tabla: name, nombre: cn, variantes });
    }

    const idxNames = new Set<string>();
    for (const d of dbs) for (const i of perDb[d].table?.indexes ?? []) idxNames.add(i.name);
    const indices: MatrixItem[] = [];
    for (const inm of idxNames) {
      const variantes = dbs.map((d) => {
        const i = perDb[d].table?.indexes.find((x) => x.name === inm);
        return { db: d, valor: i ? idxToSig(i) : null };
      });
      if (new Set(variantes.map((v) => v.valor)).size > 1) indices.push({ tipo: 'indice', tabla: name, nombre: inm, variantes });
    }

    const fkNames = new Set<string>();
    for (const d of dbs) for (const f of perDb[d].table?.foreignKeys ?? []) fkNames.add(f.name);
    const fks: MatrixItem[] = [];
    for (const fn of fkNames) {
      const variantes = dbs.map((d) => {
        const f = perDb[d].table?.foreignKeys.find((x) => x.name === fn);
        return { db: d, valor: f ? fkToSig(f) : null };
      });
      if (new Set(variantes.map((v) => v.valor)).size > 1) fks.push({ tipo: 'fk', tabla: name, nombre: fn, variantes });
    }

    const tablaDifiere = estaEn.length < dbs.length || columnas.length || indices.length || fks.length;
    if (tablaDifiere) tablas[name] = { estaEn, columnas, indices, fks };
  }

  const viewNames = new Set<string>();
  for (const s of snaps) for (const v of s.views) viewNames.add(v.name);
  const vistas: MatrixItem[] = [];
  for (const name of viewNames) {
    const variantes = dbs.map((d) => {
      const v = byDb[d].views.find((x) => x.name === name);
      return { db: d, valor: v ? (v.definition || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/`/g, '').slice(0, 200) : null };
    });
    if (new Set(variantes.map((v) => v.valor)).size > 1) vistas.push({ tipo: 'vista', nombre: name, variantes });
  }

  const routNames = new Set<string>();
  for (const s of snaps) for (const r of s.routines) routNames.add(r.name);
  const routines: MatrixItem[] = [];
  for (const name of routNames) {
    const variantes = dbs.map((d) => {
      const r = byDb[d].routines.find((x) => x.name === name);
      return { db: d, valor: r ? `${r.type} returns ${r.returns ?? ''}` : null };
    });
    if (new Set(variantes.map((v) => v.valor)).size > 1) routines.push({ tipo: 'routine', nombre: name, variantes });
  }

  return { dbs, tablas, vistas, routines };
}
