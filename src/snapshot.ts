// Turn snapshots, the git I/O behind the turn-check. A snapshot is a git TREE of the
// whole working tree - tracked AND untracked files, minus .gitignored ones - built in a
// scratch index so the user's real index is never touched. Diffing two such trees shows
// exactly what a turn changed, including brand-new files (which `git stash create` and
// plain `git diff` both miss). The snapshot ref lives in the git dir, not the working tree,
// one per agent session, so two sessions in one checkout never reset each other's turn.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRef, git } from './git.js';

const BASE_FILE = 'leash-turn-base';
const BLOCKED_FILE = 'leash-blocked.json';
const TREE_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** Building the snapshot tree may take at most this long. The snapshot hook's host timeout
 * is 30s, so a too-large tree fails here and logs a miss instead of being killed silently. */
const SNAPSHOT_TIMEOUT_MS = 25_000;
const STALE_STATE_MS = 7 * 24 * 60 * 60 * 1000;

/** Absolute path of the repo's git dir. */
export function gitDir(): string {
  return git(['rev-parse', '--absolute-git-dir'], { quiet: true }).trim();
}

/** The git-dir file holding `name` for `session` (hosts send a session_id per event). */
function stateFile(name: string, session?: string): string {
  const key = session ? `-${session.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}` : '';
  return join(gitDir(), `${name}${key}`);
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
  if (existsSync(real)) copyIndex(real, index);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  git(['add', '-A'], { env, quiet: true, timeoutMs: SNAPSHOT_TIMEOUT_MS });
  return git(['write-tree'], { env, timeoutMs: SNAPSHOT_TIMEOUT_MS }).trim();
}

// Keep the real index's mtime on the copy. Git trusts an entry whose stat matches unless the
// file is as new as the index itself ("racy git"); a copy stamped "now" hides a same-size
// edit made within a second of the last index write, so that edit would look unchanged.
function copyIndex(real: string, copy: string): void {
  copyFileSync(real, copy);
  const { atime, mtime } = statSync(real);
  utimesSync(copy, atime, mtime);
}

/** Record the turn's starting point (UserPromptSubmit); a new turn starts a clean block record. */
export function writeTurnBase(session?: string): void {
  writeFileSync(stateFile(BASE_FILE, session), `${worktreeTree()}\n`);
  rmSync(stateFile(BLOCKED_FILE, session), { force: true });
  pruneStaleState();
}

// Ended sessions leave their two small files behind; drop any untouched for a week.
function pruneStaleState(): void {
  const dir = gitDir();
  for (const name of readdirSync(dir)) {
    if (!/^leash-(?:turn-base|blocked\.json)-/.test(name)) continue;
    const path = join(dir, name);
    if (Date.now() - statSync(path).mtimeMs > STALE_STATE_MS) rmSync(path, { force: true });
  }
}

/** Fingerprints the Stop hook already blocked on during the turn that started at `base`. */
export function readBlocked(base: string, session?: string): string[] {
  const path = stateFile(BLOCKED_FILE, session);
  if (!existsSync(path)) return [];
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as { base?: string; fingerprints?: string[] };
    return record.base === base && Array.isArray(record.fingerprints) ? record.fingerprints : [];
  } catch {
    return []; // a corrupt record only means one extra block, never a missed check
  }
}

/** Persist the turn's block record (see readBlocked). */
export function recordBlocked(base: string, fingerprints: string[], session?: string): void {
  writeFileSync(stateFile(BLOCKED_FILE, session), JSON.stringify({ base, fingerprints }));
}

/** The turn's starting point: the tree id in the git-dir marker, else HEAD. Anything
 * that isn't a tree id (a hand-edited or corrupt marker) falls back to HEAD. */
export function readTurnBase(session?: string): string {
  const path = stateFile(BASE_FILE, session);
  const base = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  return TREE_ID.test(base) ? base : 'HEAD';
}

/** Diff from `base` (any tree-ish) to the current working tree, untracked files included,
 * limited to `paths` when given. */
export function diffToWorktree(base: string, paths: readonly string[] = []): string {
  return git(['diff', assertRef(base), worktreeTree(), '--', ...paths]);
}

/** The empty tree's id: diffing from it shows every file as newly written. */
export function emptyTree(): string {
  return git(['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim();
}
