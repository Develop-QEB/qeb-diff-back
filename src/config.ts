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

export type LogSourceType = 'pm2' | 'do';
export interface LogSource {
  key: string;
  label: string;
  type: LogSourceType;
  pm2Name?: string;
}

// LOGS_SOURCES = "key:type:arg, key:type:arg, ..."
//   key:pm2:<nombreProcesoPm2>  -> jala `pm2 logs <nombre>` del droplet
//   key:do                      -> jala DigitalOcean App Platform (usa DO_*)
// Ej: release:pm2:qeb-back-release,stage:pm2:qeb-back-stage,bi:pm2:bi-back
function parseLogSources(raw: string): LogSource[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item): LogSource | null => {
      const [rawKey, rawType, ...rest] = item.split(':');
      const key = (rawKey ?? '').trim();
      if (!key) return null;
      const type = (rawType ?? 'pm2').trim().toLowerCase();
      if (type === 'do') return { key, label: key, type: 'do' };
      const pm2Name = rest.join(':').trim() || key;
      return { key, label: key, type: 'pm2', pm2Name };
    })
    .filter((s): s is LogSource => s !== null);
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  authPassword: req('AUTH_PASSWORD'),
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
  logs: {
    sources: parseLogSources(process.env.LOGS_SOURCES ?? ''),
    doAppId: (process.env.DO_APP_ID ?? '').trim(),
    doComponent: (process.env.DO_COMPONENT ?? '').trim(),
    doToken: (process.env.DO_TOKEN ?? '').trim(),
  },
};

export const DB_NAMES: DbName[] = ['main', 'dev', 'release', 'stage'];
export const REPO_NAMES = ['front', 'back'] as const;
export type RepoName = typeof REPO_NAMES[number];
