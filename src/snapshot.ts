// Turn snapshots, the git I/O behind the turn-check. A snapshot is a git TREE of the
// whole working tree - tracked AND untracked files, minus .gitignored ones - built in a
// scratch index so the user's real index is never touched. Diffing two such trees shows
// exactly what a turn changed, including brand-new files (which `git stash create` and
// plain `git diff` both miss). The snapshot ref lives in the git dir, not the working tree.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRef, git } from './git.js';

const BASE_FILE = 'leash-turn-base';
const BLOCKED_FILE = 'leash-blocked.json';
const TREE_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Absolute path of the repo's git dir. */
export function gitDir(): string {
  return git(['rev-parse', '--absolute-git-dir'], { quiet: true }).trim();
}

// The scratch index lives in a fresh temp dir per call: two sessions never share it, and a
// lock left by a killed run is never seen again, so it cannot wedge later snapshots.
/** Tree id of the current working tree, untracked files included, real index untouched. */
export function worktreeTree(): string {
  const scratch = mkdtempSync(join(tmpdir(), 'leash-index-'));
  try {
    return treeWithIndex(join(scratch, 'index'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function treeWithIndex(index: string): string {
  const real = join(gitDir(), 'index');
  if (existsSync(real)) copyFileSync(real, index);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(['add', '-A'], { env, quiet: true });
  return git(['write-tree'], { env }).trim();
}

/** Record the turn's starting point (UserPromptSubmit); a new turn starts a clean block record. */
export function writeTurnBase(): void {
  writeFileSync(join(gitDir(), BASE_FILE), `${worktreeTree()}\n`);
  rmSync(join(gitDir(), BLOCKED_FILE), { force: true });
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

/** The turn's starting point: the tree id in the git-dir marker, else HEAD. Anything
 * that isn't a tree id (a hand-edited or corrupt marker) falls back to HEAD. */
export function readTurnBase(): string {
  const path = join(gitDir(), BASE_FILE);
  const base = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  return TREE_ID.test(base) ? base : 'HEAD';
}

/** Diff from `base` (any tree-ish) to the current working tree, untracked files included. */
export function diffToWorktree(base: string, file?: string): string {
  return git(['diff', assertRef(base), worktreeTree(), '--', ...(file ? [file] : [])]);
}
