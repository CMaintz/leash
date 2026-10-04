import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffToWorktree, readTurnBase, writeTurnBase } from '../src/snapshot.js';

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

  it('falls back to HEAD with no snapshot yet', () => {
    expect(readTurnBase()).toBe('HEAD');
  });
});
