import * as dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export type DbName = 'main' | 'dev' | 'release' | 'stage';

export interface DbConfig {
  name: DbName;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

function dbCfg(prefix: Uppercase<DbName>): DbConfig {
  return {
    name: prefix.toLowerCase() as DbName,
    host: req(`${prefix}_HOST`),
    port: Number(req(`${prefix}_PORT`)),
    user: req(`${prefix}_USER`),
    password: req(`${prefix}_PASSWORD`),
    database: req(`${prefix}_DB`),
    ssl: (process.env[`${prefix}_SSL`] ?? 'false') === 'true',
  };
}

const corsOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function parseUsers(raw: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const u = pair.slice(0, idx).trim();
    const p = pair.slice(idx + 1);
    if (u && p) m.set(u, p);
  }
  return m;
}

const users = parseUsers(process.env.AUTH_USERS ?? '');
if (users.size === 0) throw new Error('Falta AUTH_USERS en .env (formato: user1:pass1,user2:pass2)');

const authSecret = process.env.AUTH_SECRET ?? '';
if (authSecret.length < 16) throw new Error('Falta AUTH_SECRET en .env (minimo 16 caracteres)');

export const config = {
  port: Number(process.env.PORT ?? 3100),
  users,
  authSecret,
  asanaToken: (process.env.ASANA_TOKEN ?? '').trim(),
  autoFetch: (process.env.AUTO_FETCH ?? 'true') === 'true',
  corsOrigins,
  repos: {
    front: path.resolve(req('FRONT_REPO_PATH')),
    back: path.resolve(req('BACK_REPO_PATH')),
  },
  dbs: {
    main: dbCfg('MAIN'),
    dev: dbCfg('DEV'),
    release: dbCfg('RELEASE'),
    stage: dbCfg('STAGE'),
  } as Record<DbName, DbConfig>,
};

export const DB_NAMES: DbName[] = ['main', 'dev', 'release', 'stage'];
export const REPO_NAMES = ['front', 'back'] as const;
export type RepoName = typeof REPO_NAMES[number];
