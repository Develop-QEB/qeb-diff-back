import { config } from '../config.js';

export interface AsanaTask {
  gid: string;
  name: string;
  permalinkUrl: string;
  completed: boolean;
  assignee?: { gid: string; name: string } | null;
  dueOn?: string | null;
}

interface CacheEntry { at: number; task: AsanaTask | null }

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export class AsanaNotConfiguredError extends Error {
  constructor() {
    super('ASANA_TOKEN no configurado en .env');
    this.name = 'AsanaNotConfiguredError';
  }
}

export async function fetchAsanaTask(gid: string): Promise<AsanaTask | null> {
  if (!config.asanaToken) throw new AsanaNotConfiguredError();
  if (!/^\d{10,}$/.test(gid)) throw new Error('gid invalido');

  const now = Date.now();
  const cached = cache.get(gid);
  if (cached && now - cached.at < TTL_MS) return cached.task;

  const url = `https://app.asana.com/api/1.0/tasks/${gid}?opt_fields=name,permalink_url,completed,assignee.name,due_on`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.asanaToken}`, Accept: 'application/json' },
  });
  if (res.status === 404 || res.status === 403) {
    cache.set(gid, { at: now, task: null });
    return null;
  }
  if (!res.ok) throw new Error(`Asana API ${res.status}`);

  const body = (await res.json()) as { data: any };
  const d = body?.data;
  if (!d) {
    cache.set(gid, { at: now, task: null });
    return null;
  }

  const task: AsanaTask = {
    gid: d.gid,
    name: d.name ?? '',
    permalinkUrl: d.permalink_url ?? `https://app.asana.com/0/0/${gid}`,
    completed: Boolean(d.completed),
    assignee: d.assignee ? { gid: d.assignee.gid, name: d.assignee.name } : null,
    dueOn: d.due_on ?? null,
  };
  cache.set(gid, { at: now, task });
  return task;
}
