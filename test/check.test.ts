import { describe, expect, it } from 'vitest';
import { checkTurn, DEADLINE_REASON } from '../src/check.js';
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

  it('isolates a failing call: that file is skipped, the rest still judged', async () => {
    const provider = new FakeProvider((req) => {
      if ((req.state as { file: string }).file === 'src/bad.ts') throw new Error('Jev request failed: 500');
      return { 'small-functions': { type: 'noul', noul: 0.9 } };
    });
    const diffs = [
      { file: 'src/bad.ts', patch: 'd' },
      { file: 'src/ok.ts', patch: 'd' },
    ];
    const { actionable, skipped } = await checkTurn(provider, rubric, diffs, []);
    expect(skipped).toEqual([{ file: 'src/bad.ts', reason: 'Jev request failed: 500' }]);
    expect(actionable.map((f) => f.file)).toEqual(['src/ok.ts']);
  });

  it('chunks an oversized patch and flags a rule if any chunk breaks it', async () => {
    let call = 0;
    const provider = new FakeProvider(() => ({ 'small-functions': { type: 'noul', noul: call++ === 1 ? 0.9 : 0.1 } }));
    const patch = [
      'diff --git a/x b/x',
      `@@ -1 +1 @@\n+${'a'.repeat(1_500)}`,
      `@@ -2 +2 @@\n+${'b'.repeat(1_500)}`,
    ].join('\n');
    const { actionable } = await checkTurn(provider, rubric, [{ file: 'docs/x.md', patch }], [], {
      maxPatchChars: 2_000,
    });
    expect(provider.calls.length).toBeGreaterThan(1);
    expect((provider.calls[0]!.state as { part?: string }).part).toMatch(/^1\//);
    expect(actionable).toHaveLength(1);
  });

  it('never calls Jev for leash state, lockfiles, or binary patches', async () => {
    const provider = new FakeProvider(() => ({ 'small-functions': { type: 'noul', noul: 0.9 } }));
    const diffs = [
      { file: '.leash/baseline.json', patch: 'd' },
      { file: 'package-lock.json', patch: 'd' },
      { file: 'img/logo.png', patch: 'Binary files a/img/logo.png and b/img/logo.png differ' },
    ];
    const { findings } = await checkTurn(provider, rubric, diffs, []);
    expect(provider.calls).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });

  it('keeps findings in diff order under concurrency', async () => {
    const provider = new FakeProvider(() => ({ 'small-functions': { type: 'noul', noul: 0.9 } }));
    const diffs = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ file: `docs/${n}.md`, patch: 'd' }));
    const { findings } = await checkTurn(provider, rubric, diffs, [], { concurrency: 3 });
    expect(findings.map((f) => f.file)).toEqual(diffs.map((d) => d.file));
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

describe('turn deadline', () => {
  const files = [
    { file: 'src/a.ts', patch: 'a' },
    { file: 'src/b.ts', patch: 'b' },
  ];

  it('skips every file without calling Jev once the deadline has passed', async () => {
    const provider = new FakeProvider(() => ({}));
    const { skipped } = await checkTurn(provider, rubric, files, [], { signal: AbortSignal.abort() });
    expect(provider.calls).toHaveLength(0);
    expect(skipped).toEqual(files.map(({ file }) => ({ file, reason: DEADLINE_REASON })));
  });

  it('passes the signal to the provider and names the deadline when an in-flight call is cut', async () => {
    const controller = new AbortController();
    const provider: JevProvider = {
      evaluate: (req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          controller.abort();
        }),
    };
    const { skipped } = await checkTurn(provider, rubric, files.slice(0, 1), [], { signal: controller.signal });
    expect(skipped).toEqual([{ file: 'src/a.ts', reason: DEADLINE_REASON }]);
  });
});
