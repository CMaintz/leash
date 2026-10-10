import { describe, expect, it } from 'vitest';
import { deadScopes, summarize } from '../src/compile.js';
import { questionsForFile } from '../src/engine.js';
import type { Rubric, Rule } from '../src/schema.js';

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r',
  question: 'broken?',
  phase: 'turn',
  scope: [],
  repairAt: 0.8,
  noteAt: 0.5,
  ...over,
});
const rubric = (rules: Rule[]): Rubric => ({ version: 1, rules });

describe('summarize', () => {
  it('counts active, deferred, and phases', () => {
    const s = summarize(
      rubric([
        rule({ id: 'a', phase: 'turn' }),
        rule({ id: 'b', phase: 'edit' }),
        rule({ id: 'c', handledBy: 'eslint' }),
      ]),
    );
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.deferred).toBe(1);
    expect(s.byPhase).toEqual({ turn: 1, edit: 1 });
    expect(s.deferrals).toEqual([{ id: 'c', handledBy: 'eslint' }]);
  });
});

describe('deterministic-first filtering', () => {
  it('the engine skips handledBy rules when building questions', () => {
    const r = rubric([rule({ id: 'a' }), rule({ id: 'b', handledBy: 'eslint' })]);
    expect(Object.keys(questionsForFile(r, 'src/x.ts'))).toEqual(['a']);
  });
});

describe('deadScopes', () => {
  it('flags globs that match no file, like a root-only *.ts', () => {
    const rubric: Rubric = {
      version: 1,
      rules: [
        { id: 'a', question: 'q', phase: 'turn', scope: ['*.ts', 'src/**'], repairAt: 0.8, noteAt: 0.5 },
        { id: 'b', question: 'q', phase: 'turn', scope: ['typo/**'], repairAt: 0.8, noteAt: 0.5, handledBy: 'eslint' },
      ],
    };
    expect(deadScopes(rubric, ['src/x.ts', 'src/y/z.ts'])).toEqual([{ id: 'a', glob: '*.ts' }]);
  });
});
