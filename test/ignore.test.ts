import { describe, expect, it } from 'vitest';
import { isIgnored, rulesForFile } from '../src/engine.js';
import type { Rubric } from '../src/schema.js';

describe('isIgnored', () => {
  it('never sends likely secret files, at the root or nested', () => {
    for (const file of ['.env', '.env.local', 'apps/web/.env.production', 'certs/server.pem', 'deploy/id_rsa', '.npmrc'])
      expect(isIgnored(file), file).toBe(true);
  });

  it('still judges ordinary source', () => {
    for (const file of ['src/env.ts', 'src/environment.ts', 'docs/keys.md']) expect(isIgnored(file), file).toBe(false);
  });
});

describe('scope globs', () => {
  const rubric = (scope: string[]): Rubric => ({
    version: 1,
    rules: [{ id: 'r', question: 'q?', phase: 'turn', scope, repairAt: 0.8, noteAt: 0.5 }],
  });
  const hits = (scope: string[], file: string): boolean => rulesForFile(rubric(scope), file, 'turn').length === 1;

  it('supports braces and ?', () => {
    expect(hits(['src/**/*.{ts,tsx}'], 'src/a.ts')).toBe(true);
    expect(hits(['src/**/*.{ts,tsx}'], 'src/deep/b.tsx')).toBe(true);
    expect(hits(['src/**/*.{ts,tsx}'], 'src/a.js')).toBe(false);
    expect(hits(['src/?.ts'], 'src/a.ts')).toBe(true);
    expect(hits(['src/?.ts'], 'src/ab.ts')).toBe(false);
  });

  it('keeps everything else literal', () => {
    expect(hits(['src/a+b.ts'], 'src/a+b.ts')).toBe(true);
    expect(hits(['src/a.ts'], 'src/aXts')).toBe(false);
    expect(hits(['src/{x'], 'src/{x')).toBe(true);
  });
});
