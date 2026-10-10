// Where Leash finds its config: the process env first, then KEY=value files - the repo's
// .env.local and .env, then ~/.leash/.env (what `leash login` writes). Only Leash's own
// keys are read from those files, so an app's other secrets in .env are never picked up.
// A repo's files are untrusted (anyone can commit one), so they may never choose where
// requests go: the endpoint, provider and account come only from the env or ~/.leash/.env.
// Otherwise a cloned repo could send the user's key and diffs to a server of its choosing.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LEASH_KEY = /^(JEV_|TYPESAFE_AI_|LEASH_)[A-Z0-9_]*$/;
/** The keys a repo's .env files may set: the key itself, the model and Leash's tuning. */
const REPO_KEY = /^(JEV_API_KEY|JEV_MODEL|LEASH_[A-Z0-9_]*)$/;
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** The user-level key file `leash login` writes. */
export function userEnvPath(home = homedir()): string {
  return join(home, '.leash', '.env');
}

/** An env file Leash reads; `repo` files are untrusted and limited to REPO_KEY. */
export interface EnvFile {
  path: string;
  repo: boolean;
}

/** The env files Leash reads, highest priority first. */
export function envFiles(root: string, home = homedir()): EnvFile[] {
  return [
    { path: join(root, '.env.local'), repo: true },
    { path: join(root, '.env'), repo: true },
    { path: userEnvPath(home), repo: false },
  ];
}

/** Parse KEY=value lines (optional `export`, quotes, # comments), keeping only Leash's keys. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match && LEASH_KEY.test(match[1]!)) out[match[1]!] = unquote(match[2]!);
  }
  return out;
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '');
}

/** The env Leash runs with: the process env wins, then the first file that sets a key. */
export function resolveEnv(env: NodeJS.ProcessEnv, files: readonly EnvFile[]): NodeJS.ProcessEnv {
  const fromFiles: Record<string, string> = {};
  for (const file of [...files].reverse()) Object.assign(fromFiles, readEnvFile(file));
  return { ...fromFiles, ...env };
}

function readEnvFile({ path, repo }: EnvFile): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars = parseEnvFile(readFileSync(path, 'utf8'));
  return repo ? Object.fromEntries(Object.entries(vars).filter(([key]) => REPO_KEY.test(key))) : vars;
}

/** Set `key=value` in env-file text, replacing an existing line for that key or appending. */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/).filter((line, i, all) => line !== '' || i < all.length - 1);
  const at = lines.findIndex((line) => LINE.exec(line)?.[1] === key);
  if (at >= 0) lines[at] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

/** Store the API key in ~/.leash/.env, owner-only (0600; Windows ignores the mode). */
export function saveApiKey(apiKey: string, path = userEnvPath()): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  writeFileSync(path, upsertEnvLine(text, 'JEV_API_KEY', apiKey), { mode: 0o600 });
  chmodSync(path, 0o600); // an existing file keeps its old mode on write
  return path;
}
