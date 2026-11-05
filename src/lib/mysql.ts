import mysql from 'mysql2/promise';
import { config, DbConfig, DbName } from '../config.js';

const pools = new Map<DbName, mysql.Pool>();

export function getPool(db: DbName): mysql.Pool {
  const cached = pools.get(db);
  if (cached) return cached;
  const cfg: DbConfig = config.dbs[db];
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 3,
    connectTimeout: 20000,
    waitForConnections: true,
  });
  pools.set(db, pool);
  return pool;
}

export async function query<T = any>(db: DbName, sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = getPool(db);
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}
