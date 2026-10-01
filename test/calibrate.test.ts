import { describe, expect, it } from 'vitest';
import { calibrationReport, tallyFires } from '../src/calibrate.js';
import type { FileDiff } from '../src/diff.js';
import type { Answer, JevProvider, JevRequest, JevResponse } from '../src/provider.js';
import type { Rubric } from '../src/schema.js';

describe('calibrationReport', () => {
  it('computes rate and flags never-firing rules as dead', () => {
    const rows = calibrationReport({ a: 3, b: 0 }, 4);
    expect(rows).toContainEqual({ rule: 'a', fires: 3, rate: 0.75, dead: false });
    expect(rows).toContainEqual({ rule: 'b', fires: 0, rate: 0, dead: true });
  });

  it('treats a zero sample as rate 0 (no divide-by-zero)', () => {
    expect(calibrationReport({ a: 0 }, 0)).toEqual([{ rule: 'a', fires: 0, rate: 0, dead: true }]);
  });
});

const rubric: Rubric = {
  version: 1,
  rules: [
    { id: 'a', question: '?', phase: 'turn', scope: [], repairAt: 0.8, noteAt: 0.5 },
    { id: 'b', question: '?', phase: 'turn', scope: [], repairAt: 0.8, noteAt: 0.5 },
    { id: 'c', question: '?', phase: 'turn', scope: [], repairAt: 0.8, noteAt: 0.5 },
    { id: 'lint', question: '?', phase: 'turn', scope: [], repairAt: 0.8, noteAt: 0.5, handledBy: 'eslint' },
    { id: 'e', question: '?', phase: 'edit', scope: [], repairAt: 0.8, noteAt: 0.5 },
  ],
};

const noul = (n: number): Answer => ({ type: 'noul', noul: n });

class FakeProvider implements JevProvider {
  seen: string[] = [];
  constructor(private readonly perFile: (file: string) => Record<string, Answer>) {}
  async evaluate(req: JevRequest): Promise<JevResponse> {
    const file = (req.state as { file: string }).file;
    this.seen.push(...Object.keys(req.questions));
    return { model: 'fake', answers: this.perFile(file) };
  }
}

describe('tallyFires', () => {
  const commits: FileDiff[][] = [[{ file: 'x', patch: 'p' }], [{ file: 'y', patch: 'p' }]];

  it('counts commits where a rule fired, zeroes a dead rule, and ignores handledBy/edit rules', async () => {
    const provider = new FakeProvider((file) =>
      file === 'x' ? { a: noul(0.9), b: noul(0.3), c: noul(0.1) } : { a: noul(0.1), b: noul(0.6), c: noul(0.2) },
    );
    const hits = await tallyFires(provider, rubric, commits);
    expect(hits).toEqual({ a: 1, b: 1, c: 0 });
    expect(provider.seen).not.toContain('lint');
    expect(provider.seen).not.toContain('e');
  });
});
