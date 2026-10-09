// Where Leash finds its config: the process env first, then KEY=value files - the repo's
// .env.local and .env, then ~/.leash/.env (what `leash login` writes). Only Leash's own
// keys are read from those files, so an app's other secrets in .env are never picked up.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LEASH_KEY = /^(JEV_|TYPESAFE_AI_|LEASH_)[A-Z0-9_]*$/;
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** The user-level key file `leash login` writes. */
export function userEnvPath(home = homedir()): string {
  return join(home, '.leash', '.env');
}

/** The env files Leash reads, highest priority first. */
export function envFiles(root: string, home = homedir()): string[] {
  return [join(root, '.env.local'), join(root, '.env'), userEnvPath(home)];
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
export function resolveEnv(env: NodeJS.ProcessEnv, files: readonly string[]): NodeJS.ProcessEnv {
  const fromFiles: Record<string, string> = {};
  for (const file of [...files].reverse()) {
    if (existsSync(file)) Object.assign(fromFiles, parseEnvFile(readFileSync(file, 'utf8')));
  }
  return { ...fromFiles, ...env };
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
