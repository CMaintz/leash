import { describe, expect, it } from 'vitest';
import { parseRubric } from '../src/schema.js';

describe('parseRubric', () => {
  it('applies defaults for omitted fields', () => {
    const rubric = parseRubric({ rules: [{ id: 'a', question: 'broken?' }] });
    expect(rubric.version).toBe(1);
    expect(rubric.rules[0]).toMatchObject({ phase: 'turn', scope: [], repairAt: 0.8, noteAt: 0.5 });
  });

  it('keeps explicit fields including provenance', () => {
    const rubric = parseRubric({
      version: 2,
      rules: [
        { id: 'a', question: 'q?', phase: 'edit', scope: ['x'], repairAt: 0.9, noteAt: 0.4, source: 'CLAUDE.md:5' },
      ],
    });
    expect(rubric.rules[0]).toMatchObject({ phase: 'edit', scope: ['x'], repairAt: 0.9, source: 'CLAUDE.md:5' });
  });

  it('clamps out-of-range thresholds back to the default', () => {
    const rubric = parseRubric({ rules: [{ id: 'a', question: 'q?', repairAt: 5 }] });
    expect(rubric.rules[0]!.repairAt).toBe(0.8);
  });

  it('throws on malformed input', () => {
    expect(() => parseRubric({})).toThrow();
    expect(() => parseRubric({ rules: [{ id: 'a' }] })).toThrow();
  });
});
