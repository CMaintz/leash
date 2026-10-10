import { describe, expect, it } from 'vitest';
import {
  bandFor,
  baselineFrom,
  rebaseline,
  fingerprint,
  findingsForFile,
  newFindings,
  questionsForFile,
  rulesForFile,
} from '../src/engine.js';
import type { Answer } from '../src/provider.js';
import type { Finding } from '../src/schema.js';
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

const rubric: Rubric = {
  version: 1,
  rules: [rule({ id: 'no-premature-abstraction', scope: ['src/**/*.ts'] }), rule({ id: 'small-functions', scope: [] })],
};

const noul = (n: number): Answer => ({ type: 'noul', noul: n });

describe('scope', () => {
  it('empty scope matches every file; a glob filters', () => {
    expect(Object.keys(questionsForFile(rubric, 'src/a.ts')).sort()).toEqual([
      'no-premature-abstraction',
      'small-functions',
    ]);
    expect(Object.keys(questionsForFile(rubric, 'README.md'))).toEqual(['small-functions']);
  });

  it('** matches both nested and top-level paths', () => {
    expect(rulesForFile(rubric, 'src/x/y.ts').map((r) => r.id)).toContain('no-premature-abstraction');
    expect(rulesForFile(rubric, 'src/a.ts').map((r) => r.id)).toContain('no-premature-abstraction');
  });
});

describe('banding', () => {
  it('applies repair/note/off thresholds', () => {
    const r = rule();
    expect(bandFor(r, 0.9)).toBe('repair');
    expect(bandFor(r, 0.6)).toBe('note');
    expect(bandFor(r, 0.3)).toBe('off');
  });
});

describe('findings and ratchet', () => {
  it('builds findings and drops the off band', () => {
    const answers: Record<string, Answer> = { 'no-premature-abstraction': noul(0.9), 'small-functions': noul(0.3) };
    const findings = findingsForFile(rubric, 'src/a.ts', answers);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('no-premature-abstraction');
    expect(findings[0]!.band).toBe('repair');
  });

  it('ratchets baselined fingerprints out of the new set', () => {
    const findings = findingsForFile(rubric, 'src/a.ts', { 'small-functions': noul(0.9) });
    expect(fingerprint(findings[0]!)).toBe('small-functions::src/a.ts');
    expect(newFindings(findings, ['small-functions::src/a.ts'])).toHaveLength(0);
    expect(newFindings(findings, [])).toHaveLength(1);
  });

  it('baselineFrom is sorted and de-duplicated', () => {
    const answers: Record<string, Answer> = { 'no-premature-abstraction': noul(0.9), 'small-functions': noul(0.9) };
    const findings = findingsForFile(rubric, 'src/a.ts', answers);
    expect(baselineFrom(findings)).toEqual(['no-premature-abstraction::src/a.ts', 'small-functions::src/a.ts']);
  });
});

describe('edit phase', () => {
  const mixed: Rubric = {
    version: 1,
    rules: [rule({ id: 'turn-rule', phase: 'turn' }), rule({ id: 'edit-rule', phase: 'edit', scope: ['src/**/*.ts'] })],
  };

  it('selects only edit-phase rules in scope', () => {
    expect(Object.keys(questionsForFile(mixed, 'src/a.ts', 'edit'))).toEqual(['edit-rule']);
    expect(Object.keys(questionsForFile(mixed, 'README.md', 'edit'))).toEqual([]);
  });

  it('bands edit-phase answers and ignores turn rules', () => {
    const answers: Record<string, Answer> = { 'edit-rule': noul(0.9), 'turn-rule': noul(0.9) };
    const findings = findingsForFile(mixed, 'src/a.ts', answers, 'edit');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('edit-rule');
  });
});

describe('rebaseline', () => {
  const f = (ruleId: string, file: string): Finding => ({ ruleId, file }) as Finding;

  it('refreshes judged files and keeps everything else', () => {
    const before = ['a::src/x.ts', 'a::src/untouched.ts', 'a::src/skipped.ts'];
    const out = rebaseline(before, new Set(['src/x.ts', 'src/y.ts']), [f('b', 'src/y.ts')]);
    expect(out).toEqual(['a::src/skipped.ts', 'a::src/untouched.ts', 'b::src/y.ts']);
  });

  it('a clean audit of nothing leaves the baseline alone', () => {
    expect(rebaseline(['a::src/x.ts'], new Set(), [])).toEqual(['a::src/x.ts']);
  });
});
