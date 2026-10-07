// Turn snapshots, the git I/O behind the turn-check. A snapshot is a git TREE of the
// whole working tree - tracked AND untracked files, minus .gitignored ones - built in a
// scratch index so the user's real index is never touched. Diffing two such trees shows
// exactly what a turn changed, including brand-new files (which `git stash create` and
// plain `git diff` both miss). The snapshot ref lives in the git dir, not the working tree.

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_FILE = 'leash-turn-base';
const BLOCKED_FILE = 'leash-blocked.json';
const LEGACY_BASE = join('.leash', 'turn-base');
const MAX_BUFFER = 64 * 1024 * 1024;

/** Absolute path of the repo's git dir. */
function gitDir(): string {
  return execSync('git rev-parse --absolute-git-dir', { encoding: 'utf8' }).trim();
}

/** Tree id of the current working tree, untracked files included, real index untouched. */
export function worktreeTree(): string {
  const dir = gitDir();
  const index = join(dir, 'leash-index');
  const real = join(dir, 'index');
  if (existsSync(real)) copyFileSync(real, index);
  else rmSync(index, { force: true });
  const env = { ...process.env, GIT_INDEX_FILE: index };
  execSync('git add -A', { env, stdio: 'ignore' });
  return execSync('git write-tree', { env, encoding: 'utf8' }).trim();
}

/** Record the turn's starting point (UserPromptSubmit); a new turn starts a clean block record. */
export function writeTurnBase(): void {
  writeFileSync(join(gitDir(), BASE_FILE), `${worktreeTree()}\n`);
  rmSync(join(gitDir(), BLOCKED_FILE), { force: true });
  rmSync(LEGACY_BASE, { force: true });
}

/** Fingerprints the Stop hook already blocked on during the turn that started at `base`. */
export function readBlocked(base: string): string[] {
  const path = join(gitDir(), BLOCKED_FILE);
  if (!existsSync(path)) return [];
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as { base?: string; fingerprints?: string[] };
    return record.base === base && Array.isArray(record.fingerprints) ? record.fingerprints : [];
  } catch {
    return []; // a corrupt record only means one extra block, never a missed check
  }
}

/** Persist the turn's block record (see readBlocked). */
export function recordBlocked(base: string, fingerprints: string[]): void {
  writeFileSync(join(gitDir(), BLOCKED_FILE), JSON.stringify({ base, fingerprints }));
}

/** The turn's starting point: the git-dir marker, the pre-0.7 marker, else HEAD. */
export function readTurnBase(): string {
  const current = join(gitDir(), BASE_FILE);
  for (const path of [current, LEGACY_BASE]) {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim() || 'HEAD';
  }
  return 'HEAD';
}

/** Diff from `base` (any tree-ish) to the current working tree, untracked files included. */
export function diffToWorktree(base: string, file?: string): string {
  const path = file ? ` -- "${file}"` : '';
  return execSync(`git diff ${base} ${worktreeTree()}${path}`, { encoding: 'utf8', maxBuffer: MAX_BUFFER });
}
