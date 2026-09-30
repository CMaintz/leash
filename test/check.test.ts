import { describe, expect, it } from 'vitest';
import { checkTurn } from '../src/check.js';
import type { JevProvider, JevRequest, JevResponse } from '../src/provider.js';
import type { Rubric } from '../src/schema.js';

const rubric: Rubric = {
  version: 1,
  rules: [
    {
      id: 'no-premature-abstraction',
      question: 'abstraction used once?',
      phase: 'turn',
      scope: ['src/**/*.ts'],
      repairAt: 0.8,
      noteAt: 0.5,
    },
    {
      id: 'small-functions',
      question: 'function does two things?',
      phase: 'turn',
      scope: [],
      repairAt: 0.8,
      noteAt: 0.5,
    },
  ],
};

class FakeProvider implements JevProvider {
  calls: JevRequest[] = [];
  constructor(private readonly answersFor: (req: JevRequest) => JevResponse['answers']) {}
  async evaluate(req: JevRequest): Promise<JevResponse> {
    this.calls.push(req);
    return { model: 'fake', answers: this.answersFor(req) };
  }
}

describe('checkTurn', () => {
  it('makes one batched call per changed file and bands the answers', async () => {
    const provider = new FakeProvider(() => ({
      'no-premature-abstraction': { type: 'noul', noul: 0.9 },
      'small-functions': { type: 'noul', noul: 0.2 },
    }));
    const { findings, actionable } = await checkTurn(provider, rubric, [{ file: 'src/a.ts', patch: 'diff' }], []);
    expect(provider.calls).toHaveLength(1);
    expect(findings).toHaveLength(1);
    expect(actionable[0]!.ruleId).toBe('no-premature-abstraction');
  });

  it('ratchets: a baselined finding is not actionable', async () => {
    const provider = new FakeProvider(() => ({ 'small-functions': { type: 'noul', noul: 0.9 } }));
    const { actionable } = await checkTurn(
      provider,
      rubric,
      [{ file: 'README.md', patch: 'd' }],
      ['small-functions::README.md'],
    );
    expect(actionable).toHaveLength(0);
  });

  it('makes no call when no rule is in scope for the file', async () => {
    const scoped: Rubric = {
      version: 1,
      rules: [{ id: 'x', question: '?', phase: 'turn', scope: ['src/**'], repairAt: 0.8, noteAt: 0.5 }],
    };
    const provider = new FakeProvider(() => ({}));
    await checkTurn(provider, scoped, [{ file: 'docs/readme.md', patch: 'd' }], []);
    expect(provider.calls).toHaveLength(0);
  });
});
