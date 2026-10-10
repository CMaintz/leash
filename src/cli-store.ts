import { assertRef, git } from './git.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { envFiles, resolveEnv } from './env.js';
import { DEFAULT_DEADLINE_MS } from './check.js';
import { positiveMs, providerFromEnv, type JevProvider } from './provider.js';
import { parseRubric, type Rubric } from './schema.js';
import { SOURCES_PATH, type SourceStamp } from './sources.js';

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
    const text = git(['show', `${assertRef(ref)}:${RUBRIC_PATH}`], { quiet: true });
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
    return git(['rev-parse', '--show-toplevel'], { quiet: true }).trim();
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

/** The instruction-file stamp `leash compile` recorded, or null when there is none. */
export function loadSources(): SourceStamp | null {
  try {
    const parsed = JSON.parse(readFileSync(SOURCES_PATH, 'utf8')) as { files?: SourceStamp };
    return parsed.files && typeof parsed.files === 'object' ? parsed.files : null;
  } catch {
    return null;
  }
}
