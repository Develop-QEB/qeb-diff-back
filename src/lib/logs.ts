import { spawn } from 'node:child_process';
import { config, LogSource } from '../config.js';

export interface LogSourceInfo {
  key: string;
  label: string;
  type: 'pm2' | 'do';
  configured: boolean;
}

export interface LogsResponse {
  env: string;
  source: 'pm2' | 'digitalocean';
  lines: string[];
  cursor: string | null;
  truncated: boolean;
  fetchedAt: string;
}

const MAX_LINES = 500;
const DEFAULT_LINES = 200;

export function listSources(): LogSourceInfo[] {
  const doReady = !!(config.logs.doAppId && config.logs.doComponent && config.logs.doToken);
  return config.logs.sources.map((s) => ({
    key: s.key,
    label: s.label,
    type: s.type,
    configured: s.type === 'pm2' ? !!s.pm2Name : doReady,
  }));
}

function findSource(key: string): LogSource | undefined {
  return config.logs.sources.find((s) => s.key === key);
}

function sliceSince(all: string[], cursor: string | null): string[] {
  if (!cursor) return all;
  const idx = all.lastIndexOf(cursor);
  if (idx < 0) return all;
  return all.slice(idx + 1);
}

function runCmd(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false });
    let out = '';
    let err = '';
    const to = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout ejecutando ${cmd}`));
    }, timeoutMs);
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(to); reject(e); });
    child.on('close', (code) => {
      clearTimeout(to);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

async function fetchPm2(procName: string, lines: number): Promise<string[]> {
  const out = await runCmd('pm2', ['logs', procName, '--raw', '--nostream', '--lines', String(lines)], 5000);
  return out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
}

interface DoLogsPayload {
  historic_urls?: string[];
  live_url?: string;
}

async function fetchDo(appId: string, componentName: string, token: string, lines: number): Promise<string[]> {
  const url = `https://api.digitalocean.com/v2/apps/${appId}/components/${encodeURIComponent(componentName)}/logs?type=RUN&follow=false&tail_lines=${lines}`;
  const metaRes = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!metaRes.ok) {
    throw new Error(`DO logs ${metaRes.status}: ${(await metaRes.text()).slice(0, 200)}`);
  }
  const meta = (await metaRes.json()) as DoLogsPayload;
  const urls = meta.historic_urls ?? [];
  if (urls.length === 0) return [];
  const chunks = await Promise.all(
    urls.slice(-3).map(async (u) => {
      const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return '';
      return await r.text();
    })
  );
  const all = chunks.join('\n').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  return all.slice(-lines);
}

export async function fetchLogs(sourceKey: string, cursor: string | null, lines: number): Promise<LogsResponse> {
  const src = findSource(sourceKey);
  if (!src) throw new Error(`fuente de logs desconocida: ${sourceKey}`);

  const n = Math.min(MAX_LINES, Math.max(10, lines || DEFAULT_LINES));
  let source: 'pm2' | 'digitalocean';
  let all: string[];

  if (src.type === 'do') {
    const { doAppId, doComponent, doToken } = config.logs;
    if (!doAppId || !doComponent || !doToken) {
      throw new Error(`${src.key} sin configurar: faltan DO_APP_ID / DO_COMPONENT / DO_TOKEN en .env`);
    }
    source = 'digitalocean';
    all = await fetchDo(doAppId, doComponent, doToken, n);
  } else {
    if (!src.pm2Name) throw new Error(`${src.key} sin configurar: falta el nombre de proceso pm2`);
    source = 'pm2';
    all = await fetchPm2(src.pm2Name, n);
  }

  const sliced = sliceSince(all, cursor);
  const last = all[all.length - 1] ?? null;

  return {
    env: src.key,
    source,
    lines: sliced,
    cursor: last,
    truncated: !cursor && all.length >= n,
    fetchedAt: new Date().toISOString(),
  };
}
