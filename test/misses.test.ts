import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capLines, logMiss, recentMisses } from '../src/misses.js';

describe('capLines', () => {
  it('keeps only the newest lines', () => {
    expect(capLines('a\nb\nc\n', 2)).toBe('b\nc\n');
    expect(capLines('a\n', 2)).toBe('a\n');
  });
});

describe('miss log', () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'leash-miss-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('records misses in the git dir and reads the newest back', () => {
    execSync('git init -q');
    logMiss('hook', 'no JEV_API_KEY', new Date('2026-10-09T10:00:00Z'));
    logMiss('hook', 'src/a.ts: turn deadline reached', new Date('2026-10-09T10:01:00Z'));
    expect(recentMisses(1)).toEqual([
      { at: '2026-10-09T10:01:00.000Z', command: 'hook', reason: 'src/a.ts: turn deadline reached' },
    ]);
    expect(execSync('git status --porcelain', { encoding: 'utf8' })).toBe(''); // nothing in the work tree
  });

  it('never throws outside a git repo', () => {
    expect(() => logMiss('hook', 'x')).not.toThrow();
    expect(recentMisses(5)).toEqual([]);
  });
});
