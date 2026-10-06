// Load and persist leash's on-disk state: the rubric and the accepted-debt baseline
// under .leash/. All reads fail soft (absent => null/empty) so the advisory CLI never
// throws on a missing or unreadable file.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// The rubric as of a git ref, or null if absent/unreadable there (guard then no-ops).
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
