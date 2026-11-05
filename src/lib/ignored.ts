import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepoName } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../../ignored.json');

export interface IgnoredEntry {
  repo: RepoName;
  hash: string;
  subject: string;
  reason?: string;
  at: string;
}

interface Store { entries: IgnoredEntry[] }

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.entries)) return parsed;
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

async function writeStore(s: Store): Promise<void> {
  await fs.writeFile(FILE, JSON.stringify(s, null, 2));
}

export async function listIgnored(repo?: RepoName): Promise<IgnoredEntry[]> {
  const s = await readStore();
  return repo ? s.entries.filter((e) => e.repo === repo) : s.entries;
}

export async function ignoredHashesByRepo(repo: RepoName): Promise<Set<string>> {
  const s = await readStore();
  return new Set(s.entries.filter((e) => e.repo === repo).map((e) => e.hash));
}

export async function addIgnored(entry: Omit<IgnoredEntry, 'at'>): Promise<void> {
  const s = await readStore();
  if (s.entries.some((e) => e.repo === entry.repo && e.hash === entry.hash)) return;
  s.entries.push({ ...entry, at: new Date().toISOString() });
  await writeStore(s);
}

export async function removeIgnored(repo: RepoName, hash: string): Promise<void> {
  const s = await readStore();
  s.entries = s.entries.filter((e) => !(e.repo === repo && e.hash === hash));
  await writeStore(s);
}
