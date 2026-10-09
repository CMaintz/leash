import { describe, expect, it } from 'vitest';
import type { Rubric } from '../src/schema.js';
import {
  hashText,
  instructionFiles,
  sessionStartOutput,
  stampSources,
  staleNudge,
  staleSources,
} from '../src/sources.js';

const rule = (id: string, source?: string): Rubric['rules'][number] => ({
  id,
  question: 'q?',
  phase: 'turn',
  scope: [],
  repairAt: 0.8,
  noteAt: 0.5,
  ...(source ? { source } : {}),
});

describe('instructionFiles', () => {
  it('takes CLAUDE.md, AGENTS.md and every cited Markdown file, not cited code', () => {
    const rubric: Rubric = {
      version: 1,
      rules: [
        rule('a', 'docs/STYLE.md:12'),
        rule('b', 'CLAUDE.md conventions'),
        rule('c', 'src/check.ts: x'),
        rule('d'),
      ],
    };
    expect(instructionFiles(rubric)).toEqual(['AGENTS.md', 'CLAUDE.md', 'docs/STYLE.md']);
  });
});

describe('stamps', () => {
  it('ignores line endings', () => {
    expect(hashText('a\r\nb\r\n')).toBe(hashText('a\nb\n'));
  });

  it('stamps only files that exist', () => {
    const read = (file: string): string | null => (file === 'CLAUDE.md' ? 'rules' : null);
    expect(Object.keys(stampSources(['AGENTS.md', 'CLAUDE.md'], read))).toEqual(['CLAUDE.md']);
  });

  it('reports edited, added and removed sources', () => {
    const recorded = { 'CLAUDE.md': 'h1', 'old.md': 'h2' };
    const current = { 'CLAUDE.md': 'h1-edited', 'AGENTS.md': 'h3' };
    expect(staleSources(recorded, current)).toEqual(['AGENTS.md', 'CLAUDE.md', 'old.md']);
    expect(staleSources(current, current)).toEqual([]);
  });
});

describe('staleNudge', () => {
  it('is silent when nothing changed, and names the files when something did', () => {
    expect(staleNudge([])).toBeNull();
    const text = staleNudge(['CLAUDE.md'])!;
    expect(text).toContain('CLAUDE.md changed');
    expect(text).toContain('leash compile');
    expect(sessionStartOutput(text).hookSpecificOutput.hookEventName).toBe('SessionStart');
  });
});
