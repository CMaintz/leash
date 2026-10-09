import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { envFiles, resolveEnv } from './env.js';
import { DEFAULT_DEADLINE_MS } from './check.js';
import { positiveMs, providerFromEnv, type JevProvider } from './provider.js';
import { parseRubric, type Rubric } from './schema.js';

export const RUBRIC_PATH = '.leash/rubric.json';
export const BASELINE_PATH = '.leash/baseline.json';

export function loadRubric(): Rubric | null {
  if (!existsSync(RUBRIC_PATH)) return null;
  return parseRubric(JSON.parse(readFileSync(RUBRIC_PATH, 'utf8')));
}

export function tryLoadRubric(): Rubric | null {
  try {
    return loadRubric();
  } catch {
    return null;
  }
}

export function loadRubricAt(ref: string): Rubric | null {
  try {
    const text = execSync(`git show ${ref}:${RUBRIC_PATH}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return parseRubric(JSON.parse(text));
  } catch {
    return null;
  }
}

export function loadBaseline(): string[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed: unknown = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync('.leash', { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The repo root, or the cwd outside a git repo. */
export function projectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

/** The process env plus Leash's env files (see env.ts). */
function leashEnv(): NodeJS.ProcessEnv {
  return resolveEnv(process.env, envFiles(projectRoot()));
}

/** The provider from leashEnv(); null = no key, fail open. */
export function cliProvider(): JevProvider | null {
  return providerFromEnv(leashEnv());
}

/** Aborts once the turn budget (LEASH_DEADLINE_MS, default 60s) is spent. */
export function turnSignal(): AbortSignal {
  return AbortSignal.timeout(positiveMs(leashEnv().LEASH_DEADLINE_MS, DEFAULT_DEADLINE_MS));
}
