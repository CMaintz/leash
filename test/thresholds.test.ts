import { describe, expect, it } from 'vitest';
import { questionsForFile } from '../src/engine.js';
import type { Rubric, Rule } from '../src/schema.js';
import { applyBands, parseYesAtThresholds, planBands, wireQuestion } from '../src/thresholds.js';

const rule = (id: string, extra: Partial<Rule> = {}): Rule => ({
  id,
  question: `Does it break ${id}?`,
  phase: 'turn',
  scope: [],
  repairAt: 0.8,
  noteAt: 0.5,
  ...extra,
});

const rubric: Rubric = { version: 1, rules: [rule('secret'), rule('single', { noteAt: 0.7 }), rule('quiet')] };

const file = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  model: 'jev-latest',
  generatedAt: '2026-10-10T12:00:00Z',
  questions: { secret: { type: 'noul', threshold: 0.6 } },
  composite: { threshold: 0.9 },
  yesAt: {
    secret: [
      { target: 0.9, threshold: 0.86, precision: 0.912, recall: 0.61, flagged: 0.31, n: 412 },
      { target: 0.7, threshold: 0.64, precision: 0.733, recall: 0.88, flagged: 0.52, n: 412 },
    ],
    single: [{ target: 0.9, threshold: 0.66 }],
  },
  ...extra,
});

const plan = (extra: Record<string, unknown> = {}, model = 'jev-latest') =>
  planBands(rubric, parseYesAtThresholds(file(extra)), model);

describe('parseYesAtThresholds', () => {
  it('reads model, generatedAt and yesAt, ignoring questions and composite', () => {
    const t = parseYesAtThresholds(file());
    expect(t.model).toBe('jev-latest');
    expect(t.generatedAt).toBe('2026-10-10T12:00:00Z');
    expect(t.yesAt.single).toEqual([{ target: 0.9, threshold: 0.66 }]);
    expect(t).not.toHaveProperty('questions');
  });

  it('refuses a version other than 1', () => {
    expect(() => parseYesAtThresholds(file({ version: 2 }))).toThrow(/unsupported version 2/);
  });

  it('refuses a file without a yesAt section', () => {
    expect(() => parseYesAtThresholds(file({ yesAt: undefined }))).toThrow(/no yesAt section/);
  });

  it('refuses malformed entries and non-objects', () => {
    expect(() => parseYesAtThresholds(null)).toThrow(/JSON object/);
    expect(() => parseYesAtThresholds(file({ model: 3 }))).toThrow(/missing model/);
    expect(() => parseYesAtThresholds(file({ yesAt: { a: {} } }))).toThrow(/yesAt.a must be a list/);
    expect(() => parseYesAtThresholds(file({ yesAt: { a: [{ target: 0.9, threshold: 2 }] } }))).toThrow(/yesAt.a\[0\]/);
  });
});

describe('planBands', () => {
  it('maps the strictest target to repairAt and the loosest to noteAt', () => {
    const change = plan().changes.find((c) => c.ruleId === 'secret');
    expect(change?.after).toEqual({ repairAt: 0.86, noteAt: 0.64 });
    expect(change?.before).toEqual({ repairAt: 0.8, noteAt: 0.5 });
    expect(change?.loose?.target).toBe(0.7);
  });

  it('picks by target, not list order', () => {
    const yesAt = { secret: [...(file().yesAt as { secret: unknown[] }).secret].reverse() };
    expect(plan({ yesAt }).changes[0]?.after).toEqual({ repairAt: 0.86, noteAt: 0.64 });
  });

  it('sets only repairAt from a single entry, capping noteAt at it', () => {
    const change = plan().changes.find((c) => c.ruleId === 'single');
    expect(change?.after).toEqual({ repairAt: 0.66, noteAt: 0.66 });
    expect(change?.loose).toBeUndefined();
    const lower = planBands({ version: 1, rules: [rule('single')] }, parseYesAtThresholds(file()), 'jev-latest');
    expect(lower.changes[0]?.after).toEqual({ repairAt: 0.66, noteAt: 0.5 });
  });

  it('lists rules jev-eval did not measure and warns on unknown ids', () => {
    const p = plan({ yesAt: { quiet: [], ghost: [{ target: 0.9, threshold: 0.9 }] } });
    expect(p.unmeasured).toEqual(['secret', 'single', 'quiet']);
    expect(p.warnings).toContain('ghost is in yesAt but not in the rubric; ignored');
  });

  it('skips a rule whose stricter target has the lower threshold', () => {
    const yesAt = {
      secret: [
        { target: 0.9, threshold: 0.5 },
        { target: 0.7, threshold: 0.6 },
      ],
    };
    const p = plan({ yesAt });
    expect(p.changes).toEqual([]);
    expect(p.warnings[0]).toMatch(/secret: stricter target has the lower threshold/);
  });

  it('warns on a model mismatch', () => {
    expect(plan({}, 'jev-2').warnings).toContain('measured on jev-latest, but Leash is configured for jev-2');
    expect(plan().warnings).toEqual([]);
  });

  it('warns when the measured definition differs from the question Leash sends', () => {
    const definitions = {
      secret: { instructions: 'Does it break secret?', type: 'noul' },
      single: { type: 'noul', instructions: 'Old wording?' },
    };
    expect(plan({ definitions }).warnings).toEqual(['single was reworded since it was measured; re-measure']);
  });
});

describe('wireQuestion', () => {
  it('matches the question the engine sends', () => {
    const r = rule('x');
    expect(questionsForFile({ version: 1, rules: [r] }, 'a.ts').x).toEqual(wireQuestion(r));
  });
});

describe('applyBands', () => {
  it('patches only the bands of changed rules and keeps every other field', () => {
    const raw = {
      version: 1,
      extra: true,
      rules: [
        { id: 'secret', question: 'q', custom: 'kept' },
        { id: 'quiet', question: 'q', repairAt: 0.9 },
      ],
    };
    const out = applyBands(raw, plan().changes);
    expect(out).toEqual({
      version: 1,
      extra: true,
      rules: [
        { id: 'secret', question: 'q', custom: 'kept', repairAt: 0.86, noteAt: 0.64 },
        { id: 'quiet', question: 'q', repairAt: 0.9 },
      ],
    });
  });

  it('returns a shapeless rubric unchanged', () => {
    expect(applyBands('nope', [])).toBe('nope');
  });
});
