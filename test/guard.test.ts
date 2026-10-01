import { describe, expect, it } from 'vitest';
import { rubricDrift } from '../src/guard.js';
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

describe('rubricDrift', () => {
  it('flags a removed rule', () => {
    expect(rubricDrift(rubric([rule({ id: 'a' })]), rubric([])).loosened).toContain('a: removed');
  });

  it('flags a raised repairAt or noteAt (higher bar = weaker)', () => {
    const before = rubric([rule({ id: 'a', repairAt: 0.8, noteAt: 0.5 })]);
    const after = rubric([rule({ id: 'a', repairAt: 0.9, noteAt: 0.6 })]);
    const { loosened } = rubricDrift(before, after);
    expect(loosened.some((l) => l.includes('repairAt raised'))).toBe(true);
    expect(loosened.some((l) => l.includes('noteAt raised'))).toBe(true);
  });

  it('flags a rule newly deferred to a tool', () => {
    const after = rubric([rule({ id: 'a', handledBy: 'eslint' })]);
    const { loosened } = rubricDrift(rubric([rule({ id: 'a' })]), after);
    expect(loosened.some((l) => l.includes('deferred to eslint'))).toBe(true);
  });

  it('allows additions and tightening', () => {
    const before = rubric([rule({ id: 'a', repairAt: 0.8 })]);
    const after = rubric([rule({ id: 'a', repairAt: 0.7 }), rule({ id: 'b' })]);
    expect(rubricDrift(before, after).loosened).toHaveLength(0);
  });
});
