import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffToWorktree, readBlocked, readTurnBase, recordBlocked, writeTurnBase } from '../src/snapshot.js';

const git = (cmd: string): string => execSync(`git ${cmd}`, { encoding: 'utf8' });

describe('turn snapshots (real git repo)', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'leash-snap-'));
    process.chdir(dir);
    git('init -q');
    git('config user.email t@example.com');
    git('config user.name t');
    git('config core.autocrlf false');
    writeFileSync('tracked.ts', 'export const a = 1;\n');
    git('add -A');
    git('commit -qm init');
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('sees a brand-new untracked file and a tracked edit made during the turn', () => {
    writeFileSync('pre-existing-untracked.ts', 'export const p = 0;\n');
    writeTurnBase();
    writeFileSync('tracked.ts', 'export const a = 2;\n');
    writeFileSync('brand-new.ts', 'export const b = 1;\n');
    const diff = diffToWorktree(readTurnBase());
    expect(diff).toContain('brand-new.ts');
    expect(diff).toContain('tracked.ts');
    expect(diff).not.toContain('pre-existing-untracked.ts'); // unchanged within the turn
  });

  it('leaves the real index and the working tree untouched', () => {
    writeFileSync('new.ts', 'x\n');
    writeTurnBase();
    expect(git('diff --cached --name-only').trim()).toBe('');
    expect(git('status --porcelain')).toContain('?? new.ts'); // still untracked
    expect(existsSync(join('.leash', 'turn-base'))).toBe(false);
  });

  it('honors .gitignore', () => {
    writeFileSync('.gitignore', 'secret.env\n');
    git('add .gitignore');
    git('commit -qm ignore');
    writeTurnBase();
    writeFileSync('secret.env', 'TOKEN=x\n');
    expect(diffToWorktree(readTurnBase())).toBe('');
  });

  it('keeps a per-turn block record that a new snapshot clears', () => {
    writeTurnBase();
    const base = readTurnBase();
    recordBlocked(base, ['r::src/a.ts']);
    expect(readBlocked(base)).toEqual(['r::src/a.ts']);
    expect(readBlocked('some-other-turn')).toEqual([]);
    writeTurnBase();
    expect(readBlocked(readTurnBase())).toEqual([]);
  });

  it('falls back to HEAD with no snapshot yet', () => {
    expect(readTurnBase()).toBe('HEAD');
  });

  it('ignores a committed legacy marker and a marker that is not a tree id', () => {
    mkdirSync('.leash');
    writeFileSync(join('.leash', 'turn-base'), 'HEAD & echo PWNED> pwned.txt & rem\n');
    expect(readTurnBase()).toBe('HEAD');
    writeFileSync(join(git('rev-parse --absolute-git-dir').trim(), 'leash-turn-base'), 'HEAD; touch x\n');
    expect(readTurnBase()).toBe('HEAD');
    writeTurnBase();
    expect(readTurnBase()).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join('.leash', 'turn-base'))).toBe(true); // a user's file is never deleted
  });

  it('keeps a separate turn per session, so one session never resets another', () => {
    writeTurnBase('session-a');
    const a = readTurnBase('session-a');
    writeFileSync('tracked.ts', 'export const a = 3;\n');
    writeTurnBase('session-b');
    expect(readTurnBase('session-a')).toBe(a);
    expect(readTurnBase('session-b')).not.toBe(a);
    recordBlocked(a, ['r::x'], 'session-a');
    expect(readBlocked(a, 'session-b')).toEqual([]);
    expect(readBlocked(a, 'session-a')).toEqual(['r::x']);
    expect(readTurnBase('../../evil')).toBe('HEAD'); // ids are sanitized into a file name
  });

  it('treats a file name as data, never as shell', () => {
    writeTurnBase();
    // Legal on Windows too; under the old `sh -c` both substitutions ran on POSIX.
    const name = '$(touch inj) `touch inj2` & x.ts';
    writeFileSync(name, 'x\n');
    expect(diffToWorktree(readTurnBase(), [name])).toContain('x.ts');
    expect(existsSync('inj') || existsSync('inj2')).toBe(false);
  });
});
